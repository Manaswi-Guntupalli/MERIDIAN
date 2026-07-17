// Lumen — image preprocessing.
//
// OCR accuracy is decided *before* the OCR engine ever runs. A 1° skew, a grey
// cast from a phone camera, or a 96-DPI scan will each cost more accuracy than
// any amount of clever parsing afterwards can win back. So this module does the
// unglamorous work: straighten it, clean it, make the ink black and the paper
// white, and hand Tesseract the easiest possible problem.
//
// Every step is measured and reported (see `PreprocessReport`) so the UI can
// explain *why* a document scored badly instead of just shrugging.

import sharp from 'sharp';
import type { QualityMetrics } from './types.js';

export interface PreprocessReport {
  rotation: number;
  skewDeg: number;
  quality: QualityMetrics;
  upscaled: boolean;
  /** The cleaned image handed to the OCR engine. */
  buffer: Buffer;
  width: number;
  height: number;
}

/** Tesseract is happiest around 300 DPI; below ~1600px wide for A4 we upscale. */
const TARGET_MIN_WIDTH = 1700;
const MAX_WIDTH = 3000;

/** Pull a raw single-channel greyscale bitmap we can do real maths on. */
async function greyRaw(
  input: Buffer,
  maxWidth: number,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const img = sharp(input).greyscale();
  const meta = await img.metadata();
  const scale = meta.width && meta.width > maxWidth ? maxWidth / meta.width : 1;
  const { data, info } = await img
    .resize({ width: Math.max(1, Math.round((meta.width ?? maxWidth) * scale)) })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
}

/**
 * Variance of the Laplacian — the standard sharpness estimator.
 * A blurred page has almost no high-frequency energy, so this collapses toward
 * zero, which is exactly the signal we want for "this scan is too soft to read".
 */
function sharpnessScore(g: Uint8Array, w: number, h: number): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = -4 * g[i] + g[i - 1] + g[i + 1] + g[i - w] + g[i + w];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  // ~500+ is crisp print; normalise into 0..1 with a soft knee.
  return Math.max(0, Math.min(1, Math.sqrt(variance) / 22));
}

function contrastScore(g: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < g.length; i++) sum += g[i];
  const mean = sum / g.length;
  let varSum = 0;
  for (let i = 0; i < g.length; i++) varSum += (g[i] - mean) ** 2;
  const sd = Math.sqrt(varSum / g.length);
  // 60+ std-dev is healthy black-on-white text.
  return Math.max(0, Math.min(1, sd / 62));
}

function inkCoverage(g: Uint8Array): number {
  let ink = 0;
  for (let i = 0; i < g.length; i++) if (g[i] < 128) ink++;
  return ink / g.length;
}

/**
 * Otsu's method — pick the threshold that best separates ink from paper.
 * Beats a fixed 128 cut on grey phone photos, which is most real uploads.
 */
function otsu(g: Uint8Array): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < g.length; i++) hist[g[i]]++;
  const total = g.length;
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];

  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }
  return best;
}

/**
 * Estimate skew by shear-projection.
 *
 * Text lines are horizontal bands of ink separated by blank paper. When the
 * page is straight, the row-ink histogram is spiky (dense line, empty gap,
 * dense line). Tilt it and those spikes smear together. So: shear the ink at
 * each candidate angle, build the histogram, and keep the angle whose histogram
 * has the highest variance — that's the angle where the lines line up.
 *
 * We shear coordinates rather than rotating pixels, which keeps the whole sweep
 * to a single pass per angle instead of a resample per angle.
 */
function estimateSkew(g: Uint8Array, w: number, h: number): number {
  const threshold = otsu(g);
  // Collect ink pixel coordinates once; most of a page is blank, so this is a
  // big constant-factor win over touching every pixel for every angle.
  const xs: number[] = [];
  const ys: number[] = [];
  // Sub-sample: skew is a global property, we don't need every pixel.
  const step = Math.max(1, Math.floor(Math.min(w, h) / 700));
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      if (g[y * w + x] < threshold) {
        xs.push(x);
        ys.push(y);
      }
    }
  }
  if (xs.length < 200) return 0;

  const cx = w / 2;
  let bestAngle = 0;
  let bestScore = -1;

  const evaluate = (deg: number): number => {
    const tan = Math.tan((deg * Math.PI) / 180);
    const bins = new Float64Array(h + 1);
    for (let i = 0; i < xs.length; i++) {
      const yy = ys[i] - (xs[i] - cx) * tan;
      const b = yy | 0;
      if (b >= 0 && b <= h) bins[b]++;
    }
    // Variance of the projection: high = crisp line separation.
    let sum = 0;
    for (let i = 0; i < bins.length; i++) sum += bins[i];
    const mean = sum / bins.length;
    let v = 0;
    for (let i = 0; i < bins.length; i++) v += (bins[i] - mean) ** 2;
    return v;
  };

  // Coarse sweep, then refine — 0.1° precision without 160 full passes.
  for (let deg = -8; deg <= 8; deg += 0.5) {
    const score = evaluate(deg);
    if (score > bestScore) {
      bestScore = score;
      bestAngle = deg;
    }
  }
  for (let deg = bestAngle - 0.5; deg <= bestAngle + 0.5; deg += 0.1) {
    const score = evaluate(deg);
    if (score > bestScore) {
      bestScore = score;
      bestAngle = deg;
    }
  }
  // Ignore noise-level angles — rotating by 0.1° costs quality for nothing.
  return Math.abs(bestAngle) < 0.25 ? 0 : Number(bestAngle.toFixed(2));
}

function verdictFor(sharpness: number, contrast: number, dpi: number): QualityMetrics['verdict'] {
  const score = sharpness * 0.45 + contrast * 0.35 + Math.min(1, dpi / 300) * 0.2;
  if (score >= 0.7) return 'GOOD';
  if (score >= 0.45) return 'FAIR';
  return 'POOR';
}

/**
 * Clean a page image for OCR and report what we found.
 * `rotation` is applied by the caller's orientation pass (see ocr.ts) — this
 * function owns fine deskew, tone, and noise only.
 */
export async function preprocessPage(
  input: Buffer,
  opts: { rotation?: number; pageWidthInches?: number } = {},
): Promise<PreprocessReport> {
  const rotation = opts.rotation ?? 0;
  const notes: string[] = [];

  // 1. Coarse orientation first, so skew estimation sees upright text.
  let work = rotation ? await sharp(input).rotate(rotation).toBuffer() : input;

  // 2. Measure the page as-scanned (before we improve it) — this is what the
  //    user actually uploaded, and what the quality report should describe.
  const probe = await greyRaw(work, 1000);
  const sharpness = sharpnessScore(probe.data, probe.width, probe.height);
  const contrast = contrastScore(probe.data);
  const ink = inkCoverage(probe.data);

  const meta = await sharp(work).metadata();
  const width = meta.width ?? probe.width;
  const height = meta.height ?? probe.height;
  const pageWidthInches = opts.pageWidthInches ?? 8.27; // A4 portrait
  const dpi = Math.round(width / pageWidthInches);

  if (sharpness < 0.35) notes.push('Image is soft — text edges are blurred.');
  if (contrast < 0.35) notes.push('Low contrast between ink and paper.');
  if (dpi < 200) notes.push(`Low resolution (~${dpi} DPI); 300 DPI recommended.`);
  if (ink < 0.002) notes.push('Almost no ink detected — page may be blank.');
  if (ink > 0.45) notes.push('Very heavy ink coverage — page may be over-darkened.');

  // 3. Deskew on the measured greyscale.
  const skewDeg = estimateSkew(probe.data, probe.width, probe.height);

  // 4. Build the cleaned image.
  let pipeline = sharp(work).greyscale();

  if (skewDeg !== 0) {
    // Rotate against the detected tilt, filling with paper-white so the
    // corners don't become black wedges that Tesseract reads as garbage.
    pipeline = pipeline.rotate(-skewDeg, { background: '#ffffff' });
    notes.push(`Deskewed by ${(-skewDeg).toFixed(2)}°.`);
  }

  // 5. Upscale small scans — Tesseract's models are trained near 300 DPI and
  //    degrade sharply below it. Lanczos keeps stroke edges intact.
  let upscaled = false;
  if (width < TARGET_MIN_WIDTH) {
    const factor = Math.min(TARGET_MIN_WIDTH / width, 3);
    pipeline = pipeline.resize({ width: Math.round(width * factor), kernel: 'lanczos3' });
    upscaled = true;
    notes.push(`Upscaled ${factor.toFixed(1)}× to reach OCR-friendly resolution.`);
  } else if (width > MAX_WIDTH) {
    pipeline = pipeline.resize({ width: MAX_WIDTH, kernel: 'lanczos3' });
  }

  // 6. Tone + noise. Order matters — and so does diagnosing the *right*
  //    ailment. Blur and speckle are opposite diseases with opposite cures:
  //    a median filter flattens salt-and-pepper noise but *widens* blur, so
  //    running it on a soft image (an earlier version did) destroys exactly
  //    the stroke edges OCR needs. Median is therefore reserved for pages
  //    that are reasonably sharp but noisy; soft pages get aggressive
  //    unsharp masking instead.
  const isBlurry = sharpness < 0.35;
  const isNoisy = !isBlurry && ink > 0.003 && contrast > 0.4 && sharpness < 0.75;
  if (isNoisy) {
    pipeline = pipeline.median(3);
    notes.push('Despeckled scanner noise.');
  }
  pipeline = pipeline.normalise();
  if (isBlurry) {
    // Strong unsharp mask: exaggerate what little edge information survives.
    pipeline = pipeline.sharpen({ sigma: 2.2, m1: 1.4, m2: 3 });
    notes.push('Applied strong sharpening to a soft image.');
  } else {
    pipeline = pipeline.sharpen({ sigma: 0.9 });
  }
  if (contrast < 0.5) {
    // Gentle S-curve: pull darks down, push lights up.
    pipeline = pipeline.linear(1.35, -35);
    notes.push('Boosted contrast for a washed-out scan.');
  }

  // Soft pages get binarised after the unsharp mask. Blur leaves glyphs as
  // grey gradients that Tesseract's internal binariser slices inconsistently;
  // deciding ink-vs-paper here — after the histogram has been stretched and
  // the edges exaggerated — hands the engine clean black letterforms. Only
  // for soft pages: on a healthy page a hard global threshold destroys
  // anti-aliasing for no gain.
  if (isBlurry) {
    pipeline = pipeline.threshold(contrast < 0.5 ? 160 : 150);
    notes.push('Binarised a soft scan after sharpening.');
  }

  const out = await pipeline.png().toBuffer({ resolveWithObject: true });

  return {
    rotation,
    skewDeg,
    upscaled,
    buffer: out.data,
    width: out.info.width,
    height: out.info.height,
    quality: {
      sharpness: Number(sharpness.toFixed(3)),
      contrast: Number(contrast.toFixed(3)),
      dpi,
      inkCoverage: Number(ink.toFixed(4)),
      verdict: verdictFor(sharpness, contrast, dpi),
      notes,
    },
  };
}

/** A small JPEG for the side-by-side reviewer — readable, but not 3MB. */
export async function makePreview(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .resize({ width: 1100, withoutEnlargement: true })
    .jpeg({ quality: 78, progressive: true })
    .toBuffer();
}

/**
 * Is there ink in this region of the page?
 *
 * Used for signature fields. A signature cannot be *read* — running OCR over a
 * squiggle produces confident nonsense like "Mmm~w". But "was this form signed
 * at all?" is a real question a registrar needs answered, and it's answerable
 * honestly: look for dark pixels where the signature belongs.
 *
 * We compare against the page's own paper tone rather than a fixed threshold,
 * so a grey phone photo doesn't read as one giant signature.
 *
 * `region` is normalised 0..1 over the page.
 */
export async function inkInRegion(
  image: Buffer,
  region: { x: number; y: number; w: number; h: number },
): Promise<{ present: boolean; coverage: number }> {
  const meta = await sharp(image).metadata();
  if (!meta.width || !meta.height) return { present: false, coverage: 0 };

  const left = Math.max(0, Math.round(region.x * meta.width));
  const top = Math.max(0, Math.round(region.y * meta.height));
  const width = Math.max(1, Math.min(meta.width - left, Math.round(region.w * meta.width)));
  const height = Math.max(1, Math.min(meta.height - top, Math.round(region.h * meta.height)));
  if (width < 4 || height < 4) return { present: false, coverage: 0 };

  const { data } = await sharp(image)
    .extract({ left, top, width, height })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const px = new Uint8Array(data.buffer, data.byteOffset, data.length);
  // Paper tone = the bright end of this crop; ink is what's meaningfully darker.
  let maxV = 0;
  for (let i = 0; i < px.length; i++) if (px[i] > maxV) maxV = px[i];
  const threshold = Math.max(60, maxV * 0.62);

  let dark = 0;
  for (let i = 0; i < px.length; i++) if (px[i] < threshold) dark++;
  const coverage = dark / px.length;

  // A printed rule ("________") is ~1-2% coverage; a signature is visibly more.
  // Below 2.5% we call it unsigned rather than claim a signature we can't see.
  return { present: coverage >= 0.025, coverage: Number(coverage.toFixed(4)) };
}

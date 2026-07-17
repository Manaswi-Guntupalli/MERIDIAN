// Generate Lumen's sample school documents.
//
//   npm --prefix server run lumen:fixtures
//
// Produces nine realistic forms (three admission, three teacher, three
// employee) across three layouts, plus four deliberately awkward variants, plus
// a ground-truth file the benchmark grades against.
//
// ── Why the "challenge" files are built the way they are ──
//
// The nine clean forms are digital PDFs, so Lumen reads them via the text-layer
// fast path — accurate, but it never touches the imaging pipeline. That would
// leave deskew, denoise, orientation and OCR completely untested, which is
// most of the engine.
//
// So the challenge files are rasterised and degraded into image-only PDFs: the
// text layer is destroyed on purpose. They are the *same documents* with the
// same ground truth, forced down the hard path. That gives us two honest
// numbers — accuracy on digital files, and accuracy on scans — instead of one
// flattering average that hides which is which.

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ALL_FIXTURES, ADMISSIONS, TEACHERS, type FixtureRecord } from './fixtures/data.js';
import { renderFixture, renderMultipage, toBuffer } from './fixtures/render.js';
import { homographyFrom, applyH, type Quad } from '../src/services/lumen/perspective.js';

const OUT_DIR = path.resolve(process.cwd(), 'fixtures', 'lumen');

interface Manifest {
  generatedAt: string;
  note: string;
  documents: {
    file: string;
    kind: 'clean' | 'challenge';
    challenge?: string;
    expectedType: string;
    layout: string;
    truth: Record<string, string>;
  }[];
}

/** Rasterise page 1 of a PDF at print resolution. */
async function rasterise(pdfBuffer: Buffer, scale = 2.4): Promise<Buffer> {
  const task = pdfjs.getDocument({ data: new Uint8Array(pdfBuffer), useSystemFonts: true });
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx as never, viewport, canvas }).promise;
  const out = canvas.toBuffer('image/png');
  await task.destroy();
  return out;
}

/** Wrap an image back into a PDF — an image-only PDF, exactly like a scanner makes. */
async function imageToPdf(image: Buffer, title: string): Promise<Buffer> {
  const meta = await sharp(image).metadata();
  const w = meta.width ?? 1240;
  const h = meta.height ?? 1754;
  const doc = new PDFDocument({ size: [595.28, 841.89], margin: 0, info: { Title: title } });
  // Fit to A4 while preserving aspect, centred, like a real scan.
  const scale = Math.min(595.28 / w, 841.89 / h);
  const dw = w * scale;
  const dh = h * scale;
  doc.image(image, (595.28 - dw) / 2, (841.89 - dh) / 2, { width: dw, height: dh });
  return toBuffer(doc);
}

/** Deterministic sensor-noise overlay — a scan is never perfectly clean. */
async function addNoise(image: Buffer, amount: number): Promise<Buffer> {
  const meta = await sharp(image).metadata();
  const w = meta.width!;
  const h = meta.height!;
  const noise = Buffer.alloc(w * h);
  let seed = 12345;
  for (let i = 0; i < noise.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    noise[i] = 128 + (((seed >> 16) % 255) - 128) * amount;
  }
  return sharp(image)
    .greyscale()
    .composite([{ input: noise, raw: { width: w, height: h, channels: 1 }, blend: 'overlay' }])
    .png()
    .toBuffer();
}

/**
 * Simulate a phone photo of a form lying on a desk: the page becomes a
 * perspective quadrilateral over a dark background, lit unevenly, with sensor
 * noise and camera JPEG compression on top.
 *
 * The warp uses the engine's own homography math — but in the FORWARD
 * direction (flat page → tilted photo), so it cannot share any bug with the
 * corrective (photo → flat) path it exists to test.
 */
async function makePhoneMock(pageRaster: Buffer): Promise<Buffer> {
  const meta = await sharp(pageRaster).metadata();
  const pw = meta.width!;
  const ph = meta.height!;
  const { data: pageRaw } = await sharp(pageRaster).greyscale().raw().toBuffer({ resolveWithObject: true });
  const page = new Uint8Array(pageRaw.buffer, pageRaw.byteOffset, pageRaw.length);

  // Photo frame ~18% larger than the page, page sitting tilted inside it.
  const W = Math.round(pw * 1.18);
  const H = Math.round(ph * 1.16);
  const quad: Quad = [
    [W * 0.09, H * 0.055],  // TL
    [W * 0.945, H * 0.09],  // TR — pulled down: camera tilted
    [W * 0.90, H * 0.965],  // BR — pulled in: keystone
    [W * 0.055, H * 0.925], // BL
  ];
  // Map photo pixels back onto the flat page for sampling.
  const h = homographyFrom(quad, [[0, 0], [pw - 1, 0], [pw - 1, ph - 1], [0, ph - 1]]);
  if (!h) throw new Error('degenerate photo quad');

  const out = new Uint8Array(W * H);
  let seed = 424242;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [sx, sy] = applyH(h, x, y);
      let v: number;
      if (sx >= 0 && sy >= 0 && sx < pw - 1 && sy < ph - 1) {
        const x0 = sx | 0;
        const y0 = sy | 0;
        const fx = sx - x0;
        const fy = sy - y0;
        v =
          (page[y0 * pw + x0] * (1 - fx) + page[y0 * pw + x0 + 1] * fx) * (1 - fy) +
          (page[(y0 + 1) * pw + x0] * (1 - fx) + page[(y0 + 1) * pw + x0 + 1] * fx) * fy;
      } else {
        // The desk: dark wood-ish tone with gentle variation.
        v = 52 + 14 * Math.sin(x * 0.004) + rand() * 10;
      }
      // Uneven lighting: brighter toward the top-left "window", a soft shadow
      // falling over the bottom-right corner — the classic phone-photo look.
      const light = 1.04 - 0.16 * ((x / W) * 0.5 + (y / H) * 0.5) - 0.06 * Math.max(0, (x / W + y / H) - 1.25);
      v = v * light + (rand() - 0.5) * 7; // sensor noise
      out[y * W + x] = Math.max(0, Math.min(255, v));
    }
  }

  // Camera JPEG compression finishes the disguise.
  return sharp(Buffer.from(out.buffer), { raw: { width: W, height: H, channels: 1 } })
    .jpeg({ quality: 72 })
    .toBuffer();
}

async function makeChallenges(): Promise<Manifest['documents']> {
  const out: Manifest['documents'] = [];

  // ── 0. Phone photo: perspective + shadow + noise + JPEG. ──
  {
    const source = TEACHERS[0];
    const raster = await rasterise(await renderFixture(source), 2.0);
    const photo = await makePhoneMock(raster);
    const pdf = await imageToPdf(photo, 'Phone photo');
    await fs.writeFile(path.join(OUT_DIR, 'challenge-phone-photo.pdf'), pdf);
    out.push({
      file: 'challenge-phone-photo.pdf',
      kind: 'challenge',
      challenge: 'Phone photo on a desk: perspective keystone, uneven lighting, sensor noise, camera JPEG — exercises rectification.',
      expectedType: source.type,
      layout: source.layout,
      truth: source.truth,
    });
  }

  // ── 1. Rotated scan: 1.8° tilt, as if fed in crooked. ──
  {
    const source = ADMISSIONS[0];
    const raster = await rasterise(await renderFixture(source));
    const tilted = await sharp(raster)
      .rotate(1.8, { background: '#ffffff' })
      .png()
      .toBuffer();
    const noisy = await addNoise(tilted, 0.12);
    const pdf = await imageToPdf(noisy, 'Rotated scan');
    await fs.writeFile(path.join(OUT_DIR, 'challenge-rotated-scan.pdf'), pdf);
    out.push({
      file: 'challenge-rotated-scan.pdf',
      kind: 'challenge',
      challenge: 'Scanned crooked (1.8° tilt) with sensor noise — exercises deskew.',
      expectedType: source.type,
      layout: source.layout,
      truth: source.truth,
    });
  }

  // ── 2. Low-quality scan: downsampled to ~110 DPI and JPEG-crushed. ──
  {
    const source = ADMISSIONS[1];
    const raster = await rasterise(await renderFixture(source));
    const meta = await sharp(raster).metadata();
    const degraded = await sharp(raster)
      .resize({ width: Math.round(meta.width! * 0.38) })
      .jpeg({ quality: 32 })
      .toBuffer();
    // Blow it back up the way a cheap scanner's software would.
    const restored = await sharp(degraded)
      .resize({ width: meta.width! })
      .greyscale()
      .linear(0.92, 12) // wash it out slightly — low contrast, like a tired copier
      .png()
      .toBuffer();
    const pdf = await imageToPdf(restored, 'Low quality scan');
    await fs.writeFile(path.join(OUT_DIR, 'challenge-low-quality.pdf'), pdf);
    out.push({
      file: 'challenge-low-quality.pdf',
      kind: 'challenge',
      challenge: 'Low resolution (~110 DPI), heavy JPEG artefacts, washed-out contrast.',
      expectedType: source.type,
      layout: source.layout,
      truth: source.truth,
    });
  }

  // ── 3. Blurred: soft focus, like a phone photo taken in a hurry. ──
  {
    const source = ADMISSIONS[2];
    const raster = await rasterise(await renderFixture(source));
    const blurred = await sharp(raster).greyscale().blur(1.6).png().toBuffer();
    const pdf = await imageToPdf(blurred, 'Blurred document');
    await fs.writeFile(path.join(OUT_DIR, 'challenge-blurred.pdf'), pdf);
    out.push({
      file: 'challenge-blurred.pdf',
      kind: 'challenge',
      challenge: 'Soft focus (Gaussian blur σ≈1.6) — exercises sharpening and quality capping.',
      expectedType: source.type,
      layout: source.layout,
      truth: source.truth,
    });
  }

  // ── 4. Multi-page: form + annexure, kept digital. ──
  {
    const source = ADMISSIONS[0];
    const pdf = await renderMultipage(source);
    await fs.writeFile(path.join(OUT_DIR, 'challenge-multipage.pdf'), pdf);
    out.push({
      file: 'challenge-multipage.pdf',
      kind: 'challenge',
      challenge: 'Two pages: the form plus a signed annexure sheet.',
      expectedType: source.type,
      layout: source.layout,
      truth: source.truth,
    });
  }

  return out;
}

async function main(): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const documents: Manifest['documents'] = [];

  for (const rec of ALL_FIXTURES as FixtureRecord[]) {
    const pdf = await renderFixture(rec);
    const file = `${rec.id}.pdf`;
    await fs.writeFile(path.join(OUT_DIR, file), pdf);
    documents.push({
      file,
      kind: 'clean',
      expectedType: rec.type,
      layout: rec.layout,
      truth: rec.truth,
    });
    console.log(`  ✓ ${file}  (${rec.type}, layout ${rec.layout}, ${(pdf.length / 1024).toFixed(0)} KB)`);
  }

  console.log('\n  Generating challenge variants…');
  const challenges = await makeChallenges();
  for (const c of challenges) console.log(`  ✓ ${c.file}  — ${c.challenge}`);

  documents.push(...challenges);

  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    note:
      'Ground truth is expressed in POST-NORMALISATION form (dates as ISO, phones as +91 XXXXXXXXXX, ' +
      'currency as bare numbers). The benchmark grades the full pipeline, not raw OCR.',
    documents,
  };
  await fs.writeFile(path.join(OUT_DIR, 'ground-truth.json'), JSON.stringify(manifest, null, 2));

  const fields = documents.reduce((a, d) => a + Object.keys(d.truth).length, 0);
  console.log(`\n  ${documents.length} documents · ${fields} ground-truth fields`);
  console.log(`  → ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

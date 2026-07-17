// Lumen — perspective correction for photographed documents.
//
// A scanner produces a rectangle; a phone produces a trapezoid. Someone
// photographing an admission form at their kitchen table tilts the camera,
// and every line of text ends up on its own slope with its own scale — the
// single most common reason "works on scans" systems fall apart on parent
// uploads.
//
// The fix is classical computer vision, implemented here without OpenCV
// (which would drag a 60MB native dependency into a school server for one
// operation):
//
//   1. Find the paper: it is the large bright blob against a darker world.
//   2. Find its corners: the extreme points of that blob.
//   3. Compute the homography mapping that quadrilateral to a rectangle.
//   4. Resample through the inverse mapping (bilinear).
//
// The detector is deliberately conservative. When the bright region already
// fills the frame — every scanner and most PDFs — it declines to touch the
// image. A wrong warp is far more destructive than no warp, so anything
// ambiguous (concave hull, wild side ratios, tiny paper) also declines.

import sharp from 'sharp';

export type Quad = [number, number][]; // TL, TR, BR, BL as [x, y]

// ───────────────────────────  homography  ───────────────────────────

/**
 * Solve the 8-unknown projective mapping taking each src[i] to dst[i]
 * (direct linear transform on 4 correspondences). Returns the 3×3 matrix
 * as a flat row-major array with h33 fixed at 1.
 */
export function homographyFrom(src: Quad, dst: Quad): number[] | null {
  // Build the 8×9 augmented system.
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-9) return null; // degenerate quad
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      for (let c = col; c < 9; c++) a[r][c] -= f * a[col][c];
    }
  }
  const h = new Array<number>(9);
  for (let i = 0; i < 8; i++) h[i] = a[i][8] / a[i][i];
  h[8] = 1;
  return h;
}

/** Apply a homography to a point. */
export function applyH(h: number[], x: number, y: number): [number, number] {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

// ─────────────────────────  paper detection  ─────────────────────────

interface Detected {
  quad: Quad;
  /** Fraction of the frame the paper covers. */
  coverage: number;
}

/**
 * Locate the paper as the largest bright connected component.
 *
 * Runs on a ~220px thumbnail: the paper is a page-scale feature, so corner
 * positions survive heavy downsampling, and flood fill on 40k pixels is
 * effectively free compared to one OCR pass.
 */
function detectPaper(grey: Uint8Array, w: number, h: number): Detected | null {
  // Threshold between "world" and "paper". Otsu over the whole frame puts the
  // split between the dark background mass and the bright page.
  const hist = new Array(256).fill(0);
  for (let i = 0; i < grey.length; i++) hist[grey[i]]++;
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = 127;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB || wB === grey.length) continue;
    sumB += t * hist[t];
    const wF = grey.length - wB;
    const between = wB * wF * (sumB / wB - (sumAll - sumB) / wF) ** 2;
    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }

  const mask = new Uint8Array(grey.length);
  for (let i = 0; i < grey.length; i++) mask[i] = grey[i] > best ? 1 : 0;

  // Largest connected bright component by iterative flood fill.
  const labels = new Int32Array(grey.length).fill(-1);
  let bestLabel = -1;
  let bestSize = 0;
  let nextLabel = 0;
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] !== -1) continue;
    let size = 0;
    stack.push(start);
    labels[start] = nextLabel;
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const px = p % w;
      const py = (p / w) | 0;
      if (px > 0 && mask[p - 1] && labels[p - 1] === -1) { labels[p - 1] = nextLabel; stack.push(p - 1); }
      if (px < w - 1 && mask[p + 1] && labels[p + 1] === -1) { labels[p + 1] = nextLabel; stack.push(p + 1); }
      if (py > 0 && mask[p - w] && labels[p - w] === -1) { labels[p - w] = nextLabel; stack.push(p - w); }
      if (py < h - 1 && mask[p + w] && labels[p + w] === -1) { labels[p + w] = nextLabel; stack.push(p + w); }
    }
    if (size > bestSize) {
      bestSize = size;
      bestLabel = nextLabel;
    }
    nextLabel++;
  }
  if (bestLabel === -1 || bestSize < grey.length * 0.2) return null;

  // Corners as the component's extreme points in the four diagonal directions
  // — robust to ragged edges, cheap, and exact for any convex quadrilateral.
  let tl = 0, tr = 0, br = 0, bl = 0;
  let tlV = Infinity, trV = -Infinity, brV = -Infinity, blV = Infinity;
  for (let p = 0; p < labels.length; p++) {
    if (labels[p] !== bestLabel) continue;
    const x = p % w;
    const y = (p / w) | 0;
    if (x + y < tlV) { tlV = x + y; tl = p; }
    if (x - y > trV) { trV = x - y; tr = p; }
    if (x + y > brV) { brV = x + y; br = p; }
    if (x - y < blV) { blV = x - y; bl = p; }
  }
  const pt = (p: number): [number, number] => [p % w, (p / w) | 0];
  return { quad: [pt(tl), pt(tr), pt(br), pt(bl)], coverage: bestSize / grey.length };
}

function sideLength(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Convexity + sanity checks — every rejection here prevents a bad warp. */
function plausiblePaper(quad: Quad, w: number, h: number): boolean {
  // Convex: consecutive edge cross products all share a sign.
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const c = quad[(i + 2) % 4];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  // Opposite sides must be within 2.5× of each other — beyond that we are
  // looking at a fold, a hand, or a detection failure, not perspective.
  const top = sideLength(quad[0], quad[1]);
  const bottom = sideLength(quad[3], quad[2]);
  const left = sideLength(quad[0], quad[3]);
  const right = sideLength(quad[1], quad[2]);
  if (Math.max(top, bottom) / Math.max(1, Math.min(top, bottom)) > 2.5) return false;
  if (Math.max(left, right) / Math.max(1, Math.min(left, right)) > 2.5) return false;
  // A paper smaller than a quarter of the frame is too small to read anyway.
  const area = 0.5 * Math.abs(
    quad[0][0] * (quad[1][1] - quad[3][1]) + quad[1][0] * (quad[2][1] - quad[0][1]) +
    quad[2][0] * (quad[3][1] - quad[1][1]) + quad[3][0] * (quad[0][1] - quad[2][1]),
  );
  return area / (w * h) >= 0.25;
}

// ─────────────────────────────  warp  ─────────────────────────────

export interface PerspectiveResult {
  buffer: Buffer;
  applied: boolean;
  note?: string;
}

/**
 * Detect a photographed page and rectify it. Returns the input untouched
 * (applied: false) whenever the frame already *is* the page.
 */
export async function correctPerspective(input: Buffer): Promise<PerspectiveResult> {
  const meta = await sharp(input).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (W < 200 || H < 200) return { buffer: input, applied: false };

  // Detection thumbnail.
  const smallW = 220;
  const { data: small, info } = await sharp(input)
    .greyscale()
    .resize({ width: smallW })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const detected = detectPaper(new Uint8Array(small.buffer, small.byteOffset, small.length), info.width, info.height);
  if (!detected) return { buffer: input, applied: false };

  // Paper fills the frame → this is a scan; leave it alone. The 0.94 margin
  // absorbs the dark scanner-lid border many flatbeds leave.
  if (detected.coverage >= 0.94) return { buffer: input, applied: false };
  if (!plausiblePaper(detected.quad, info.width, info.height)) return { buffer: input, applied: false };

  // Does this quad actually need rectifying? The test is how far its corners
  // sit from the corners of its own bounding box, normalised by the diagonal.
  // This catches every distortion a camera introduces — rotation, shear, and
  // keystone all displace corners — where comparing opposite side *lengths*
  // (an earlier version) was blind to pure rotation: a rotated rectangle has
  // perfectly equal opposite sides and still desperately needs the warp.
  const q = detected.quad;
  const bx0 = Math.min(q[0][0], q[1][0], q[2][0], q[3][0]);
  const by0 = Math.min(q[0][1], q[1][1], q[2][1], q[3][1]);
  const bx1 = Math.max(q[0][0], q[1][0], q[2][0], q[3][0]);
  const by1 = Math.max(q[0][1], q[1][1], q[2][1], q[3][1]);
  const bboxCorners: Quad = [[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]];
  const diag = Math.hypot(bx1 - bx0, by1 - by0) || 1;
  const cornerDrift = Math.max(...q.map((c, i) => Math.hypot(c[0] - bboxCorners[i][0], c[1] - bboxCorners[i][1]))) / diag;
  const cropOnly = cornerDrift < 0.015;

  // Scale corners back to full resolution.
  const s = W / info.width;
  const quad: Quad = q.map(([x, y]) => [Math.max(0, Math.min(W - 1, x * s)), Math.max(0, Math.min(H - 1, y * s))]) as Quad;

  // Output rectangle sized from the quad's real edge lengths, so text keeps
  // roughly its photographed resolution instead of being stretched.
  const outW = Math.round(Math.max(sideLength(quad[0], quad[1]), sideLength(quad[3], quad[2])));
  const outH = Math.round(Math.max(sideLength(quad[0], quad[3]), sideLength(quad[1], quad[2])));
  if (outW < 300 || outH < 300) return { buffer: input, applied: false };

  if (cropOnly) {
    // Effectively straight-on: a plain crop preserves more sharpness than a
    // resampling warp.
    const left = Math.round(Math.min(quad[0][0], quad[3][0]));
    const top = Math.round(Math.min(quad[0][1], quad[1][1]));
    const width = Math.min(W - left, Math.round(Math.max(quad[1][0], quad[2][0]) - left));
    const height = Math.min(H - top, Math.round(Math.max(quad[2][1], quad[3][1]) - top));
    const buffer = await sharp(input).extract({ left, top, width, height }).png().toBuffer();
    return { buffer, applied: true, note: 'Cropped the photo to the page borders.' };
  }

  // Full projective rectification. Map destination → source so every output
  // pixel gets exactly one bilinear sample.
  const h = homographyFrom(
    [[0, 0], [outW - 1, 0], [outW - 1, outH - 1], [0, outH - 1]],
    quad,
  );
  if (!h) return { buffer: input, applied: false };

  const { data: srcData } = await sharp(input).greyscale().raw().toBuffer({ resolveWithObject: true });
  const src = new Uint8Array(srcData.buffer, srcData.byteOffset, srcData.length);
  const out = new Uint8Array(outW * outH);

  for (let v = 0; v < outH; v++) {
    for (let u = 0; u < outW; u++) {
      const [sx, sy] = applyH(h, u, v);
      if (sx < 0 || sy < 0 || sx >= W - 1 || sy >= H - 1) {
        out[v * outW + u] = 255; // outside the photo: paper-white
        continue;
      }
      const x0 = sx | 0;
      const y0 = sy | 0;
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = src[y0 * W + x0];
      const i10 = src[y0 * W + x0 + 1];
      const i01 = src[(y0 + 1) * W + x0];
      const i11 = src[(y0 + 1) * W + x0 + 1];
      out[v * outW + u] =
        (i00 * (1 - fx) + i10 * fx) * (1 - fy) + (i01 * (1 - fx) + i11 * fx) * fy;
    }
  }

  const buffer = await sharp(Buffer.from(out.buffer), { raw: { width: outW, height: outH, channels: 1 } })
    .png()
    .toBuffer();
  return {
    buffer,
    applied: true,
    note: `Rectified a photographed page (corner drift ${(cornerDrift * 100).toFixed(1)}% corrected).`,
  };
}

import { createCanvas } from '@napi-rs/canvas';

/**
 * Renders a realistic Student Admission Form as a JPEG. Every data field is
 * drawn from its normalized crop rectangle, so it lines up exactly with the
 * ExtractedField crops Lumen highlights on hover — the visible document and the
 * extracted data are one-to-one (no "why didn't it read that field?" gaps).
 *
 * Used to give the seeded demo document a real page preview (the seed creates
 * the extracted fields synthetically; without this the preview pane is blank).
 */
export interface SampleField {
  label: string;
  value: string;
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
}

const W = 900;
const H = 1200; // 3:4 portrait, matches the viewer's preview aspect

export function renderAdmissionForm(fields: SampleField[]): Buffer {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Paper
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fbfaf7';
  ctx.fillRect(0, 0, W, 150);

  // Header
  ctx.fillStyle = '#0a6558';
  ctx.fillRect(64, 40, 8, 64);
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText('Meridian Public School', 88, 74);
  ctx.fillStyle = '#64748b';
  ctx.font = '20px sans-serif';
  ctx.fillText('Student Admission Form  ·  Academic Year 2026–27', 88, 104);

  // Passport-photo box (decoration — signals a real form)
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1;
  ctx.strokeRect(W - 190, 176, 120, 150);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '14px sans-serif';
  ctx.fillText('AFFIX', W - 158, 246);
  ctx.fillText('PHOTO', W - 160, 264);

  // Form number (decoration)
  ctx.fillStyle = '#94a3b8';
  ctx.font = '16px sans-serif';
  ctx.fillText('Form No. ADM-2026-0147', 88, 138);

  ctx.strokeStyle = '#e8e4da';
  ctx.beginPath();
  ctx.moveTo(64, 150);
  ctx.lineTo(W - 64, 150);
  ctx.stroke();

  // Every field is drawn from its crop box so hover-highlights line up 1:1.
  for (const f of fields) {
    const x = f.cropX * W;
    const y = f.cropY * H;
    const bw = f.cropW * W;
    const bh = f.cropH * H;

    ctx.fillStyle = '#94a3b8';
    ctx.font = '18px sans-serif';
    ctx.fillText(f.label.toUpperCase(), x, y - 10);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(f.value, x + 6, y + bh * 0.62);

    ctx.strokeStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(x, y + bh);
    ctx.lineTo(x + bw, y + bh);
    ctx.stroke();
  }

  // Footer
  ctx.fillStyle = '#94a3b8';
  ctx.font = '16px sans-serif';
  ctx.fillText('Received by Admissions Office · Digitized by Meridian Lumen', 0.12 * W, H - 48);

  return canvas.toBuffer('image/jpeg');
}

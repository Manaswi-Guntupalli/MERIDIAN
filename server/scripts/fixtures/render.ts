// Lumen test fixtures — PDF rendering.
//
// Three genuinely different layouts, not one layout with three colour schemes.
// If every sample form has its labels in the same place, the benchmark only
// proves the extractor works on that one place — which is exactly the failure
// mode ("we template-matched the demo") this whole design is meant to avoid.
//
//   Layout A — Helvetica, classic two-column "Label : Value" rows
//   Layout B — Times, bordered table with ruled cells and a header band
//   Layout C — Helvetica headings with Courier data, labels stacked above values
//
// Layout C is the important one: it prints the label *above* its value, which
// is the case that defeats naive "read to the right of the label" extractors.

import PDFDocument from 'pdfkit';
import { CHECKBOX_FIELDS, FIELD_LABELS, type FixtureRecord } from './data.js';

type Doc = InstanceType<typeof PDFDocument>;

const INK = '#111827';
const MUTED = '#6b7280';
const RULE = '#9ca3af';
const BRAND = '#0E7C6B';

export async function toBuffer(doc: Doc): Promise<Buffer> {
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

/** The Meridian mark — drawn as vectors so it survives rasterisation cleanly. */
function drawLogo(doc: Doc, x: number, y: number, size = 30): void {
  doc.save();
  doc.roundedRect(x, y, size, size, size * 0.28).fill(BRAND);
  doc
    .strokeColor('#ffffff')
    .lineWidth(size * 0.09)
    .lineJoin('round')
    .lineCap('round');
  const s = size / 32;
  doc
    .moveTo(x + 7 * s, y + 23 * s)
    .lineTo(x + 7 * s, y + 10 * s)
    .lineTo(x + 12 * s, y + 17 * s)
    .lineTo(x + 16 * s, y + 8 * s)
    .lineTo(x + 20 * s, y + 17 * s)
    .lineTo(x + 25 * s, y + 10 * s)
    .lineTo(x + 25 * s, y + 23 * s)
    .stroke();
  doc.restore();
}

/** Passport photo placeholder — the box every Indian school form has. */
function drawPhotoBox(doc: Doc, x: number, y: number, w = 84, h = 104): void {
  doc.save();
  doc.rect(x, y, w, h).lineWidth(0.8).dash(3, { space: 2 }).strokeColor(RULE).stroke();
  doc.undash();
  doc
    .fontSize(7)
    .fillColor(MUTED)
    .font('Helvetica')
    .text('AFFIX', x, y + h / 2 - 16, { width: w, align: 'center' })
    .text('PASSPORT', x, y + h / 2 - 7, { width: w, align: 'center' })
    .text('PHOTOGRAPH', x, y + h / 2 + 2, { width: w, align: 'center' });
  doc.restore();
}

/**
 * A handwritten-looking signature.
 *
 * This has to be real ink, not the word "signed": Lumen detects signatures by
 * measuring dark pixels in the signature area, so a fixture that only *claims*
 * to be signed would test nothing. Deterministic per name so re-running the
 * generator doesn't churn the files.
 */
function drawSignature(doc: Doc, name: string, x: number, y: number): void {
  let seed = 0;
  for (const ch of name) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  doc.save();
  doc.strokeColor('#1e3a8a').lineWidth(1.4).lineCap('round').lineJoin('round');
  doc.moveTo(x, y);
  let cx = x;
  const strokes = 7 + Math.floor(rand() * 3);
  for (let i = 0; i < strokes; i++) {
    const dx = 14 + rand() * 12;
    const up = y - 6 - rand() * 11;
    const down = y + 3 + rand() * 6;
    doc.bezierCurveTo(cx + dx * 0.3, up, cx + dx * 0.7, down, cx + dx, y - rand() * 3);
    cx += dx;
  }
  doc.stroke();
  // The flourish underline most signatures end with.
  doc
    .moveTo(x - 2, y + 8)
    .bezierCurveTo(x + (cx - x) * 0.4, y + 13, x + (cx - x) * 0.7, y + 4, cx + 6, y + 9)
    .lineWidth(0.9)
    .stroke();
  doc.restore();
}

function drawCheckboxRow(doc: Doc, x: number, y: number, options: string[], selected: string, font: string): number {
  let cx = x;
  doc.font(font).fontSize(9).fillColor(INK);
  for (const opt of options) {
    const checked = opt.toLowerCase() === selected.toLowerCase();
    // Rendered as literal "[X]" / "[ ]" text so OCR reads a tick token, which
    // is how these actually print on a typed form.
    const mark = checked ? '[X]' : '[  ]';
    doc.text(`${mark} ${opt}`, cx, y, { lineBreak: false });
    cx += doc.widthOfString(`${mark} ${opt}`) + 14;
  }
  return cx;
}

function header(doc: Doc, rec: FixtureRecord, font: string, boldFont: string): number {
  drawLogo(doc, 48, 40);
  doc
    .font(boldFont)
    .fontSize(15)
    .fillColor(INK)
    .text(rec.school, 88, 44, { lineBreak: false });
  doc
    .font(font)
    .fontSize(8)
    .fillColor(MUTED)
    .text('Affiliated to CBSE  ·  Affiliation No. 1130428  ·  Pune, Maharashtra', 88, 62, { lineBreak: false });

  doc
    .moveTo(48, 82)
    .lineTo(547, 82)
    .lineWidth(1.2)
    .strokeColor(BRAND)
    .stroke();

  doc
    .font(boldFont)
    .fontSize(13)
    .fillColor(INK)
    .text(rec.title, 48, 94, { width: 499, align: 'center' });
  return 120;
}

function footer(doc: Doc, rec: FixtureRecord, font: string, y: number): void {
  const name = rec.print.studentName ?? rec.print.teacherName ?? '';
  doc.font(font).fontSize(9).fillColor(INK);
  doc.text('Signature:', 48, y, { lineBreak: false });
  drawSignature(doc, name, 108, y + 4);

  doc.text('Date:', 330, y, { lineBreak: false });
  doc.text('16/07/2026', 366, y, { lineBreak: false });

  doc
    .font(font)
    .fontSize(7)
    .fillColor(MUTED)
    .text(
      'I declare that the information provided above is true to the best of my knowledge.',
      48,
      y + 30,
      { width: 499 },
    );
}

// ─────────────────────────────  Layout A  ─────────────────────────────
// Helvetica, two columns of "Label : Value". The most common form on earth.

function renderA(doc: Doc, rec: FixtureRecord): void {
  let y = header(doc, rec, 'Helvetica', 'Helvetica-Bold');
  drawPhotoBox(doc, 463, y);

  const fields = FIELD_LABELS[rec.type];
  const colX = [48, 270];
  let col = 0;
  const startY = y + 6;
  let rowY = startY;

  for (const [key, label] of fields) {
    const value = rec.print[key];
    if (value === undefined) continue;

    // Address and the gender tick-boxes are both too wide for a half-column;
    // give them their own row rather than letting them collide with the label
    // opposite.
    const isWide = key === 'address' || key === 'gender';
    if (isWide && col === 1) {
      col = 0;
      rowY += 18;
    }

    const x = colX[col];
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`${label}:`, x, rowY, { lineBreak: false });
    const valueX = x + 96;

    if (CHECKBOX_FIELDS[key]) {
      drawCheckboxRow(doc, valueX, rowY, CHECKBOX_FIELDS[key], value, 'Helvetica');
    } else {
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(INK)
        .text(value, valueX, rowY, { width: isWide ? 380 : 150, lineBreak: false });
    }

    if (isWide) {
      rowY += 18;
      col = 0;
    } else if (col === 0) {
      col = 1;
    } else {
      col = 0;
      rowY += 18;
    }
  }
  if (col === 1) rowY += 18;
  footer(doc, rec, 'Helvetica', rowY + 24);
}

// ─────────────────────────────  Layout B  ─────────────────────────────
// Times-Roman in a bordered table with ruled cells and a shaded header band.

function renderB(doc: Doc, rec: FixtureRecord): void {
  let y = header(doc, rec, 'Times-Roman', 'Times-Bold');
  drawPhotoBox(doc, 463, y + 4);

  const fields = FIELD_LABELS[rec.type];
  const tableX = 48;
  const tableW = 400;
  const labelW = 140;
  const rowH = 22;

  doc.rect(tableX, y, tableW, 18).fill('#f3f4f6');
  doc
    .font('Times-Bold')
    .fontSize(9)
    .fillColor(INK)
    .text('PARTICULARS', tableX + 8, y + 5, { lineBreak: false })
    .text('DETAILS', tableX + labelW + 8, y + 5, { lineBreak: false });
  y += 18;

  for (const [key, label] of fields) {
    const value = rec.print[key];
    if (value === undefined) continue;

    doc.rect(tableX, y, tableW, rowH).lineWidth(0.6).strokeColor(RULE).stroke();
    doc
      .moveTo(tableX + labelW, y)
      .lineTo(tableX + labelW, y + rowH)
      .stroke();

    doc.font('Times-Roman').fontSize(9).fillColor(MUTED).text(label, tableX + 6, y + 7, { width: labelW - 12, lineBreak: false });

    if (CHECKBOX_FIELDS[key]) {
      drawCheckboxRow(doc, tableX + labelW + 6, y + 7, CHECKBOX_FIELDS[key], value, 'Times-Roman');
    } else {
      doc
        .font('Times-Bold')
        .fontSize(9)
        .fillColor(INK)
        .text(value, tableX + labelW + 6, y + 7, { width: tableW - labelW - 12, lineBreak: false });
    }
    y += rowH;
  }

  footer(doc, rec, 'Times-Roman', y + 26);
}

// ─────────────────────────────  Layout C  ─────────────────────────────
// Labels stacked ABOVE their values, data set in Courier. This is the layout
// that breaks "read to the right of the label" — the value is underneath.

function renderC(doc: Doc, rec: FixtureRecord): void {
  let y = header(doc, rec, 'Helvetica', 'Helvetica-Bold');

  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(MUTED)
    .text('PLEASE COMPLETE IN BLOCK LETTERS. FIELDS MARKED WITH AN ASTERISK ARE MANDATORY.', 48, y, {
      width: 400,
    });
  drawPhotoBox(doc, 463, y - 4, 84, 100);
  y += 20;

  const fields = FIELD_LABELS[rec.type];
  const colX = [48, 216, 384];
  let col = 0;
  let rowY = y;
  const blockH = 40;

  for (const [key, label] of fields) {
    const value = rec.print[key];
    if (value === undefined) continue;

    const isWide = key === 'address' || key === 'qualification';
    if (isWide && col !== 0) {
      col = 0;
      rowY += blockH;
    }

    const x = colX[col];
    const width = isWide ? 400 : 150;

    // Label above…
    doc
      .font('Helvetica-Bold')
      .fontSize(6.8)
      .fillColor(MUTED)
      .text(label.toUpperCase(), x, rowY, { characterSpacing: 0.4, lineBreak: false });

    // …value below.
    if (CHECKBOX_FIELDS[key]) {
      drawCheckboxRow(doc, x, rowY + 11, CHECKBOX_FIELDS[key], value, 'Helvetica');
    } else {
      doc.font('Courier-Bold').fontSize(8.5).fillColor(INK).text(value, x, rowY + 11, { width, lineBreak: false });
    }

    // The ruled line these forms always print under the value.
    doc
      .moveTo(x, rowY + 24)
      .lineTo(x + (isWide ? 400 : 150), rowY + 24)
      .lineWidth(0.5)
      .strokeColor('#d1d5db')
      .stroke();

    if (isWide) {
      col = 0;
      rowY += blockH;
    } else if (col === 2) {
      col = 0;
      rowY += blockH;
    } else {
      col++;
    }
  }
  if (col !== 0) rowY += blockH;
  footer(doc, rec, 'Helvetica', rowY + 16);
}

export function renderFixture(rec: FixtureRecord): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: { Title: rec.title, Author: rec.school },
  });
  if (rec.layout === 'A') renderA(doc, rec);
  else if (rec.layout === 'B') renderB(doc, rec);
  else renderC(doc, rec);
  return toBuffer(doc);
}

/**
 * A two-page document: the form, then a continuation sheet.
 * Multi-page handling is a distinct code path (pages are ingested and
 * classified independently), so it needs its own fixture.
 */
export function renderMultipage(rec: FixtureRecord): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: rec.title, Author: rec.school } });
  renderA(doc, rec);

  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('ANNEXURE — SUPPORTING DECLARATION', 48, 60);
  doc
    .moveTo(48, 78)
    .lineTo(547, 78)
    .lineWidth(0.8)
    .strokeColor(RULE)
    .stroke();
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(INK)
    .text(
      `This annexure forms part of the admission application submitted for ${rec.print.studentName ?? rec.print.teacherName}. ` +
        'The undersigned confirms that all supporting documents — birth certificate, transfer certificate and ' +
        'address proof — have been verified against their originals by the admissions office.',
      48,
      96,
      { width: 499, align: 'justify' },
    );

  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Verified By:', 48, 170, { lineBreak: false });
  doc.font('Helvetica-Bold').fillColor(INK).text('S. Deshpande, Admissions Officer', 144, 170, { lineBreak: false });
  doc.font('Helvetica').fillColor(MUTED).text('Office Stamp Date:', 48, 190, { lineBreak: false });
  doc.font('Helvetica-Bold').fillColor(INK).text('16/07/2026', 144, 190, { lineBreak: false });

  return toBuffer(doc);
}

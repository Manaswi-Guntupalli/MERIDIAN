import { describe, expect, it } from 'vitest';
import PDFDocument from 'pdfkit';
import { ingest } from './ingest.js';
import { classify } from './classify.js';
import { extractFields } from './extract.js';
import { templateFor } from './templates.js';

// Reproduces the reported failure: a PDF whose labels are printed text but
// whose VALUES were typed into form fields (the annotation layer). Before the
// fix, getTextContent() returned only the labels → every value empty → near-
// zero confidence. The fix reads the annotation layer and merges the values.

function filledAdmissionPdf(): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.font('Helvetica-Bold').fontSize(16).text('STUDENT ADMISSION FORM', { align: 'center' });
    doc.fontSize(9).text('Application for Admission', { align: 'center' });
    doc.moveDown();
    doc.initForm();

    // Each row: a printed label (content stream) + a filled form field (annotation).
    const rows: [string, string, string][] = [
      ['Student Name', 'name', 'MANASWI G'],
      ['Date of Birth', 'dob', '23-11-2013'],
      ['Gender', 'gender', 'FEMALE'],
      ['Class Applied For', 'class', '8'],
      ['Blood Group', 'blood', 'O+'],
      ['Contact Number', 'phone', '9108837950'],
      ['Email', 'email', 'test@example.com'],
      ['Previous School', 'prev', 'RASHTROTTHANA VIDYA KENDRA'],
    ];
    let y = doc.y + 6;
    for (const [label, field, value] of rows) {
      doc.font('Times-Bold').fontSize(11).text(`${label} :`, 40, y, { lineBreak: false });
      const lx = 40 + doc.widthOfString(`${label} :`) + 6;
      doc.formText(field, lx, y - 2, 300, 16, { value, fontSize: 11 });
      y += 26;
    }
    doc.end();
  });
}

describe('Lumen — digitally-filled PDF (values in the annotation layer)', () => {
  it('extracts field values that were typed into PDF form fields, not just the labels', async () => {
    const pdf = await filledAdmissionPdf();
    const pages = await ingest({ buffer: pdf, mimeType: 'application/pdf', fileName: 'filled.pdf' });

    // It stayed on the fast text path (no OCR) but now carries the values.
    expect(pages[0].source).toBe('TEXT_LAYER');
    expect(pages[0].text).toMatch(/MANASWI G/);
    expect(pages[0].text).toMatch(/9108837950/);

    const cls = classify(pages);
    expect(cls.type).toBe('ADMISSION');

    const fields = await extractFields(templateFor('ADMISSION'), pages, {
      signaturePresent: async () => false,
      reread: async () => null,
    });
    const byKey = new Map(fields.map((f) => [f.key, f]));

    // The values are present and confidently read (they are the file's own text).
    expect(byKey.get('studentName')?.value.toUpperCase()).toContain('MANASWI');
    expect(byKey.get('studentName')?.confidence ?? 0).toBeGreaterThan(0.75);
    expect(byKey.get('phone')?.value.replace(/\D/g, '')).toContain('9108837950');
    expect(byKey.get('dob')?.value).toBeTruthy();

    // And the document as a whole is no longer a near-zero-confidence dud.
    const filled = fields.filter((f) => f.value.trim()).length;
    expect(filled).toBeGreaterThanOrEqual(5);
  });
});

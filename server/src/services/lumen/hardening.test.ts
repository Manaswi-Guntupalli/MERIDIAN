import { describe, expect, it } from 'vitest';
import PDFDocument from 'pdfkit';
import { sniffFile } from './storage.js';
import { classify } from './classify.js';
import { docTypeLabel } from './templates.js';
import { ingest, MAX_PDF_PAGES } from './ingest.js';

// ── Intake hardening: page cap, honest UNKNOWN type, named rejections ──

function makePdf(pages: number): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    for (let i = 0; i < pages; i++) {
      doc.addPage({ size: 'A4' });
      doc.text(`Page ${i + 1}`);
    }
    doc.end();
  });
}

describe('Lumen intake — file sniffing', () => {
  it('accepts the five supported formats by magic bytes', () => {
    expect(sniffFile(Buffer.from('%PDF-1.4\nx'), 'a.pdf').name).toBe('PDF');
    expect(sniffFile(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]), 'a.png').name).toBe('PNG');
    expect(sniffFile(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), 'a.jpg').name).toBe('JPEG');
  });

  it('names the iPhone HEIC problem and the fix, instead of a generic shrug', () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(12)]);
    expect(() => sniffFile(heic, 'IMG_0421.heic')).toThrow(/iPhone HEIC photo.*JPEG/s);
  });

  it('recognises Office/ZIP files and says how to convert them', () => {
    const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(16)]);
    expect(() => sniffFile(docx, 'form.docx')).toThrow(/Office document.*PDF/s);
  });

  it('still rejects unrecognisable bytes with the generic message', () => {
    expect(() => sniffFile(Buffer.from('hello world, not a document'), 'x.bin')).toThrow(/not a recognisable PDF or image/);
  });
});

describe('Lumen intake — PDF page cap', () => {
  it(`rejects a PDF over ${MAX_PDF_PAGES} pages with the counts in the message`, async () => {
    const big = await makePdf(MAX_PDF_PAGES + 1);
    await expect(ingest({ buffer: big, mimeType: 'application/pdf', fileName: 'big.pdf' })).rejects.toThrow(
      new RegExp(`${MAX_PDF_PAGES + 1} pages.*${MAX_PDF_PAGES} pages`),
    );
  });
});

describe('Lumen classify — honest UNKNOWN', () => {
  it('returns UNKNOWN (not a silent default) when nothing matches', () => {
    const pages = [{ index: 0, text: 'zxqv lorem noise 123 unrelated words', height: 1000, width: 800, lines: [] }] as any;
    const c = classify(pages);
    expect(c.type).toBe('UNKNOWN');
    expect(c.confidence).toBe(0);
  });

  it('still identifies a real admission form from its headline', () => {
    const pages = [
      {
        index: 0,
        text: 'ADMISSION FORM Student Name Date of Birth Class Applied For Previous School',
        height: 1000,
        width: 800,
        lines: [{ text: 'ADMISSION FORM', y0: 60 }],
      },
    ] as any;
    const c = classify(pages);
    expect(c.type).toBe('ADMISSION');
    expect(c.confidence).toBeGreaterThan(0.4);
  });

  it('labels UNKNOWN honestly while known types keep their template label', () => {
    expect(docTypeLabel('UNKNOWN')).toBe('Unknown document');
    expect(docTypeLabel('ADMISSION')).toBe('Student Admission Form');
  });
});

// Lumen — exports.
//
// The clerk's real deliverable is rarely "a record in our database" — it's the
// spreadsheet the district office wants, the CSV the state portal ingests, the
// JSON another system consumes. Retyping verified data into those formats
// would resurrect exactly the manual work Lumen exists to kill, so exports are
// first-class.
//
// One decision worth stating: exports include *audit columns* (confidence,
// status, whether a human confirmed the value), not just the values. A
// spreadsheet that silently mixes machine-read and human-verified data is how
// bad records propagate between systems with their provenance laundered away.

import ExcelJS from 'exceljs';

export interface ExportableDoc {
  id: string;
  fileName: string;
  type: string;
  status: string;
  overallConfidence: number;
  createdAt: Date;
  fields: {
    key: string;
    label: string;
    value: string;
    confidence: number;
    status: string;
    corrected: boolean;
  }[];
}

/** Union of field keys across the batch, in first-seen order. */
function allKeys(docs: ExportableDoc[]): { key: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const d of docs) for (const f of d.fields) if (!seen.has(f.key)) seen.set(f.key, f.label);
  return [...seen.entries()].map(([key, label]) => ({ key, label }));
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function toCSV(docs: ExportableDoc[]): string {
  const keys = allKeys(docs);
  const header = ['Document', 'Type', 'Status', 'Overall Confidence', ...keys.map((k) => k.label), 'Fields Needing Review'];
  const rows = docs.map((d) => {
    const byKey = new Map(d.fields.map((f) => [f.key, f]));
    const needsReview = d.fields.filter((f) => f.status === 'REVIEW' || f.status === 'MISSING').length;
    return [
      d.fileName,
      d.type,
      d.status,
      `${Math.round(d.overallConfidence * 100)}%`,
      ...keys.map(({ key }) => byKey.get(key)?.value ?? ''),
      String(needsReview),
    ];
  });
  // ﻿: Excel needs the BOM to open UTF-8 CSVs without mangling ₹ and
  // Indian names — the exact characters this data is full of.
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function toJSONExport(docs: ExportableDoc[]): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      source: 'Meridian Lumen',
      documents: docs.map((d) => ({
        id: d.id,
        fileName: d.fileName,
        type: d.type,
        status: d.status,
        overallConfidence: d.overallConfidence,
        processedAt: d.createdAt,
        fields: d.fields.map((f) => ({
          key: f.key,
          label: f.label,
          value: f.value,
          confidence: f.confidence,
          status: f.status,
          humanVerified: f.status === 'CONFIRMED',
          machineCorrected: f.corrected,
        })),
      })),
    },
    null,
    2,
  );
}

export async function toXLSX(docs: ExportableDoc[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Meridian Lumen';
  wb.created = new Date();

  // ── Sheet 1: the data, one row per document. ──
  const data = wb.addWorksheet('Extracted Data', { views: [{ state: 'frozen', ySplit: 1 }] });
  const keys = allKeys(docs);
  data.columns = [
    { header: 'Document', key: '__file', width: 26 },
    { header: 'Type', key: '__type', width: 20 },
    { header: 'Status', key: '__status', width: 12 },
    { header: 'Confidence', key: '__conf', width: 12 },
    ...keys.map(({ key, label }) => ({ header: label, key, width: Math.max(14, Math.min(34, label.length + 8)) })),
  ];
  data.getRow(1).font = { bold: true };
  data.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEDE6' } };

  for (const d of docs) {
    const byKey = new Map(d.fields.map((f) => [f.key, f]));
    const row = data.addRow({
      __file: d.fileName,
      __type: d.type,
      __status: d.status,
      __conf: d.overallConfidence,
      ...Object.fromEntries(keys.map(({ key }) => [key, byKey.get(key)?.value ?? ''])),
    });
    row.getCell('__conf').numFmt = '0%';
    // Amber-tint any cell a human still needs to look at.
    for (const { key } of keys) {
      const f = byKey.get(key);
      if (f && (f.status === 'REVIEW' || f.status === 'MISSING')) {
        row.getCell(key).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBEED2' } };
      }
    }
  }

  // ── Sheet 2: the audit trail, one row per field. ──
  const audit = wb.addWorksheet('Field Audit', { views: [{ state: 'frozen', ySplit: 1 }] });
  audit.columns = [
    { header: 'Document', key: 'doc', width: 26 },
    { header: 'Field', key: 'label', width: 22 },
    { header: 'Value', key: 'value', width: 30 },
    { header: 'Confidence', key: 'conf', width: 12 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Machine-corrected', key: 'corr', width: 16 },
  ];
  audit.getRow(1).font = { bold: true };
  audit.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEDE6' } };
  for (const d of docs) {
    for (const f of d.fields) {
      const row = audit.addRow({
        doc: d.fileName,
        label: f.label,
        value: f.value,
        conf: f.confidence,
        status: f.status,
        corr: f.corrected ? 'yes' : '',
      });
      row.getCell('conf').numFmt = '0%';
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

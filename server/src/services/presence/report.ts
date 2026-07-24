// Presence — attendance session reports.
//
// After a session closes, the teacher's real deliverable is not the rows in our
// database — it's the printable register the office files and the spreadsheet
// the district ingests. This module assembles that report from data the
// attendance engine has ALREADY stored (AttendanceSession + its verification
// rows) and renders it as PDF and Excel. It never re-decides who was present:
// every status here is read straight off the stored verification state. The
// only thing computed is *presentation* — turning stored timestamps into a
// human "Face Only" vs "QR + Face" label, and counting what's already there.

import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { prisma } from '../../lib/prisma.js';
import { notFound } from '../../lib/errors.js';

// ── Presentation types ──────────────────────────────────────────────────────

/** Final attendance outcome for a student, as shown on the report. */
export type ReportStatus = 'Present' | 'Absent' | 'Unverified QR' | 'Proxy Attempt';

/** How a present student proved it — derived purely from stored timestamps. */
export type ReportMethod = 'Face Only' | 'QR + Face' | 'Manual' | 'QR only' | 'Blocked (proxy)' | '—';

export interface ReportStudent {
  rollNo: number;
  name: string;
  status: ReportStatus;
  method: ReportMethod;
  confidence: number | null; // cosine similarity 0..1, when a face was matched
  time: string | null; // ISO instant the outcome was recorded
  remarks: string;
}

export interface SessionSummary {
  id: string;
  status: string; // ACTIVE | CLOSED | EXPIRED
  schoolName: string;
  className: string; // e.g. "9B"
  grade: number;
  section: string;
  subject: string | null;
  subjectCode: string | null;
  teacherName: string;
  date: string; // YYYY-MM-DD
  startTime: string; // ISO
  endTime: string | null; // ISO (closedAt) — null while still active
  durationSeconds: number | null;
  counts: {
    present: number;
    absent: number;
    unverifiedQr: number;
    proxy: number;
    total: number;
  };
  methods: {
    faceOnly: number;
    qrAndFace: number;
    manual: number;
    avgFaceConfidence: number | null; // 0..1 across matched faces
  };
  // Honest, queried facts — not decoration. Each is a real check that the
  // corresponding trust artifact exists for this session.
  integrity: {
    attendanceVerified: boolean;
    auditLogged: boolean;
    eventStored: boolean;
    trustCoreUpdated: boolean;
  };
  students: ReportStudent[];
}

// ── Derivation (formatting only — no attendance is recomputed here) ──────────

type VRow = {
  state: string;
  qrVerifiedAt: Date | null;
  faceVerifiedAt: Date | null;
  faceConfidence: number | null;
  markedPresentAt: Date | null;
  reason: string | null;
  proxyMatchedName: string | null;
  student: { name: string; rollNo: number };
};

/**
 * Map a stored verification row to its final report status.
 *
 * On close/expiry the engine sweeps every non-present row to UNVERIFIED_QR. The
 * stored `qrVerifiedAt` timestamp is what separates the two honest cases: a
 * student who actually scanned a QR (face never confirmed → genuinely
 * "Unverified QR") from one who did nothing at all (→ "Absent"). We read that
 * timestamp; we do not re-derive it.
 */
function statusOf(v: VRow): ReportStatus {
  if (v.state === 'PRESENT' || v.state === 'FACE_VERIFIED') return 'Present';
  if (v.state === 'PROXY_ATTEMPT') return 'Proxy Attempt';
  if (v.state === 'UNVERIFIED_QR') return v.qrVerifiedAt ? 'Unverified QR' : 'Absent';
  // PENDING / QR_VERIFIED can only survive on a still-active session; ABSENT is
  // explicit. All read as not-yet-present → Absent for the register.
  if (v.state === 'QR_VERIFIED') return 'Unverified QR';
  return 'Absent';
}

function methodOf(v: VRow, status: ReportStatus): ReportMethod {
  if (status === 'Present') {
    if (v.faceVerifiedAt && v.qrVerifiedAt) return 'QR + Face';
    if (v.faceVerifiedAt) return 'Face Only';
    return 'Manual'; // present with neither timestamp = staff override
  }
  if (status === 'Proxy Attempt') return 'Blocked (proxy)';
  if (status === 'Unverified QR') return 'QR only';
  return '—';
}

function remarksOf(v: VRow, status: ReportStatus): string {
  if (status === 'Proxy Attempt') {
    return v.proxyMatchedName ? `QR claimed this student; face matched ${v.proxyMatchedName}` : (v.reason ?? 'Proxy attempt blocked');
  }
  if (status === 'Unverified QR') return v.reason ?? 'QR scanned; face never verified';
  if (status === 'Present' && !v.faceVerifiedAt && !v.qrVerifiedAt) return 'Marked manually by staff';
  return '';
}

// ── Assemble ─────────────────────────────────────────────────────────────────

/**
 * Build the full session summary from already-stored data. Read-only: this
 * touches nothing but SELECTs and never mutates a verification, an event, or
 * the attendance engine's state.
 */
export async function buildSessionSummary(schoolId: string, sessionId: string): Promise<SessionSummary> {
  const s = await prisma.attendanceSession.findFirst({
    where: { id: sessionId, schoolId },
    include: {
      school: { select: { name: true } },
      class: { select: { name: true, grade: true, section: true } },
      subject: { select: { code: true, name: true } },
      teacher: { include: { user: { select: { name: true } } } },
      verifications: {
        include: { student: { select: { name: true, rollNo: true } } },
        orderBy: { student: { rollNo: 'asc' } },
      },
    },
  });
  if (!s) throw notFound('Attendance session not found');

  const rows: ReportStudent[] = s.verifications.map((v) => {
    const status = statusOf(v);
    return {
      rollNo: v.student.rollNo,
      name: v.student.name,
      status,
      method: methodOf(v, status),
      confidence: v.faceConfidence,
      time: (v.markedPresentAt ?? v.faceVerifiedAt ?? v.qrVerifiedAt)?.toISOString() ?? null,
      remarks: remarksOf(v, status),
    };
  });

  // Counts — a clean partition of the roster into the four report buckets.
  const counts = { present: 0, absent: 0, unverifiedQr: 0, proxy: 0, total: rows.length };
  for (const r of rows) {
    if (r.status === 'Present') counts.present++;
    else if (r.status === 'Proxy Attempt') counts.proxy++;
    else if (r.status === 'Unverified QR') counts.unverifiedQr++;
    else counts.absent++;
  }

  // Verification-method breakdown across the present students.
  let faceOnly = 0;
  let qrAndFace = 0;
  let manual = 0;
  const confs: number[] = [];
  for (const v of s.verifications) {
    if (v.faceConfidence != null) confs.push(v.faceConfidence);
    if (v.state === 'PRESENT' || v.state === 'FACE_VERIFIED') {
      if (v.faceVerifiedAt && v.qrVerifiedAt) qrAndFace++;
      else if (v.faceVerifiedAt) faceOnly++;
      else manual++;
    }
  }
  const avgFaceConfidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null;

  // Integrity — real queries against the trust artifacts, in parallel.
  const [eventCount, auditCount, attendanceEventCount] = await Promise.all([
    prisma.event.count({ where: { schoolId, aggregateId: sessionId } }),
    prisma.auditLog.count({ where: { schoolId, entityId: sessionId } }),
    prisma.attendanceEvent.count({ where: { schoolId, sessionId } }),
  ]);

  return {
    id: s.id,
    status: s.status,
    schoolName: s.school.name,
    className: s.class.name,
    grade: s.class.grade,
    section: s.class.section,
    subject: s.subject?.name ?? null,
    subjectCode: s.subject?.code ?? null,
    teacherName: s.teacher.user.name,
    date: s.date,
    startTime: s.startTime.toISOString(),
    endTime: s.closedAt?.toISOString() ?? null,
    durationSeconds: s.closedAt ? Math.max(0, Math.round((s.closedAt.getTime() - s.startTime.getTime()) / 1000)) : null,
    counts,
    methods: { faceOnly, qrAndFace, manual, avgFaceConfidence },
    integrity: {
      attendanceVerified: counts.total > 0,
      auditLogged: auditCount > 0,
      eventStored: eventCount > 0,
      trustCoreUpdated: counts.present === 0 ? true : attendanceEventCount > 0,
    },
    students: rows,
  };
}

// ── Shared formatting helpers ────────────────────────────────────────────────

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function fmtDuration(sec: number | null): string {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmtConfidence(c: number | null): string {
  return c == null ? '—' : `${Math.round(c * 100)}%`;
}

/** "Attendance_9B_Maths_2026-07-24" — a stable, filesystem-safe report name. */
export function reportFileName(sm: SessionSummary): string {
  const parts = ['Attendance', sm.className, sm.subjectCode ?? sm.subject ?? '', sm.date].filter(Boolean);
  return parts.join('_').replace(/[^\w.-]+/g, '_');
}

// ── PDF (pdfkit) ─────────────────────────────────────────────────────────────

const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';
const BRAND = '#4f46e5';
const STATUS_COLOR: Record<ReportStatus, string> = {
  Present: '#16a34a',
  Absent: '#64748b',
  'Unverified QR': '#d97706',
  'Proxy Attempt': '#dc2626',
};

/** Render the session summary as a professional, printable A4 PDF. */
export function renderSessionPdf(sm: SessionSummary): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 44, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    // ── Header ──
    doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(9).text('MERIDIAN PRESENCE', left, doc.y, { characterSpacing: 1.5 });
    doc.moveDown(0.2);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text(sm.schoolName);
    doc.fillColor(MUTED).font('Helvetica').fontSize(11).text('Attendance Session Report');
    doc.moveDown(0.6);
    hr(doc, left, right);
    doc.moveDown(0.8);

    // ── Session meta (two columns) ──
    const metaTop = doc.y;
    const colGap = 22;
    const colW = (width - colGap) / 2;
    const metaLeft: [string, string][] = [
      ['Class', `${sm.className}  (Grade ${sm.grade} · Section ${sm.section})`],
      ['Subject', sm.subject ?? 'General'],
      ['Teacher', sm.teacherName],
    ];
    const metaRight: [string, string][] = [
      ['Date', sm.date],
      ['Session', `${fmtTime(sm.startTime)} – ${fmtTime(sm.endTime)}`],
      ['Duration', fmtDuration(sm.durationSeconds)],
    ];
    const hLeft = metaColumn(doc, metaLeft, left, metaTop, colW);
    const hRight = metaColumn(doc, metaRight, left + colW + colGap, metaTop, colW);
    doc.y = Math.max(hLeft, hRight) + 14;

    // ── Attendance statistics ──
    sectionHeading(doc, 'Attendance Summary', left, right);
    const stats: [string, number, string][] = [
      ['Present', sm.counts.present, STATUS_COLOR.Present],
      ['Absent', sm.counts.absent, STATUS_COLOR.Absent],
      ['Unverified QR', sm.counts.unverifiedQr, STATUS_COLOR['Unverified QR']],
      ['Proxy Attempts', sm.counts.proxy, STATUS_COLOR['Proxy Attempt']],
    ];
    statCards(doc, stats, left, width);
    doc.moveDown(0.6);

    // ── Verification methods ──
    sectionHeading(doc, 'Verification Methods', left, right);
    const methodLine = [
      `Face only: ${sm.methods.faceOnly}`,
      `QR + Face: ${sm.methods.qrAndFace}`,
      ...(sm.methods.manual ? [`Manual: ${sm.methods.manual}`] : []),
      `Average face confidence: ${fmtConfidence(sm.methods.avgFaceConfidence)}`,
    ].join('      ');
    doc.fillColor(INK).font('Helvetica').fontSize(10).text(methodLine, left, doc.y, { width });
    doc.moveDown(0.9);

    // ── Student register table ──
    sectionHeading(doc, `Student Register  (${sm.counts.total})`, left, right);
    renderStudentTable(doc, sm, left, right);

    // ── Footer on every page ──
    const range = doc.bufferedPageRange();
    const generated = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      // Writing into the bottom-margin band makes pdfkit auto-insert a page;
      // zero this page's bottom margin so the footer text never paginates.
      doc.page.margins.bottom = 0;
      const fy = doc.page.height - 30;
      doc.fillColor(MUTED).font('Helvetica').fontSize(8);
      doc.text(`Generated by Meridian Presence · ${generated}`, left, fy, { width: width / 2, lineBreak: false });
      doc.text(`Page ${i + 1} of ${range.count}`, left + width / 2, fy, { width: width / 2, align: 'right', lineBreak: false });
    }

    doc.end();
  });
}

function hr(doc: PDFKit.PDFDocument, x1: number, x2: number, y = doc.y) {
  doc.moveTo(x1, y).lineTo(x2, y).lineWidth(1).strokeColor(LINE).stroke();
}

function metaColumn(doc: PDFKit.PDFDocument, rows: [string, string][], x: number, top: number, w: number): number {
  let y = top;
  for (const [label, value] of rows) {
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5).text(label.toUpperCase(), x, y, { width: w, characterSpacing: 0.5 });
    y = doc.y;
    doc.fillColor(INK).font('Helvetica').fontSize(11).text(value, x, y, { width: w });
    y = doc.y + 8;
  }
  return y;
}

function sectionHeading(doc: PDFKit.PDFDocument, title: string, left: number, right: number) {
  if (doc.y > doc.page.height - 140) doc.addPage();
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(title, left);
  doc.moveDown(0.3);
  hr(doc, left, right);
  doc.moveDown(0.5);
}

function statCards(doc: PDFKit.PDFDocument, stats: [string, number, string][], left: number, width: number) {
  const gap = 10;
  const n = stats.length;
  const w = (width - gap * (n - 1)) / n;
  const top = doc.y;
  const h = 52;
  stats.forEach(([label, value, color], i) => {
    const x = left + i * (w + gap);
    doc.roundedRect(x, top, w, h, 6).lineWidth(1).strokeColor(LINE).stroke();
    doc.roundedRect(x, top, 3, h, 1.5).fillColor(color).fill();
    doc.fillColor(color).font('Helvetica-Bold').fontSize(22).text(String(value), x + 12, top + 9, { width: w - 16 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(label.toUpperCase(), x + 12, top + 36, { width: w - 16, characterSpacing: 0.4 });
  });
  doc.y = top + h;
}

function renderStudentTable(doc: PDFKit.PDFDocument, sm: SessionSummary, left: number, right: number) {
  const width = right - left;
  // Column layout: Roll · Name · Status · Method · Conf · Time
  const cols = [
    { key: 'roll', label: 'Roll', w: 0.09 },
    { key: 'name', label: 'Student Name', w: 0.3 },
    { key: 'status', label: 'Status', w: 0.17 },
    { key: 'method', label: 'Method', w: 0.19 },
    { key: 'conf', label: 'Conf.', w: 0.1 },
    { key: 'time', label: 'Time', w: 0.15 },
  ].map((c) => ({ ...c, px: c.w * width }));
  const xOf = (i: number) => left + cols.slice(0, i).reduce((a, c) => a + c.px, 0);
  const rowH = 20;

  const header = () => {
    const y = doc.y;
    doc.rect(left, y, width, 18).fillColor('#f1f5f9').fill();
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8);
    cols.forEach((c, i) => doc.text(c.label.toUpperCase(), xOf(i) + 6, y + 5, { width: c.px - 8, lineBreak: false }));
    doc.y = y + 18;
  };
  header();

  sm.students.forEach((st, idx) => {
    if (doc.y + rowH > doc.page.height - doc.page.margins.bottom - 20) {
      doc.addPage();
      header();
    }
    const y = doc.y;
    if (idx % 2 === 1) doc.rect(left, y, width, rowH).fillColor('#fafafa').fill();
    doc.font('Helvetica').fontSize(9);
    const cells: [string, string?][] = [
      [String(st.rollNo)],
      [st.name],
      [st.status, STATUS_COLOR[st.status]],
      [st.method],
      [fmtConfidence(st.confidence)],
      [fmtTime(st.time)],
    ];
    cells.forEach(([text, color], i) => {
      doc.fillColor(color ?? INK);
      if (i === 2) doc.font('Helvetica-Bold');
      else doc.font('Helvetica');
      doc.text(text, xOf(i) + 6, y + 5.5, { width: cols[i].px - 8, lineBreak: false, ellipsis: true });
    });
    doc.strokeColor(LINE).lineWidth(0.5).moveTo(left, y + rowH).lineTo(right, y + rowH).stroke();
    doc.y = y + rowH;
  });
}

// ── Excel (exceljs) ──────────────────────────────────────────────────────────

const XL_FILL: Record<ReportStatus, string> = {
  Present: 'FFDCFCE7', // green tint
  Absent: 'FFF1F5F9', // grey tint
  'Unverified QR': 'FFFEF3C7', // amber tint
  'Proxy Attempt': 'FFFEE2E2', // red tint
};

/** Render the session summary as a formatted .xlsx workbook. */
export async function renderSessionExcel(sm: SessionSummary): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Meridian Presence';
  wb.created = new Date();

  // ── Sheet 1: Register ──
  const ws = wb.addWorksheet('Attendance', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Roll Number', key: 'roll', width: 14 },
    { header: 'Student Name', key: 'name', width: 30 },
    { header: 'Attendance Status', key: 'status', width: 18 },
    { header: 'Verification Method', key: 'method', width: 20 },
    { header: 'Recognition Confidence', key: 'conf', width: 22 },
    { header: 'Attendance Time', key: 'time', width: 18 },
    { header: 'Remarks', key: 'remarks', width: 42 },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
  head.alignment = { vertical: 'middle' };
  head.height = 20;

  for (const st of sm.students) {
    const row = ws.addRow({
      roll: st.rollNo,
      name: st.name,
      status: st.status,
      method: st.method,
      conf: st.confidence == null ? '' : st.confidence,
      time: st.time ? new Date(st.time) : '',
      remarks: st.remarks,
    });
    row.getCell('conf').numFmt = '0%';
    row.getCell('time').numFmt = 'hh:mm AM/PM';
    const fill = XL_FILL[st.status];
    row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    row.getCell('status').font = { bold: true };
  }

  // ── Sheet 2: Session summary ──
  const meta = wb.addWorksheet('Summary');
  meta.columns = [
    { header: 'Field', key: 'k', width: 26 },
    { header: 'Value', key: 'v', width: 40 },
  ];
  meta.getRow(1).font = { bold: true };
  meta.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEDE6' } };
  const pairs: [string, string | number][] = [
    ['School', sm.schoolName],
    ['Class', `${sm.className} (Grade ${sm.grade}, Section ${sm.section})`],
    ['Subject', sm.subject ?? 'General'],
    ['Teacher', sm.teacherName],
    ['Date', sm.date],
    ['Start Time', fmtTime(sm.startTime)],
    ['End Time', fmtTime(sm.endTime)],
    ['Session Duration', fmtDuration(sm.durationSeconds)],
    ['Students on Register', sm.counts.total],
    ['Present', sm.counts.present],
    ['Absent', sm.counts.absent],
    ['Unverified QR', sm.counts.unverifiedQr],
    ['Proxy Attempts', sm.counts.proxy],
    ['Face Only', sm.methods.faceOnly],
    ['QR + Face', sm.methods.qrAndFace],
    ['Average Face Confidence', fmtConfidence(sm.methods.avgFaceConfidence)],
    ['Generated', new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })],
  ];
  for (const [k, v] of pairs) meta.addRow({ k, v });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

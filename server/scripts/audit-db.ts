// One-off READ-ONLY database audit — integrity + feature-data coverage.
import { prisma } from '../src/lib/prisma.js';

const flags: string[] = [];
const ok: string[] = [];
const flag = (s: string) => flags.push(s);
const pass = (s: string) => ok.push(s);

async function main() {
  // ── Referential / business-rule integrity ──
  const [students, cards, fees, payments, attendance, events] = await Promise.all([
    prisma.student.findMany({ select: { id: true, classId: true, active: true, guardianName: true, phone: true, emergencyContact: true } }),
    prisma.rFIDCard.groupBy({ by: ['studentId', 'status'], _count: true }),
    prisma.fee.findMany({ include: { payments: true } }),
    prisma.payment.count(),
    prisma.attendance.groupBy({ by: ['date'], _count: true, orderBy: { date: 'asc' } }),
    prisma.attendanceEvent.count(),
  ]);

  // Students without class / login
  const noClass = students.filter((s) => !s.classId).length;
  noClass ? flag(`${noClass} students have no class`) : pass('every student has a class');

  // >1 ACTIVE card per student
  const activeCards = new Map<string, number>();
  for (const c of cards) if (c.status === 'ACTIVE') activeCards.set(c.studentId, (activeCards.get(c.studentId) ?? 0) + (c as any)._count);
  const multi = [...activeCards.values()].filter((n) => n > 1).length;
  multi ? flag(`${multi} students hold >1 ACTIVE RFID card`) : pass('≤1 active card per student');

  // Fee ledger arithmetic: paid must equal sum(payments); status must match
  let ledgerMismatch = 0, statusWrong = 0, overpaid = 0;
  for (const f of fees) {
    const sum = f.payments.reduce((a, p) => a + p.amount, 0);
    if (Math.abs(sum - f.paid) > 0.01) ledgerMismatch++;
    const expected = f.paid >= f.amount ? 'PAID' : f.paid > 0 ? 'PARTIAL' : new Date(f.dueDate) < new Date() ? 'OVERDUE' : 'PENDING';
    if (f.status !== expected && !(f.status === 'PENDING' && expected === 'OVERDUE')) statusWrong++;
    if (f.paid > f.amount + 0.01) overpaid++;
  }
  ledgerMismatch ? flag(`FEE LEDGER: ${ledgerMismatch}/${fees.length} fees where paid ≠ sum(Payment rows) — the audit trail contradicts the balance`) : pass('fee paid == sum(payments) everywhere');
  statusWrong ? flag(`${statusWrong} fees have inconsistent status`) : pass('fee statuses consistent');
  overpaid ? flag(`${overpaid} fees overpaid`) : pass('no overpayments');

  // Duplicate attendance per student/day is schema-enforced; check status domain
  const badStatus = await prisma.attendance.count({ where: { status: { notIn: ['PRESENT', 'ABSENT', 'LATE', 'LEAVE'] } } });
  badStatus ? flag(`${badStatus} attendance rows with unknown status`) : pass('attendance status domain clean');

  // Timetable: exactly one active published; slot double-booking is schema-enforced
  const activeTT = await prisma.timetable.findMany({ where: { active: true } });
  activeTT.length === 1 && activeTT[0].status === 'PUBLISHED'
    ? pass(`exactly one live timetable (v${activeTT[0].version}, score ${activeTT[0].score})`)
    : flag(`expected 1 active PUBLISHED timetable, found ${activeTT.length} (${activeTT.map((t) => t.status).join(',')})`);

  // Orphaned substitutions / absences
  const subs = await prisma.substitution.count();
  const absences = await prisma.staffAbsence.count();

  // Trust ledger honesty: AI logs claiming actions with no matching records
  const cvLogs = await prisma.aILog.count({ where: { engine: 'PRESENCE', action: 'CV attendance capture' } });
  const cvEvents = await prisma.attendanceEvent.count({ where: { source: 'CV' } });
  cvLogs > cvEvents
    ? flag(`TRUST LEDGER: ${cvLogs} "CV attendance capture" AI-log rows but only ${cvEvents} CV attendance events exist — fabricated ledger entries`)
    : pass('AI log CV claims match CV events');

  const fakeKairos = await prisma.aILog.count({ where: { engine: 'KAIROS', action: 'Timetable solve' } });
  fakeKairos ? flag(`TRUST LEDGER: ${fakeKairos} hand-written "Timetable solve" rows (the real generateDraft writes its own honest log)`) : pass('no duplicate hand-written Kairos logs');

  // ── Feature-data coverage ──
  const schoolDays = attendance.length;
  schoolDays < 15 ? flag(`COVERAGE: only ${schoolDays} distinct attendance dates — thin for trends/at-risk/forecast (dossier narrates 6-week patterns)`) : pass(`${schoolDays} attendance dates`);

  absences === 0 ? flag('COVERAGE: zero StaffAbsence history — the Python substitute-demand forecast reports "insufficient evidence" forever') : pass(`${absences} staff absences, ${subs} substitutions`);

  const docs = await prisma.document.findMany({ include: { activity: true, insights: true, pages: true } });
  docs.length < 2 ? flag(`COVERAGE: ${docs.length} document(s) — review queue/verified pipeline can't show both states (seed comment promises "one in review, one verified" but creates only one)`) : pass(`${docs.length} documents`);
  const docNoActivity = docs.filter((d) => d.activity.length === 0).length;
  docNoActivity ? flag(`COVERAGE: ${docNoActivity} document(s) with EMPTY activity timeline (Processing History renders blank)`) : pass('documents have activity trails');

  const contactMissing = students.filter((s) => !s.guardianName || !s.phone || !s.emergencyContact).length;
  contactMissing ? flag(`COVERAGE: ${contactMissing}/${students.length} students missing guardian/phone/emergency contact — the "front office emergency lookup" columns are empty`) : pass('student contact blocks filled');

  const pendingFees = fees.filter((f) => f.status === 'PENDING').length;
  pendingFees === 0 ? flag('COVERAGE: no PENDING (future due) fees — aging buckets collapse to two identical ages; every at-risk student shows the same "₹12,500, 36d" evidence') : pass('fee aging varied');

  const preds = await prisma.prediction.count();
  if (preds === 0) pass('Prediction table empty — confirmed dead/legacy (nothing reads it; Python computes live)');

  const faceEmb = await prisma.faceEmbedding.count();
  const proxyEvents = await prisma.faceEvent.count({ where: { kind: 'PROXY' } });
  proxyEvents > 0 && faceEmb === 0
    ? flag(`DEBRIS: ${proxyEvents} PROXY FaceEvent row(s) from smoke tests but zero enrolled faces — stale security log entries`)
    : pass('face event log consistent with enrollments');

  const simNotes = await prisma.attendanceEvent.count({ where: { notes: { contains: 'Simulator' } } });
  console.log('\n════════ AUDIT RESULT ════════');
  console.log(`\n❌ FLAGS (${flags.length}):`);
  flags.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  console.log(`\n✅ PASSES (${ok.length}):`);
  ok.forEach((o) => console.log(`  · ${o}`));
  console.log(`\nℹ️  context: ${events} attendance events (${simNotes} simulator-tagged), ${payments} payment rows, ${fees.length} fees`);
}

main().finally(() => prisma.$disconnect());

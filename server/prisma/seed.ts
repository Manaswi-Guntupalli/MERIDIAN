import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { generateDraft, approveDraft, publishDraft } from '../src/services/kairos/index.js';
import { renderAdmissionForm } from '../src/services/lumen/sampleForm.js';
import { savePagePreview, saveOriginal } from '../src/services/lumen/storage.js';

const prisma = new PrismaClient();

const PASSWORD = 'meridian123';
const toJson = (v: unknown) => JSON.stringify(v);

const FIRST = ['Aditi', 'Rohan', 'Ishaan', 'Sara', 'Vivaan', 'Neha', 'Kabir', 'Ananya', 'Arjun', 'Diya', 'Aryan', 'Myra', 'Reyansh', 'Kiara', 'Vihaan', 'Anaya', 'Advait', 'Saanvi', 'Dhruv', 'Aarohi', 'Kunal', 'Prisha', 'Yuvan', 'Riya', 'Ved', 'Tara', 'Om', 'Zoya', 'Ayaan', 'Meera'];
const LAST = ['Menon', 'Kapoor', 'Verma', 'Khan', 'Rao', 'Iyer', 'Shah', 'Nair', 'Gupta', 'Reddy', 'Bose', 'Sharma'];
const BLOOD = ['A+', 'B+', 'O+', 'AB+', 'A-', 'O-'];

function rand<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function daysAhead(n: number): string {
  return daysAgo(-n);
}

// Deterministic PRNG (mulberry32) — the engine's own "reproducible: same
// input, same output" honesty rule, applied to the demo data itself. Two
// seed runs produce the same school.
let _rng = 20260720 >>> 0;
function rnd(): number {
  _rng |= 0;
  _rng = (_rng + 0x6d2b79f5) | 0;
  let t = Math.imul(_rng ^ (_rng >>> 15), 1 | _rng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const LOCALITIES = ['Kothrud', 'Aundh', 'Baner', 'Viman Nagar', 'Hadapsar', 'Shivajinagar', 'Wakad', 'Kalyani Nagar'];
const phoneNo = (i: number) => `+91 98${String(220000000 + i * 7919 % 79999999).slice(0, 8)}`;

async function main() {
  console.log('🌱 Seeding Meridian…');
  // Clean slate
  await prisma.$transaction([
    prisma.readerHeartbeat.deleteMany(),
    prisma.attendanceEvent.deleteMany(),
    prisma.rFIDCard.updateMany({ data: { replacedByCardId: null } }), // clear self-refs before bulk delete
    prisma.rFIDCard.deleteMany(),
    prisma.rFIDReader.deleteMany(),
    prisma.faceEmbedding.deleteMany(),
    prisma.faceEvent.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.fee.deleteMany(),
    prisma.substitution.deleteMany(),
    prisma.staffAbsence.deleteMany(),
    prisma.timetableSlot.deleteMany(),
    prisma.timetable.deleteMany(),
    prisma.classSubjectPlan.deleteMany(),
    prisma.academicConfig.deleteMany(),
    prisma.extractedField.deleteMany(),
    prisma.document.deleteMany(),
    prisma.attendance.deleteMany(),
    prisma.prediction.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.aILog.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.event.deleteMany(),
    prisma.emergencyIncident.deleteMany(),
    prisma.setting.deleteMany(),
    prisma.studentParent.deleteMany(),
    prisma.student.deleteMany(),
    prisma.parent.deleteMany(),
    prisma.teacher.deleteMany(),
    prisma.class.deleteMany(),
    prisma.subject.deleteMany(),
    prisma.room.deleteMany(),
    prisma.building.deleteMany(),
    prisma.user.deleteMany(),
    prisma.school.deleteMany(),
  ]);

  const hash = await bcrypt.hash(PASSWORD, 10);

  const school = await prisma.school.create({
    data: { name: 'Meridian Public School', code: 'MERIDIAN', address: 'Pune, MH', phone: '+91 20 1234 5678' },
  });
  const schoolId = school.id;

  // ── Buildings + Rooms (Digital Twin) ──
  const blockA = await prisma.building.create({ data: { schoolId, name: 'Block A', floors: 2, x: 60, y: 80 } });
  const blockB = await prisma.building.create({ data: { schoolId, name: 'Block B', floors: 2, x: 320, y: 80 } });
  const science = await prisma.building.create({ data: { schoolId, name: 'Science Wing', floors: 1, x: 60, y: 300 } });
  const admin = await prisma.building.create({ data: { schoolId, name: 'Admin & Hall', floors: 1, x: 320, y: 300 } });

  const rooms = await Promise.all([
    prisma.room.create({ data: { buildingId: blockA.id, name: 'A-101', type: 'CLASSROOM', floor: 0, hasProjector: true } }),
    prisma.room.create({ data: { buildingId: blockA.id, name: 'A-102', type: 'CLASSROOM', floor: 0 } }),
    prisma.room.create({ data: { buildingId: blockA.id, name: 'A-201', type: 'CLASSROOM', floor: 1 } }),
    prisma.room.create({ data: { buildingId: blockB.id, name: 'B-101', type: 'CLASSROOM', floor: 0, hasProjector: true } }),
    prisma.room.create({ data: { buildingId: blockB.id, name: 'B-102', type: 'CLASSROOM', floor: 0 } }),
    prisma.room.create({ data: { buildingId: blockB.id, name: 'B-201', type: 'CLASSROOM', floor: 1 } }),
    prisma.room.create({ data: { buildingId: science.id, name: 'Lab-1', type: 'LAB', floor: 0, capacity: 30 } }),
    prisma.room.create({ data: { buildingId: science.id, name: 'Lab-2', type: 'LAB', floor: 0, capacity: 30 } }),
    prisma.room.create({ data: { buildingId: admin.id, name: 'Library', type: 'LIBRARY', floor: 0 } }),
    prisma.room.create({ data: { buildingId: admin.id, name: 'Auditorium', type: 'HALL', floor: 0, capacity: 200 } }),
  ]);
  const classrooms = rooms.filter((r) => r.type === 'CLASSROOM');

  // ── Subjects ──
  const subjectDefs = [
    { code: 'MATH', name: 'Mathematics', color: '#0E7C6B', weeklyLoad: 6, cognitiveLoad: 5 },
    { code: 'ENG', name: 'English', color: '#1F6F8B', weeklyLoad: 5, cognitiveLoad: 3 },
    { code: 'SCI', name: 'Science', color: '#1E8A63', weeklyLoad: 5, cognitiveLoad: 5, requiresLab: true },
    { code: 'SST', name: 'Social Studies', color: '#C98A21', weeklyLoad: 4, cognitiveLoad: 3 },
    { code: 'HIN', name: 'Hindi', color: '#B0605C', weeklyLoad: 4, cognitiveLoad: 2 },
    { code: 'CS', name: 'Computer Science', color: '#5C6E9E', weeklyLoad: 3, cognitiveLoad: 4, requiresLab: true },
    { code: 'PE', name: 'Physical Ed', color: '#6F8C3A', weeklyLoad: 2, cognitiveLoad: 1 },
  ];
  const subjects = await Promise.all(
    subjectDefs.map((s) => prisma.subject.create({ data: { schoolId, ...s } })),
  );

  // ── Principal + Admin ──
  await prisma.user.create({
    data: { schoolId, email: 'principal@meridian.school', password: hash, name: 'Dr. Kavita Menon', role: 'PRINCIPAL', phone: '+91 98765 43210' },
  });
  await prisma.user.create({
    data: { schoolId, email: 'admin@meridian.school', password: hash, name: 'Rahul Deshpande', role: 'ADMIN' },
  });
  await prisma.user.create({
    data: { schoolId, email: 'super@meridian.school', password: hash, name: 'System Owner', role: 'SUPER_ADMIN' },
  });

  // ── Teachers — with real Kairos constraints ──
  const teacherDefs: {
    name: string; dept: string; subjects: string[]; maxHours: number;
    maxDaily?: number; maxConsecutive?: number; partTime?: boolean;
    unavailable?: { day: number; period: number }[];
    preferredFree?: { day: number; period: number }[];
  }[] = [
    { name: 'Mr. Rao', dept: 'Mathematics', subjects: ['MATH'], maxHours: 24 },
    { name: 'Ms. Iyer', dept: 'Science', subjects: ['SCI', 'MATH'], maxHours: 26, maxDaily: 7 },
    { name: 'Mrs. Sharma', dept: 'English', subjects: ['ENG'], maxHours: 24, preferredFree: [{ day: 4, period: 7 }] },
    { name: 'Mr. Khan', dept: 'Social Studies', subjects: ['SST', 'HIN'], maxHours: 24, unavailable: [{ day: 2, period: 6 }, { day: 2, period: 7 }] },
    // Part-timer: 14 periods/week, off every Friday.
    { name: 'Ms. Nair', dept: 'Computer Science', subjects: ['CS', 'MATH'], maxHours: 14, partTime: true, unavailable: Array.from({ length: 8 }, (_, p) => ({ day: 4, period: p })) },
    { name: 'Mr. Bose', dept: 'Science', subjects: ['SCI'], maxHours: 24 },
    { name: 'Mrs. Gupta', dept: 'Hindi', subjects: ['HIN', 'SST'], maxHours: 24 },
    { name: 'Mr. Reddy', dept: 'Physical Ed', subjects: ['PE'], maxHours: 20, maxConsecutive: 4 },
    { name: 'Ms. Kapoor', dept: 'English', subjects: ['ENG', 'SST'], maxHours: 24 },
    { name: 'Mr. Verma', dept: 'Mathematics', subjects: ['MATH', 'CS'], maxHours: 24 },
    // Third Science-qualified teacher with deliberate spare capacity — so a
    // Science absence has a real substitute pool (the cascade demo), and the
    // solver can spread lab-heavy load instead of maxing out Iyer + Bose.
    { name: 'Ms. Menon', dept: 'Science', subjects: ['SCI', 'MATH'], maxHours: 22 },
  ];
  const teachers = [];
  for (let i = 0; i < teacherDefs.length; i++) {
    const d = teacherDefs[i];
    const user = await prisma.user.create({
      data: {
        schoolId,
        email: `teacher${i + 1}@meridian.school`,
        password: hash,
        name: d.name,
        role: 'TEACHER',
      },
    });
    const teacher = await prisma.teacher.create({
      data: {
        schoolId,
        userId: user.id,
        employeeId: `T-${100 + i}`,
        department: d.dept,
        qualification: 'M.Sc / B.Ed',
        maxHours: d.maxHours,
        maxDailyPeriods: d.maxDaily ?? 6,
        maxConsecutive: d.maxConsecutive ?? 3,
        partTime: d.partTime ?? false,
        unavailableString: toJson(d.unavailable ?? []),
        preferredFreeString: toJson(d.preferredFree ?? []),
        subjectsString: toJson(d.subjects),
      },
    });
    teachers.push(teacher);
  }
  // A friendly login alias for the first teacher.
  await prisma.user.update({ where: { email: 'teacher1@meridian.school' }, data: { email: 'teacher@meridian.school' } });

  // ── Classes (grades 6-10, section A) + class teachers + rooms ──
  const classes = [];
  const grades = [6, 7, 8, 9, 10];
  for (let i = 0; i < grades.length; i++) {
    const grade = grades[i];
    const cls = await prisma.class.create({
      data: {
        schoolId,
        grade,
        section: 'A',
        name: `${grade}A`,
        roomId: rand(classrooms, i).id,
        classTeacherId: teachers[i % teachers.length].id,
      },
    });
    classes.push(cls);
  }
  // Add one extra section to create scheduling pressure (9B).
  const class9b = await prisma.class.create({
    data: { schoolId, grade: 9, section: 'B', name: '9B', roomId: classrooms[5].id, classTeacherId: teachers[5].id },
  });
  classes.push(class9b);

  // ── Kairos: academic calendar ──
  await prisma.academicConfig.create({
    data: {
      schoolId,
      academicYear: '2026-27',
      workingDays: 5,
      dayStart: '08:00',
      periodMinutes: 45,
      periodsPerDay: 8,
      termsString: toJson([
        { name: 'Term 1', start: '2026-06-08', end: '2026-10-30' },
        { name: 'Term 2', start: '2026-11-16', end: '2027-03-31' },
      ]),
      breaksString: toJson([
        { after: 1, name: 'Short break', minutes: 10 },
        { after: 4, name: 'Lunch', minutes: 40 },
      ]),
      blockedString: toJson([{ day: 0, period: 0, reason: 'Assembly' }]),
      holidaysString: toJson(['2026-08-15', '2026-10-02', '2026-10-20']),
      examWeeksString: toJson([{ name: 'Mid-term exams', start: '2026-09-14', end: '2026-09-19' }]),
    },
  });

  // ── Kairos: curriculum per class (grade-appropriate, drives generation) ──
  const subjectId = (code: string) => subjects.find((s) => s.code === code)!.id;
  const curriculumFor = (grade: number): { code: string; weekly: number; lab?: boolean }[] =>
    grade <= 7
      ? [
          { code: 'MATH', weekly: 6 }, { code: 'ENG', weekly: 5 }, { code: 'SCI', weekly: 5, lab: true },
          { code: 'SST', weekly: 5 }, { code: 'HIN', weekly: 4 }, { code: 'CS', weekly: 3, lab: true },
          { code: 'PE', weekly: 3 },
        ]
      : grade === 8
        ? [
            { code: 'MATH', weekly: 6 }, { code: 'ENG', weekly: 5 }, { code: 'SCI', weekly: 6, lab: true },
            { code: 'SST', weekly: 5 }, { code: 'HIN', weekly: 3 }, { code: 'CS', weekly: 3, lab: true },
            { code: 'PE', weekly: 3 },
          ]
        : [
            { code: 'MATH', weekly: 7 }, { code: 'ENG', weekly: 5 }, { code: 'SCI', weekly: 6, lab: true },
            { code: 'SST', weekly: 5 }, { code: 'HIN', weekly: 3 }, { code: 'CS', weekly: 4, lab: true },
            { code: 'PE', weekly: 2 },
          ];
  for (const cls of classes) {
    await prisma.classSubjectPlan.createMany({
      data: curriculumFor(cls.grade).map((p) => ({
        classId: cls.id,
        subjectId: subjectId(p.code),
        weeklyPeriods: p.weekly,
        requiresLab: p.lab ?? false,
      })),
    });
  }

  // ── Presence: RFID readers (gates) — a real device would authenticate
  //    with the plaintext key; the seed just hashes a memorable demo key
  //    so the Simulator/hardware-adapter story is testable out of the box. ──
  const readerDefs = [
    { name: 'Main Gate Reader', location: 'Main Gate', building: 'Admin & Hall', direction: 'BOTH', key: 'demo-reader-key-main-gate' },
    { name: 'Block A Reader', location: 'Block A Entrance', building: 'Block A', direction: 'ENTRY', key: 'demo-reader-key-block-a' },
    { name: 'Sports Gate Reader', location: 'Sports Ground Exit', building: 'Admin & Hall', direction: 'EXIT', key: 'demo-reader-key-sports-gate' },
  ];
  const readers = [];
  for (const r of readerDefs) {
    const apiKeyHash = await bcrypt.hash(r.key, 10);
    const reader = await prisma.rFIDReader.create({
      data: { schoolId, name: r.name, location: r.location, building: r.building, direction: r.direction, apiKeyHash, online: true, lastHeartbeat: new Date(), firmwareVersion: '1.4.2' },
    });
    await prisma.readerHeartbeat.create({ data: { readerId: reader.id, signal: 0.9, firmwareVersion: '1.4.2' } });
    readers.push(reader);
  }

  // ── Presence: default policy settings (explicit rows so the Settings
  //    page shows real persisted values, not just in-code defaults) ──
  await prisma.setting.createMany({
    data: [
      { schoolId, key: 'presence.schoolStartTime', valueString: '08:00' },
      { schoolId, key: 'presence.lateGraceMinutes', valueString: '5' },
      { schoolId, key: 'presence.duplicateWindowSeconds', valueString: '120' },
      { schoolId, key: 'presence.heartbeatOfflineThresholdSeconds', valueString: '90' },
    ],
  });

  // ── Students + Parents + RFID ──
  let rollGlobal = 0;
  const students = [];
  for (const cls of classes) {
    for (let r = 1; r <= 22; r++) {
      rollGlobal++;
      const name = `${rand(FIRST, rollGlobal)} ${rand(LAST, rollGlobal + 3)}`;
      const admissionNo = `ADM-${2026}-${String(rollGlobal).padStart(4, '0')}`;
      // Every student gets a real portal login — same email scheme a Lumen
      // commit uses, so paper-admitted and seeded students look identical.
      const stuUser = await prisma.user.create({
        data: {
          schoolId,
          email: `${admissionNo.toLowerCase()}@student.meridian.school`,
          password: hash,
          name,
          role: 'STUDENT',
        },
      });
      // Contact block filled at creation — these are exactly the columns the
      // front office needs in an emergency, so no seeded student may lack them.
      const surname = name.split(' ')[1];
      const father = `${rand(FIRST, rollGlobal + 11)} ${surname}`;
      const mother = `${rand(FIRST, rollGlobal + 17)} ${surname}`;
      const guardian = rollGlobal % 2 ? father : mother;
      const student = await prisma.student.create({
        data: {
          schoolId,
          classId: cls.id,
          userId: stuUser.id,
          admissionNo,
          rollNo: r,
          name,
          gender: rollGlobal % 2 ? 'M' : 'F',
          bloodGroup: rand(BLOOD, rollGlobal),
          guardianName: guardian,
          fatherName: father,
          motherName: mother,
          phone: phoneNo(rollGlobal),
          emergencyContact: phoneNo(rollGlobal + 500),
          address: `${10 + (rollGlobal % 80)} ${rand(LOCALITIES, rollGlobal)}, Pune`,
          pincode: `4110${String(rollGlobal % 60 + 1).padStart(2, '0')}`,
        },
      });
      await prisma.rFIDCard.create({
        data: { schoolId, studentId: student.id, uid: `RFID-${String(rollGlobal).padStart(5, '0')}`, status: 'ACTIVE' },
      });
      students.push(student);

      // One parent per every 2 students (some share none — keep it simple: 1 each)
      const puser = await prisma.user.create({
        data: {
          schoolId,
          email: `parent${rollGlobal}@meridian.school`,
          password: hash,
          name: `Parent of ${name.split(' ')[0]}`,
          role: 'PARENT',
        },
      });
      const parent = await prisma.parent.create({ data: { schoolId, userId: puser.id, relation: 'Guardian' } });
      await prisma.studentParent.create({ data: { studentId: student.id, parentId: parent.id } });
    }
  }
  // Friendly parent + student login aliases.
  await prisma.user.update({ where: { email: 'parent1@meridian.school' }, data: { email: 'parent@meridian.school' } });

  // The demo parent gets a SECOND child — the sibling case is a core IAM
  // behaviour (one parent account, several children in one dashboard) and the
  // demo should show it without needing a Lumen commit first.
  const demoParentUser = await prisma.user.findUnique({ where: { email: 'parent@meridian.school' }, include: { parent: true } });
  if (demoParentUser?.parent && students.length > 1) {
    await prisma.studentParent.upsert({
      where: { studentId_parentId: { studentId: students[1].id, parentId: demoParentUser.parent.id } },
      create: { studentId: students[1].id, parentId: demoParentUser.parent.id },
      update: {},
    });
  }
  // Friendly login alias for the first student (everyone already has a
  // scheme-email login; the demo one just gets a memorable address too).
  await prisma.user.update({ where: { id: students[0].userId! }, data: { email: 'student@meridian.school' } });

  // ── Designed risk profiles — a handful of students whose attendance AND
  //    fee patterns tell a coherent, differentiated story (the early-warning
  //    demo needs real cases, not 132 near-identical borderline flags).
  //    Indices into `students` (132 total):
  const CHRONIC = new Set([7, 40]);       // ~65% attendance all term
  const DECLINING = new Set([23]);        // fine first half, slipping second half
  const MONDAY_SKEW = new Set([19, 55]);  // absences cluster on Mondays
  const OFTEN_LATE = new Set([11]);       // present, but late ~40% of days
  const FEE_STRESS = new Set([7, 23, 40, 61, 88, 102, 115]); // overdue balances

  // ── Fees — a well-run school (~78% collected) with REAL ledger arithmetic:
  //    every rupee of `paid` is backed by Payment rows (audit-trail rule:
  //    the balance and the payment history may never disagree). Varied
  //    amounts, due dates and overdue ages so aging buckets mean something.
  const paymentRows: { feeId: string; amount: number; method: string; reference: string | null; paidAt: Date }[] = [];
  const payMethods = ['UPI', 'CASH', 'BANK_TRANSFER', 'UPI'];
  let feeCount = 0;
  const addFee = async (
    studentId: string,
    title: string,
    amount: number,
    dueDate: string,
    paidAmount: number,
    opts: { installments?: number; overdue?: boolean } = {},
  ) => {
    feeCount++;
    const paid = Math.min(paidAmount, amount);
    const status = paid >= amount ? 'PAID' : paid > 0 ? 'PARTIAL' : new Date(dueDate) < new Date() ? 'OVERDUE' : 'PENDING';
    const fee = await prisma.fee.create({
      data: { schoolId, studentId, title, amount, paid, status, dueDate },
    });
    if (paid > 0) {
      const n = opts.installments ?? (paid > 9000 && rnd() < 0.4 ? 2 : 1);
      const due = new Date(dueDate);
      let remaining = paid;
      for (let k = 0; k < n; k++) {
        const part = k === n - 1 ? remaining : Math.round(paid * 0.6);
        remaining -= part;
        const paidAt = new Date(due);
        paidAt.setDate(paidAt.getDate() - (n - k) * (3 + Math.floor(rnd() * 9)));
        paymentRows.push({
          feeId: fee.id,
          amount: part,
          method: rand(payMethods, feeCount + k),
          reference: `${rand(payMethods, feeCount + k) === 'CASH' ? 'RCPT' : 'TXN'}-2026-${String(feeCount * 3 + k).padStart(5, '0')}`,
          paidAt,
        });
      }
    }
  };

  for (let i = 0; i < students.length; i++) {
    const s = students[i];
    const cls = classes.find((c) => c.id === s.classId)!;
    const tuition = cls.grade >= 9 ? 14500 : cls.grade === 8 ? 13000 : 12500;

    if (FEE_STRESS.has(i)) {
      // Overdue with VARIED ages (15–63 days) and sizes — real aging buckets.
      const age = [15, 22, 28, 36, 42, 51, 63][i % 7];
      const partial = i % 3 === 0 ? Math.round(tuition * 0.35) : 0;
      await addFee(s.id, 'Term 1 Tuition', tuition, daysAgo(age), partial);
    } else if (i % 9 === 4) {
      // A slice of ordinary partials — paid most, small balance, recent due.
      await addFee(s.id, 'Term 1 Tuition', tuition, daysAgo(4 + (i % 6)), tuition - 2500, { installments: 2 });
    } else {
      // Paid in full, 1–2 installments, before the due date.
      await addFee(s.id, 'Term 1 Tuition', tuition, daysAgo(4 + (i % 6)), tuition);
    }

    // Second head: Activity & Lab fee, due in the FUTURE → real PENDING rows.
    // About a third of families have already paid it early.
    await addFee(s.id, 'Activity & Lab Fee', cls.grade >= 8 ? 2800 : 2200, daysAhead(12 + (i % 9)), i % 3 === 0 ? (cls.grade >= 8 ? 2800 : 2200) : 0);
  }
  await prisma.payment.createMany({ data: paymentRows });

  // ── Attendance history (last ~5 weeks ≈ 24 school days) — deep enough for
  //    honest trends, weekday-deviation evidence and the at-risk index.
  //    Today (d=0) is intentionally left un-marked so the live kiosks
  //    (RFID + Face Recognition) have real students to mark on stage.
  //    Designed patterns (see the risk-profile sets above) give the
  //    early-warning demo REAL, differentiated stories:
  //      · CHRONIC       — ~65% all term (the classic 10%+ missed-days case)
  //      · DECLINING     — 97% first half → ~72% second half (trend evidence)
  //      · MONDAY_SKEW   — absences cluster on Mondays (weekday evidence)
  //      · OFTEN_LATE    — present but late ~40% of days (punctuality signal)
  const HISTORY_DAYS = 34;
  const schoolDayList: { date: string; dow: number; idx: number }[] = [];
  for (let d = HISTORY_DAYS; d >= 1; d--) {
    const date = daysAgo(d);
    const dow = new Date(date).getDay();
    if (dow === 0 || dow === 6) continue;
    schoolDayList.push({ date, dow, idx: schoolDayList.length });
  }
  const totalSchoolDays = schoolDayList.length;
  const entryReaders = readers.filter((r) => r.direction !== 'EXIT');

  for (const { date, dow, idx } of schoolDayList) {
    const daysFromToday = Math.round((Date.now() - new Date(date).getTime()) / 86400000);
    // School-wide base ~95%, with a dip over the last 3 school days (rain).
    const schoolBase = daysFromToday <= 4 ? 0.84 : 0.95;
    const attRows: any[] = [];
    const evtRows: any[] = [];
    // Backfill AttendanceEvents only for the last 5 school days — enough for
    // the live feed / peak-time / reader analytics without a huge event log.
    const backfillEvents = daysFromToday <= 7;

    for (let i = 0; i < students.length; i++) {
      const s = students[i];
      let pPresent = schoolBase;
      if (CHRONIC.has(i)) pPresent = 0.65;
      if (DECLINING.has(i)) pPresent = idx < totalSchoolDays / 2 ? 0.97 : 0.72;
      if (MONDAY_SKEW.has(i)) pPresent = dow === 1 ? 0.4 : 0.94;

      const present = rnd() < pPresent;
      let status: string;
      if (!present) status = rnd() < 0.06 ? 'LEAVE' : 'ABSENT';
      else if (OFTEN_LATE.has(i)) status = rnd() < 0.4 ? 'LATE' : 'PRESENT';
      else status = rnd() < 0.05 ? 'LATE' : 'PRESENT';

      const source = rnd() < 0.55 ? 'RFID' : 'MANUAL';
      attRows.push({ schoolId, studentId: s.id, classId: s.classId!, date, status, source });

      if (backfillEvents && status !== 'ABSENT' && status !== 'LEAVE') {
        const late = status === 'LATE';
        // Arrivals 07:42–08:04; late arrivals 08:10–08:40. lateMinutes is
        // COMPUTED from the timestamp vs start+grace (08:05) — never invented.
        const minutesAfter0742 = late ? 28 + Math.floor(rnd() * 31) : Math.floor(rnd() * 23); // on-time 07:42–08:04, late 08:10–08:40
        const totalMin = 7 * 60 + 42 + minutesAfter0742;
        const timestamp = new Date(`${date}T${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}`);
        const graceEnd = new Date(`${date}T08:05:00`);
        const lateMinutes = late ? Math.max(1, Math.ceil((timestamp.getTime() - graceEnd.getTime()) / 60000)) : null;
        const reader = source === 'RFID' ? rand(entryReaders, s.rollNo + minutesAfter0742) : null;
        evtRows.push({
          schoolId,
          studentId: s.id,
          readerId: reader?.id ?? null,
          source,
          timestamp,
          direction: 'ENTRY',
          verificationStatus: late ? 'LATE' : 'VERIFIED',
          late,
          lateMinutes,
        });
      }
    }
    await prisma.attendance.createMany({ data: attRows });
    if (evtRows.length) await prisma.attendanceEvent.createMany({ data: evtRows });
  }

  // ── Documents (Lumen) — one in review, one verified ──
  const doc1 = await prisma.document.create({
    data: { schoolId, type: 'ADMISSION', fileName: 'admission-aditi.jpg', status: 'REVIEW', overallConfidence: 0.83 },
  });
  // Every visible field on the form is a real extracted field — the document
  // preview and the extraction panel are one-to-one. bloodGroup stays low
  // confidence so it drives the "needs review" workflow.
  const doc1Fields = [
    { documentId: doc1.id, key: 'studentName', label: 'Student name', value: 'Aditi R. Menon', confidence: 0.99, cropX: 0.12, cropY: 0.14, cropW: 0.5, cropH: 0.055, status: 'AUTO', expected: true, ocrConfidence: 0.99 },
    { documentId: doc1.id, key: 'phone', label: 'Contact number', value: '+91 98••• ••210', confidence: 0.97, cropX: 0.12, cropY: 0.235, cropW: 0.5, cropH: 0.055, status: 'AUTO', expected: true, ocrConfidence: 0.96 },
    // The honest OCR story: the engine read "8+", the normaliser repaired it
    // to "B+" — rawValue keeps what was actually read, and the low composite
    // confidence routes it to human review instead of silently trusting it.
    { documentId: doc1.id, key: 'bloodGroup', label: 'Blood group', value: 'B+', rawValue: '8+', corrected: true, confidence: 0.61, cropX: 0.12, cropY: 0.33, cropW: 0.3, cropH: 0.055, status: 'REVIEW', ocrConfidence: 0.58 },
    { documentId: doc1.id, key: 'dob', label: 'Date of birth', value: '14 March 2016', confidence: 0.95, cropX: 0.12, cropY: 0.425, cropW: 0.5, cropH: 0.055, status: 'AUTO', expected: true, ocrConfidence: 0.94 },
    { documentId: doc1.id, key: 'className', label: 'Class applying for', value: 'Grade 8 · Section A', confidence: 0.93, cropX: 0.12, cropY: 0.52, cropW: 0.5, cropH: 0.055, status: 'AUTO', ocrConfidence: 0.92 },
    { documentId: doc1.id, key: 'address', label: 'Address', value: '18 Prabhat Road, Pune 411004', confidence: 0.86, cropX: 0.12, cropY: 0.615, cropW: 0.7, cropH: 0.055, status: 'AUTO', ocrConfidence: 0.84 },
    { documentId: doc1.id, key: 'previousSchool', label: 'Previous school', value: 'Little Scholars Montessori', confidence: 0.9, cropX: 0.12, cropY: 0.71, cropW: 0.6, cropH: 0.055, status: 'AUTO', ocrConfidence: 0.9 },
  ];
  await prisma.extractedField.createMany({ data: doc1Fields });
  const doc1Avg = doc1Fields.reduce((a, f) => a + f.confidence, 0) / doc1Fields.length;

  // Its life story — the Processing History timeline must never render blank.
  await prisma.documentActivity.createMany({
    data: [
      { documentId: doc1.id, kind: 'UPLOADED', actorName: 'Rahul Deshpande', detailString: toJson({ fileName: 'admission-aditi.jpg' }), createdAt: new Date(Date.now() - 3 * 3600_000) },
      { documentId: doc1.id, kind: 'PROCESSED', actorName: 'Lumen', detailString: toJson({ fields: doc1Fields.length, ms: 1840, review: 1 }), createdAt: new Date(Date.now() - 3 * 3600_000 + 2000) },
    ],
  });
  await prisma.documentInsight.create({
    data: { documentId: doc1.id, kind: 'MISSING', severity: 'WARNING', message: 'Guardian phone number was not found on the form — required for the emergency-contact record.' },
  });

  // Give the seeded document a real page preview so the Lumen viewer shows the
  // scan (with field-crop highlights), not a blank pane. Generated to match the
  // crop coordinates above and stored through the real encrypted pipeline.
  const formJpeg = renderAdmissionForm(doc1Fields.map((f) => ({ label: f.label, value: f.value, cropX: f.cropX, cropY: f.cropY, cropW: f.cropW, cropH: f.cropH })));
  await savePagePreview(doc1.id, 0, formJpeg);
  await saveOriginal(doc1.id, 'admission-aditi.jpg', formJpeg);
  await prisma.document.update({
    where: { id: doc1.id },
    data: { pageCount: 1, mimeType: 'image/jpeg', overallConfidence: doc1Avg, processingMs: 1840, sizeBytes: formJpeg.length },
  });

  // ── Second document: fully VERIFIED — so the queue shows the whole
  //    lifecycle (in review vs verified), exactly as the workflow produces it.
  const doc2 = await prisma.document.create({
    data: { schoolId, type: 'ADMISSION', fileName: 'admission-rohan.jpg', status: 'VERIFIED', overallConfidence: 0, processingMs: 1610 },
  });
  const doc2Fields = [
    { documentId: doc2.id, key: 'studentName', label: 'Student name', value: 'Rohan S. Kulkarni', confidence: 0.99, cropX: 0.12, cropY: 0.14, cropW: 0.5, cropH: 0.055, status: 'CONFIRMED', expected: true, ocrConfidence: 0.99 },
    { documentId: doc2.id, key: 'phone', label: 'Contact number', value: '+91 98••• ••418', confidence: 0.98, cropX: 0.12, cropY: 0.235, cropW: 0.5, cropH: 0.055, status: 'AUTO', expected: true, ocrConfidence: 0.97 },
    { documentId: doc2.id, key: 'bloodGroup', label: 'Blood group', value: 'O+', confidence: 0.95, cropX: 0.12, cropY: 0.33, cropW: 0.3, cropH: 0.055, status: 'CONFIRMED', ocrConfidence: 0.94 },
    { documentId: doc2.id, key: 'dob', label: 'Date of birth', value: '02 August 2015', confidence: 0.97, cropX: 0.12, cropY: 0.425, cropW: 0.5, cropH: 0.055, status: 'AUTO', expected: true, ocrConfidence: 0.96 },
    { documentId: doc2.id, key: 'className', label: 'Class applying for', value: 'Grade 7 · Section A', confidence: 0.96, cropX: 0.12, cropY: 0.52, cropW: 0.5, cropH: 0.055, status: 'AUTO', ocrConfidence: 0.95 },
    { documentId: doc2.id, key: 'address', label: 'Address', value: '42 Baner Road, Pune 411045', confidence: 0.92, cropX: 0.12, cropY: 0.615, cropW: 0.7, cropH: 0.055, status: 'AUTO', ocrConfidence: 0.9 },
  ];
  await prisma.extractedField.createMany({ data: doc2Fields });
  const doc2Avg = doc2Fields.reduce((a, f) => a + f.confidence, 0) / doc2Fields.length;
  const form2Jpeg = renderAdmissionForm(doc2Fields.map((f) => ({ label: f.label, value: f.value, cropX: f.cropX, cropY: f.cropY, cropW: f.cropW, cropH: f.cropH })));
  await savePagePreview(doc2.id, 0, form2Jpeg);
  await saveOriginal(doc2.id, 'admission-rohan.jpg', form2Jpeg);
  await prisma.document.update({
    where: { id: doc2.id },
    data: { pageCount: 1, mimeType: 'image/jpeg', overallConfidence: doc2Avg, sizeBytes: form2Jpeg.length },
  });
  await prisma.documentActivity.createMany({
    data: [
      { documentId: doc2.id, kind: 'UPLOADED', actorName: 'Rahul Deshpande', detailString: toJson({ fileName: 'admission-rohan.jpg' }), createdAt: new Date(Date.now() - 26 * 3600_000) },
      { documentId: doc2.id, kind: 'PROCESSED', actorName: 'Lumen', detailString: toJson({ fields: doc2Fields.length, ms: 1610, review: 2 }), createdAt: new Date(Date.now() - 26 * 3600_000 + 1800) },
      { documentId: doc2.id, kind: 'FIELD_CONFIRMED', actorName: 'Rahul Deshpande', detailString: toJson({ key: 'studentName' }), createdAt: new Date(Date.now() - 25 * 3600_000) },
      { documentId: doc2.id, kind: 'FIELD_CONFIRMED', actorName: 'Rahul Deshpande', detailString: toJson({ key: 'bloodGroup' }), createdAt: new Date(Date.now() - 25 * 3600_000 + 60_000) },
      { documentId: doc2.id, kind: 'VERIFIED', actorName: 'Dr. Kavita Menon', detailString: toJson({ fields: doc2Fields.length }), createdAt: new Date(Date.now() - 24 * 3600_000) },
    ],
  });

  // ── Baseline Trust ledger — automated actions already taken (drives the
  //    "admin hours saved" counter honestly, and populates the audit timeline) ──
  // `reversible` must reflect whether a real reverser exists (see eventStore).
  // STUDENT_CREATED has one; DOCUMENT_PROCESSED does not — so we say so.
  // Zero-fake-AI rule applies to the seed too: the ledger may only contain
  // actions that CORRESPOND TO REAL ROWS in this database. Student-creation
  // events are honestly labelled as an import (not "Lumen"), and the only
  // AI-log rows written here describe the two documents that genuinely exist
  // with their real field counts and confidences. Kairos writes its own
  // honest log when generateDraft actually runs below — no hand-written
  // duplicates, no phantom "CV captures" without matching attendance events.
  const eventRows = students.map((s, i) => ({
    schoolId,
    type: 'STUDENT_CREATED',
    aggregate: 'Student',
    aggregateId: s.id,
    payloadString: toJson({ studentId: s.id, name: s.name }),
    actorName: 'Admissions import',
    reversible: true,
    createdAt: new Date(Date.now() - (i % 20) * 3600_000),
  }));
  eventRows.push({
    schoolId, type: 'DOCUMENT_PROCESSED', aggregate: 'Document', aggregateId: doc1.id,
    payloadString: toJson({ documentId: doc1.id, type: 'ADMISSION' }), actorName: 'Lumen',
    reversible: false, createdAt: new Date(),
  } as any);
  await prisma.event.createMany({ data: eventRows });

  await prisma.aILog.createMany({
    data: [
      { schoolId, engine: 'LUMEN', action: 'Document extraction', reason: `${doc1Fields.length} fields · ${Math.round(doc1Avg * 100)}% avg confidence · 1 routed to review`, confidence: doc1Avg, inputString: toJson({ documentId: doc1.id, type: 'ADMISSION' }), outputString: toJson({ fields: doc1Fields.length, review: 1 }), createdAt: new Date(Date.now() - 3 * 3600_000) },
      { schoolId, engine: 'LUMEN', action: 'Document extraction', reason: `${doc2Fields.length} fields · ${Math.round(doc2Avg * 100)}% avg confidence`, confidence: doc2Avg, inputString: toJson({ documentId: doc2.id, type: 'ADMISSION' }), outputString: toJson({ fields: doc2Fields.length, review: 2 }), createdAt: new Date(Date.now() - 26 * 3600_000) },
    ],
  });

  // ── Timetable (Kairos) — run the real production workflow:
  //    generate draft → principal approves → principal publishes v1.
  const principalUser = await prisma.user.findUnique({ where: { email: 'principal@meridian.school' } });
  const principal = { id: principalUser?.id, name: principalUser?.name ?? 'Dr. Kavita Menon' };
  const outcome = await generateDraft(schoolId, principal);
  if (!outcome.ok) {
    console.error('Kairos pre-validation blocked generation:', outcome.issues);
    throw new Error('Seed curriculum is infeasible — fix seed data');
  }
  console.log(
    `   Kairos: placed ${outcome.result!.stats.placed}/${outcome.result!.stats.total} periods, ` +
      `score ${outcome.result!.score}/100, ${outcome.result!.unplaced.length} unplaced, in ${outcome.result!.solveMs}ms`,
  );
  await approveDraft(schoolId, principal);
  await publishDraft(schoolId, principal);

  // ── Staff absence history (last ~7 weeks) with real cover records — this
  //    is what makes the substitute-demand forecast honest instead of
  //    permanently "insufficient evidence: zero absence history". Absences
  //    skew Monday/Friday (the real-world pattern the forecaster looks for);
  //    covers reference REAL slots of the published timetable and honestly
  //    leave some periods uncovered.
  const liveTT = await prisma.timetable.findFirst({ where: { schoolId, active: true }, include: { slots: true } });
  const subjCodeById = new Map(subjects.map((s) => [s.id, s.code]));
  const teacherSubjects = new Map(teachers.map((t, i) => [t.id, teacherDefs[i].subjects]));
  const absentOn = new Map<string, Set<string>>(); // date → teacherIds
  const coverLoad = new Map<string, number>(); // fairness: covers taken this term
  let absenceCount = 0, coverCount = 0;

  for (let d = 49; d >= 3; d--) {
    const date = daysAgo(d);
    const dow = new Date(date).getDay();
    if (dow === 0 || dow === 6) continue;
    const dayIdx = dow - 1; // Mon=0 … Fri=4
    const pAbsent = dow === 1 ? 0.07 : dow === 5 ? 0.055 : 0.032;
    for (const t of teachers) {
      if (rnd() >= pAbsent) continue;
      if (!absentOn.has(date)) absentOn.set(date, new Set());
      absentOn.get(date)!.add(t.id);
      const absence = await prisma.staffAbsence.create({
        data: {
          teacherId: t.id,
          date,
          reason: rand(['Medical leave', 'Family function', 'Official duty', 'Personal leave'], absenceCount),
          createdAt: new Date(`${date}T07:15:00`),
        },
      });
      absenceCount++;

      // Cover the absent teacher's real periods that day where a qualified
      // colleague exists — capped, so some periods stay honestly uncovered.
      const slots = (liveTT?.slots ?? []).filter((sl) => sl.teacherId === t.id && sl.day === dayIdx).slice(0, 4);
      for (const sl of slots) {
        const code = subjCodeById.get(sl.subjectId)!;
        const candidates = teachers
          .filter((c) => c.id !== t.id && !absentOn.get(date)?.has(c.id) && (teacherSubjects.get(c.id) ?? []).includes(code))
          .sort((a, b) => (coverLoad.get(a.id) ?? 0) - (coverLoad.get(b.id) ?? 0));
        const sub = candidates[0];
        if (!sub || rnd() < 0.2) continue; // no qualified cover found that period
        coverLoad.set(sub.id, (coverLoad.get(sub.id) ?? 0) + 1);
        coverCount++;
        await prisma.substitution.create({
          data: {
            absenceId: absence.id,
            subTeacherId: sub.id,
            day: dayIdx,
            period: sl.period,
            classId: sl.classId,
            subjectId: sl.subjectId,
            reasonString: toJson([`Qualified for ${code}`, 'Lowest cover load among qualified staff at assignment time']),
            confidence: 0.8 + Math.round(rnd() * 15) / 100,
            accepted: true,
            createdAt: new Date(`${date}T07:25:00`),
          },
        });
      }
    }
  }

  // ── Settings ──
  await prisma.setting.create({ data: { schoolId, key: 'branding', valueString: toJson({ primary: '#8B5CF6', accent: '#00E5FF' }) } });

  console.log('✅ Seed complete.');
  console.log(`   School code: MERIDIAN`);
  console.log(`   Logins (password: ${PASSWORD}):`);
  console.log('     principal@meridian.school   (PRINCIPAL)');
  console.log('     admin@meridian.school       (ADMIN)');
  console.log('     teacher@meridian.school     (TEACHER)');
  console.log('     student@meridian.school     (STUDENT)');
  console.log('     parent@meridian.school      (PARENT)');
  console.log(`   Students: ${students.length}, Teachers: ${teachers.length}, Classes: ${classes.length}`);
  console.log(`   Presence: ${readers.length} readers, ${students.length} RFID cards issued`);
  console.log(`   History: ${totalSchoolDays} school days of attendance · ${absenceCount} staff absences with ${coverCount} covers`);
  console.log(`   Fees: ${feeCount} fee heads with ${paymentRows.length} payment records (ledger arithmetic exact)`);
  console.log('   Deterministic: re-running this seed reproduces the identical school.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

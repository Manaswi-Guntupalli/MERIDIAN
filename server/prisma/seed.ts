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

  // ── Fees — a well-run school: ~73% collected, with some dues to action ──
  for (let i = 0; i < students.length; i++) {
    const s = students[i];
    const amount = 12500;
    const mod = i % 5;
    // mod 0,1,2 → paid in full; mod 3 → partial; mod 4 → overdue.
    const paid = mod <= 2 ? amount : mod === 3 ? 8000 : 0;
    const status = paid >= amount ? 'PAID' : paid > 0 ? 'PARTIAL' : 'OVERDUE';
    await prisma.fee.create({
      data: {
        schoolId,
        studentId: s.id,
        title: 'Term 1 Tuition',
        amount,
        paid,
        status,
        dueDate: daysAgo(mod === 4 ? 35 : 5),
      },
    });
  }

  // ── Attendance history (last 12 school days, with a recent dip).
  //    Today (d=0) is intentionally left un-marked so the live kiosks
  //    (RFID + Face Recognition) have real students to mark on stage. ──
  for (let d = 12; d >= 1; d--) {
    const date = daysAgo(d);
    const dow = new Date(date).getDay();
    if (dow === 0 || dow === 6) continue; // skip weekends
    // Base rate ~95%, dip in the last 3 days (simulating rainfall).
    const base = d <= 2 ? 0.84 : 0.95;
    // Only the last 5 school days get a matching AttendanceEvent — enough to
    // populate Presence's live feed / late / peak-time / reader-usage
    // analytics on first load without a slow full 12-day backfill.
    const backfillEvents = d <= 5;
    for (const s of students) {
      const present = Math.random() < base;
      const status = present ? 'PRESENT' : Math.random() < 0.4 ? 'LATE' : 'ABSENT';
      const source = Math.random() < 0.5 ? 'RFID' : 'MANUAL';
      await prisma.attendance.create({
        data: { schoolId, studentId: s.id, classId: s.classId!, date, status, source },
      });

      if (backfillEvents && status !== 'ABSENT') {
        const late = status === 'LATE';
        const minute = late ? 15 + Math.floor(Math.random() * 30) : Math.floor(Math.random() * 20);
        const timestamp = new Date(`${date}T07:5${late ? '9' : '0'}:00`);
        timestamp.setMinutes(timestamp.getMinutes() + minute);
        const entryReaders = readers.filter((r) => r.direction !== 'EXIT');
        const reader = source === 'RFID' ? rand(entryReaders, s.rollNo + minute) : null;
        await prisma.attendanceEvent.create({
          data: {
            schoolId,
            studentId: s.id,
            readerId: reader?.id,
            source,
            timestamp,
            direction: 'ENTRY',
            verificationStatus: late ? 'LATE' : 'VERIFIED',
            late,
            lateMinutes: late ? minute - 5 : null,
          },
        });
      }
    }
  }

  // ── Documents (Lumen) — one in review, one verified ──
  const doc1 = await prisma.document.create({
    data: { schoolId, type: 'ADMISSION', fileName: 'admission-aditi.jpg', status: 'REVIEW', overallConfidence: 0.83 },
  });
  // Every visible field on the form is a real extracted field — the document
  // preview and the extraction panel are one-to-one. bloodGroup stays low
  // confidence so it drives the "needs review" workflow.
  const doc1Fields = [
    { documentId: doc1.id, key: 'studentName', label: 'Student name', value: 'Aditi R. Menon', confidence: 0.99, cropX: 0.12, cropY: 0.14, cropW: 0.5, cropH: 0.055, status: 'AUTO' },
    { documentId: doc1.id, key: 'phone', label: 'Contact number', value: '+91 98••• ••210', confidence: 0.97, cropX: 0.12, cropY: 0.235, cropW: 0.5, cropH: 0.055, status: 'AUTO' },
    { documentId: doc1.id, key: 'bloodGroup', label: 'Blood group', value: 'B+', confidence: 0.61, cropX: 0.12, cropY: 0.33, cropW: 0.3, cropH: 0.055, status: 'REVIEW' },
    { documentId: doc1.id, key: 'dob', label: 'Date of birth', value: '14 March 2016', confidence: 0.95, cropX: 0.12, cropY: 0.425, cropW: 0.5, cropH: 0.055, status: 'AUTO' },
    { documentId: doc1.id, key: 'className', label: 'Class applying for', value: 'Grade 8 · Section A', confidence: 0.93, cropX: 0.12, cropY: 0.52, cropW: 0.5, cropH: 0.055, status: 'AUTO' },
    { documentId: doc1.id, key: 'address', label: 'Address', value: '18 Nandi Hills Road, Bengaluru 560001', confidence: 0.86, cropX: 0.12, cropY: 0.615, cropW: 0.7, cropH: 0.055, status: 'AUTO' },
    { documentId: doc1.id, key: 'previousSchool', label: 'Previous school', value: 'Little Scholars Montessori', confidence: 0.9, cropX: 0.12, cropY: 0.71, cropW: 0.6, cropH: 0.055, status: 'AUTO' },
  ];
  await prisma.extractedField.createMany({ data: doc1Fields });
  const doc1Avg = doc1Fields.reduce((a, f) => a + f.confidence, 0) / doc1Fields.length;

  // Give the seeded document a real page preview so the Lumen viewer shows the
  // scan (with field-crop highlights), not a blank pane. Generated to match the
  // crop coordinates above and stored through the real encrypted pipeline.
  const formJpeg = renderAdmissionForm(doc1Fields.map((f) => ({ label: f.label, value: f.value, cropX: f.cropX, cropY: f.cropY, cropW: f.cropW, cropH: f.cropH })));
  await savePagePreview(doc1.id, 0, formJpeg);
  await saveOriginal(doc1.id, 'admission-aditi.jpg', formJpeg);
  await prisma.document.update({ where: { id: doc1.id }, data: { pageCount: 1, mimeType: 'image/jpeg', overallConfidence: doc1Avg } });

  // ── Baseline Trust ledger — automated actions already taken (drives the
  //    "admin hours saved" counter honestly, and populates the audit timeline) ──
  // `reversible` must reflect whether a real reverser exists (see eventStore).
  // STUDENT_CREATED has one; DOCUMENT_PROCESSED does not — so we say so.
  const eventRows = students.map((s, i) => ({
    schoolId,
    type: 'STUDENT_CREATED',
    aggregate: 'Student',
    aggregateId: s.id,
    payloadString: toJson({ studentId: s.id, name: s.name }),
    actorName: 'Admissions intake (Lumen)',
    reversible: true,
    createdAt: new Date(Date.now() - (i % 20) * 3600_000),
  }));
  eventRows.push({
    schoolId, type: 'DOCUMENT_PROCESSED', aggregate: 'Document', aggregateId: doc1.id,
    payloadString: toJson({ documentId: doc1.id, type: 'ADMISSION' }), actorName: 'Lumen',
    reversible: false, createdAt: new Date(),
  } as any);
  await prisma.event.createMany({ data: eventRows });

  const aiRows: any[] = [
    { schoolId, engine: 'KAIROS', action: 'Timetable solve', reason: 'CP feasibility + soft refine', confidence: 0.86, inputString: toJson({}), outputString: toJson({ placed: 174 }) },
    { schoolId, engine: 'LUMEN', action: 'Document extraction', reason: `${doc1Fields.length} fields · ${Math.round(doc1Avg * 100)}% avg confidence`, confidence: doc1Avg, inputString: toJson({ type: 'ADMISSION' }), outputString: toJson({ fields: doc1Fields.length }) },
  ];
  for (let i = 0; i < 18; i++) {
    const st = students[i];
    aiRows.push({ schoolId, engine: 'PRESENCE', action: 'CV attendance capture', reason: 'Edge embedding matched — zero image stored', confidence: 0.9 + (i % 9) / 100, inputString: toJson({}), outputString: toJson({ student: st.name }), createdAt: new Date(Date.now() - i * 1200_000) });
  }
  for (let i = 0; i < 4; i++) {
    aiRows.push({ schoolId, engine: 'COPILOT', action: 'Grounded answer', reason: 'Answered from live event store', confidence: 0.85, inputString: toJson({}), outputString: toJson({}) });
  }
  await prisma.aILog.createMany({ data: aiRows });

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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

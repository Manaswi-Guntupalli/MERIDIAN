import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { generateTimetable, persistTimetable } from '../src/services/kairos.js';

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
    prisma.faceEmbedding.deleteMany(),
    prisma.faceEvent.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.fee.deleteMany(),
    prisma.substitution.deleteMany(),
    prisma.staffAbsence.deleteMany(),
    prisma.timetableSlot.deleteMany(),
    prisma.timetable.deleteMany(),
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

  // ── Teachers ──
  const teacherDefs = [
    { name: 'Mr. Rao', dept: 'Mathematics', subjects: ['MATH'], maxHours: 24 },
    { name: 'Ms. Iyer', dept: 'Science', subjects: ['SCI', 'MATH'], maxHours: 26 },
    { name: 'Mrs. Sharma', dept: 'English', subjects: ['ENG'], maxHours: 24 },
    { name: 'Mr. Khan', dept: 'Social Studies', subjects: ['SST', 'HIN'], maxHours: 24 },
    { name: 'Ms. Nair', dept: 'Computer Science', subjects: ['CS', 'MATH'], maxHours: 22 },
    { name: 'Mr. Bose', dept: 'Science', subjects: ['SCI'], maxHours: 24 },
    { name: 'Mrs. Gupta', dept: 'Hindi', subjects: ['HIN', 'SST'], maxHours: 24 },
    { name: 'Mr. Reddy', dept: 'Physical Ed', subjects: ['PE'], maxHours: 20 },
    { name: 'Ms. Kapoor', dept: 'English', subjects: ['ENG', 'SST'], maxHours: 24 },
    { name: 'Mr. Verma', dept: 'Mathematics', subjects: ['MATH', 'CS'], maxHours: 24 },
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

  // ── Students + Parents + RFID ──
  let rollGlobal = 0;
  const students = [];
  for (const cls of classes) {
    for (let r = 1; r <= 22; r++) {
      rollGlobal++;
      const name = `${rand(FIRST, rollGlobal)} ${rand(LAST, rollGlobal + 3)}`;
      const student = await prisma.student.create({
        data: {
          schoolId,
          classId: cls.id,
          admissionNo: `ADM-${2026}-${String(rollGlobal).padStart(4, '0')}`,
          rollNo: r,
          name,
          gender: rollGlobal % 2 ? 'M' : 'F',
          bloodGroup: rand(BLOOD, rollGlobal),
          rfidTag: `RFID-${String(rollGlobal).padStart(5, '0')}`,
        },
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
  // Attach a student login to the first student.
  const firstStudent = students[0];
  const suser = await prisma.user.create({
    data: { schoolId, email: 'student@meridian.school', password: hash, name: firstStudent.name, role: 'STUDENT' },
  });
  await prisma.student.update({ where: { id: firstStudent.id }, data: { userId: suser.id } });

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
    for (const s of students) {
      const present = Math.random() < base;
      await prisma.attendance.create({
        data: {
          schoolId,
          studentId: s.id,
          classId: s.classId!,
          date,
          status: present ? 'PRESENT' : Math.random() < 0.4 ? 'LATE' : 'ABSENT',
          source: Math.random() < 0.5 ? 'RFID' : 'MANUAL',
        },
      });
    }
  }

  // ── Documents (Lumen) — one in review, one verified ──
  const doc1 = await prisma.document.create({
    data: { schoolId, type: 'ADMISSION', fileName: 'admission-aditi.jpg', status: 'REVIEW', overallConfidence: 0.83 },
  });
  await prisma.extractedField.createMany({
    data: [
      { documentId: doc1.id, key: 'studentName', label: 'Student name', value: 'Aditi R. Menon', confidence: 0.99, cropX: 0.12, cropY: 0.14, cropW: 0.5, cropH: 0.08, status: 'AUTO' },
      { documentId: doc1.id, key: 'guardianPhone', label: 'Guardian phone', value: '+91 98••• ••210', confidence: 0.97, cropX: 0.12, cropY: 0.27, cropW: 0.5, cropH: 0.08, status: 'AUTO' },
      { documentId: doc1.id, key: 'bloodGroup', label: 'Blood group', value: 'B+', confidence: 0.61, cropX: 0.12, cropY: 0.4, cropW: 0.3, cropH: 0.08, status: 'REVIEW' },
    ],
  });

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
    { schoolId, engine: 'LUMEN', action: 'Document extraction', reason: '3 fields · 83% avg confidence', confidence: 0.83, inputString: toJson({ type: 'ADMISSION' }), outputString: toJson({ fields: 3 }) },
  ];
  for (let i = 0; i < 18; i++) {
    const st = students[i];
    aiRows.push({ schoolId, engine: 'PRESENCE', action: 'CV attendance capture', reason: 'Edge embedding matched — zero image stored', confidence: 0.9 + (i % 9) / 100, inputString: toJson({}), outputString: toJson({ student: st.name }), createdAt: new Date(Date.now() - i * 1200_000) });
  }
  for (let i = 0; i < 4; i++) {
    aiRows.push({ schoolId, engine: 'COPILOT', action: 'Grounded answer', reason: 'Answered from live event store', confidence: 0.85, inputString: toJson({}), outputString: toJson({}) });
  }
  await prisma.aILog.createMany({ data: aiRows });

  // ── Timetable (Kairos) — generate + persist an active schedule ──
  const tt = await generateTimetable(schoolId);
  await persistTimetable(schoolId, tt, 'Term timetable');
  const load: Record<string, number> = {};
  for (const slot of tt.slots) load[slot.teacherId] = (load[slot.teacherId] ?? 0) + 1;
  for (const [tid, hrs] of Object.entries(load)) {
    await prisma.teacher.update({ where: { id: tid }, data: { weeklyHours: hrs } });
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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

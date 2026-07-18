// Integrity audit of the published timetable — run with tsx from server/.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const tt = await prisma.timetable.findFirst({ where: { active: true }, include: { slots: { include: { teacher: { include: { user: true } }, subject: true, class: true, room: true } } } });
  if (!tt) throw new Error('No active timetable');
  console.log(`Active: ${tt.name} v${tt.version} status=${tt.status} score=${tt.score} slots=${tt.slots.length} publishedBy=${tt.publishedByName}`);

  const dupes = (keys: string[]) => keys.filter((k, i) => keys.indexOf(k) !== i);
  console.log('class double-bookings :', dupes(tt.slots.map((s) => `${s.classId}|${s.day}|${s.period}`)).length);
  console.log('teacher double-bookings:', dupes(tt.slots.map((s) => `${s.teacherId}|${s.day}|${s.period}`)).length);
  console.log('room double-bookings  :', dupes(tt.slots.filter((s) => s.roomId).map((s) => `${s.roomId}|${s.day}|${s.period}`)).length);

  let unqualified = 0, labViol = 0, blockedViol = 0;
  for (const s of tt.slots) {
    const quals = JSON.parse(s.teacher.subjectsString ?? '[]');
    if (!quals.includes(s.subject.code)) unqualified++;
    if (s.subject.requiresLab && s.room?.type !== 'LAB') labViol++;
    if (s.day === 0 && s.period === 0) blockedViol++; // assembly
  }
  console.log('unqualified teacher   :', unqualified);
  console.log('lab subject w/o lab   :', labViol);
  console.log('assembly cell used    :', blockedViol);

  const teachers = await prisma.teacher.findMany({ include: { user: true } });
  for (const t of teachers) {
    const mine = tt.slots.filter((s) => s.teacherId === t.id);
    const weekly = mine.length;
    if (weekly > t.maxHours) console.log(`  ✗ ${t.user.name} weekly ${weekly} > cap ${t.maxHours}`);
    const unavailable: { day: number; period: number }[] = JSON.parse(t.unavailableString ?? '[]');
    const hits = mine.filter((s) => unavailable.some((u) => u.day === s.day && u.period === s.period));
    if (hits.length) console.log(`  ✗ ${t.user.name} scheduled in unavailable window ${hits.length}×`);
    for (let d = 0; d < 5; d++) {
      const daily = mine.filter((s) => s.day === d);
      if (daily.length > t.maxDailyPeriods) console.log(`  ✗ ${t.user.name} day ${d}: ${daily.length} > maxDaily ${t.maxDailyPeriods}`);
      const ps = daily.map((s) => s.period).sort((a, b) => a - b);
      let run = 1, best = ps.length ? 1 : 0;
      for (let i = 1; i < ps.length; i++) { run = ps[i] === ps[i - 1] + 1 ? run + 1 : 1; best = Math.max(best, run); }
      if (best > t.maxConsecutive) console.log(`  ✗ ${t.user.name} day ${d}: ${best} consecutive > cap ${t.maxConsecutive}`);
    }
  }
  const nair = teachers.find((t) => t.user.name === 'Ms. Nair')!;
  const nairSlots = tt.slots.filter((s) => s.teacherId === nair.id);
  console.log(`Ms. Nair (part-time)  : ${nairSlots.length}/${nair.maxHours} periods, Friday slots: ${nairSlots.filter((s) => s.day === 4).length}`);
  const withWhy = tt.slots.filter((s) => s.explainString && JSON.parse(s.explainString!)?.reasons?.length).length;
  console.log(`explanations attached : ${withWhy}/${tt.slots.length}`);
  console.log('✓ audit complete');
}
main().finally(() => prisma.$disconnect());

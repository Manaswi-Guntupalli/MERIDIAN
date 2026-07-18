import { describe, expect, it } from 'vitest';
import { preValidate } from './validate.js';
import type { GridShape, LoadedData } from './types.js';

function grid(): GridShape {
  return {
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    periodsPerDay: 8,
    periodLabels: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'],
    periodTimes: [],
    breaks: [],
    blocked: [{ day: 0, period: 0, reason: 'Assembly' }],
  };
}

function base(): LoadedData {
  return {
    schoolId: 'test',
    hasConfig: true,
    classesWithoutPlan: [],
    grid: grid(),
    rooms: [
      { id: 'R1', name: 'R1', type: 'CLASSROOM', capacity: 40, unavailable: [] },
      { id: 'LAB1', name: 'Lab', type: 'LAB', capacity: 30, unavailable: [] },
    ],
    teachers: [
      { id: 't1', name: 'Ms. Physics', subjects: ['PHY'], maxWeekly: 20, maxDaily: 6, maxConsecutive: 3, partTime: false, unavailable: [], preferredFree: [] },
      { id: 't2', name: 'Mr. English', subjects: ['ENG'], maxWeekly: 20, maxDaily: 6, maxConsecutive: 3, partTime: false, unavailable: [], preferredFree: [] },
    ],
    lessons: [
      { classId: 'A', className: '9A', classSize: 30, homeRoomId: 'R1', subjectId: 'sP', subjectCode: 'PHY', subjectName: 'Physics', color: '#000', cognitiveLoad: 5, requiresLab: true, elective: false, weeklyPeriods: 6 },
      { classId: 'A', className: '9A', classSize: 30, homeRoomId: 'R1', subjectId: 'sE', subjectCode: 'ENG', subjectName: 'English', color: '#000', cognitiveLoad: 3, requiresLab: false, elective: false, weeklyPeriods: 5 },
    ],
  };
}

describe('Kairos pre-validation — plain-English impossibility detection', () => {
  it('passes a healthy configuration', () => {
    const issues = preValidate(base());
    expect(issues.filter((i) => i.severity === 'BLOCKER')).toHaveLength(0);
  });

  it('blocks when a subject has no qualified teacher (missing Physics teacher)', () => {
    const data = base();
    data.teachers = data.teachers.filter((t) => t.id !== 't1');
    const issues = preValidate(data);
    const blocker = issues.find((i) => i.code === 'NO_QUALIFIED_TEACHER');
    expect(blocker?.severity).toBe('BLOCKER');
    expect(blocker?.title).toContain('Physics');
  });

  it('blocks when a class has no curriculum', () => {
    const data = base();
    data.classesWithoutPlan = [{ id: 'B', name: '9B' }];
    const issues = preValidate(data);
    expect(issues.some((i) => i.code === 'NO_CURRICULUM' && i.title.includes('9B'))).toBe(true);
  });

  it('blocks when a class needs more periods than the week offers', () => {
    const data = base();
    data.lessons[0].weeklyPeriods = 40; // 40 + 5 > 39 usable cells
    const issues = preValidate(data);
    expect(issues.some((i) => i.code === 'CLASS_OVERFULL' && i.severity === 'BLOCKER')).toBe(true);
  });

  it('blocks when the sole qualified teacher cannot absorb the demand', () => {
    const data = base();
    data.teachers = data.teachers.map((t) => (t.id === 't1' ? { ...t, maxWeekly: 4 } : t));
    const issues = preValidate(data);
    const blocker = issues.find((i) => i.code === 'TEACHER_OVERLOAD');
    expect(blocker?.severity).toBe('BLOCKER');
    expect(blocker?.title).toContain('Ms. Physics');
  });

  it('blocks when lab demand exceeds lab supply', () => {
    const data = base();
    data.rooms = data.rooms.filter((r) => r.type !== 'LAB');
    const issues = preValidate(data);
    expect(issues.some((i) => i.code === 'LAB_CAPACITY' && i.severity === 'BLOCKER')).toBe(true);
  });

  it('warns (not blocks) when the home room is too small', () => {
    const data = base();
    data.lessons = data.lessons.map((l) => ({ ...l, classSize: 60 }));
    const issues = preValidate(data);
    const issue = issues.find((i) => i.code === 'ROOM_CAPACITY');
    expect(issue?.severity).toBe('WARNING');
  });
});

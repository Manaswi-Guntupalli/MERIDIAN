// Kairos — production timetable engine. Public surface.
export * from './types.js';
export { loadSolverInput, loadConfig, buildGrid, DEFAULT_CONFIG } from './input.js';
export type { AcademicConfigShape } from './input.js';
export { preValidate } from './validate.js';
export { solve, ScheduleState, verifySolution } from './engine.js';
export type { SolveOptions } from './engine.js';
export {
  generateDraft,
  getDraft,
  updateDraftSlot,
  setSlotLock,
  approveDraft,
  publishDraft,
  rollbackToVersion,
  discardDraft,
  compareVersions,
  planRoomClosure,
} from './workflow.js';
export { planSubstitutes, applySubstitutes, dayIndexFor } from './substitute.js';
export { runAbsenceCascade, undoAbsenceCascade } from './cascade.js';
export type { CascadeResult, CascadeStep } from './cascade.js';

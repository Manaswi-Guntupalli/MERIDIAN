import { describe, expect, it } from 'vitest';
import { statusFor, documentConfidence } from './confidence.js';
import { commitReadiness, DEFAULT_COMMIT_POLICY, policyFieldChoices } from './policy.js';

// ── The two-layer split, pure-function level ──
// Layer 1 (template): `expected` describes DOCUMENT structure.
// Layer 2 (school):   commit policy describes ERP requirements.

describe('statusFor — expected vs absent', () => {
  it('an EXPECTED field with no value is MISSING (document-quality news)', () => {
    expect(statusFor(0, true, '', true)).toBe('MISSING');
  });

  it('a field this form version simply does not carry is ABSENT — never review work', () => {
    expect(statusFor(0, true, '', false)).toBe('ABSENT');
  });

  it('values still route by validity and confidence as before', () => {
    expect(statusFor(0.95, true, 'B+', false)).toBe('AUTO');
    expect(statusFor(0.95, false, 'not-a-phone', false)).toBe('REVIEW');
    expect(statusFor(0.5, true, 'B+', true)).toBe('REVIEW');
  });
});

describe('documentConfidence — ABSENT is excluded, expected weighs triple', () => {
  it('a form cannot lose marks for boxes it never had', () => {
    const withAbsent = documentConfidence([
      { confidence: 0.95, expected: true, status: 'AUTO' },
      { confidence: 0, expected: false, status: 'ABSENT' },
    ]);
    const without = documentConfidence([{ confidence: 0.95, expected: true, status: 'AUTO' }]);
    expect(withAbsent).toBe(without);
  });

  it('a MISSING expected field still drags the headline down hard', () => {
    const clean = documentConfidence([
      { confidence: 0.95, expected: true, status: 'AUTO' },
      { confidence: 0.9, expected: false, status: 'AUTO' },
    ]);
    const missing = documentConfidence([
      { confidence: 0.95, expected: true, status: 'MISSING' },
      { confidence: 0.9, expected: false, status: 'AUTO' },
    ]);
    expect(missing).toBeLessThan(clean - 0.4);
  });
});

describe('commitReadiness — school policy vs extracted fields', () => {
  const fields = [
    { key: 'studentName', label: 'Student name', value: 'Aditi Menon' },
    { key: 'dob', label: 'Date of birth', value: '14 March 2016' },
    { key: 'phone', label: 'Contact number', value: '' },
  ];

  it('blocks with NAMED fields when policy wants what the form did not carry', () => {
    const r = commitReadiness(['studentName', 'dob', 'phone'], fields);
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual([{ key: 'phone', label: 'Contact number' }]);
  });

  it('the same document commits cleanly under a school that does not require phone', () => {
    const r = commitReadiness(['studentName', 'dob'], fields);
    expect(r.ready).toBe(true);
    expect(r.missing).toHaveLength(0);
  });

  it('a policy key this form version never extracted still blocks, with a label fallback', () => {
    const r = commitReadiness(['studentName', 'bloodGroup'], fields, (k) => (k === 'bloodGroup' ? 'Blood group' : k));
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual([{ key: 'bloodGroup', label: 'Blood group' }]);
  });

  it('defaults exist for both kinds and reference only legal template keys', () => {
    for (const kind of ['STUDENT', 'TEACHER'] as const) {
      const legal = new Set(policyFieldChoices(kind).map((c) => c.key));
      for (const key of DEFAULT_COMMIT_POLICY[kind]) expect(legal.has(key)).toBe(true);
    }
  });
});

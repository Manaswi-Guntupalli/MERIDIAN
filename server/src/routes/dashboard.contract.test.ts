import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/auth.js';
import { ROLES } from '../utils/constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// GET /dashboard/stats — the contract that keeps school health single-sourced.
//
// This route used to compute its own weighted health score from its own
// categories (attendance / finance / people / operations) while the Python
// engine published a different score from different categories. The dashboard
// drew whichever arrived first, so the headline number changed under the
// reader about a second after the page opened — 82, then 82.2.
//
// The fix is structural, not cosmetic: this route publishes no score at all.
// These tests fail if anyone reintroduces one.
// ─────────────────────────────────────────────────────────────────────────────

const app = createApp();
let token = '';
let body: Record<string, unknown> = {};

beforeAll(async () => {
  const school = await prisma.school.create({
    data: { name: 'Contract Test School', code: `CT-${Date.now()}` },
  });
  const user = await prisma.user.create({
    data: {
      schoolId: school.id,
      email: `principal-${Date.now()}@contract.test`,
      name: 'Dr Contract',
      role: ROLES.PRINCIPAL,
      password: 'x',
    },
  });
  token = signToken({
    sub: user.id,
    role: user.role,
    schoolId: school.id,
    name: user.name,
    tv: user.tokenVersion,
  });

  const res = await request(app).get('/api/dashboard/stats').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  body = res.body as Record<string, unknown>;
});

describe('dashboard stats publishes no health score of its own', () => {
  it('does not return a health figure', () => {
    expect(body).not.toHaveProperty('health');
  });

  it('does not return a category breakdown', () => {
    expect(body).not.toHaveProperty('healthBreakdown');
  });

  it('returns no field that looks like a second score', () => {
    const suspicious = Object.keys(body).filter((k) => /health|score/i.test(k));
    expect(suspicious).toEqual([]);
  });
});

describe('dashboard stats reports only measured facts', () => {
  it('does not publish an invented "hours saved" figure', () => {
    // It was ledger actions x 8 minutes, presented as a measured saving.
    expect(body).not.toHaveProperty('timeSavedHours');
  });

  it('still reports the raw ledger volume it actually counted', () => {
    expect(typeof body.automatedActions).toBe('number');
  });

  it('still reports the operational counts the dashboard renders', () => {
    for (const key of ['students', 'teachers', 'classes', 'outstanding',
      'overdueCount', 'docsInReview', 'uncoveredToday', 'feeCollectionRate']) {
      expect(body, `missing ${key}`).toHaveProperty(key);
    }
  });

  it('reports fee collection as a percentage of what was billed', () => {
    const rate = body.feeCollectionRate as number;
    expect(rate).toBeGreaterThanOrEqual(0);
    expect(rate).toBeLessThanOrEqual(100);
  });
});

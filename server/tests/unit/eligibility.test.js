import { describe, expect, it } from 'vitest';
import { evaluateEligibility } from '../../src/domain/eligibility.js';

const student = { cgpa: 7.5, activeBacklogs: 0, department: 'CSE', passingYear: 2026, tenthPercent: 82, twelfthPercent: 78 };
const state = (res, key) => res.criteria.find((c) => c.key === key).state;

describe('evaluateEligibility', () => {
  it('is eligible when every applied criterion passes', () => {
    const r = evaluateEligibility(student, {
      minCgpa: 7, maxBacklogs: 0, allowedDepartments: ['CSE', 'IT'], allowedYears: [2026], minTenthPercent: 75, minTwelfthPercent: 75,
    });
    expect(r.status).toBe('eligible');
    expect(r.failed).toEqual([]);
  });

  it('applies no criteria when none are set', () => {
    const r = evaluateEligibility({}, {});
    expect(r.status).toBe('eligible');
    expect(r.criteria.every((c) => c.state === 'not_applied')).toBe(true);
  });

  it('gives a human-readable reason per failed criterion', () => {
    const r = evaluateEligibility({ ...student, cgpa: 6.8 }, { minCgpa: 7 });
    expect(r.status).toBe('ineligible');
    expect(r.criteria.find((c) => c.key === 'cgpa').reason).toBe('CGPA 6.8 is below the required 7');
  });

  it('treats the boundary value as passing (>= for minimums, <= for backlogs)', () => {
    expect(state(evaluateEligibility({ ...student, cgpa: 7 }, { minCgpa: 7 }), 'cgpa')).toBe('pass');
    expect(state(evaluateEligibility({ ...student, activeBacklogs: 1 }, { maxBacklogs: 1 }), 'backlogs')).toBe('pass');
    expect(state(evaluateEligibility({ ...student, activeBacklogs: 2 }, { maxBacklogs: 1 }), 'backlogs')).toBe('fail');
    expect(state(evaluateEligibility({ ...student, tenthPercent: 75 }, { minTenthPercent: 75 }), 'tenth')).toBe('pass');
  });

  it('marks missing data as unavailable and the overall result incomplete (not failed)', () => {
    const r = evaluateEligibility({ ...student, cgpa: null }, { minCgpa: 7 });
    expect(state(r, 'cgpa')).toBe('unavailable');
    expect(r.status).toBe('incomplete');
    expect(r.unavailable).toEqual(['cgpa']);
  });

  it('does not treat missing data as a failure when the criterion is not applied', () => {
    const r = evaluateEligibility({ ...student, cgpa: null }, { maxBacklogs: 0 });
    expect(r.status).toBe('eligible');
  });

  it('treats 0 backlogs as valid data (not missing) and null backlogs as missing', () => {
    expect(state(evaluateEligibility({ ...student, activeBacklogs: 0 }, { maxBacklogs: 0 }), 'backlogs')).toBe('pass');
    expect(state(evaluateEligibility({ ...student, activeBacklogs: null }, { maxBacklogs: 0 }), 'backlogs')).toBe('unavailable');
  });

  it('matches departments case-insensitively and rejects others', () => {
    expect(state(evaluateEligibility({ ...student, department: ' cse ' }, { allowedDepartments: ['CSE'] }), 'department')).toBe('pass');
    const r = evaluateEligibility({ ...student, department: 'Mechanical' }, { allowedDepartments: ['CSE', 'IT'] });
    expect(state(r, 'department')).toBe('fail');
    expect(r.status).toBe('ineligible');
  });

  it('checks the allowed batch list', () => {
    expect(state(evaluateEligibility({ ...student, passingYear: 2025 }, { allowedYears: [2026, 2027] }), 'batch')).toBe('fail');
    expect(state(evaluateEligibility({ ...student, passingYear: 2027 }, { allowedYears: [2026, 2027] }), 'batch')).toBe('pass');
  });

  it('prefers ineligible over incomplete when one criterion fails and another is missing', () => {
    const r = evaluateEligibility({ ...student, cgpa: 5, twelfthPercent: null }, { minCgpa: 7, minTwelfthPercent: 60 });
    expect(r.status).toBe('ineligible');
    expect(r.unavailable).toEqual(['twelfth']);
  });

  it('never throws on odd values', () => {
    expect(() => evaluateEligibility({ cgpa: 'abc', activeBacklogs: '' }, { minCgpa: 7, maxBacklogs: 0 })).not.toThrow();
  });
});

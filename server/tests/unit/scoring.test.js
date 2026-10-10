import { describe, expect, it } from 'vitest';
import {
  combineComponents, computeMatch, computeReadiness, DEFAULT_MATCH_WEIGHTS, DEFAULT_READINESS_WEIGHTS,
} from '../../src/domain/scoring.js';
import { computeProfileCompletion } from '../../src/domain/profileCompletion.js';
import { matchSkills, skillKey } from '../../src/domain/skills.js';

const completion = computeProfileCompletion({});

describe('combineComponents', () => {
  const comp = (key, score, available = true) => ({ key, label: key, source: 'rule', available, score: available ? score : null, evidence: [], reason: '' });

  it('computes a weighted average over available components and re-normalises weights', () => {
    const r = combineComponents(
      [comp('a', 100), comp('b', 50), comp('c', 0, false)],
      { a: 50, b: 25, c: 25 },
    );
    // (100*50 + 50*25) / 75
    expect(r.total).toBeCloseTo(83.3, 1);
    expect(r.componentsUsed).toBe(2);
    expect(r.componentsTotal).toBe(3);
    expect(r.note).toContain('2 of 3 components');
    const eff = r.components.map((c) => c.effectiveWeight);
    expect(eff[0] + eff[1]).toBeCloseTo(100, 0);
    expect(r.components[2].effectiveWeight).toBe(0);
  });

  it('returns null total when nothing is available', () => {
    const r = combineComponents([comp('a', 1, false)], { a: 10 });
    expect(r.total).toBeNull();
    expect(r.note).toMatch(/not enough data/i);
  });

  it('ignores zero-weight components', () => {
    const r = combineComponents([comp('a', 100), comp('b', 0)], { a: 10, b: 0 });
    expect(r.total).toBe(100);
  });
});

describe('computeReadiness', () => {
  const base = {
    student: { cgpa: 8, tenthPercent: 90, twelfthPercent: 80, activeBacklogs: 0 },
    skills: ['JavaScript', 'React', 'SQL', 'Python', 'Git'],
    projects: [{ description: 'x'.repeat(80), tech: ['React', 'Node'] }],
    experience: [],
    completion,
    resumeAnalysis: null,
    resumeMissingReason: 'AI resume analysis has not been run yet.',
  };

  it('excludes resume quality when no AI analysis exists and says so', () => {
    const r = computeReadiness(base, DEFAULT_READINESS_WEIGHTS);
    const resume = r.components.find((c) => c.key === 'resume');
    expect(resume.available).toBe(false);
    expect(resume.reason).toMatch(/not been run/);
    expect(r.componentsUsed).toBe(5);
    expect(r.note).toMatch(/5 of 6/);
    expect(r.total).toBeGreaterThan(0);
  });

  it('reports academics as unavailable when CGPA is missing', () => {
    const r = computeReadiness({ ...base, student: { cgpa: null } }, DEFAULT_READINESS_WEIGHTS);
    expect(r.components.find((c) => c.key === 'academics').available).toBe(false);
  });

  it('penalises active backlogs', () => {
    const clean = computeReadiness(base, DEFAULT_READINESS_WEIGHTS).components.find((c) => c.key === 'academics').score;
    const dirty = computeReadiness({ ...base, student: { ...base.student, activeBacklogs: 2 } }, DEFAULT_READINESS_WEIGHTS).components.find((c) => c.key === 'academics').score;
    expect(dirty).toBeCloseTo(clean - 20, 0);
  });

  it('includes the AI resume score and flags it as AI sourced', () => {
    const r = computeReadiness(
      { ...base, resumeAnalysis: { overallScore: 70, components: [{ label: 'Content', score: 70 }], projectRelevance: { score: 60, reason: 'ok' } } },
      DEFAULT_READINESS_WEIGHTS,
    );
    const resume = r.components.find((c) => c.key === 'resume');
    expect(resume.available).toBe(true);
    expect(resume.source).toBe('ai');
    expect(r.components.find((c) => c.key === 'projects').source).toBe('mixed');
    expect(r.componentsUsed).toBe(6);
  });

  it('always exposes weight, evidence and reason for every component', () => {
    const r = computeReadiness(base, DEFAULT_READINESS_WEIGHTS);
    for (const c of r.components) {
      expect(c).toHaveProperty('weight');
      expect(c).toHaveProperty('evidence');
      expect(typeof c.reason).toBe('string');
    }
  });
});

describe('computeMatch', () => {
  const required = [
    { skill: 'React', importance: 'mandatory' },
    { skill: 'Node.js', importance: 'mandatory' },
    { skill: 'Docker', importance: 'preferred' },
  ];
  const input = { student: { cgpa: 8 }, haveSkills: ['react', 'NodeJS'], requiredSkills: required, criteria: { minCgpa: 7 }, ai: null };

  it('scores required skills with mandatory weighted double and aliases normalised', () => {
    const r = computeMatch(input, DEFAULT_MATCH_WEIGHTS);
    expect(r.matchedSkills.map((s) => s.skill)).toEqual(['React', 'Node.js']);
    expect(r.missingSkills.map((s) => s.skill)).toEqual(['Docker']);
    expect(r.components.find((c) => c.key === 'skills').score).toBe(80); // 4 of 5 weight points
  });

  it('marks AI parts unavailable and re-normalises when AI is absent', () => {
    const r = computeMatch(input, DEFAULT_MATCH_WEIGHTS);
    expect(r.components.find((c) => c.key === 'role').available).toBe(false);
    expect(r.componentsUsed).toBe(2);
  });

  it('uses AI relevance when supplied', () => {
    const r = computeMatch(
      { ...input, ai: { roleRelevance: { score: 90, reason: 'Relevant internship' }, projectRelevance: { score: 70, reason: 'Web projects' } } },
      DEFAULT_MATCH_WEIGHTS,
    );
    expect(r.componentsUsed).toBe(4);
    expect(r.components.find((c) => c.key === 'role').source).toBe('ai');
  });
});

describe('skills', () => {
  it('normalises common aliases', () => {
    expect(skillKey('Node.js')).toBe(skillKey('nodejs'));
    expect(skillKey('JS')).toBe(skillKey('JavaScript'));
    expect(skillKey('React.js')).toBe(skillKey('react'));
    expect(skillKey('C++')).toBe('cpp');
  });
  it('returns null ratio when nothing is required', () => {
    expect(matchSkills([], ['a']).ratio).toBeNull();
  });
});

describe('profile completion', () => {
  it('is 0 for an empty profile and 100 for a full one', () => {
    expect(computeProfileCompletion({}).percent).toBe(0);
    const full = computeProfileCompletion({
      phone: '1', department: 'CSE', rollNumber: '1', passingYear: 2026, cgpa: 8, tenthPercent: 80, twelfthPercent: 80,
      activeBacklogs: 0, skills: ['a', 'b', 'c'], projectCount: 1, experienceCount: 1, links: { github: 'x' },
      careerInterests: ['web'], hasResume: true,
    });
    expect(full.percent).toBe(100);
    expect(full.missing).toEqual([]);
  });
});

// Explainable scoring. Pure functions: every number comes with weight, evidence and a reason.
// Components that cannot be computed are marked `available: false`, removed from the total, and
// the remaining weights are re-normalised.
import { matchSkills } from './skills.js';
import { clamp, round1 } from '../utils/helpers.js';

export const DEFAULT_READINESS_WEIGHTS = {
  academics: 25,
  skills: 25,
  projects: 15,
  experience: 10,
  resume: 15,
  completeness: 10,
};

export const DEFAULT_MATCH_WEIGHTS = {
  skills: 50,
  role: 20,
  academic: 15,
  projects: 15,
};

const unavailable = (key, label, reason, source = 'rule') => ({
  key,
  label,
  source,
  available: false,
  score: null,
  evidence: [],
  reason,
});

const component = (key, label, score, evidence, reason, source = 'rule') => ({
  key,
  label,
  source,
  available: true,
  score: round1(clamp(score, 0, 100)),
  evidence,
  reason,
});

/**
 * @param components array of components (see above)
 * @param weights    { key: number } configured weights
 */
export function combineComponents(components, weights) {
  const withWeight = components.map((c) => ({ ...c, weight: Number(weights[c.key] ?? 0) }));
  const usable = withWeight.filter((c) => c.available && c.weight > 0);
  const usedWeight = usable.reduce((a, c) => a + c.weight, 0);
  const total = usedWeight > 0 ? usable.reduce((a, c) => a + c.score * c.weight, 0) / usedWeight : null;

  const out = withWeight.map((c) => {
    const counted = c.available && c.weight > 0 && usedWeight > 0;
    return {
      ...c,
      effectiveWeight: counted ? round1((c.weight / usedWeight) * 100) : 0,
      contribution: counted ? round1((c.score * c.weight) / usedWeight) : 0,
    };
  });
  const configured = withWeight.filter((c) => c.weight > 0).length;
  return {
    total: total === null ? null : round1(total),
    componentsUsed: usable.length,
    componentsTotal: configured,
    note:
      total === null
        ? 'Not enough data to compute a score yet.'
        : usable.length === configured
          ? `Based on all ${configured} components`
          : `Based on ${usable.length} of ${configured} components (missing data was excluded and weights re-normalised)`,
    components: out,
  };
}

// ---------------------------------------------------------------------------
// Readiness components
// ---------------------------------------------------------------------------
export function academicsComponent(s) {
  if (s.cgpa == null) {
    return unavailable('academics', 'Academics', 'CGPA is missing, so academics cannot be scored.');
  }
  const parts = [{ v: (Number(s.cgpa) / 10) * 100, w: 0.6, label: `CGPA ${s.cgpa}/10` }];
  if (s.tenthPercent != null) parts.push({ v: Number(s.tenthPercent), w: 0.2, label: `10th ${s.tenthPercent}%` });
  if (s.twelfthPercent != null) parts.push({ v: Number(s.twelfthPercent), w: 0.2, label: `12th ${s.twelfthPercent}%` });
  const wsum = parts.reduce((a, p) => a + p.w, 0);
  let score = parts.reduce((a, p) => a + p.v * p.w, 0) / wsum;
  const evidence = parts.map((p) => p.label);
  const backlogs = Number(s.activeBacklogs ?? 0);
  if (backlogs > 0) {
    score -= backlogs * 10;
    evidence.push(`${backlogs} active backlog(s): -${backlogs * 10} points`);
  }
  return component(
    'academics',
    'Academics',
    score,
    evidence,
    backlogs > 0
      ? 'Weighted CGPA, 10th and 12th marks, reduced for active backlogs.'
      : 'Weighted CGPA (60%), 10th (20%) and 12th (20%) marks.',
  );
}

export function skillsComponent(skills = []) {
  if (!skills.length) return unavailable('skills', 'Skills', 'No skills have been added to the profile.');
  const score = (Math.min(skills.length, 10) / 10) * 100;
  return component(
    'skills',
    'Skills',
    score,
    [`${skills.length} skill(s) listed`, skills.slice(0, 8).join(', ')],
    'Breadth of skills, capped at 10 skills. Add more relevant skills to raise this.',
  );
}

export function projectsComponent(projects = [], aiRelevance = null) {
  const per = projects.map((p) => {
    let pts = 20;
    if ((p.description ?? '').trim().length >= 60) pts += 8;
    if ((p.tech ?? []).length >= 2) pts += 6;
    return pts;
  });
  const det = Math.min(100, per.reduce((a, b) => a + b, 0));
  const evidence = [`${projects.length} project(s)`];
  if (aiRelevance && typeof aiRelevance.score === 'number') {
    evidence.push(`AI project-quality estimate: ${Math.round(aiRelevance.score)}/100`);
    return component(
      'projects',
      'Projects',
      (det + aiRelevance.score) / 2,
      evidence,
      'Average of rule-based project depth and the AI estimate of project quality from the resume.',
      'mixed',
    );
  }
  return component(
    'projects',
    'Projects',
    det,
    evidence,
    projects.length
      ? 'Rule-based: number of projects with descriptions and technologies (3 solid projects = full score).'
      : 'No projects added yet. This counts as 0 because "none" cannot be told apart from "not entered".',
  );
}

export function experienceComponent(experience = []) {
  const per = experience.map((e) => {
    let pts = 30;
    if ((e.description ?? '').trim().length >= 60) pts += 10;
    if (e.start_date && e.end_date) pts += 10;
    return pts;
  });
  const score = Math.min(100, per.reduce((a, b) => a + b, 0));
  return component(
    'experience',
    'Experience',
    score,
    [`${experience.length} internship/experience entr${experience.length === 1 ? 'y' : 'ies'}`],
    experience.length
      ? 'Rule-based: internships and experience with role details (2 detailed entries = full score).'
      : 'No internships or experience added. This counts as 0 because "none" cannot be told apart from "not entered".',
  );
}

export function resumeComponent(analysis, missingReason) {
  if (!analysis) return unavailable('resume', 'Resume quality', missingReason, 'ai');
  return component(
    'resume',
    'Resume quality',
    analysis.overallScore,
    analysis.components.map((c) => `${c.label}: ${c.score}/100`),
    'AI assessment of the uploaded resume (average of its sub-scores).',
    'ai',
  );
}

export function completenessComponent(completion) {
  return component(
    'completeness',
    'Profile completeness',
    completion.percent,
    completion.missing.length
      ? [`Missing: ${completion.missing.map((m) => m.label).join(', ')}`]
      : ['All profile fields are filled'],
    'Share of profile fields filled in (rule-based).',
  );
}

export function computeReadiness({ student, skills, projects, experience, completion, resumeAnalysis, resumeMissingReason }, weights = DEFAULT_READINESS_WEIGHTS) {
  const comps = [
    academicsComponent(student),
    skillsComponent(skills),
    projectsComponent(projects, resumeAnalysis?.projectRelevance ?? null),
    experienceComponent(experience),
    resumeComponent(resumeAnalysis, resumeMissingReason),
    completenessComponent(completion),
  ];
  return combineComponents(comps, weights);
}

// ---------------------------------------------------------------------------
// Job match
// ---------------------------------------------------------------------------
export function academicFitComponent(student, criteria = {}) {
  if (student.cgpa == null) return unavailable('academic', 'Academic fit', 'CGPA is missing.');
  const cgpa = Number(student.cgpa);
  const min = criteria.minCgpa != null ? Number(criteria.minCgpa) : null;
  if (min === null || min <= 0) {
    return component('academic', 'Academic fit', cgpa * 10, [`CGPA ${cgpa}`], 'No minimum CGPA set; scored from CGPA directly.');
  }
  const score = cgpa >= min ? 60 + 40 * Math.min(1, (cgpa - min) / Math.max(0.5, 10 - min)) : (60 * cgpa) / min;
  return component(
    'academic',
    'Academic fit',
    score,
    [`CGPA ${cgpa} vs required ${min}`],
    cgpa >= min ? 'Meets the CGPA requirement; more headroom scores higher.' : 'Below the CGPA requirement.',
  );
}

export function computeMatch({ student, haveSkills, requiredSkills, criteria, ai }, weights = DEFAULT_MATCH_WEIGHTS) {
  const m = matchSkills(requiredSkills, haveSkills);
  const comps = [];

  if (m.ratio === null) {
    comps.push(unavailable('skills', 'Required skills', 'The drive has no required skills listed.'));
  } else {
    comps.push(
      component(
        'skills',
        'Required skills',
        m.ratio * 100,
        [
          `Matched: ${m.matched.map((x) => x.skill).join(', ') || 'none'}`,
          `Missing: ${m.missing.map((x) => x.skill).join(', ') || 'none'}`,
        ],
        'Share of required skills the student has (mandatory skills count double).',
      ),
    );
  }

  comps.push(
    ai?.roleRelevance
      ? component('role', 'Role / experience relevance', ai.roleRelevance.score, ai.roleRelevance.signals ?? [], ai.roleRelevance.reason, 'ai')
      : unavailable('role', 'Role / experience relevance', 'AI analysis not available.', 'ai'),
  );
  comps.push(academicFitComponent(student, criteria));
  comps.push(
    ai?.projectRelevance
      ? component('projects', 'Projects relevance', ai.projectRelevance.score, [], ai.projectRelevance.reason, 'ai')
      : unavailable('projects', 'Projects relevance', 'AI analysis not available.', 'ai'),
  );

  const combined = combineComponents(comps, weights);
  return {
    ...combined,
    matchedSkills: m.matched,
    missingSkills: m.missing,
    missingMandatory: m.missingMandatory,
    missingPreferred: m.missingPreferred,
    mandatoryCoverage: m.mandatoryRatio,
  };
}

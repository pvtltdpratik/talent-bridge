// Skill normalisation and matching (deterministic, no AI).
const ALIASES = {
  js: 'javascript',
  ecmascript: 'javascript',
  ts: 'typescript',
  node: 'nodejs',
  nodejs: 'nodejs',
  reactjs: 'react',
  reactjs18: 'react',
  vuejs: 'vue',
  angularjs: 'angular',
  nextjs: 'next',
  expressjs: 'express',
  py: 'python',
  python3: 'python',
  postgres: 'postgresql',
  psql: 'postgresql',
  mongo: 'mongodb',
  k8s: 'kubernetes',
  golang: 'go',
  'c++': 'cpp',
  'c#': 'csharp',
  ml: 'machinelearning',
  dl: 'deeplearning',
  dsa: 'datastructuresandalgorithms',
  datastructures: 'datastructuresandalgorithms',
  algorithms: 'datastructuresandalgorithms',
  oops: 'oop',
  objectorientedprogramming: 'oop',
  html5: 'html',
  css3: 'css',
  tailwindcss: 'tailwind',
  restapi: 'rest',
  restapis: 'rest',
  restfulapi: 'rest',
  amazonwebservices: 'aws',
  gcp: 'googlecloud',
  sklearn: 'scikitlearn',
  'scikit-learn': 'scikitlearn',
};

/** Canonical comparison key for a skill label. */
export function skillKey(label) {
  const raw = String(label ?? '')
    .toLowerCase()
    .trim();
  if (!raw) return '';
  // keep c++ / c# intact before stripping punctuation
  if (ALIASES[raw]) return ALIASES[raw];
  const stripped = raw.replace(/[.\s_\-/]+/g, '');
  return ALIASES[stripped] ?? stripped;
}

export function uniqueSkills(list = []) {
  const seen = new Map();
  for (const s of list) {
    const label = String(s ?? '').trim();
    const key = skillKey(label);
    if (key && !seen.has(key)) seen.set(key, label);
  }
  return [...seen.values()];
}

/**
 * @param required [{ skill, importance: 'mandatory'|'preferred' }]
 * @param have     string[] skills the student has (profile + parsed resume)
 */
export function matchSkills(required = [], have = []) {
  const haveKeys = new Set(have.map(skillKey).filter(Boolean));
  const matched = [];
  const missing = [];
  for (const r of required) {
    (haveKeys.has(skillKey(r.skill)) ? matched : missing).push({ skill: r.skill, importance: r.importance });
  }
  const weight = (r) => (r.importance === 'mandatory' ? 2 : 1);
  const total = required.reduce((a, r) => a + weight(r), 0);
  const got = matched.reduce((a, r) => a + weight(r), 0);
  return {
    matched,
    missing,
    missingMandatory: missing.filter((m) => m.importance === 'mandatory'),
    missingPreferred: missing.filter((m) => m.importance === 'preferred'),
    ratio: total === 0 ? null : got / total,
    mandatoryRatio: (() => {
      const m = required.filter((r) => r.importance === 'mandatory');
      if (!m.length) return null;
      return m.filter((r) => haveKeys.has(skillKey(r.skill))).length / m.length;
    })(),
  };
}

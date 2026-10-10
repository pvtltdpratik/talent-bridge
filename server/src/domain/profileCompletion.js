// Deterministic profile completion. Weights sum to 100.
const FIELDS = [
  { key: 'phone', label: 'Phone number', weight: 5, has: (p) => !!p.phone },
  { key: 'department', label: 'Department', weight: 8, has: (p) => !!p.department },
  { key: 'rollNumber', label: 'Roll number', weight: 5, has: (p) => !!p.rollNumber },
  { key: 'passingYear', label: 'Passing year', weight: 8, has: (p) => p.passingYear != null },
  { key: 'cgpa', label: 'CGPA', weight: 12, has: (p) => p.cgpa != null },
  { key: 'tenthPercent', label: '10th %', weight: 5, has: (p) => p.tenthPercent != null },
  { key: 'twelfthPercent', label: '12th %', weight: 5, has: (p) => p.twelfthPercent != null },
  { key: 'activeBacklogs', label: 'Active backlogs', weight: 4, has: (p) => p.activeBacklogs != null },
  { key: 'skills', label: 'At least 3 skills', weight: 10, has: (p) => (p.skills?.length ?? 0) >= 3 },
  { key: 'projects', label: 'At least 1 project', weight: 10, has: (p) => (p.projectCount ?? 0) >= 1 },
  { key: 'experience', label: 'Internship / experience', weight: 4, has: (p) => (p.experienceCount ?? 0) >= 1 },
  { key: 'links', label: 'GitHub or LinkedIn link', weight: 5, has: (p) => !!(p.links?.github || p.links?.linkedin) },
  { key: 'careerInterests', label: 'Career interests', weight: 5, has: (p) => (p.careerInterests?.length ?? 0) >= 1 },
  { key: 'resume', label: 'Resume uploaded', weight: 14, has: (p) => !!p.hasResume },
];

export function computeProfileCompletion(p) {
  let earned = 0;
  const total = FIELDS.reduce((a, f) => a + f.weight, 0);
  const missing = [];
  for (const f of FIELDS) {
    if (f.has(p)) earned += f.weight;
    else missing.push({ key: f.key, label: f.label, weight: f.weight });
  }
  return { percent: Math.round((earned / total) * 100), missing };
}

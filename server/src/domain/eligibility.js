// Deterministic eligibility evaluation. No AI, no I/O.
//
// student:  { cgpa, activeBacklogs, department, passingYear, tenthPercent, twelfthPercent }
// criteria: { minCgpa, maxBacklogs, allowedDepartments[], allowedYears[], minTenthPercent, minTwelfthPercent }
//           (null / undefined / empty array => criterion is not applied)
//
// Per-criterion state:
//   pass | fail | unavailable (criterion applies but student data is missing) | not_applied
// Overall status:
//   any fail -> ineligible; else any unavailable -> incomplete; else eligible.

const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const norm = (s) => String(s ?? '').trim().toLowerCase();
const fmt = (n) => String(Number(Number(n).toFixed(2)));

function numericMin({ key, label, unit = '', required, actual, missingHint }) {
  if (!isNum(required)) return { key, label, state: 'not_applied', required: null, actual: isNum(actual) ? Number(actual) : null, reason: `${label} is not a requirement for this drive` };
  if (!isNum(actual)) {
    return { key, label, state: 'unavailable', required: Number(required), actual: null, reason: `${label} is missing from your profile (required: ${fmt(required)}${unit}). ${missingHint}` };
  }
  const ok = Number(actual) >= Number(required);
  return {
    key,
    label,
    state: ok ? 'pass' : 'fail',
    required: Number(required),
    actual: Number(actual),
    reason: ok
      ? `${label} ${fmt(actual)}${unit} meets the required ${fmt(required)}${unit}`
      : `${label} ${fmt(actual)}${unit} is below the required ${fmt(required)}${unit}`,
  };
}

export function evaluateEligibility(student = {}, criteria = {}) {
  const items = [];

  items.push(
    numericMin({ key: 'cgpa', label: 'CGPA', required: criteria.minCgpa, actual: student.cgpa, missingHint: 'Add your CGPA.' }),
  );

  // backlogs: maximum
  if (!isNum(criteria.maxBacklogs)) {
    items.push({ key: 'backlogs', label: 'Active backlogs', state: 'not_applied', required: null, actual: isNum(student.activeBacklogs) ? Number(student.activeBacklogs) : null, reason: 'Active backlogs are not a requirement for this drive' });
  } else if (!isNum(student.activeBacklogs)) {
    items.push({ key: 'backlogs', label: 'Active backlogs', state: 'unavailable', required: Number(criteria.maxBacklogs), actual: null, reason: `Active backlogs are missing from your profile (maximum allowed: ${criteria.maxBacklogs}). Enter 0 if you have none.` });
  } else {
    const ok = Number(student.activeBacklogs) <= Number(criteria.maxBacklogs);
    items.push({
      key: 'backlogs',
      label: 'Active backlogs',
      state: ok ? 'pass' : 'fail',
      required: Number(criteria.maxBacklogs),
      actual: Number(student.activeBacklogs),
      reason: ok
        ? `${student.activeBacklogs} active backlog(s) is within the allowed ${criteria.maxBacklogs}`
        : `${student.activeBacklogs} active backlog(s) exceeds the allowed maximum of ${criteria.maxBacklogs}`,
    });
  }

  // department: allow-list
  const depts = (criteria.allowedDepartments ?? []).filter(Boolean);
  if (!depts.length) {
    items.push({ key: 'department', label: 'Department', state: 'not_applied', required: null, actual: student.department ?? null, reason: 'Any department may apply' });
  } else if (!student.department) {
    items.push({ key: 'department', label: 'Department', state: 'unavailable', required: depts, actual: null, reason: `Department is missing from your profile (allowed: ${depts.join(', ')})` });
  } else {
    const ok = depts.some((d) => norm(d) === norm(student.department));
    items.push({
      key: 'department',
      label: 'Department',
      state: ok ? 'pass' : 'fail',
      required: depts,
      actual: student.department,
      reason: ok ? `${student.department} is an allowed department` : `${student.department} is not in the allowed departments (${depts.join(', ')})`,
    });
  }

  // batch / passing year: allow-list
  const years = (criteria.allowedYears ?? []).filter(isNum).map(Number);
  if (!years.length) {
    items.push({ key: 'batch', label: 'Batch', state: 'not_applied', required: null, actual: student.passingYear ?? null, reason: 'Any batch may apply' });
  } else if (!isNum(student.passingYear)) {
    items.push({ key: 'batch', label: 'Batch', state: 'unavailable', required: years, actual: null, reason: `Passing year is missing from your profile (allowed batches: ${years.join(', ')})` });
  } else {
    const ok = years.includes(Number(student.passingYear));
    items.push({
      key: 'batch',
      label: 'Batch',
      state: ok ? 'pass' : 'fail',
      required: years,
      actual: Number(student.passingYear),
      reason: ok ? `Batch ${student.passingYear} is allowed` : `Batch ${student.passingYear} is not in the allowed batches (${years.join(', ')})`,
    });
  }

  items.push(
    numericMin({ key: 'tenth', label: '10th %', unit: '%', required: criteria.minTenthPercent, actual: student.tenthPercent, missingHint: 'Add your 10th percentage.' }),
  );
  items.push(
    numericMin({ key: 'twelfth', label: '12th %', unit: '%', required: criteria.minTwelfthPercent, actual: student.twelfthPercent, missingHint: 'Add your 12th percentage.' }),
  );

  const failed = items.filter((i) => i.state === 'fail');
  const unavailable = items.filter((i) => i.state === 'unavailable');
  let status = 'eligible';
  if (failed.length) status = 'ineligible';
  else if (unavailable.length) status = 'incomplete';

  return {
    status,
    criteria: items,
    failed: failed.map((i) => i.key),
    unavailable: unavailable.map((i) => i.key),
    summary:
      status === 'eligible'
        ? 'You meet all eligibility criteria.'
        : status === 'ineligible'
          ? failed.map((i) => i.reason).join('; ')
          : `Complete your profile to check eligibility: ${unavailable.map((i) => i.label).join(', ')}.`,
  };
}

export function criteriaFromRow(row) {
  if (!row) return {};
  return {
    minCgpa: row.minCgpa ?? null,
    maxBacklogs: row.maxBacklogs ?? null,
    allowedDepartments: row.allowedDepartments ?? [],
    allowedYears: row.allowedYears ?? [],
    minTenthPercent: row.minTenthPercent ?? null,
    minTwelfthPercent: row.minTwelfthPercent ?? null,
  };
}

/** Accepts a camelCased student_profiles row. */
export function studentFromRow(row) {
  return {
    cgpa: row.cgpa ?? null,
    activeBacklogs: row.activeBacklogs ?? null,
    department: row.department ?? null,
    passingYear: row.passingYear ?? null,
    tenthPercent: row.tenthPercent ?? null,
    twelfthPercent: row.twelfthPercent ?? null,
  };
}

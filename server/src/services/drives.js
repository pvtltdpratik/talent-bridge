import { ctx } from '../context.js';
import { companies, drives } from '../repositories/drives.js';
import { students } from '../repositories/students.js';
import { applications, exceptions } from '../repositories/applications.js';
import { criteriaFromRow, evaluateEligibility, studentFromRow } from '../domain/eligibility.js';
import { assertCollegeAccess, collegeForCreate, notifyMany, recordAudit, scopeCollege } from './common.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { likePattern, pageResult } from '../utils/helpers.js';

const STAFF_TRANSITIONS = {
  draft: ['open', 'cancelled'],
  open: ['closed', 'completed', 'cancelled'],
  closed: ['open', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

/** Pure helper reused by services: evaluate a student_profiles row against a drive_eligibility row. */
export const evaluateRow = (studentRow, eligibilityRow) =>
  evaluateEligibility(studentFromRow(studentRow), criteriaFromRow(eligibilityRow));

export function eligibilityCriteriaView(e) {
  const c = criteriaFromRow(e);
  return {
    minCgpa: c.minCgpa, maxBacklogs: c.maxBacklogs, allowedDepartments: c.allowedDepartments,
    allowedYears: c.allowedYears, minTenthPercent: c.minTenthPercent, minTwelfthPercent: c.minTwelfthPercent,
  };
}

const publicDrive = (d, skills, eligibility) => ({
  id: d.id, collegeId: d.collegeId, collegeName: d.collegeName, companyId: d.companyId, companyName: d.companyName,
  companyIndustry: d.companyIndustry, title: d.title, description: d.description, jobType: d.jobType, location: d.location,
  packageLpa: d.packageLpa, stipendPerMonth: d.stipendPerMonth, openings: d.openings, deadline: d.deadline,
  originalDeadline: d.originalDeadline, driveDate: d.driveDate, status: d.status, applicationCount: d.applicationCount,
  createdAt: d.createdAt,
  skills: skills ?? [],
  eligibility: eligibilityCriteriaView(eligibility),
});

// ===========================================================================
// companies
// ===========================================================================
export const companyService = {
  async create(user, input) {
    const collegeId = collegeForCreate(user, input.collegeId);
    try {
      return await companies.insert({ ...input, collegeId, createdBy: user.id });
    } catch (err) {
      if (err.code === '23505') throw conflict('A company with this name already exists for this college', 'company_exists');
      throw err;
    }
  },

  async list(user, query, paging) {
    const { items, total } = await companies.list({
      collegeId: scopeCollege(user, query.collegeId), status: query.status,
      q: query.q ? likePattern(query.q) : null, limit: paging.limit, offset: paging.offset,
    });
    return pageResult(items, total, paging);
  },

  /** Company workspace: company + its drives + hiring numbers. */
  async workspace(user, id) {
    const company = await companies.findById(id);
    if (!company) throw notFound('Company not found');
    assertCollegeAccess(user, company.collegeId);
    const { items } = await drives.list({ collegeId: company.collegeId, companyId: id, limit: 100, offset: 0 });
    const { rows } = await ctx.db.query(
      `select a.status, count(*)::int as n from applications a join drives d on d.id = a.drive_id
        where d.company_id = $1 group by a.status`, [id]);
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    return {
      company,
      drives: items.map((d) => ({ id: d.id, title: d.title, status: d.status, deadline: d.deadline, applicationCount: d.applicationCount })),
      hiring: {
        applicants: Object.values(byStatus).reduce((a, b) => a + b, 0),
        shortlisted: (byStatus.shortlisted ?? 0) + (byStatus.interview_scheduled ?? 0),
        selected: byStatus.selected ?? 0,
        rejected: byStatus.rejected ?? 0,
        byStatus,
      },
    };
  },

  async update(user, id, patch) {
    const company = await companies.findById(id);
    if (!company) throw notFound('Company not found');
    assertCollegeAccess(user, company.collegeId);
    try {
      return await companies.update(id, patch);
    } catch (err) {
      if (err.code === '23505') throw conflict('A company with this name already exists for this college', 'company_exists');
      throw err;
    }
  },
};

// ===========================================================================
// drives
// ===========================================================================
async function loadDrive(id) {
  const d = await drives.findById(id);
  if (!d) throw notFound('Drive not found');
  const [skills, eligibility] = await Promise.all([drives.skills(id), drives.eligibility(id)]);
  return { d, skills, eligibility };
}

/** Tell students (who are not ruled out) that a new drive is open. */
async function notifyMatchingStudents(ex, drive, eligibility) {
  const all = await students.listAllForCollege(drive.collegeId, {}, ex);
  const ids = all.filter((s) => evaluateRow(s, eligibility).status !== 'ineligible').map((s) => s.userId);
  await notifyMany(ex, ids, {
    type: 'new_drive',
    title: `New drive: ${drive.title}`,
    body: `${drive.companyName ?? 'A company'} is hiring. Apply before ${new Date(drive.deadline).toLocaleDateString('en-IN')}.`,
    link: `/student/drives/${drive.id}`,
  });
}

export const driveService = {
  async create(user, input) {
    const company = await companies.findById(input.companyId);
    if (!company) throw badRequest('Unknown company', [{ field: 'companyId', message: 'Unknown company' }]);
    const collegeId = user.role === 'admin' ? company.collegeId : user.collegeId;
    if (company.collegeId !== collegeId) throw notFound('Company not found');
    if (company.status !== 'active') throw conflict('This company is inactive', 'company_inactive');
    if (new Date(input.deadline) <= new Date() && input.status === 'open') {
      throw badRequest('The deadline must be in the future for an open drive', [{ field: 'deadline', message: 'Must be in the future' }]);
    }

    const drive = await ctx.db.tx(async (ex) => {
      const row = await drives.insert({ ...input, collegeId, createdBy: user.id }, ex);
      await drives.replaceSkills(row.id, input.skills ?? [], ex);
      await drives.upsertEligibility(row.id, input.eligibility ?? {}, ex);
      if (row.status === 'open') {
        await notifyMatchingStudents(ex, { ...row, companyName: company.name }, input.eligibility ?? {});
      }
      return row;
    });
    return this.getForStaff(user, drive.id);
  },

  async update(user, id, patch) {
    const { d } = await loadDrive(id);
    assertCollegeAccess(user, d.collegeId);
    if (['completed', 'cancelled'].includes(d.status)) throw conflict(`A ${d.status} drive cannot be edited`, 'drive_locked');
    await ctx.db.tx(async (ex) => {
      await drives.update(id, patch, ex);
      if (patch.skills) await drives.replaceSkills(id, patch.skills, ex);
      if (patch.eligibility) {
        const before = await drives.eligibility(id, ex);
        await drives.upsertEligibility(id, patch.eligibility, ex);
        await recordAudit(user, {
          action: 'drive.eligibility_changed', targetType: 'drive', targetId: id, collegeId: d.collegeId,
          oldValue: eligibilityCriteriaView(before), newValue: patch.eligibility,
        }, ex);
      }
    });
    return this.getForStaff(user, id);
  },

  async setStatus(user, id, status) {
    const { d, eligibility } = await loadDrive(id);
    assertCollegeAccess(user, d.collegeId);
    if (!STAFF_TRANSITIONS[d.status]?.includes(status)) {
      throw conflict(`A ${d.status} drive cannot be changed to ${status}`, 'invalid_transition');
    }
    if (status === 'open' && new Date(d.deadline) <= new Date()) {
      throw conflict('Extend the deadline before opening this drive', 'deadline_passed');
    }
    await ctx.db.tx(async (ex) => {
      await drives.setStatus(id, status, ex);
      await recordAudit(user, { action: 'drive.status_changed', targetType: 'drive', targetId: id, collegeId: d.collegeId, oldValue: { status: d.status }, newValue: { status } }, ex);
      if (status === 'open' && d.status === 'draft') await notifyMatchingStudents(ex, d, eligibility);
    });
    return this.getForStaff(user, id);
  },

  /** Extending a deadline is the only way past a closed drive. Always audited. */
  async extendDeadline(user, id, { deadline, reason }) {
    const { d } = await loadDrive(id);
    assertCollegeAccess(user, d.collegeId);
    if (['completed', 'cancelled'].includes(d.status)) throw conflict(`A ${d.status} drive cannot be extended`, 'drive_locked');
    const next = new Date(deadline);
    if (next <= new Date()) throw badRequest('The new deadline must be in the future', [{ field: 'deadline', message: 'Must be in the future' }]);
    await ctx.db.tx(async (ex) => {
      await drives.setDeadline(id, next, user.id, ex);
      await recordAudit(user, {
        action: 'drive.deadline_extended', targetType: 'drive', targetId: id, collegeId: d.collegeId,
        oldValue: { deadline: d.deadline, status: d.status }, newValue: { deadline: next.toISOString(), reason },
      }, ex);
    });
    return this.getForStaff(user, id);
  },

  async getForStaff(user, id) {
    const { d, skills, eligibility } = await loadDrive(id);
    assertCollegeAccess(user, d.collegeId);
    const counts = await applications.countsByStatus(id);
    return { ...publicDrive(d, skills, eligibility), pipelineCounts: counts };
  },

  async listForStaff(user, query, paging) {
    const collegeId = scopeCollege(user, query.collegeId);
    await drives.closeExpired(collegeId);
    const { items, total } = await drives.list({
      collegeId, status: query.status, companyId: query.companyId,
      q: query.q ? likePattern(query.q) : null, limit: paging.limit, offset: paging.offset,
    });
    return pageResult(items.map((d) => publicDrive(d)), total, paging);
  },

  // ---- student-facing ------------------------------------------------------
  async listForStudent(user, query, paging) {
    await drives.closeExpired(user.collegeId);
    const { items, total } = await drives.list({
      collegeId: user.collegeId, statuses: query.status ? [query.status] : ['open', 'closed', 'completed'],
      q: query.q ? likePattern(query.q) : null, limit: paging.limit, offset: paging.offset,
    });
    const ids = items.map((d) => d.id);
    const [skills, elig, sp, apps, exs] = await Promise.all([
      drives.skillsForDrives(ids), drives.eligibilityForDrives(ids), students.findByUserId(user.id),
      applications.listByStudent(user.id), exceptions.listByStudent(user.id),
    ]);
    const appByDrive = new Map(apps.map((a) => [a.driveId, a]));
    const exByDrive = new Map();
    for (const e of exs) if (!exByDrive.has(e.driveId)) exByDrive.set(e.driveId, e);

    const view = items.map((d) => {
      const evaluation = evaluateRow(sp, elig.get(d.id));
      return {
        ...publicDrive(d, skills.get(d.id), elig.get(d.id)),
        eligibilityResult: { status: evaluation.status, summary: evaluation.summary },
        application: appByDrive.get(d.id) ? { id: appByDrive.get(d.id).id, status: appByDrive.get(d.id).status } : null,
        exception: exByDrive.get(d.id) ? { id: exByDrive.get(d.id).id, status: exByDrive.get(d.id).status } : null,
      };
    });
    return pageResult(view, total, paging);
  },

  async getForStudent(user, id) {
    const { d, skills, eligibility } = await loadDrive(id);
    if (d.collegeId !== user.collegeId || d.status === 'draft' || d.status === 'cancelled') throw notFound('Drive not found');
    const sp = await students.findByUserId(user.id);
    const [app, ex] = await Promise.all([
      applications.findByStudentDrive(user.id, id), exceptions.latestForStudentDrive(user.id, id),
    ]);
    const evaluation = evaluateRow(sp, eligibility);
    const deadlinePassed = new Date(d.deadline) <= new Date();
    const verified = sp.verificationStatus === 'verified';
    const hasLiveApplication = !!app && app.status !== 'withdrawn';
    const windowOpen = d.status === 'open' && !deadlinePassed && verified;
    const canApply = windowOpen && !hasLiveApplication && (evaluation.status === 'eligible' || ex?.status === 'approved');
    return {
      ...publicDrive(d, skills, eligibility),
      eligibilityResult: evaluation,
      application: app ? { id: app.id, status: app.status, viaException: app.viaException, appliedAt: app.appliedAt } : null,
      exception: ex ? { id: ex.id, status: ex.status, reason: ex.reason, decisionNote: ex.decisionNote, decidedAt: ex.decidedAt } : null,
      verificationStatus: sp.verificationStatus,
      canApply,
      canRequestException:
        windowOpen && evaluation.status === 'ineligible' && !hasLiveApplication && (!ex || ['rejected', 'withdrawn'].includes(ex.status)),
    };
  },

  /** Per-student eligibility for a drive (placement cell monitoring). Deterministic. */
  async eligibilityReport(user, id, query) {
    const { d, eligibility } = await loadDrive(id);
    assertCollegeAccess(user, d.collegeId);
    const all = await students.listAllForCollege(d.collegeId);
    const rows = all.map((s) => {
      const ev = evaluateRow(s, eligibility);
      return {
        studentId: s.userId, name: s.fullName, email: s.email, department: s.department, rollNumber: s.rollNumber,
        passingYear: s.passingYear, cgpa: s.cgpa, activeBacklogs: s.activeBacklogs,
        verification: s.verificationStatus, eligibility: ev.status, failed: ev.failed, unavailable: ev.unavailable,
        reasons: ev.criteria.filter((c) => ['fail', 'unavailable'].includes(c.state)).map((c) => c.reason),
      };
    });
    const summary = { eligible: 0, ineligible: 0, incomplete: 0, total: rows.length };
    const failedBy = {};
    for (const r of rows) {
      summary[r.eligibility] += 1;
      for (const k of r.failed) failedBy[k] = (failedBy[k] ?? 0) + 1;
    }
    const filtered = query.status ? rows.filter((r) => r.eligibility === query.status) : rows;
    return { driveId: id, summary, failedBy, students: filtered };
  },

  /** Ensures staff-only operations are not reachable by students (defence in depth for services). */
  assertStaff(user) {
    if (!['admin', 'placement_cell'].includes(user.role)) throw forbidden();
  },
};

import { ctx } from '../context.js';
import { drives } from '../repositories/drives.js';
import { students } from '../repositories/students.js';
import { profiles } from '../repositories/users.js';
import { applications, exceptions, interviews } from '../repositories/applications.js';
import { evaluateRow } from './drives.js';
import { assertCollegeAccess, notify, notifyMany, recordAudit, scopeCollege } from './common.js';
import { badRequest, conflict, forbidden, isUniqueViolation, notFound, unprocessable } from '../utils/errors.js';
import { likePattern, pageResult } from '../utils/helpers.js';

const WITHDRAWABLE = ['applied', 'under_review', 'shortlisted', 'interview_scheduled'];

// Staff-driven transitions. AI never changes a status; `withdrawn` is student-only.
const STAFF_TRANSITIONS = {
  applied: ['under_review', 'shortlisted', 'rejected'],
  under_review: ['shortlisted', 'rejected'],
  shortlisted: ['under_review', 'interview_scheduled', 'selected', 'rejected'],
  interview_scheduled: ['shortlisted', 'selected', 'rejected'],
  rejected: ['under_review'],
  selected: [],
  withdrawn: [],
};

const STATUS_LABEL = {
  under_review: 'is under review',
  shortlisted: 'has been shortlisted',
  interview_scheduled: 'has an interview scheduled',
  selected: 'has been selected',
  rejected: 'was not taken forward',
};

/** Shared guard: a drive the student may act on right now. */
function assertDriveOpenFor(student, drive) {
  if (!drive || drive.collegeId !== student.collegeId || ['draft', 'cancelled'].includes(drive.status)) {
    throw notFound('Drive not found');
  }
  if (drive.status !== 'open') throw conflict('This drive is not open for applications', 'drive_not_open');
  if (new Date(drive.deadline) <= new Date()) throw conflict('The application deadline has passed', 'deadline_passed');
}

const snapshotOf = (evaluation, extra = {}) => ({
  evaluatedAt: new Date().toISOString(),
  status: evaluation.status,
  criteria: evaluation.criteria,
  summary: evaluation.summary,
  ...extra,
});

export const applicationService = {
  /**
   * Apply to a drive. Every gate is enforced here (and the one-per-drive rule also by a DB constraint):
   * account active (middleware) -> same college -> drive open -> before deadline -> profile verified ->
   * eligible OR approved exception.
   */
  async apply(user, driveId) {
    try {
      return await ctx.db.tx(async (ex) => {
        const drive = await drives.lock(driveId, ex);
        assertDriveOpenFor(user, drive);

        const sp = await students.findByUserId(user.id, ex);
        if (!sp) throw notFound('Student profile not found');
        if (sp.verificationStatus !== 'verified') {
          throw forbidden('Your profile must be verified by the placement cell before you can apply', 'profile_not_verified');
        }

        const eligibility = await drives.eligibility(driveId, ex);
        const evaluation = evaluateRow(sp, eligibility);

        let viaException = false;
        let exceptionRequestId = null;
        if (evaluation.status !== 'eligible') {
          const approved = await exceptions.findActive(user.id, driveId, ex);
          if (approved?.status === 'approved') {
            await exceptions.lock(approved.id, ex);
            viaException = true;
            exceptionRequestId = approved.id;
          } else if (evaluation.status === 'incomplete') {
            throw unprocessable('Complete your profile to check eligibility before applying', 'profile_incomplete', {
              missing: evaluation.unavailable,
              criteria: evaluation.criteria,
            });
          } else {
            throw forbidden('You do not meet the eligibility criteria for this drive', 'not_eligible', evaluation);
          }
        }

        const existing = await applications.findByStudentDrive(user.id, driveId, ex);
        if (existing && existing.status !== 'withdrawn') throw conflict('You have already applied to this drive', 'already_applied');

        let app;
        const snapshot = snapshotOf(evaluation, { viaException, exceptionRequestId });
        if (existing) {
          // re-apply after a withdrawal: reuse the row (unique per student+drive)
          await ex.query(
            `update applications set status = 'applied', via_exception = $2, exception_request_id = $3,
                    eligibility_snapshot = $4::jsonb, applied_at = now() where id = $1`,
            [existing.id, viaException, exceptionRequestId, JSON.stringify(snapshot)],
          );
          app = await applications.findById(existing.id, ex);
          await applications.addHistory({ applicationId: app.id, fromStatus: 'withdrawn', toStatus: 'applied', changedBy: user.id, note: 'Re-applied' }, ex);
        } else {
          app = await applications.insert({
            studentId: user.id, driveId, collegeId: drive.collegeId, viaException, exceptionRequestId, snapshot,
          }, ex);
          await applications.addHistory({
            applicationId: app.id, fromStatus: null, toStatus: 'applied', changedBy: user.id,
            note: viaException ? 'Applied via approved exception' : 'Applied',
          }, ex);
        }
        return { id: app.id, driveId, status: 'applied', viaException };
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('You have already applied to this drive', 'already_applied');
      throw err;
    }
  },

  listMine: (user) => applications.listByStudent(user.id),

  async getForUser(user, id) {
    const app = await applications.findById(id);
    if (!app) throw notFound('Application not found');
    if (user.role === 'student') {
      if (app.studentId !== user.id) throw notFound('Application not found');
    } else assertCollegeAccess(user, app.collegeId);
    return { ...app, history: await applications.history(id) };
  },

  async withdraw(user, id) {
    return ctx.db.tx(async (ex) => {
      const app = await applications.lock(id, ex);
      if (!app || app.studentId !== user.id) throw notFound('Application not found');
      if (!WITHDRAWABLE.includes(app.status)) {
        throw conflict(app.status === 'withdrawn' ? 'Already withdrawn' : 'A decision has already been made on this application', 'not_withdrawable');
      }
      await applications.setStatus(id, 'withdrawn', ex);
      await applications.addHistory({ applicationId: id, fromStatus: app.status, toStatus: 'withdrawn', changedBy: user.id, note: 'Withdrawn by student' }, ex);
      await ex.query("update interviews set status = 'cancelled' where application_id = $1 and status = 'scheduled'", [id]);
      return { id, status: 'withdrawn' };
    });
  },

  // ---- staff ---------------------------------------------------------------
  async listForStaff(user, query, paging) {
    const { items, total } = await applications.listForStaff({
      collegeId: scopeCollege(user, query.collegeId), driveId: query.driveId, status: query.status,
      q: query.q ? likePattern(query.q) : null, limit: paging.limit, offset: paging.offset,
    });
    return pageResult(items, total, paging);
  },

  /** Staff decision. Audited, history-logged, student notified. */
  async setStatus(actor, id, { status, note }) {
    return ctx.db.tx(async (ex) => {
      const app = await applications.lock(id, ex);
      if (!app) throw notFound('Application not found');
      assertCollegeAccess(actor, app.collegeId);
      if (!(STAFF_TRANSITIONS[app.status] ?? []).includes(status)) {
        throw conflict(`An application that is ${app.status} cannot be moved to ${status}`, 'invalid_transition');
      }
      await applications.setStatus(id, status, ex);
      await applications.addHistory({ applicationId: id, fromStatus: app.status, toStatus: status, changedBy: actor.id, note }, ex);
      await recordAudit(actor, {
        action: 'application.status_changed', targetType: 'application', targetId: id, collegeId: app.collegeId,
        oldValue: { status: app.status }, newValue: { status, note: note ?? null },
      }, ex);
      const drive = await drives.findById(app.driveId, ex);
      await notify(ex, {
        userId: app.studentId, type: 'application_status',
        title: `Application update: ${drive.title}`,
        body: `Your application to ${drive.companyName} ${STATUS_LABEL[status] ?? `is now ${status}`}.${note ? ` Note: ${note}` : ''}`,
        link: '/student/applications',
      });
      return { id, status };
    });
  },

  /** Manual order override for a drive's shortlist (placement-cell judgement beats the AI order). */
  async setOrder(actor, driveId, ids) {
    const drive = await drives.findById(driveId);
    if (!drive) throw notFound('Drive not found');
    assertCollegeAccess(actor, drive.collegeId);
    await ctx.db.tx(async (ex) => {
      await applications.setManualRanks(driveId, ids, ex);
      await recordAudit(actor, { action: 'ranking.manual_order_set', targetType: 'drive', targetId: driveId, collegeId: drive.collegeId, newValue: { count: ids.length } }, ex);
    });
    return { driveId, count: ids.length };
  },
};

// ===========================================================================
// exception requests
// ===========================================================================
export const exceptionService = {
  async create(user, { driveId, reason }) {
    try {
      return await ctx.db.tx(async (ex) => {
        const drive = await drives.lock(driveId, ex);
        assertDriveOpenFor(user, drive);
        const sp = await students.findByUserId(user.id, ex);
        if (sp.verificationStatus !== 'verified') {
          throw forbidden('Your profile must be verified before you can request an exception', 'profile_not_verified');
        }
        const eligibility = await drives.eligibility(driveId, ex);
        const evaluation = evaluateRow(sp, eligibility);
        if (evaluation.status === 'eligible') throw conflict('You are already eligible; you can apply directly', 'already_eligible');
        if (evaluation.status === 'incomplete') {
          throw unprocessable('Complete your profile first so eligibility can be determined', 'profile_incomplete', { missing: evaluation.unavailable });
        }
        const app = await applications.findByStudentDrive(user.id, driveId, ex);
        if (app && app.status !== 'withdrawn') throw conflict('You have already applied to this drive', 'already_applied');

        const row = await exceptions.insert({
          studentId: user.id, driveId, collegeId: drive.collegeId, reason: reason.trim(), snapshot: snapshotOf(evaluation),
        }, ex);
        const staff = await profiles.listByCollegeAndRole(drive.collegeId, 'placement_cell', ex);
        await notifyMany(ex, staff.map((s) => s.id), {
          type: 'exception_request',
          title: 'New exception request',
          body: `${user.fullName} requested an exception for ${drive.title}.`,
          link: '/placement/exceptions',
        });
        return row;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('You already have an active exception request for this drive', 'exception_already_active');
      throw err;
    }
  },

  listMine: (user) => exceptions.listByStudent(user.id),

  async withdraw(user, id) {
    return ctx.db.tx(async (ex) => {
      const r = await exceptions.lock(id, ex);
      if (!r || r.studentId !== user.id) throw notFound('Request not found');
      if (r.status !== 'pending') throw conflict('Only pending requests can be withdrawn', 'not_pending');
      return exceptions.withdraw(id, ex);
    });
  },

  async listForStaff(user, query, paging) {
    const { items, total } = await exceptions.listForStaff({
      collegeId: scopeCollege(user, query.collegeId), status: query.status, driveId: query.driveId,
      limit: paging.limit, offset: paging.offset,
    });
    return pageResult(items, total, paging);
  },

  async get(user, id) {
    const r = await exceptions.findById(id);
    if (!r) throw notFound('Request not found');
    if (user.role === 'student') {
      if (r.studentId !== user.id) throw notFound('Request not found');
    } else assertCollegeAccess(user, r.collegeId);
    return r;
  },

  /**
   * Approve/reject. Approval never edits the original eligibility result; it only unlocks applying.
   * The decision, its audit row and the notification commit together.
   */
  async decide(actor, id, { decision, note }) {
    if (decision === 'rejected' && !note?.trim()) {
      throw badRequest('Please give the student a reason', [{ field: 'note', message: 'A decision note is required when rejecting' }]);
    }
    return ctx.db.tx(async (ex) => {
      const r = await exceptions.lock(id, ex);
      if (!r) throw notFound('Request not found');
      assertCollegeAccess(actor, r.collegeId);
      if (r.status !== 'pending') throw conflict(`This request is already ${r.status}`, 'not_pending');
      const drive = await drives.findById(r.driveId, ex);
      const updated = await exceptions.decide(id, { status: decision, note, by: actor.id }, ex);
      await recordAudit(actor, {
        action: `exception.${decision}`, targetType: 'exception_request', targetId: id, collegeId: r.collegeId,
        oldValue: { status: 'pending' }, newValue: { status: decision, note: note ?? null, studentId: r.studentId, driveId: r.driveId },
      }, ex);
      await notify(ex, {
        userId: r.studentId, type: 'exception_decision',
        title: decision === 'approved' ? 'Exception approved' : 'Exception not approved',
        body:
          decision === 'approved'
            ? `Your exception for ${drive.title} was approved. You can now apply before the deadline.${note ? ` Note: ${note}` : ''}`
            : `Your exception for ${drive.title} was not approved. ${note}`,
        link: `/student/drives/${r.driveId}`,
      });
      return updated;
    });
  },
};

// ===========================================================================
// interviews
// ===========================================================================
export const interviewService = {
  async schedule(actor, input) {
    return ctx.db.tx(async (ex) => {
      const app = await applications.lock(input.applicationId, ex);
      if (!app) throw notFound('Application not found');
      assertCollegeAccess(actor, app.collegeId);
      if (!['shortlisted', 'interview_scheduled'].includes(app.status)) {
        throw conflict('Interviews can only be scheduled for shortlisted candidates', 'not_shortlisted');
      }
      const row = await interviews.insert({
        applicationId: app.id, driveId: app.driveId, studentId: app.studentId, collegeId: app.collegeId,
        roundName: input.roundName, scheduledAt: input.scheduledAt, mode: input.mode, venueOrLink: input.venueOrLink,
        notes: input.notes, createdBy: actor.id,
      }, ex);
      if (app.status === 'shortlisted') {
        await applications.setStatus(app.id, 'interview_scheduled', ex);
        await applications.addHistory({ applicationId: app.id, fromStatus: 'shortlisted', toStatus: 'interview_scheduled', changedBy: actor.id, note: `Interview: ${input.roundName}` }, ex);
      }
      const drive = await drives.findById(app.driveId, ex);
      await notify(ex, {
        userId: app.studentId, type: 'interview_scheduled',
        title: `Interview scheduled: ${drive.companyName}`,
        body: `${input.roundName} on ${new Date(input.scheduledAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} (${input.mode}).`,
        link: '/student/interviews',
      });
      return row;
    });
  },

  async update(actor, id, patch) {
    const row = await interviews.findById(id);
    if (!row) throw notFound('Interview not found');
    assertCollegeAccess(actor, row.collegeId);
    const updated = await interviews.update(id, patch);
    if (patch.scheduledAt || patch.status === 'cancelled') {
      await notify(null, {
        userId: row.studentId, type: 'interview_updated',
        title: patch.status === 'cancelled' ? 'Interview cancelled' : 'Interview rescheduled',
        body: patch.status === 'cancelled' ? 'One of your interviews was cancelled.' : 'The time of one of your interviews changed. Please check the details.',
        link: '/student/interviews',
      });
    }
    return updated;
  },

  listMine: (user) => interviews.listByStudent(user.id),

  async listForStaff(user, query, paging) {
    const { items, total } = await interviews.listForStaff({
      collegeId: scopeCollege(user, query.collegeId), driveId: query.driveId, upcomingOnly: query.upcoming,
      limit: paging.limit, offset: paging.offset,
    });
    return pageResult(items, total, paging);
  },
};

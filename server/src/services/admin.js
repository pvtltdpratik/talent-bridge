import { ctx } from '../context.js';
import { colleges, invitations, profiles } from '../repositories/users.js';
import { students } from '../repositories/students.js';
import { audit, settings as settingsRepo } from '../repositories/system.js';
import { getSettings, invalidateSettingsCache, notify, recordAudit, SETTING_DEFAULTS } from './common.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { likePattern, pageResult, randomToken, sha256 } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';

// Allowed account-status transitions (admin decisions only).
const STATUS_TRANSITIONS = {
  pending: ['active', 'rejected'],
  active: ['suspended'],
  suspended: ['active'],
  rejected: ['active'],
};

export const adminService = {
  async listUsers(query, paging) {
    const { items, total } = await profiles.list({
      role: query.role, status: query.status, collegeId: query.collegeId,
      q: query.q ? likePattern(query.q) : null, limit: paging.limit, offset: paging.offset,
    });
    return pageResult(items.map(({ statusReason, ...u }) => ({ ...u, statusReason })), total, paging);
  },

  /** approve / reject / suspend / reactivate. Always audited. */
  async setUserStatus(actor, userId, { status, reason }) {
    if (userId === actor.id) throw forbidden('You cannot change your own account status');
    return ctx.db.tx(async (ex) => {
      const target = await profiles.lock(userId, ex);
      if (!target) throw notFound('User not found');
      if (target.status === status) throw conflict(`User is already ${status}`, 'no_change');
      if (!STATUS_TRANSITIONS[target.status]?.includes(status)) {
        throw conflict(`Cannot change a ${target.status} account to ${status}`, 'invalid_transition');
      }
      if (['rejected', 'suspended'].includes(status) && !reason?.trim()) {
        throw badRequest('A reason is required', [{ field: 'reason', message: 'Reason is required' }]);
      }
      if (target.role === 'admin' && status === 'suspended' && (await profiles.countActiveAdmins(ex)) <= 1) {
        throw conflict('You cannot suspend the last active administrator', 'last_admin');
      }
      const updated = await profiles.setStatus(userId, { status, reason }, ex);
      await recordAudit(actor, {
        action: `account.${status === 'active' ? (target.status === 'pending' ? 'approved' : 'reactivated') : status}`,
        targetType: 'profile', targetId: userId, collegeId: target.collegeId,
        oldValue: { status: target.status }, newValue: { status, reason: reason ?? null },
      }, ex);
      const text = {
        active: target.status === 'pending' ? ['Account approved', 'Your placement cell account has been approved. You can now use the platform.'] : ['Account reactivated', 'Your account has been reactivated.'],
        rejected: ['Registration not approved', `Your registration was not approved. Reason: ${reason}`],
        suspended: ['Account suspended', `Your account was suspended. Reason: ${reason}`],
      }[status];
      await notify(ex, { userId, type: 'account_status', title: text[0], body: text[1], link: '/', email: target.email });
      return updated;
    });
  },

  /** Role changes are admin-only and audited. */
  async setUserRole(actor, userId, { role, collegeId }) {
    if (userId === actor.id) throw forbidden('You cannot change your own role');
    return ctx.db.tx(async (ex) => {
      const target = await profiles.lock(userId, ex);
      if (!target) throw notFound('User not found');
      if (target.role === role) throw conflict(`User is already ${role}`, 'no_change');
      if (target.role === 'admin' && target.status === 'active' && (await profiles.countActiveAdmins(ex)) <= 1) {
        throw conflict('You cannot demote the last active administrator', 'last_admin');
      }
      const newCollege = collegeId ?? target.collegeId;
      if (role !== 'admin') {
        if (!newCollege) throw badRequest('collegeId is required for this role', [{ field: 'collegeId', message: 'Required' }]);
        if (!(await colleges.findById(newCollege, ex))) throw badRequest('Unknown college');
        if (newCollege !== target.collegeId) await ex.query('update profiles set college_id = $2 where id = $1', [userId, newCollege]);
      }
      const updated = await profiles.setRole(userId, role, ex);
      if (role === 'student') await students.ensure(userId, newCollege, ex);
      await recordAudit(actor, {
        action: 'role.changed', targetType: 'profile', targetId: userId, collegeId: newCollege,
        oldValue: { role: target.role }, newValue: { role },
      }, ex);
      await notify(ex, { userId, type: 'role_changed', title: 'Your role changed', body: `Your role is now ${role.replace('_', ' ')}.`, link: '/' });
      return updated;
    });
  },

  async createAdmin(actor, { email, fullName, password }) {
    if (await profiles.findByEmail(email)) throw conflict('An account with this email already exists', 'email_taken');
    const { userId } = await ctx.authAdmin.createUser({ email: email.toLowerCase(), password, metadata: { full_name: fullName } });
    try {
      await ctx.db.tx(async (ex) => {
        await profiles.insert({ id: userId, email, fullName, role: 'admin', status: 'active', collegeId: null, consentAt: new Date() }, ex);
        await recordAudit(actor, { action: 'admin.created', targetType: 'profile', targetId: userId, newValue: { email } }, ex);
      });
    } catch (err) {
      await ctx.authAdmin.deleteUser(userId).catch(() => {});
      throw err;
    }
    return profiles.findById(userId);
  },

  // ---- invitations ------------------------------------------------------
  async createInvitation(actor, { email, collegeId }) {
    if (!(await colleges.findById(collegeId))) throw badRequest('Unknown college', [{ field: 'collegeId', message: 'Unknown college' }]);
    if (await profiles.findByEmail(email)) throw conflict('An account with this email already exists', 'email_taken');
    const settings = await getSettings();
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + settings.invite_expiry_days * 86_400_000);

    const invitation = await ctx.db.tx(async (ex) => {
      // a new invite replaces any outstanding one for the same email
      await ex.query(
        `update placement_cell_invitations set revoked_at = now()
          where lower(email) = lower($1) and accepted_at is null and revoked_at is null`,
        [email],
      );
      const inv = await invitations.insert({ email, collegeId, tokenHash: sha256(token), invitedBy: actor.id, expiresAt }, ex);
      await recordAudit(actor, { action: 'invitation.created', targetType: 'invitation', targetId: inv.id, collegeId, newValue: { email, expiresAt } }, ex);
      return inv;
    });

    const inviteUrl = `${ctx.env.CLIENT_URL}/accept-invite?token=${token}`;
    if (ctx.mailer?.enabled) {
      ctx.mailer.send({
        to: email, subject: 'You are invited to TalentBridge AI',
        text: `You have been invited as a placement cell member.\n\nAccept the invitation (valid until ${expiresAt.toDateString()}): ${inviteUrl}`,
      }).catch((e) => logger.warn('invite mail failed', { error: e.message }));
    }
    // The token is only ever returned here, once. Only its hash is stored.
    return { id: invitation.id, email: invitation.email, collegeId, expiresAt, inviteUrl, emailed: !!ctx.mailer?.enabled };
  },

  async listInvitations(paging) {
    const { items, total } = await invitations.list(paging);
    const now = Date.now();
    return pageResult(
      items.map((i) => ({
        ...i,
        state: i.acceptedAt ? 'accepted' : i.revokedAt ? 'revoked' : new Date(i.expiresAt).getTime() < now ? 'expired' : 'pending',
      })),
      total,
      paging,
    );
  },

  async revokeInvitation(actor, id) {
    const inv = await invitations.revoke(id);
    if (!inv) throw notFound('Invitation not found or no longer revocable');
    await recordAudit(actor, { action: 'invitation.revoked', targetType: 'invitation', targetId: id, collegeId: inv.collegeId, oldValue: { email: inv.email } });
    return { revoked: true };
  },

  // ---- colleges ---------------------------------------------------------
  listColleges: () => colleges.list(),
  async createCollege(actor, data) {
    const row = await colleges.insert(data);
    await recordAudit(actor, { action: 'college.created', targetType: 'college', targetId: row.id, newValue: data });
    return row;
  },
  async updateCollege(actor, id, data) {
    const old = await colleges.findById(id);
    if (!old) throw notFound('College not found');
    const row = await colleges.update(id, data);
    await recordAudit(actor, { action: 'college.updated', targetType: 'college', targetId: id, oldValue: { name: old.name, code: old.code, city: old.city }, newValue: data });
    return row;
  },

  // ---- audit log --------------------------------------------------------
  async listAudit(query, paging) {
    const { items, total } = await audit.list({ ...query, limit: paging.limit, offset: paging.offset });
    return pageResult(items, total, paging);
  },

  // ---- settings ---------------------------------------------------------
  async getSettings() {
    return { settings: await getSettings(), defaults: SETTING_DEFAULTS };
  },
  async updateSettings(actor, patch) {
    const before = await getSettings();
    await ctx.db.tx(async (ex) => {
      for (const [key, value] of Object.entries(patch)) {
        await settingsRepo.upsert(key, value, actor.id, ex);
      }
      await recordAudit(actor, {
        action: 'settings.updated', targetType: 'system_settings',
        oldValue: Object.fromEntries(Object.keys(patch).map((k) => [k, before[k]])), newValue: patch,
      }, ex);
    });
    invalidateSettingsCache();
    return getSettings();
  },
};

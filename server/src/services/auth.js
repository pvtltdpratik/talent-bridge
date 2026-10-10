import { ctx } from '../context.js';
import { colleges, invitations, profiles } from '../repositories/users.js';
import { students } from '../repositories/students.js';
import { resumes } from '../repositories/students.js';
import { notifyMany, recordAudit } from './common.js';
import { badRequest, conflict, forbidden, notFound, AppError } from '../utils/errors.js';
import { sha256 } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';

const publicUser = (p) => ({
  id: p.id,
  email: p.email,
  fullName: p.fullName,
  phone: p.phone ?? null,
  role: p.role,
  status: p.status,
  statusReason: p.statusReason ?? null,
  collegeId: p.collegeId ?? null,
  collegeName: p.collegeName ?? null,
});

async function createAccount({ role, status, input, collegeId, ip }) {
  const email = input.email.trim().toLowerCase();
  if (await profiles.findByEmail(email)) throw conflict('An account with this email already exists', 'email_taken');

  const { userId, session } = await ctx.authAdmin.signUp({ email, password: input.password, metadata: { full_name: input.fullName } });
  try {
    await ctx.db.tx(async (ex) => {
      await profiles.insert(
        { id: userId, email, fullName: input.fullName.trim(), phone: input.phone ?? null, role, status, collegeId, consentAt: new Date() },
        ex,
      );
      if (role === 'student') await students.ensure(userId, collegeId, ex);
      await recordAudit({ id: userId, role, ip }, { action: `${role}.registered`, targetType: 'profile', targetId: userId, collegeId, newValue: { role, status } }, ex);
    });
  } catch (err) {
    // keep Supabase Auth and our profiles table consistent
    await ctx.authAdmin.deleteUser(userId).catch((e) => logger.error('rollback of auth user failed', { error: e.message }));
    throw err;
  }
  return { userId, session, email };
}

async function requireCollege(collegeId) {
  const college = await colleges.findById(collegeId);
  if (!college) throw badRequest('Please choose a valid college', [{ field: 'collegeId', message: 'Unknown college' }]);
  return college;
}

export const authService = {
  async listColleges() {
    return (await colleges.list()).map((c) => ({ id: c.id, name: c.name, city: c.city }));
  },

  /** Student self-registration. The role is fixed here, never taken from the request. */
  async registerStudent(input, ip) {
    await requireCollege(input.collegeId);
    const { userId, session } = await createAccount({ role: 'student', status: 'active', input, collegeId: input.collegeId, ip });
    const user = await profiles.findById(userId);
    return {
      user: publicUser(user),
      session,
      message: session
        ? 'Account created.'
        : 'Account created. Please confirm your email address (check your inbox), then sign in.',
    };
  },

  /** Placement-cell self-registration: lands in `pending` until an admin approves. */
  async registerPlacementCell(input, ip) {
    await requireCollege(input.collegeId);
    const { userId } = await createAccount({ role: 'placement_cell', status: 'pending', input, collegeId: input.collegeId, ip });
    const admins = await profiles.listActiveAdmins();
    await notifyMany(null, admins.map((a) => a.id), {
      type: 'approval_needed',
      title: 'New placement cell registration',
      body: `${input.fullName} has requested placement cell access.`,
      link: '/admin/approvals',
    });
    const user = await profiles.findById(userId);
    return {
      user: publicUser(user),
      message: 'Registration received. An administrator must approve your account before you can sign in to the placement area.',
    };
  },

  async inviteInfo(token) {
    const inv = await invitations.findByHash(sha256(token));
    if (!inv || inv.revokedAt || inv.acceptedAt || new Date(inv.expiresAt) < new Date()) {
      throw notFound('This invitation is invalid, expired or has already been used');
    }
    return { email: inv.email, collegeName: inv.collegeName, expiresAt: inv.expiresAt };
  },

  /** Invitation acceptance: single-use, expiring, bound to the invited email. */
  async acceptInvite({ token, password, fullName, phone }, ip) {
    const tokenHash = sha256(token);
    const inv = await invitations.findByHash(tokenHash);
    if (!inv || inv.revokedAt || inv.acceptedAt || new Date(inv.expiresAt) < new Date()) {
      throw new AppError(410, 'invite_invalid', 'This invitation is invalid, expired or has already been used');
    }
    if (await profiles.findByEmail(inv.email)) throw conflict('An account with this email already exists', 'email_taken');

    // The invitation proves control of the email address, so the account is created pre-confirmed.
    const { userId } = await ctx.authAdmin.createUser({ email: inv.email, password, metadata: { full_name: fullName } });
    try {
      await ctx.db.tx(async (ex) => {
        const locked = await invitations.lockByHash(tokenHash, ex);
        if (!locked || locked.acceptedAt || locked.revokedAt || new Date(locked.expiresAt) < new Date()) {
          throw new AppError(410, 'invite_invalid', 'This invitation is invalid, expired or has already been used');
        }
        await profiles.insert(
          { id: userId, email: inv.email, fullName: fullName.trim(), phone: phone ?? null, role: 'placement_cell', status: 'active', collegeId: inv.collegeId, consentAt: new Date() },
          ex,
        );
        await invitations.markAccepted(inv.id, userId, ex);
        await recordAudit({ id: userId, role: 'placement_cell', ip }, { action: 'invitation.accepted', targetType: 'invitation', targetId: inv.id, collegeId: inv.collegeId, newValue: { email: inv.email } }, ex);
      });
    } catch (err) {
      await ctx.authAdmin.deleteUser(userId).catch(() => {});
      throw err;
    }
    return { message: 'Invitation accepted. You can now sign in.' };
  },

  async login({ email, password }) {
    const { userId, session } = await ctx.authAdmin.signIn({ email: email.trim().toLowerCase(), password });
    const profile = await profiles.findById(userId);
    if (!profile) throw forbidden('No TalentBridge profile exists for this account', 'profile_missing');
    return { user: publicUser(profile), session };
  },

  async refresh(refreshToken) {
    const { userId, session } = await ctx.authAdmin.refresh(refreshToken);
    const profile = await profiles.findById(userId);
    if (!profile) throw forbidden('No TalentBridge profile exists for this account', 'profile_missing');
    return { user: publicUser(profile), session };
  },

  async logout(token) {
    if (token) await ctx.authAdmin.signOut(token);
  },

  async forgotPassword(email) {
    try {
      await ctx.authAdmin.sendPasswordReset(email.trim().toLowerCase(), `${ctx.env.CLIENT_URL}/reset-password`);
    } catch (err) {
      logger.warn('password reset email failed', { error: err.message });
    }
    // Same answer whether or not the address exists (no account enumeration).
    return { message: 'If an account exists for this email, a reset link has been sent.' };
  },

  async resetPassword({ accessToken, password }) {
    const user = await ctx.authAdmin.userFromToken(accessToken);
    await ctx.authAdmin.setPassword(user.id, password);
    return { message: 'Password updated. You can now sign in.' };
  },

  async me(userId) {
    const p = await profiles.findById(userId);
    return publicUser(p);
  },

  /** Students may delete their account and all associated data (DPDP-style erasure). */
  async deleteOwnAccount(user) {
    if (user.role !== 'student') throw forbidden('Only student accounts can be deleted here. Ask an administrator.');
    const paths = await resumes.filePathsForStudent(user.id);
    await ctx.db.tx(async (ex) => {
      await recordAudit(user, { action: 'account.deleted', targetType: 'profile', targetId: user.id, collegeId: user.collegeId }, ex);
      await profiles.remove(user.id, ex); // cascades student data, applications, resumes metadata, notifications
    });
    await ctx.storage.remove(paths).catch((e) => logger.warn('storage cleanup failed', { error: e.message }));
    await ctx.authAdmin.deleteUser(user.id);
    return { message: 'Your account and data have been deleted.' };
  },
};

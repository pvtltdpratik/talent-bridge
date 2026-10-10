import { ctx } from '../context.js';
import { profiles } from '../repositories/users.js';
import { forbidden, unauthorized } from '../utils/errors.js';

const STATUS_MESSAGES = {
  pending: ['account_pending', 'Your account is awaiting approval by an administrator.'],
  rejected: ['account_rejected', 'Your registration was not approved.'],
  suspended: ['account_suspended', 'Your account has been suspended. Contact your administrator.'],
};

/**
 * Verifies the Supabase JWT, loads role/status/college from OUR profiles table (never from the token
 * or the request) and rejects any account that is not `active`.
 * `allowInactive` is only used by GET /auth/me so a pending user can learn their state.
 */
export function authenticate({ allowInactive = false } = {}) {
  return async (req, _res, next) => {
    const header = req.headers.authorization ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) throw unauthorized();

    const claims = await ctx.verifier.verify(match[1]);
    const profile = await profiles.findById(claims.sub);
    if (!profile) throw unauthorized('Account not found. Please register again.', 'profile_missing');

    if (profile.status !== 'active' && !allowInactive) {
      const [code, message] = STATUS_MESSAGES[profile.status] ?? ['account_inactive', 'Your account is not active.'];
      throw forbidden(message, code);
    }

    req.token = match[1];
    req.user = {
      id: profile.id,
      email: profile.email,
      fullName: profile.fullName,
      role: profile.role,
      status: profile.status,
      statusReason: profile.statusReason,
      collegeId: profile.collegeId,
      collegeName: profile.collegeName,
      ip: req.ip,
    };
    next();
  };
}

export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden('Your role cannot access this resource', 'role_forbidden');
    next();
  };

/** Shorthand for the staff area (placement cell + admin). */
export const requireStaff = requireRole('placement_cell', 'admin');

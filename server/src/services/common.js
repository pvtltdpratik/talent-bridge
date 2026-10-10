import { ctx, db } from '../context.js';
import { audit, notifications, settings as settingsRepo } from '../repositories/system.js';
import { DEFAULT_MATCH_WEIGHTS, DEFAULT_READINESS_WEIGHTS } from '../domain/scoring.js';
import { badRequest, notFound } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// audit + notifications
// ---------------------------------------------------------------------------
/** Writes an audit row. Pass the transaction executor so audit and change commit together. */
export function recordAudit(actor, entry, ex = db()) {
  return audit.insert({ actorId: actor?.id, actorRole: actor?.role, ip: actor?.ip, ...entry }, ex);
}

/** In-app notification; optional best-effort email when the mailer is enabled. */
export async function notify(ex, { userId, type, title, body, link, email }) {
  await notifications.insert({ userId, type, title, body, link }, ex ?? db());
  if (email && ctx.mailer?.enabled) {
    ctx.mailer.send({ to: email, subject: title, text: `${body ?? ''}\n\n${ctx.env?.CLIENT_URL ?? ''}${link ?? ''}` }).catch((e) => logger.warn('mail failed', { error: e.message }));
  }
}

export async function notifyMany(ex, userIds, { type, title, body, link }) {
  if (!userIds.length) return;
  await (ex ?? db()).query(
    `insert into notifications (user_id, type, title, body, link)
     select u, $2, $3, $4, $5 from unnest($1::uuid[]) as u`,
    [userIds, type, title, body ?? null, link ?? null],
  );
}

// ---------------------------------------------------------------------------
// college scoping
// ---------------------------------------------------------------------------
/**
 * Placement-cell users are pinned to their own college. Admin may pass a college or see everything (null).
 */
export function scopeCollege(user, requestedCollegeId) {
  if (user.role === 'admin') return requestedCollegeId ?? null;
  return user.collegeId;
}

/** 404 (not 403) for other colleges so the existence of foreign records is not disclosed. */
export function assertCollegeAccess(user, collegeId) {
  if (user.role === 'admin') return;
  if (!user.collegeId || user.collegeId !== collegeId) throw notFound();
}

/** College for creating a record: staff -> own; admin must name one. */
export function collegeForCreate(user, requestedCollegeId) {
  if (user.role !== 'admin') return user.collegeId;
  if (!requestedCollegeId) throw badRequest('collegeId is required when creating as an admin');
  return requestedCollegeId;
}

// ---------------------------------------------------------------------------
// system settings (admin-editable, cached briefly)
// ---------------------------------------------------------------------------
export const SETTING_DEFAULTS = {
  readiness_weights: DEFAULT_READINESS_WEIGHTS,
  match_weights: DEFAULT_MATCH_WEIGHTS,
  upload_max_mb: 5,
  ai_enabled: true,
  ai_user_hourly_limit: 30,
  invite_expiry_days: 7,
};

let cache = { at: 0, value: null };
export function invalidateSettingsCache() {
  cache = { at: 0, value: null };
}

export async function getSettings() {
  if (cache.value && Date.now() - cache.at < 15_000) return cache.value;
  const stored = await settingsRepo.all();
  const merged = { ...SETTING_DEFAULTS };
  for (const key of Object.keys(SETTING_DEFAULTS)) {
    if (stored[key] === undefined) continue;
    merged[key] = typeof SETTING_DEFAULTS[key] === 'object' ? { ...SETTING_DEFAULTS[key], ...stored[key] } : stored[key];
  }
  cache = { at: Date.now(), value: merged };
  return merged;
}

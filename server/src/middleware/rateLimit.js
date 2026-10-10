import rateLimit from 'express-rate-limit';

const DEFAULTS = {
  // per IP
  login: { windowMs: 15 * 60_000, limit: 10 },
  register: { windowMs: 60 * 60_000, limit: 15 },
  passwordReset: { windowMs: 60 * 60_000, limit: 5 },
  // per user
  upload: { windowMs: 60 * 60_000, limit: 20 },
  aiUser: { windowMs: 60 * 60_000, limit: 30 },
  // global
  aiGlobal: { windowMs: 60_000, limit: 120 },
  api: { windowMs: 60_000, limit: 600 },
};

const handler = (_req, res) =>
  res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests. Please slow down and try again shortly.' } });

/**
 * Builds the limiter set. `overrides` lets tests (or env) tune windows without touching routes.
 * Note: in-memory counters are per process. For several API instances use a shared store (Redis).
 */
export function createLimiters(overrides = {}, { getAiUserLimit } = {}) {
  const cfg = (name) => ({ ...DEFAULTS[name], ...(overrides[name] ?? {}) });
  const make = (name, extra = {}) =>
    rateLimit({ ...cfg(name), standardHeaders: 'draft-7', legacyHeaders: false, handler, ...extra });
  const byUser = (req) => req.user?.id ?? 'anonymous';

  return {
    api: make('api'),
    login: make('login'),
    register: make('register'),
    passwordReset: make('passwordReset'),
    upload: make('upload', { keyGenerator: byUser, validate: { keyGeneratorIpFallback: false } }),
    aiUser: make('aiUser', {
      keyGenerator: byUser,
      validate: { keyGeneratorIpFallback: false },
      // honour the admin-configurable per-user hourly limit when no explicit override is set
      limit: overrides.aiUser?.limit ?? (async () => (getAiUserLimit ? getAiUserLimit() : cfg('aiUser').limit)),
    }),
    aiGlobal: make('aiGlobal', { keyGenerator: () => 'global', validate: { keyGeneratorIpFallback: false } }),
  };
}

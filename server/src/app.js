import crypto from 'node:crypto';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { ctx } from './context.js';
import { createLimiters } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { buildRouter } from './routes/index.js';
import { getSettings } from './services/common.js';
import { logger } from './utils/logger.js';

/**
 * Builds the Express app. Everything environment specific comes from `ctx` / options, so tests can
 * create an app with in-memory fakes and custom rate limits.
 */
export function createApp({ env = ctx.env, limits = {} } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // number of trusted proxy hops for req.ip / rate limiting (see TRUST_PROXY)
  app.set('trust proxy', env.TRUST_PROXY ?? (env.NODE_ENV === 'production' ? 1 : 0));

  // Tolerate a doubled leading slash ("//api/..."). It appears when a front-end joins a base URL that
  // ends in "/" with "/api", and would otherwise 404 (without CORS headers, which then hides the real cause).
  app.use((req, _res, next) => {
    if (req.url.startsWith('//')) req.url = req.url.replace(/^\/{2,}/, '/');
    next();
  });

  app.use((req, res, next) => {
    req.id = req.headers['x-request-id']?.toString().slice(0, 64) || crypto.randomUUID();
    res.set('X-Request-Id', req.id);
    const started = Date.now();
    res.on('finish', () => {
      logger.info('request', { id: req.id, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started });
    });
    next();
  });

  app.use(helmet());
  // Origins are compared without a trailing slash and case-insensitively, so "https://app.vercel.app/" in
  // CORS_ORIGINS still matches the browser's "https://app.vercel.app".
  const normaliseOrigin = (s) => s.trim().replace(/\/+$/, '').toLowerCase();
  const allowed = env.CORS_ORIGINS.split(',').map(normaliseOrigin).filter(Boolean);
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || allowed.includes(normaliseOrigin(origin))),
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  const limiters = createLimiters(limits, { getAiUserLimit: async () => (await getSettings()).ai_user_hourly_limit });

  // Health: API + DB connectivity; reports whether AI is configured without exposing any key.
  const health = async (_req, res) => {
    let db = 'up';
    try {
      await ctx.db.query('select 1');
    } catch {
      db = 'down';
    }
    res.status(db === 'up' ? 200 : 503).json({
      status: db === 'up' ? 'ok' : 'degraded',
      time: new Date().toISOString(),
      db,
      ai: { configured: !!ctx.gemini?.configured },
      email: { enabled: !!ctx.mailer?.enabled },
    });
  };
  app.get('/health', health);
  app.get('/api/health', health);

  app.use('/api', limiters.api, buildRouter(limiters));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

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
  // behind Nginx in production: trust exactly one proxy hop for req.ip / rate limiting
  app.set('trust proxy', env.NODE_ENV === 'production' ? 1 : false);

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
  const allowed = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || allowed.includes(origin)),
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

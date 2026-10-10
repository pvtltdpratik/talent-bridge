import { createApp } from './app.js';
import { createGeminiClient } from './ai/gemini.js';
import { createMailer } from './adapters/mailer.js';
import { createSupabaseAuth } from './adapters/supabaseAuth.js';
import { createSupabaseStorage } from './adapters/storage.js';
import { createTokenVerifier } from './adapters/tokenVerifier.js';
import { assertRuntimeConfig, getEnv } from './config/env.js';
import { initContext } from './context.js';
import { createPgDb } from './db/index.js';
import { logger, setLogLevel } from './utils/logger.js';

const env = getEnv();
setLogLevel(env.LOG_LEVEL);
assertRuntimeConfig(env);

initContext({
  env,
  db: createPgDb({ connectionString: env.DATABASE_URL, ssl: env.DATABASE_SSL }),
  verifier: createTokenVerifier({ supabaseUrl: env.SUPABASE_URL, jwtSecret: env.SUPABASE_JWT_SECRET }),
  authAdmin: createSupabaseAuth({ url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY }),
  storage: createSupabaseStorage({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY, bucket: env.RESUME_BUCKET }),
  gemini: createGeminiClient({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL, timeoutMs: env.GEMINI_TIMEOUT_MS }),
  mailer: createMailer(env),
});

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info('TalentBridge API listening', {
    port: env.PORT,
    env: env.NODE_ENV,
    aiConfigured: !!env.GEMINI_API_KEY,
    emailEnabled: !!env.SMTP_HOST,
  });
});

const shutdown = (signal) => {
  logger.info('shutting down', { signal });
  server.close(async () => {
    try {
      const { ctx } = await import('./context.js');
      await ctx.db.end();
    } finally {
      process.exit(0);
    }
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error('unhandledRejection', { error: String(reason) }));

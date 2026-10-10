import { createApp } from './app.js';
import { createGeminiClient } from './ai/gemini.js';
import { createMailer } from './adapters/mailer.js';
import { createSupabaseAuth } from './adapters/supabaseAuth.js';
import { createSupabaseStorage } from './adapters/storage.js';
import { createLocalAuth } from './adapters/localAuth.js';
import { createLocalStorage } from './adapters/localStorage.js';
import { createTokenVerifier } from './adapters/tokenVerifier.js';
import { assertRuntimeConfig, getEnv } from './config/env.js';
import { initContext } from './context.js';
import { createPgDb } from './db/index.js';
import { logger, setLogLevel } from './utils/logger.js';

const env = getEnv();
setLogLevel(env.LOG_LEVEL);
assertRuntimeConfig(env);

const db = createPgDb({ connectionString: env.DATABASE_URL, ssl: env.DATABASE_SSL });
const mailer = createMailer(env);
const localAuth = env.AUTH_PROVIDER === 'local';
const localFiles = env.STORAGE_PROVIDER === 'local';

initContext({
  env,
  db,
  // local: tokens are HS256-signed with AUTH_JWT_SECRET and verified in-process; supabase: Supabase JWTs
  verifier: createTokenVerifier(
    localAuth ? { jwtSecret: env.AUTH_JWT_SECRET } : { supabaseUrl: env.SUPABASE_URL, jwtSecret: env.SUPABASE_JWT_SECRET },
  ),
  authAdmin: localAuth
    ? createLocalAuth({ db, jwtSecret: env.AUTH_JWT_SECRET, mailer })
    : createSupabaseAuth({ url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY }),
  storage: localFiles
    ? createLocalStorage({ dir: env.LOCAL_UPLOAD_DIR, secret: env.AUTH_JWT_SECRET, publicBaseUrl: env.PUBLIC_API_URL ?? '' })
    : createSupabaseStorage({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY, bucket: env.RESUME_BUCKET }),
  gemini: createGeminiClient({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL, timeoutMs: env.GEMINI_TIMEOUT_MS }),
  mailer,
});

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info('TalentBridge API listening', {
    port: env.PORT,
    env: env.NODE_ENV,
    auth: env.AUTH_PROVIDER,
    storage: env.STORAGE_PROVIDER,
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

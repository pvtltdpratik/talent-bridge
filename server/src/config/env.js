import 'dotenv/config';
import { z } from 'zod';

const bool = (def) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Number of reverse proxies in front of the API (0 when clients connect directly, 1 behind Nginx).
  // Unset: 1 in production, 0 otherwise. A wrong value lets clients spoof X-Forwarded-For past rate limits.
  TRUST_PROXY: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().min(0).max(5).optional()),

  // comma separated allow-list of browser origins
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  // public URL of the SPA, used in invitation / reset links
  CLIENT_URL: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().optional(),
  DATABASE_SSL: bool(true),

  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  // legacy HS256 projects only. If empty the project's JWKS is used.
  SUPABASE_JWT_SECRET: z.string().optional(),
  RESUME_BUCKET: z.string().default('resumes'),

  // Where identities and resume files live.
  //   supabase: Supabase Auth + Supabase Storage (needs the SUPABASE_* keys above)
  //   local:    email/password accounts stored in DATABASE_URL (schema "auth") + files on this server's disk
  AUTH_PROVIDER: z.enum(['supabase', 'local']).default('supabase'),
  STORAGE_PROVIDER: z.enum(['supabase', 'local']).default('supabase'),
  // HS256 signing key for local access tokens and signed file links. >= 32 random characters.
  AUTH_JWT_SECRET: z.string().optional(),
  LOCAL_UPLOAD_DIR: z.string().default('./uploads'),
  // optional absolute origin used when building signed file links (default: same-origin relative links)
  PUBLIC_API_URL: z.string().optional(),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().default(30000),

  // optional email (disabled unless SMTP_HOST is set)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  ENABLE_DEMO_ROUTES: bool(false),
});

let cached;

export function loadEnv(source = process.env) {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}

export function getEnv() {
  if (!cached) cached = loadEnv();
  return cached;
}

/** Fail fast in production when required infrastructure is not configured. */
export function assertRuntimeConfig(env) {
  const missing = [];
  if (!env.DATABASE_URL) missing.push('DATABASE_URL');
  if (env.AUTH_PROVIDER === 'supabase' || env.STORAGE_PROVIDER === 'supabase') {
    for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) if (!env[k]) missing.push(k);
  }
  if (env.AUTH_PROVIDER === 'supabase' && !env.SUPABASE_ANON_KEY) missing.push('SUPABASE_ANON_KEY');
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')} (see server/.env.example)`);
  }
  if ((env.AUTH_PROVIDER === 'local' || env.STORAGE_PROVIDER === 'local') && (env.AUTH_JWT_SECRET ?? '').length < 32) {
    throw new Error('AUTH_JWT_SECRET must be at least 32 characters when AUTH_PROVIDER or STORAGE_PROVIDER is "local"');
  }
}

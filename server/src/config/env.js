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
  for (const k of ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!env[k]) missing.push(k);
  }
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')} (see server/.env.example)`);
  }
}

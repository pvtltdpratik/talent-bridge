// Test harness: real Postgres SQL (PGlite), real JWT verification, in-memory Auth/Storage fakes,
// and a scriptable Gemini mock. No network, no paid calls.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { SignJWT } from 'jose';
import { createApp } from '../../src/app.js';
import { createTokenVerifier } from '../../src/adapters/tokenVerifier.js';
import { initContext } from '../../src/context.js';
import { invalidateSettingsCache } from '../../src/services/common.js';
import { AppError, conflict, unauthorized } from '../../src/utils/errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(here, '../../../supabase/migrations');
export const TEST_SIGNING_KEY = 'test-secret-test-secret-test-secret-123';

const BOOTSTRAP = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean default false);
  grant usage on schema public, auth to anon, authenticated;
  -- mimic Supabase: new public tables are granted to anon/authenticated by default
  alter default privileges in schema public grant all on tables to anon, authenticated;
`;

const STANDALONE = path.resolve(here, '../../../supabase/standalone/bootstrap.sql');

/** standalone: apply the real supabase/standalone/bootstrap.sql (as on RDS) instead of the Supabase-like stub. */
export async function createTestDb({ standalone = false } = {}) {
  const pg = new PGlite({ parsers: { 1700: (v) => Number.parseFloat(v), 20: (v) => Number.parseInt(v, 10), 1082: (v) => v } });
  await pg.exec(standalone ? fs.readFileSync(STANDALONE, 'utf8') : BOOTSTRAP);
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) await pg.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
  return {
    raw: pg,
    query: (text, params) => pg.query(text, params),
    tx: (fn) => pg.transaction(async (tx) => fn({ query: (t, p) => tx.query(t, p) })),
    end: () => pg.close(),
  };
}

/** In-memory stand-in for adapters/supabaseAuth.js, backed by auth.users so FKs are real. */
function createFakeAuth(db) {
  const users = new Map(); // email -> { id, password, confirmed }
  const sign = (id, email) =>
    new SignJWT({ email, aud: 'authenticated' }).setProtectedHeader({ alg: 'HS256' }).setSubject(id)
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(TEST_SIGNING_KEY));
  const sessionFor = async (id, email) => ({ accessToken: await sign(id, email), refreshToken: `refresh:${id}`, expiresIn: 3600 });
  const create = async (email, password, confirmed) => {
    if (users.has(email)) throw conflict('An account with this email already exists', 'email_taken');
    const id = crypto.randomUUID();
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
    users.set(email, { id, password, confirmed });
    return id;
  };
  return {
    users,
    sign,
    sessionFor,
    async signUp({ email, password }) {
      if (password.length < 8) throw new AppError(400, 'weak_password', 'Password is too short');
      const id = await create(email, password, true);
      return { userId: id, session: await sessionFor(id, email) };
    },
    async createUser({ email, password }) {
      return { userId: await create(email, password, true) };
    },
    async signIn({ email, password }) {
      const u = users.get(email);
      if (!u || u.password !== password) throw unauthorized('Incorrect email or password', 'invalid_credentials');
      return { userId: u.id, session: await sessionFor(u.id, email) };
    },
    async refresh(token) {
      const id = token.replace('refresh:', '');
      const email = [...users.entries()].find(([, v]) => v.id === id)?.[0];
      if (!email) throw unauthorized('Session expired', 'invalid_token');
      return { userId: id, session: await sessionFor(id, email) };
    },
    async sendPasswordReset() {},
    async userFromToken() { return { id: [...users.values()][0]?.id, email: 'x' }; },
    async setPassword() {},
    async deleteUser(id) {
      for (const [email, u] of users) if (u.id === id) users.delete(email);
      await db.query('delete from auth.users where id = $1', [id]);
    },
    async signOut() {},
  };
}

function createFakeStorage() {
  const files = new Map();
  return {
    files,
    async upload(p, buf, type) { files.set(p, { buf, type }); },
    async signedUrl(p, seconds) {
      if (!files.has(p)) throw new AppError(502, 'storage_error', 'missing');
      return `https://storage.test/signed/${encodeURIComponent(p)}?exp=${seconds}`;
    },
    async remove(paths) { for (const p of paths) files.delete(p); },
  };
}

/** Scriptable Gemini. `handler(args)` returns the raw JSON (or throws an AiError). */
export function createMockGemini({ configured = true } = {}) {
  const mock = {
    configured,
    model: 'mock-model',
    calls: [],
    handler: null,
    async generate(args) {
      mock.calls.push(args);
      if (!mock.handler) throw new Error('mock gemini has no handler');
      return mock.handler(args);
    },
  };
  return mock;
}

export async function createTestEnv({ configuredAi = true, limits } = {}) {
  const db = await createTestDb();
  const authAdmin = createFakeAuth(db);
  const storage = createFakeStorage();
  const gemini = createMockGemini({ configured: configuredAi });
  const env = { NODE_ENV: 'test', CORS_ORIGINS: 'http://localhost:5173', CLIENT_URL: 'http://localhost:5173' };
  initContext({
    env, db, authAdmin, storage, gemini,
    verifier: createTokenVerifier({ jwtSecret: TEST_SIGNING_KEY }),
    mailer: { enabled: false, async send() {} },
  });
  invalidateSettingsCache();
  const app = createApp({ env, limits: { api: { limit: 100000 }, login: { limit: 100000 }, register: { limit: 100000 }, passwordReset: { limit: 100000 }, upload: { limit: 100000 }, aiUser: { limit: 100000 }, aiGlobal: { limit: 100000 }, ...limits } });

  const seed = {
    async college(name = `College ${crypto.randomUUID().slice(0, 6)}`) {
      const { rows } = await db.query('insert into colleges (name) values ($1) returning id', [name]);
      return rows[0].id;
    },
    /** Creates auth user + profile (+ student profile). Returns { id, token, email }. */
    async user({ role = 'student', status = 'active', collegeId, fullName, student = {}, verified = false } = {}) {
      const email = `${role}-${crypto.randomUUID().slice(0, 8)}@test.dev`;
      const password = 'Password123!';
      const { userId } = await authAdmin.createUser({ email, password });
      await db.query(
        'insert into profiles (id, email, full_name, role, status, college_id) values ($1,$2,$3,$4,$5,$6)',
        [userId, email, fullName ?? `${role} ${email.slice(0, 6)}`, role, status, role === 'admin' ? null : collegeId],
      );
      if (role === 'student') {
        await db.query('insert into student_profiles (user_id, college_id) values ($1,$2)', [userId, collegeId]);
        const f = {
          department: 'CSE', passing_year: 2026, cgpa: 8, tenth_percent: 85, twelfth_percent: 85, active_backlogs: 0, roll_number: crypto.randomUUID().slice(0, 10),
          skills: ['JavaScript', 'React', 'SQL'], ...camelToSnake(student),
        };
        const cols = Object.keys(f);
        await db.query(
          `update student_profiles set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}${verified ? ", verification_status = 'verified'" : ''} where user_id = $1`,
          [userId, ...cols.map((c) => f[c])],
        );
      }
      return { id: userId, email, password, collegeId, token: await sign(userId, email) };
    },
    async company(collegeId, name = `Company ${crypto.randomUUID().slice(0, 6)}`) {
      const { rows } = await db.query('insert into companies (college_id, name) values ($1,$2) returning id', [collegeId, name]);
      return rows[0].id;
    },
    /** Creates an open drive with optional eligibility/skills. */
    async drive({ collegeId, companyId, status = 'open', deadlineHours = 48, eligibility = {}, skills = [], title = 'SDE Intern' }) {
      const { rows } = await db.query(
        `insert into drives (college_id, company_id, title, deadline, original_deadline, status)
         values ($1,$2,$3, now() + ($4 || ' hours')::interval, now() + ($4 || ' hours')::interval, $5) returning id`,
        [collegeId, companyId, title, String(deadlineHours), status],
      );
      const id = rows[0].id;
      await db.query(
        `insert into drive_eligibility (drive_id, min_cgpa, max_backlogs, allowed_departments, allowed_years, min_tenth_percent, min_twelfth_percent)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [id, eligibility.minCgpa ?? null, eligibility.maxBacklogs ?? null, eligibility.allowedDepartments ?? [], eligibility.allowedYears ?? [], eligibility.minTenth ?? null, eligibility.minTwelfth ?? null],
      );
      for (const s of skills) await db.query('insert into drive_skills (drive_id, skill, importance) values ($1,$2,$3)', [id, s.skill, s.importance ?? 'mandatory']);
      return id;
    },
  };

  const sign = authAdmin.sign;
  return {
    app, db, authAdmin, storage, gemini, seed,
    tokenFor: (u) => u.token,
    close: () => db.end(),
  };
}

const camelToSnake = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`), v]));
export const bearer = (user) => ({ Authorization: `Bearer ${user.token}` });

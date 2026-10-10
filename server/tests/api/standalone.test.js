// The "local" providers used for a plain-Postgres deployment (Amazon RDS): accounts in schema "auth",
// HS256 tokens, files on disk with HMAC-signed links. Runs the real bootstrap.sql + migrations on PGlite.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/harness.js';
import { createApp } from '../../src/app.js';
import { createLocalAuth, hashPassword, verifyPassword } from '../../src/adapters/localAuth.js';
import { createLocalStorage } from '../../src/adapters/localStorage.js';
import { createTokenVerifier } from '../../src/adapters/tokenVerifier.js';
import { initContext } from '../../src/context.js';
import { invalidateSettingsCache } from '../../src/services/common.js';

const SECRET = 'unit-test-signing-key-0123456789-abcdefghijklmnop';
let db;
let app;
let mails;
let storage;
let dir;
let collegeId;

const api = () => request(app);
const q = (sql, params) => db.query(sql, params).then((r) => r.rows);
const PASSWORD = 'CorrectHorse9!';
let n = 0;
const email = () => `student${++n}-${Date.now()}@example.com`;
const register = (e = email(), password = PASSWORD) =>
  api().post('/api/auth/register/student').send({ email: e, password, fullName: 'Local Student', collegeId, consent: true });

beforeAll(async () => {
  db = await createTestDb({ standalone: true });
  mails = [];
  const mailer = { enabled: true, async send(m) { mails.push(m); } };
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tb-uploads-'));
  storage = createLocalStorage({ dir, secret: SECRET });
  const env = { NODE_ENV: 'test', CORS_ORIGINS: 'http://localhost:5173', CLIENT_URL: 'http://localhost:5173' };
  initContext({
    env, db, storage, mailer, gemini: { configured: false },
    authAdmin: createLocalAuth({ db, jwtSecret: SECRET, mailer }),
    verifier: createTokenVerifier({ jwtSecret: SECRET }),
  });
  invalidateSettingsCache();
  const big = { limit: 100000 };
  app = createApp({ env, limits: { api: big, login: big, register: big, passwordReset: big, upload: big, aiUser: big, aiGlobal: big } });
  collegeId = (await q("insert into colleges (name) values ('Standalone College') returning id"))[0].id;
});
afterAll(async () => {
  await db?.end();
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

describe('standalone database bootstrap', () => {
  it('is idempotent', async () => {
    const sql = await fs.readFile(path.resolve(import.meta.dirname, '../../../supabase/standalone/bootstrap.sql'), 'utf8');
    await expect(db.raw.exec(sql)).resolves.not.toThrow();
    await expect(db.raw.exec(sql)).resolves.not.toThrow();
  });

  it('keeps identity tables out of reach of the browser-facing roles', async () => {
    await db.raw.exec('set role authenticated');
    try {
      await expect(db.raw.query('select * from auth.users')).rejects.toThrow(/permission denied/);
      await expect(db.raw.query('select * from auth.refresh_tokens')).rejects.toThrow(/permission denied/);
    } finally {
      await db.raw.exec('reset role');
    }
  });
});

describe('password hashing', () => {
  it('uses salted scrypt and verifies in constant shape', async () => {
    const a = await hashPassword('Secret123!');
    const b = await hashPassword('Secret123!');
    expect(a).toMatch(/^scrypt\$16384\$/);
    expect(a).not.toBe(b); // unique salts
    expect(a).not.toContain('Secret123!');
    expect(await verifyPassword('Secret123!', a)).toBe(true);
    expect(await verifyPassword('secret123!', a)).toBe(false);
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
  });
});

describe('accounts and sessions', () => {
  it('registers, signs in and calls a protected endpoint; no plaintext password is stored', async () => {
    const e = email();
    const reg = await register(e);
    expect(reg.status).toBe(201);
    expect(reg.body.data.session.accessToken).toBeTruthy();

    const [row] = await q('select encrypted_password from auth.users where lower(email) = $1', [e]);
    expect(row.encrypted_password).toMatch(/^scrypt\$/);
    expect(row.encrypted_password).not.toContain(PASSWORD);

    const login = await api().post('/api/auth/login').send({ email: e, password: PASSWORD });
    expect(login.status).toBe(200);
    const me = await api().get('/api/students/me').set('Authorization', `Bearer ${login.body.data.session.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe(e);
  });

  it('rejects a wrong password and an unknown account with the same message', async () => {
    const e = email();
    await register(e);
    const wrong = await api().post('/api/auth/login').send({ email: e, password: 'WrongPassword1!' });
    const unknown = await api().post('/api/auth/login').send({ email: 'nobody@example.com', password: 'WrongPassword1!' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('rejects duplicate emails (case-insensitive) and short passwords', async () => {
    const e = email();
    expect((await register(e)).status).toBe(201);
    expect((await register(e.toUpperCase())).status).toBe(409);
    expect((await register(email(), 'short')).status).toBe(400);
  });

  it('rotates refresh tokens: each one works once', async () => {
    const e = email();
    const { body } = await register(e);
    const first = body.data.session.refreshToken;
    const next = await api().post('/api/auth/refresh').send({ refreshToken: first });
    expect(next.status).toBe(200);
    expect(next.body.data.session.refreshToken).not.toBe(first);
    expect((await api().post('/api/auth/refresh').send({ refreshToken: first })).status).toBe(401);
    expect((await api().post('/api/auth/refresh').send({ refreshToken: next.body.data.session.refreshToken })).status).toBe(200);
  });

  it('logout revokes the refresh tokens', async () => {
    const { body } = await register();
    const { accessToken, refreshToken } = body.data.session;
    expect((await api().post('/api/auth/logout').set('Authorization', `Bearer ${accessToken}`)).status).toBe(200);
    expect((await api().post('/api/auth/refresh').send({ refreshToken })).status).toBe(401);
  });

  it('refuses a token signed with a different key', async () => {
    const forged = await createLocalAuth({ db, jwtSecret: 'a-completely-different-signing-key-0123456789' }).signIn({ email: 'x@example.com', password: 'y' }).catch(() => null);
    expect(forged).toBeNull();
    const other = createLocalAuth({ db, jwtSecret: 'a-completely-different-signing-key-0123456789' });
    const e = email();
    const { session } = await other.signUp({ email: e, password: PASSWORD });
    const res = await api().get('/api/auth/me').set('Authorization', `Bearer ${session.accessToken}`);
    expect(res.status).toBe(401);
  });
});

describe('password reset', () => {
  it('emails a single-use link, changes the password and signs out other sessions', async () => {
    const e = email();
    const { body } = await register(e);
    const oldRefresh = body.data.session.refreshToken;
    mails.length = 0;

    const ask = await api().post('/api/auth/forgot-password').send({ email: e });
    expect(ask.status).toBe(202);
    expect(mails).toHaveLength(1);
    const token = /access_token=([\w-]+)/.exec(mails[0].text)[1];
    expect(mails[0].text).toContain('http://localhost:5173/reset-password#');
    // only a hash is stored
    expect((await q('select token_hash from auth.recovery_tokens'))[0].token_hash).not.toContain(token);

    const NEW = 'BrandNewPassword7!';
    expect((await api().post('/api/auth/reset-password').send({ accessToken: token, password: NEW })).status).toBe(200);
    expect((await api().post('/api/auth/login').send({ email: e, password: NEW })).status).toBe(200);
    expect((await api().post('/api/auth/login').send({ email: e, password: PASSWORD })).status).toBe(401);
    expect((await api().post('/api/auth/reset-password').send({ accessToken: token, password: 'AnotherPassword8!' })).status).toBe(401);
    expect((await api().post('/api/auth/refresh').send({ refreshToken: oldRefresh })).status).toBe(401);
  });

  it('answers 202 and sends nothing for an unknown address', async () => {
    mails.length = 0;
    const res = await api().post('/api/auth/forgot-password').send({ email: 'ghost@example.com' });
    expect(res.status).toBe(202);
    expect(mails).toHaveLength(0);
  });
});

describe('private file storage', () => {
  it('serves a resume only through a signed, expiring link', async () => {
    const { body } = await register();
    const token = body.data.session.accessToken;
    const pdf = Buffer.from(`%PDF-1.4\n${'x'.repeat(300)}\n%%EOF`);
    const up = await api().post('/api/students/me/resumes').set('Authorization', `Bearer ${token}`).attach('file', pdf, { filename: 'cv.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(201);

    const link = await api().get(`/api/students/me/resumes/${up.body.data.id}/url`).set('Authorization', `Bearer ${token}`);
    expect(link.status).toBe(200);
    expect(link.body.data.url).toMatch(/^\/api\/files\/.+\..+$/);

    const file = await api().get(link.body.data.url).buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toMatch(/application\/pdf/);
    expect(file.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.compare(file.body, pdf)).toBe(0);

    // tampering with either half of the token is rejected
    const [payload, mac] = link.body.data.url.split('/api/files/')[1].split('.');
    expect((await api().get(`/api/files/${payload}.${mac.slice(0, -2)}AA`)).status).toBe(404);
    const forgedPayload = Buffer.from(JSON.stringify({ k: '../../etc/passwd', e: 9999999999 })).toString('base64url');
    expect((await api().get(`/api/files/${forgedPayload}.${mac}`)).status).toBe(404);
    expect((await api().get('/api/files/garbage')).status).toBe(404);
  });

  it('links expire and the directory cannot be escaped', async () => {
    await storage.upload('u1/a.pdf', Buffer.from('%PDF-1.4 test'));
    const expired = await storage.signedUrl('u1/a.pdf', -5);
    expect((await api().get(expired)).status).toBe(404);
    await expect(storage.upload('../outside.pdf', Buffer.from('x'))).rejects.toMatchObject({ code: 'bad_path' });
    await expect(storage.signedUrl('../../etc/passwd')).rejects.toBeTruthy();
    // files are never overwritten
    await expect(storage.upload('u1/a.pdf', Buffer.from('other'))).rejects.toBeTruthy();
  });
});

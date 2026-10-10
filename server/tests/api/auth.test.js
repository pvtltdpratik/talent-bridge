import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestEnv } from '../helpers/harness.js';
import { sha256 } from '../../src/utils/helpers.js';

let t;
let college;
let otherCollege;
let admin;

beforeAll(async () => {
  t = await createTestEnv({ limits: { login: { limit: 5, windowMs: 60_000 } } });
  college = await t.seed.college('Alpha Institute');
  otherCollege = await t.seed.college('Beta College');
  admin = await t.seed.user({ role: 'admin' });
});
afterAll(() => t.close());

const api = () => request(t.app);
const registerBody = (extra = {}) => ({
  email: `u${Math.random().toString(36).slice(2, 8)}@example.com`,
  password: 'Password123!',
  fullName: 'Test Person',
  collegeId: college,
  consent: true,
  ...extra,
});
const q = (sql, params) => t.db.query(sql, params).then((r) => r.rows);

describe('registration', () => {
  it('creates an active student and ignores any role/status in the payload', async () => {
    const res = await api()
      .post('/api/auth/register/student')
      .send(registerBody({ role: 'admin', status: 'active', collegeId: college }));
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('student');
    const [p] = await q('select role, status from profiles where id = $1', [res.body.data.user.id]);
    expect(p).toEqual({ role: 'student', status: 'active' });
    const sp = await q('select verification_status from student_profiles where user_id = $1', [res.body.data.user.id]);
    expect(sp[0].verification_status).toBe('unverified');
  });

  it('cannot create an admin or an active placement cell through public registration', async () => {
    const res = await api()
      .post('/api/auth/register/placement-cell')
      .send(registerBody({ role: 'admin', status: 'active' }));
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('placement_cell');
    expect(res.body.data.user.status).toBe('pending');
  });

  it('requires consent and a valid college', async () => {
    expect((await api().post('/api/auth/register/student').send(registerBody({ consent: false }))).status).toBe(400);
    const bad = await api().post('/api/auth/register/student').send(registerBody({ collegeId: '00000000-0000-4000-8000-000000000000' }));
    expect(bad.status).toBe(400);
  });

  it('rejects duplicate emails', async () => {
    const body = registerBody();
    expect((await api().post('/api/auth/register/student').send(body)).status).toBe(201);
    const again = await api().post('/api/auth/register/student').send(body);
    expect(again.status).toBe(409);
  });
});

describe('account states are enforced on every protected request', () => {
  it('a pending placement cell can only see /auth/me', async () => {
    const reg = await api().post('/api/auth/register/placement-cell').send(registerBody());
    const login = await api().post('/api/auth/login').send({ email: reg.body.data.user.email, password: 'Password123!' });
    expect(login.status).toBe(200);
    const token = login.body.data.session.accessToken;
    const h = { Authorization: `Bearer ${token}` };

    const me = await api().get('/api/auth/me').set(h);
    expect(me.status).toBe(200);
    expect(me.body.data.status).toBe('pending');

    for (const path of ['/api/students', '/api/drives', '/api/companies', '/api/notifications', '/api/analytics/overview']) {
      const r = await api().get(path).set(h);
      expect(r.status, path).toBe(403);
      expect(r.body.error.code).toBe('account_pending');
    }
  });

  it('suspended and rejected accounts are blocked', async () => {
    const s = await t.seed.user({ role: 'student', collegeId: college, status: 'suspended' });
    const r1 = await api().get('/api/students/me').set(bearer(s));
    expect(r1.status).toBe(403);
    expect(r1.body.error.code).toBe('account_suspended');
    const rej = await t.seed.user({ role: 'placement_cell', collegeId: college, status: 'rejected' });
    const r2 = await api().get('/api/students').set(bearer(rej));
    expect(r2.status).toBe(403);
    expect(r2.body.error.code).toBe('account_rejected');
  });

  it('rejects missing or invalid tokens with 401', async () => {
    expect((await api().get('/api/students/me')).status).toBe(401);
    expect((await api().get('/api/students/me').set('Authorization', 'Bearer not-a-jwt')).status).toBe(401);
  });
});

describe('role separation', () => {
  it('students cannot reach placement-cell or admin endpoints', async () => {
    const s = await t.seed.user({ role: 'student', collegeId: college });
    for (const [m, p] of [
      ['get', '/api/students'], ['get', '/api/companies'], ['post', '/api/drives'], ['get', '/api/exceptions'],
      ['get', '/api/admin/users'], ['get', '/api/admin/audit-logs'], ['put', '/api/admin/settings'], ['post', '/api/admin/invitations'],
    ]) {
      const r = await api()[m](p).set(bearer(s)).send({});
      expect(r.status, `${m} ${p}`).toBe(403);
    }
  });

  it('placement cell cannot reach admin endpoints', async () => {
    const c = await t.seed.user({ role: 'placement_cell', collegeId: college });
    for (const p of ['/api/admin/users', '/api/admin/audit-logs', '/api/admin/settings', '/api/admin/metrics']) {
      expect((await api().get(p).set(bearer(c))).status, p).toBe(403);
    }
  });

  it('placement cell cannot use student-only endpoints', async () => {
    const c = await t.seed.user({ role: 'placement_cell', collegeId: college });
    expect((await api().get('/api/students/me').set(bearer(c))).status).toBe(403);
    expect((await api().post('/api/applications').set(bearer(c)).send({ driveId: '00000000-0000-4000-8000-000000000000' })).status).toBe(403);
  });
});

describe('admin approvals', () => {
  it('approve activates the account, notifies and writes an audit row', async () => {
    const reg = await api().post('/api/auth/register/placement-cell').send(registerBody());
    const id = reg.body.data.user.id;
    const res = await api().patch(`/api/admin/users/${id}/status`).set(bearer(admin)).send({ status: 'active' });
    expect(res.status).toBe(200);
    const [p] = await q('select status from profiles where id = $1', [id]);
    expect(p.status).toBe('active');
    const audit = await q("select * from audit_logs where action = 'account.approved' and target_id = $1", [id]);
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_id).toBe(admin.id);
    expect(audit[0].old_value.status).toBe('pending');
    const notes = await q('select * from notifications where user_id = $1', [id]);
    expect(notes.some((n) => n.type === 'account_status')).toBe(true);
  });

  it('rejection requires a reason', async () => {
    const reg = await api().post('/api/auth/register/placement-cell').send(registerBody());
    const id = reg.body.data.user.id;
    const noReason = await api().patch(`/api/admin/users/${id}/status`).set(bearer(admin)).send({ status: 'rejected' });
    expect(noReason.status).toBe(400);
    const ok = await api().patch(`/api/admin/users/${id}/status`).set(bearer(admin)).send({ status: 'rejected', reason: 'Not a verified staff member' });
    expect(ok.status).toBe(200);
    const [p] = await q('select status, status_reason from profiles where id = $1', [id]);
    expect(p).toEqual({ status: 'rejected', status_reason: 'Not a verified staff member' });
  });

  it('role changes are admin-only, audited, and you cannot change your own', async () => {
    const s = await t.seed.user({ role: 'student', collegeId: college });
    const denied = await api().patch(`/api/admin/users/${s.id}/role`).set(bearer(s)).send({ role: 'admin' });
    expect(denied.status).toBe(403);
    const self = await api().patch(`/api/admin/users/${admin.id}/role`).set(bearer(admin)).send({ role: 'student', collegeId: college });
    expect(self.status).toBe(403);
    const ok = await api().patch(`/api/admin/users/${s.id}/role`).set(bearer(admin)).send({ role: 'placement_cell' });
    expect(ok.status).toBe(200);
    const audit = await q("select old_value, new_value from audit_logs where action = 'role.changed' and target_id = $1", [s.id]);
    expect(audit[0]).toEqual({ old_value: { role: 'student' }, new_value: { role: 'placement_cell' } });
  });

  it('an admin can suspend another admin (audited) but not themselves', async () => {
    const other = await t.seed.user({ role: 'admin' });
    const self = await api().patch(`/api/admin/users/${admin.id}/status`).set(bearer(admin)).send({ status: 'suspended', reason: 'x' });
    expect(self.status).toBe(403);
    const res = await api().patch(`/api/admin/users/${other.id}/status`).set(bearer(admin)).send({ status: 'suspended', reason: 'policy' });
    expect(res.status).toBe(200);
    expect(await q("select 1 from audit_logs where action = 'account.suspended' and target_id = $1", [other.id])).toHaveLength(1);
    // the suspended admin is locked out immediately
    expect((await api().get('/api/admin/users').set(bearer(other))).status).toBe(403);
  });
});

describe('placement cell invitations', () => {
  const invite = async (email, collegeId = otherCollege) => {
    const res = await api().post('/api/admin/invitations').set(bearer(admin)).send({ email, collegeId });
    expect(res.status).toBe(201);
    const token = new URL(res.body.data.inviteUrl).searchParams.get('token');
    return { token, id: res.body.data.id };
  };
  const accept = (token, extra = {}) =>
    api().post('/api/auth/accept-invite').send({ token, password: 'Password123!', fullName: 'Invited Person', consent: true, ...extra });

  it('stores only a hash of the token and activates the account for the invited email + college', async () => {
    const email = 'invitee1@example.com';
    const { token, id } = await invite(email);
    const [row] = await q('select token_hash from placement_cell_invitations where id = $1', [id]);
    expect(row.token_hash).toBe(sha256(token));
    expect(row.token_hash).not.toContain(token);

    const info = await api().get(`/api/auth/invite/${token}`);
    expect(info.status).toBe(200);
    expect(info.body.data.email).toBe(email);

    // an email in the payload is ignored: the invite decides the identity
    const res = await accept(token, { email: 'attacker@example.com' });
    expect(res.status).toBe(201);
    const [p] = await q('select email, role, status, college_id from profiles where lower(email) = $1', [email]);
    expect(p).toEqual({ email, role: 'placement_cell', status: 'active', college_id: otherCollege });
    expect(await q("select 1 from profiles where email = 'attacker@example.com'")).toHaveLength(0);
  });

  it('is single-use', async () => {
    const { token } = await invite('invitee2@example.com');
    expect((await accept(token)).status).toBe(201);
    const again = await accept(token);
    expect(again.status).toBe(410);
  });

  it('expires', async () => {
    const { token, id } = await invite('invitee3@example.com');
    await t.db.query("update placement_cell_invitations set expires_at = now() - interval '1 minute' where id = $1", [id]);
    expect((await accept(token)).status).toBe(410);
    expect((await api().get(`/api/auth/invite/${token}`)).status).toBe(404);
  });

  it('can be revoked, and a new invite replaces an old one for the same email', async () => {
    const first = await invite('invitee4@example.com');
    const second = await invite('invitee4@example.com');
    expect((await accept(first.token)).status).toBe(410);
    const del = await api().delete(`/api/admin/invitations/${second.id}`).set(bearer(admin));
    expect(del.status).toBe(200);
    expect((await accept(second.token)).status).toBe(410);
  });

  it('is audited', async () => {
    await invite('invitee5@example.com');
    const rows = await q("select 1 from audit_logs where action = 'invitation.created'");
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('rate limiting', () => {
  it('limits repeated login attempts', async () => {
    const codes = [];
    for (let i = 0; i < 8; i += 1) {
      const r = await api().post('/api/auth/login').send({ email: 'nobody@example.com', password: 'wrong-password' });
      codes.push(r.status);
    }
    expect(codes).toContain(401);
    expect(codes).toContain(429);
  });
});

describe('error handling', () => {
  it('never leaks stack traces', async () => {
    const r = await api().post('/api/auth/register/student').set('Content-Type', 'application/json').send('{bad json');
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toMatch(/at .*\.js|node_modules/);
  });

  it('exposes health with AI configured flag but no secrets', async () => {
    const r = await api().get('/health');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'ok', db: 'up', ai: { configured: true } });
    expect(JSON.stringify(r.body)).not.toMatch(/key|secret|token/i);
  });
});

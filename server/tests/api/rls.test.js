// Database-level defence in depth: even with a leaked anon/authenticated key, RLS limits reads
// and (because no write policies exist) blocks all writes. These run real policies in Postgres.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestEnv } from '../helpers/harness.js';

let t;
let A;
let B;
let s1;
let s2;
let staffA;
let admin;

async function as(userId, role, fn) {
  const pg = t.db.raw;
  await pg.exec(`set role ${role}`);
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? '']);
  try {
    return await fn((sql, params) => pg.query(sql, params).then((r) => r.rows));
  } finally {
    await pg.exec('reset role');
    await pg.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

beforeAll(async () => {
  t = await createTestEnv();
  A = await t.seed.college('RLS A');
  B = await t.seed.college('RLS B');
  s1 = await t.seed.user({ role: 'student', collegeId: A });
  s2 = await t.seed.user({ role: 'student', collegeId: A });
  await t.seed.user({ role: 'student', collegeId: B });
  staffA = await t.seed.user({ role: 'placement_cell', collegeId: A });
  admin = await t.seed.user({ role: 'admin' });
  const company = await t.seed.company(A);
  const drive = await t.seed.drive({ collegeId: A, companyId: company });
  await t.db.query(`insert into applications (student_id, drive_id, college_id, eligibility_snapshot) values ($1,$2,$3,'{}')`, [s1.id, drive, A]);
  await t.db.query("insert into audit_logs (action) values ('test.event')");
  await t.db.query("insert into notifications (user_id, type, title) values ($1,'x','mine'), ($2,'x','theirs')", [s1.id, s2.id]);
});
afterAll(() => t.close());

describe('row level security', () => {
  it('RLS is enabled on every public table', async () => {
    const rows = await t.db.query("select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity");
    expect(rows.rows.map((r) => r.relname)).toEqual([]);
  });

  it('anon sees nothing', async () => {
    await as(null, 'anon', async (q) => {
      expect(await q('select * from profiles')).toHaveLength(0);
      expect(await q('select * from student_profiles')).toHaveLength(0);
      expect(await q('select * from applications')).toHaveLength(0);
    });
  });

  it('a student sees only their own profile, applications and notifications', async () => {
    await as(s1.id, 'authenticated', async (q) => {
      const profiles = await q('select id from profiles');
      expect(profiles.map((p) => p.id)).toEqual([s1.id]);
      expect(await q('select 1 from student_profiles')).toHaveLength(1);
      expect(await q('select 1 from applications')).toHaveLength(1);
      expect((await q('select title from notifications')).map((n) => n.title)).toEqual(['mine']);
    });
    await as(s2.id, 'authenticated', async (q) => {
      expect(await q('select 1 from applications')).toHaveLength(0);
    });
  });

  it('placement cell sees only their own college; admin sees all', async () => {
    await as(staffA.id, 'authenticated', async (q) => {
      const colleges = new Set((await q('select college_id from student_profiles')).map((r) => r.college_id));
      expect([...colleges]).toEqual([A]);
      expect((await q('select 1 from profiles where college_id = $1', [B]))).toHaveLength(0);
    });
    await as(admin.id, 'authenticated', async (q) => {
      const colleges = new Set((await q('select college_id from student_profiles')).map((r) => r.college_id));
      expect(colleges.size).toBe(2);
    });
  });

  it('only admins can read the audit log', async () => {
    await as(s1.id, 'authenticated', async (q) => expect(await q('select 1 from audit_logs')).toHaveLength(0));
    await as(staffA.id, 'authenticated', async (q) => expect(await q('select 1 from audit_logs')).toHaveLength(0));
    await as(admin.id, 'authenticated', async (q) => expect((await q('select 1 from audit_logs')).length).toBeGreaterThan(0));
  });

  it('authenticated users cannot write: write privileges are revoked and no write policies exist', async () => {
    await as(s1.id, 'authenticated', async (q) => {
      await expect(q("update profiles set role = 'admin' where id = $1", [s1.id])).rejects.toThrow(/permission denied/);
      await expect(q("insert into notifications (user_id, type, title) values ($1, 'x', 'forged')", [s1.id])).rejects.toThrow(/permission denied/);
      await expect(q('delete from applications')).rejects.toThrow(/permission denied/);
    });
    await as(null, 'anon', async (q) => {
      await expect(q("update profiles set status = 'active'")).rejects.toThrow(/permission denied/);
    });
    const [p] = (await t.db.query('select role from profiles where id = $1', [s1.id])).rows;
    expect(p.role).toBe('student');
  });

  it('the service/owner connection (used by the API) can still write', async () => {
    const res = await t.db.query("update student_profiles set department = 'IT' where user_id = $1", [s1.id]);
    expect(res.affectedRows).toBe(1);
  });
});

describe('schema constraints', () => {
  it('rejects invalid statuses and out-of-range academics at the database', async () => {
    await expect(t.db.query("update profiles set status = 'hacked' where id = $1", [s1.id])).rejects.toThrow();
    await expect(t.db.query('update student_profiles set cgpa = 11 where user_id = $1', [s1.id])).rejects.toThrow();
    await expect(t.db.query('update student_profiles set active_backlogs = -1 where user_id = $1', [s1.id])).rejects.toThrow();
  });

  it('allows only one active resume per student at the database', async () => {
    await t.db.query(`insert into resumes (student_id, version, file_path, file_name, mime_type, size_bytes, extraction_status, is_active)
                      values ($1,1,'a','a.pdf','application/pdf',1,'ok',true)`, [s1.id]);
    await expect(
      t.db.query(`insert into resumes (student_id, version, file_path, file_name, mime_type, size_bytes, extraction_status, is_active)
                  values ($1,2,'b','b.pdf','application/pdf',1,'ok',true)`, [s1.id]),
    ).rejects.toThrow();
  });
});

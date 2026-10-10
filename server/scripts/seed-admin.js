// Creates the FIRST admin. Public registration can never create admins; this script is the only bootstrap.
//   ADMIN_EMAIL=you@college.edu [ADMIN_PASSWORD=...] [ADMIN_NAME="Platform Admin"] npm run seed:admin
// If ADMIN_PASSWORD is empty a strong random one is generated and printed ONCE to this console.
import 'dotenv/config';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME = 'Platform Admin', SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL } = process.env;
for (const [k, v] of Object.entries({ ADMIN_EMAIL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL })) {
  if (!v) {
    console.error(`Missing ${k}. See server/.env.example.`);
    process.exit(1);
  }
}

const email = ADMIN_EMAIL.trim().toLowerCase();
const generated = !ADMIN_PASSWORD;
const password = ADMIN_PASSWORD || crypto.randomBytes(18).toString('base64url');

const db = new pg.Client({ connectionString: DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false } });
await db.connect();
const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

try {
  const existing = (await db.query('select id, role from profiles where lower(email) = $1', [email])).rows[0];
  if (existing) {
    console.log(existing.role === 'admin' ? 'An admin with this email already exists. Nothing to do.' : `A ${existing.role} account already uses this email. Refusing to change its role here; use the admin UI.`);
    process.exit(existing.role === 'admin' ? 0 : 1);
  }

  let userId;
  const created = await supa.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: ADMIN_NAME } });
  if (created.error) {
    if (!/already|registered|exists/i.test(created.error.message)) throw created.error;
    // auth user exists without a profile (e.g. an earlier partial run): reuse it and reset the password
    const { data } = await supa.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const found = data.users.find((u) => u.email?.toLowerCase() === email);
    if (!found) throw new Error('Auth user exists but could not be located.');
    userId = found.id;
    await supa.auth.admin.updateUserById(userId, { password, email_confirm: true });
  } else {
    userId = created.data.user.id;
  }

  await db.query('begin');
  await db.query(
    `insert into profiles (id, email, full_name, role, status, college_id, consent_at) values ($1,$2,$3,'admin','active',null, now())`,
    [userId, email, ADMIN_NAME],
  );
  await db.query(`insert into audit_logs (actor_id, actor_role, action, target_type, target_id, new_value) values ($1,'admin','admin.seeded','profile',$1,$2::jsonb)`, [userId, JSON.stringify({ email })]);
  await db.query('commit');

  console.log(`Admin created: ${email}`);
  if (generated) {
    console.log('Generated password (shown once, store it in a password manager):');
    console.log(password);
  }
} catch (err) {
  await db.query('rollback').catch(() => {});
  console.error('Failed:', err.message);
  process.exitCode = 1;
} finally {
  await db.end();
}

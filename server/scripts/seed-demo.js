// OPTIONAL development data. Everything it creates is labelled "Sample data" and it refuses to run in
// production or without an explicit flag. It never touches real records.
//   SEED_DEMO=true npm run seed:demo
import 'dotenv/config';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}
if (process.env.SEED_DEMO !== 'true') {
  console.error('Set SEED_DEMO=true to confirm you want sample data.');
  process.exit(1);
}
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DATABASE_URL) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / DATABASE_URL.');
  process.exit(1);
}

const password = process.env.DEMO_PASSWORD || crypto.randomBytes(12).toString('base64url');
const db = new pg.Client({ connectionString: DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false } });
await db.connect();
const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function user(email, fullName, role, collegeId, student = {}) {
  const existing = (await db.query('select id from profiles where lower(email) = $1', [email])).rows[0];
  if (existing) return existing.id;
  const { data, error } = await supa.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
  if (error) throw error;
  const id = data.user.id;
  await db.query(`insert into profiles (id, email, full_name, role, status, college_id, consent_at) values ($1,$2,$3,$4,'active',$5, now())`, [id, email, fullName, role, collegeId]);
  if (role === 'student') {
    await db.query(
      `insert into student_profiles (user_id, college_id, department, roll_number, passing_year, cgpa, tenth_percent, twelfth_percent, active_backlogs, skills, verification_status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'verified')`,
      [id, collegeId, student.department, student.roll, 2026, student.cgpa, 85, 82, student.backlogs ?? 0, student.skills ?? []],
    );
  }
  return id;
}

try {
  const college = (await db.query(
    `insert into colleges (name, city) values ('Sample Institute of Technology (Sample data)', 'Sample City')
     on conflict (lower(name)) do update set city = excluded.city returning id`)).rows[0].id;

  const staff = await user('sample.placement@example.test', 'Sample Placement Officer', 'placement_cell', college);
  await user('sample.student1@example.test', 'Sample Student One', 'student', college, { department: 'CSE', roll: 'SAMPLE-001', cgpa: 8.6, skills: ['JavaScript', 'React', 'Node.js', 'SQL'] });
  await user('sample.student2@example.test', 'Sample Student Two', 'student', college, { department: 'IT', roll: 'SAMPLE-002', cgpa: 7.1, skills: ['Python', 'SQL'] });
  await user('sample.student3@example.test', 'Sample Student Three', 'student', college, { department: 'CSE', roll: 'SAMPLE-003', cgpa: 6.4, backlogs: 1, skills: ['Java'] });

  const company = (await db.query(
    `insert into companies (college_id, name, industry, notes, created_by) values ($1,'Sample Company (Sample data)','Software','Sample data for local development only',$2)
     on conflict (college_id, lower(name)) do update set industry = excluded.industry returning id`, [college, staff])).rows[0].id;

  const drive = (await db.query(
    `insert into drives (college_id, company_id, title, description, job_type, deadline, original_deadline, status, created_by)
     values ($1,$2,'Sample Software Engineer (Sample data)','Sample drive for local development.','full_time', now() + interval '14 days', now() + interval '14 days','open',$3) returning id`,
    [college, company, staff])).rows[0].id;
  await db.query(`insert into drive_eligibility (drive_id, min_cgpa, max_backlogs, allowed_departments, allowed_years) values ($1,7,0,'{CSE,IT}','{2026}')`, [drive]);
  await db.query(`insert into drive_skills (drive_id, skill, importance) values ($1,'JavaScript','mandatory'), ($1,'React','preferred'), ($1,'SQL','mandatory')`, [drive]);

  console.log('Sample data created. Accounts (all use the same password):');
  console.log('  sample.placement@example.test, sample.student1..3@example.test');
  console.log(`  password: ${password}`);
} finally {
  await db.end();
}

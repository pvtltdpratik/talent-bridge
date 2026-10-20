// Applies supabase/migrations/*.sql in order, once each, using DATABASE_URL.
// Alternative: `supabase db push` with the Supabase CLI. Both read the same files.
//
// DB_MODE (default "supabase"):
//   supabase    DATABASE_URL is a Supabase database; roles and the auth schema already exist.
//   standalone  DATABASE_URL is plain Postgres (e.g. Amazon RDS): supabase/standalone/bootstrap.sql is applied first.
//               (AUTH_PROVIDER=local implies standalone.)
// With standalone + AUTH_PROVIDER=supabase the identities live in Supabase, so the profiles -> auth.users foreign key
// is dropped afterwards (supabase/standalone/external-identity.sql).
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../supabase/migrations');
const standaloneDir = path.resolve(dir, '../standalone');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set (see server/.env.example).');
  process.exit(1);
}

const standalone = process.env.DB_MODE === 'standalone' || process.env.AUTH_PROVIDER === 'local';
const externalIdentity = standalone && process.env.AUTH_PROVIDER === 'supabase';

const useSsl = !/localhost|127\.0\.0\.1/.test(url);
const client = new pg.Client({ connectionString: url, ssl: useSsl ? { rejectUnauthorized: false } : false });
await client.connect();
try {
  if (standalone) {
    // Plain Postgres: provide the roles / auth schema the migrations expect. Idempotent.
    console.log('bootstrap standalone auth schema');
    await client.query(fs.readFileSync(path.join(standaloneDir, 'bootstrap.sql'), 'utf8'));
  }
  await client.query(`create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await client.query('select name from public.schema_migrations')).rows.map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  let applied = 0;
  for (const f of files) {
    if (done.has(f)) {
      console.log(`skip   ${f}`);
      continue;
    }
    console.log(`apply  ${f}`);
    await client.query('begin');
    try {
      await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await client.query('insert into public.schema_migrations (name) values ($1)', [f]);
      await client.query('commit');
      applied += 1;
    } catch (err) {
      await client.query('rollback');
      throw err;
    }
  }
  if (externalIdentity) {
    console.log('detach profiles from the local auth schema (identity is external)');
    await client.query(fs.readFileSync(path.join(standaloneDir, 'external-identity.sql'), 'utf8'));
  }
  console.log(`done. ${applied} migration(s) applied.`);
} finally {
  await client.end();
}

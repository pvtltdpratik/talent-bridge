// Applies supabase/migrations/*.sql in order, once each, using DATABASE_URL.
// Alternative: `supabase db push` with the Supabase CLI. Both read the same files.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../supabase/migrations');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set (see server/.env.example).');
  process.exit(1);
}

const useSsl = !/localhost|127\.0\.0\.1/.test(url);
const client = new pg.Client({ connectionString: url, ssl: useSsl ? { rejectUnauthorized: false } : false });
await client.connect();
try {
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
  console.log(`done. ${applied} migration(s) applied.`);
} finally {
  await client.end();
}

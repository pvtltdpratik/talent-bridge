// Creates the application database named in DATABASE_URL if it does not exist yet.
// It connects to the maintenance database ("postgres") on the same server and touches nothing else.
import 'dotenv/config';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const target = new URL(url);
const dbName = decodeURIComponent(target.pathname.replace(/^\//, ''));
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(dbName)) {
  console.error(`Refusing unusual database name "${dbName}".`);
  process.exit(1);
}
const admin = new URL(url);
admin.pathname = '/postgres';
const useSsl = !/localhost|127\.0\.0\.1/.test(url);
const client = new pg.Client({ connectionString: admin.toString(), ssl: useSsl ? { rejectUnauthorized: false } : false });
await client.connect();
try {
  const exists = await client.query('select 1 from pg_database where datname = $1', [dbName]);
  if (exists.rowCount) {
    console.log(`database "${dbName}" already exists`);
  } else {
    await client.query(`create database "${dbName}"`); // identifier validated above
    console.log(`created database "${dbName}"`);
  }
} finally {
  await client.end();
}

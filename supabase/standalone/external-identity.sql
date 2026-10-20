-- Identity lives OUTSIDE this database (Supabase Auth), while application data stays here (e.g. Amazon RDS).
--
-- The migrations declare  profiles.id -> auth.users(id)  which is right when Supabase Auth and the data share one
-- Postgres. With a separate identity store the referenced user does not exist locally, so the constraint is removed.
-- Integrity is kept in code instead: registration creates the identity first and rolls it back if the profile insert
-- fails, and account deletion removes the profile before the identity.
--
-- Idempotent: safe to run on every deploy. Applied by scripts/migrate.js when DB_MODE=standalone and
-- AUTH_PROVIDER=supabase.
alter table public.profiles drop constraint if exists profiles_id_fkey;

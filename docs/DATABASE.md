# Database design

Postgres on Supabase. Migrations: `supabase/migrations/*.sql` (applied in filename order by `npm run db:migrate` or `supabase db push`).
All keys are `uuid`; statuses are `text` + `CHECK` constraints; every foreign key is indexed.

## Tables

| Table | Purpose | Key constraints |
|---|---|---|
| `colleges` | multi-college tenancy | unique `lower(name)` |
| `profiles` | one row per auth user: `role`, `status`, `college_id` | `role ∈ {admin, placement_cell, student}`; `status ∈ {pending, active, suspended, rejected}`; non-admins must have a college; unique `lower(email)` |
| `placement_cell_invitations` | admin invites | `token_hash` unique (only a SHA-256 is stored), `expires_at`, `accepted_at`, `revoked_at` |
| `student_profiles` | academics, skills, links, verification | CGPA 0-10, % 0-100, backlogs ≥ 0; unique `(college_id, lower(roll_number))` |
| `student_projects`, `student_experience` | structured profile sections | cascade on student delete |
| `resumes` | versioned uploads + extracted text | **one active per student** (partial unique index); unique `(student, version)` |
| `companies`, `company_contacts` | recruiter records (contacts table reserved, not exposed) | unique `(college_id, lower(name))` |
| `drives`, `drive_skills`, `drive_eligibility` | postings, skills (`mandatory|preferred`), criteria | skills unique per drive; criteria optional per column |
| `applications` | one per (student, drive) | **`applications_one_per_drive` unique**; `eligibility_snapshot jsonb`; `via_exception`; `manual_rank` |
| `application_status_history` | who changed what, when | append-only |
| `exception_requests` | ineligible student requests | reason 10-1000 chars; **partial unique `(student, drive)` where status in (pending, approved)** |
| `interviews` | scheduled interviews | mode `online|offline` |
| `ai_analyses` | every AI result: feature, model, prompt version, input hash, status, validated output | partial unique `(feature, subject, scope, input_hash)` where `status='ok'` (the cache) |
| `notifications` | in-app | |
| `audit_logs` | privileged actions | identity bigint; no FK on actor so history survives deletion |
| `system_settings` | admin-editable weights/limits | key → jsonb |

The `resumes` storage bucket is created private by the first migration and has **no** `storage.objects` policies, so only
the service role (the API) can read or write it. Downloads use 120-second signed URLs issued after an ownership/college check.

## Row Level Security

RLS is enabled on **every** public table. The policies are read-only and scoped:

* a user reads their own rows;
* placement cell reads rows whose `college_id` equals their own;
* admin reads everything;
* `audit_logs` and `placement_cell_invitations` are admin-only;
* **there are no insert/update/delete policies**, and the migration also `REVOKE`s write privileges from `anon`/`authenticated`.

The browser never talks to the database, so this is defence in depth: a leaked anon key cannot read another college's
data or write anything. The API connects with a privileged `DATABASE_URL`, which bypasses RLS, and enforces the same rules in
code (`scopeCollege`, `assertCollegeAccess`, ownership checks). RLS behaviour is covered by `server/tests/api/rls.test.js`.

## Transactions

Multi-step actions run in one transaction with row locks (`SELECT … FOR UPDATE`):
apply (lock drive → check → insert application + history), exception decision (lock request → update → audit → notify),
status change (lock application → update → history → audit → notify), resume upload (lock student → new version → deactivate old),
role/status changes (lock profile → update → audit).

## Audit events

`account.approved|rejected|suspended|reactivated`, `role.changed`, `admin.created|seeded`, `invitation.created|accepted|revoked`,
`profile.verified|needs_changes|verification_reset`, `exception.approved|rejected`, `application.status_changed`,
`drive.deadline_extended|eligibility_changed|status_changed`, `ranking.manual_order_set`, `settings.updated`,
`college.created|updated`, `account.deleted`, `*.registered`. Each row stores actor, role, target, old/new value and IP.

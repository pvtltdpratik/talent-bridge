-- TalentBridge AI: core schema
-- Conventions: text + CHECK constraints instead of enums (easier to evolve), uuid keys,
-- timestamptz everywhere, every FK indexed.

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- colleges / profiles / invitations
-- ---------------------------------------------------------------------------
create table public.colleges (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 2 and 200),
  code        text,
  city        text,
  created_at  timestamptz not null default now()
);
create unique index colleges_name_uq on public.colleges (lower(name));

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null,
  full_name     text not null check (length(full_name) between 1 and 200),
  phone         text,
  role          text not null check (role in ('admin', 'placement_cell', 'student')),
  status        text not null default 'pending'
                  check (status in ('pending', 'active', 'suspended', 'rejected')),
  status_reason text,
  college_id    uuid references public.colleges (id),
  consent_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint profiles_college_required check (role = 'admin' or college_id is not null)
);
create unique index profiles_email_uq on public.profiles (lower(email));
create index profiles_college_idx on public.profiles (college_id);
create index profiles_role_status_idx on public.profiles (role, status);
create trigger profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

create table public.placement_cell_invitations (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  college_id  uuid not null references public.colleges (id),
  token_hash  text not null unique,
  invited_by  uuid references public.profiles (id),
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id),
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index invitations_college_idx on public.placement_cell_invitations (college_id);
create index invitations_email_idx on public.placement_cell_invitations (lower(email));

-- ---------------------------------------------------------------------------
-- students
-- ---------------------------------------------------------------------------
create table public.student_profiles (
  user_id              uuid primary key references public.profiles (id) on delete cascade,
  college_id           uuid not null references public.colleges (id),
  department           text,
  roll_number          text,
  passing_year         int check (passing_year between 2000 and 2100),
  cgpa                 numeric(4, 2) check (cgpa between 0 and 10),
  tenth_percent        numeric(5, 2) check (tenth_percent between 0 and 100),
  twelfth_percent      numeric(5, 2) check (twelfth_percent between 0 and 100),
  active_backlogs      int check (active_backlogs >= 0),
  skills               text[] not null default '{}',
  certifications       jsonb not null default '[]'::jsonb,
  links                jsonb not null default '{}'::jsonb,
  career_interests     text[] not null default '{}',
  verification_status  text not null default 'unverified'
                         check (verification_status in ('unverified', 'verified', 'needs_changes')),
  verification_comment text,
  verified_by          uuid references public.profiles (id),
  verified_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index student_roll_uq on public.student_profiles (college_id, lower(roll_number))
  where roll_number is not null;
create index student_college_idx on public.student_profiles (college_id);
create index student_dept_idx on public.student_profiles (college_id, department);
create index student_verif_idx on public.student_profiles (college_id, verification_status);
create trigger student_profiles_updated before update on public.student_profiles
  for each row execute function public.set_updated_at();

create table public.student_projects (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.student_profiles (user_id) on delete cascade,
  title       text not null check (length(title) between 1 and 200),
  description text,
  tech        text[] not null default '{}',
  url         text,
  created_at  timestamptz not null default now()
);
create index student_projects_student_idx on public.student_projects (student_id);

create table public.student_experience (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.student_profiles (user_id) on delete cascade,
  kind         text not null default 'internship' check (kind in ('internship', 'job', 'other')),
  organization text not null check (length(organization) between 1 and 200),
  role         text,
  start_date   date,
  end_date     date,
  description  text,
  created_at   timestamptz not null default now()
);
create index student_experience_student_idx on public.student_experience (student_id);

create table public.resumes (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references public.student_profiles (user_id) on delete cascade,
  version           int not null,
  file_path         text not null,
  file_name         text not null,
  mime_type         text not null,
  size_bytes        int not null,
  extraction_status text not null check (extraction_status in ('ok', 'failed')),
  extraction_error  text,
  extracted_text    text,
  text_hash         text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  unique (student_id, version)
);
create unique index resumes_one_active_uq on public.resumes (student_id) where is_active;
create index resumes_student_idx on public.resumes (student_id);

-- ---------------------------------------------------------------------------
-- companies / drives
-- ---------------------------------------------------------------------------
create table public.companies (
  id             uuid primary key default gen_random_uuid(),
  college_id     uuid not null references public.colleges (id),
  name           text not null check (length(name) between 1 and 200),
  website        text,
  industry       text,
  contact_person text,
  contact_email  text,
  contact_phone  text,
  notes          text,
  status         text not null default 'active' check (status in ('active', 'inactive')),
  created_by     uuid references public.profiles (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index companies_name_uq on public.companies (college_id, lower(name));
create index companies_college_idx on public.companies (college_id);
create trigger companies_updated before update on public.companies
  for each row execute function public.set_updated_at();

-- Reserved for a future company login. Not exposed by any endpoint in this version.
create table public.company_contacts (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name       text not null,
  email      text,
  phone      text,
  created_at timestamptz not null default now()
);
create index company_contacts_company_idx on public.company_contacts (company_id);

create table public.drives (
  id                 uuid primary key default gen_random_uuid(),
  college_id         uuid not null references public.colleges (id),
  company_id         uuid not null references public.companies (id),
  title              text not null check (length(title) between 1 and 200),
  description        text,
  job_type           text not null default 'full_time' check (job_type in ('full_time', 'internship')),
  location           text,
  package_lpa        numeric(6, 2) check (package_lpa >= 0),
  stipend_per_month  numeric(10, 2) check (stipend_per_month >= 0),
  openings           int check (openings > 0),
  deadline           timestamptz not null,
  original_deadline  timestamptz,
  deadline_extended_by uuid references public.profiles (id),
  drive_date         timestamptz,
  status             text not null default 'draft'
                       check (status in ('draft', 'open', 'closed', 'completed', 'cancelled')),
  created_by         uuid references public.profiles (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index drives_college_status_idx on public.drives (college_id, status);
create index drives_company_idx on public.drives (company_id);
create index drives_deadline_idx on public.drives (deadline);
create trigger drives_updated before update on public.drives
  for each row execute function public.set_updated_at();

create table public.drive_skills (
  id         uuid primary key default gen_random_uuid(),
  drive_id   uuid not null references public.drives (id) on delete cascade,
  skill      text not null check (length(skill) between 1 and 80),
  importance text not null default 'mandatory' check (importance in ('mandatory', 'preferred'))
);
create unique index drive_skills_uq on public.drive_skills (drive_id, lower(skill));

create table public.drive_eligibility (
  drive_id            uuid primary key references public.drives (id) on delete cascade,
  min_cgpa            numeric(4, 2) check (min_cgpa between 0 and 10),
  max_backlogs        int check (max_backlogs >= 0),
  allowed_departments text[] not null default '{}',
  allowed_years       int[] not null default '{}',
  min_tenth_percent   numeric(5, 2) check (min_tenth_percent between 0 and 100),
  min_twelfth_percent numeric(5, 2) check (min_twelfth_percent between 0 and 100)
);

-- ---------------------------------------------------------------------------
-- applications / exceptions / interviews
-- ---------------------------------------------------------------------------
create table public.applications (
  id                   uuid primary key default gen_random_uuid(),
  student_id           uuid not null references public.student_profiles (user_id) on delete cascade,
  drive_id             uuid not null references public.drives (id) on delete cascade,
  college_id           uuid not null references public.colleges (id),
  status               text not null default 'applied'
                         check (status in ('applied', 'under_review', 'shortlisted',
                                           'interview_scheduled', 'selected', 'rejected', 'withdrawn')),
  via_exception        boolean not null default false,
  exception_request_id uuid,
  eligibility_snapshot jsonb not null,
  manual_rank          int,
  applied_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint applications_one_per_drive unique (student_id, drive_id)
);
create index applications_drive_idx on public.applications (drive_id, status);
create index applications_college_idx on public.applications (college_id);
create index applications_student_idx on public.applications (student_id);
create trigger applications_updated before update on public.applications
  for each row execute function public.set_updated_at();

create table public.application_status_history (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  from_status    text,
  to_status      text not null,
  changed_by     uuid references public.profiles (id),
  note           text,
  created_at     timestamptz not null default now()
);
create index app_history_app_idx on public.application_status_history (application_id);

create table public.exception_requests (
  id                   uuid primary key default gen_random_uuid(),
  student_id           uuid not null references public.student_profiles (user_id) on delete cascade,
  drive_id             uuid not null references public.drives (id) on delete cascade,
  college_id           uuid not null references public.colleges (id),
  reason               text not null check (length(reason) between 10 and 1000),
  status               text not null default 'pending'
                         check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  decision_note        text,
  decided_by           uuid references public.profiles (id),
  decided_at           timestamptz,
  eligibility_snapshot jsonb not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
-- one ACTIVE (pending or approved) request per student per drive
create unique index exception_active_uq on public.exception_requests (student_id, drive_id)
  where status in ('pending', 'approved');
create index exception_college_status_idx on public.exception_requests (college_id, status);
create index exception_drive_idx on public.exception_requests (drive_id);
create trigger exception_requests_updated before update on public.exception_requests
  for each row execute function public.set_updated_at();

alter table public.applications
  add constraint applications_exception_fk
  foreign key (exception_request_id) references public.exception_requests (id);

create table public.interviews (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  drive_id       uuid not null references public.drives (id) on delete cascade,
  student_id     uuid not null references public.student_profiles (user_id) on delete cascade,
  college_id     uuid not null references public.colleges (id),
  round_name     text not null,
  scheduled_at   timestamptz not null,
  mode           text not null check (mode in ('online', 'offline')),
  venue_or_link  text,
  notes          text,
  status         text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  created_by     uuid references public.profiles (id),
  created_at     timestamptz not null default now()
);
create index interviews_student_idx on public.interviews (student_id, scheduled_at);
create index interviews_drive_idx on public.interviews (drive_id);
create index interviews_app_idx on public.interviews (application_id);

-- ---------------------------------------------------------------------------
-- AI results, notifications, audit, settings
-- ---------------------------------------------------------------------------
create table public.ai_analyses (
  id              uuid primary key default gen_random_uuid(),
  feature         text not null,
  subject_user_id uuid references public.profiles (id) on delete cascade,
  drive_id        uuid references public.drives (id) on delete cascade,
  scope_key       text not null default 'none',
  model           text not null,
  prompt_version  text not null,
  input_hash      text not null,
  status          text not null check (status in ('ok', 'failed')),
  output          jsonb,
  error           text,
  created_at      timestamptz not null default now()
);
-- only successful results are cached/unique
create unique index ai_analyses_cache_uq
  on public.ai_analyses (feature, subject_user_id, scope_key, input_hash) where status = 'ok';
create index ai_analyses_subject_idx on public.ai_analyses (subject_user_id, feature, created_at desc);
create index ai_analyses_drive_idx on public.ai_analyses (drive_id);

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  actor_role  text,
  action      text not null,
  target_type text,
  target_id   text,
  college_id  uuid,
  old_value   jsonb,
  new_value   jsonb,
  ip          text,
  created_at  timestamptz not null default now()
);
create index audit_created_idx on public.audit_logs (created_at desc);
create index audit_actor_idx on public.audit_logs (actor_id);
create index audit_action_idx on public.audit_logs (action);

create table public.system_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- private resume bucket (no storage.objects policies => only service role can access)
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('resumes', 'resumes', false)
    on conflict (id) do nothing;
  end if;
end $$;

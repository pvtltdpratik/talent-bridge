-- TalentBridge AI: Row Level Security
-- Model: the API writes with a privileged connection. These policies are defence in depth for
-- any direct access with the anon/authenticated keys: read-only, scoped by role and college,
-- and NO insert/update/delete policies exist for those roles (=> denied).

create or replace function public.auth_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and status = 'active'
$$;

create or replace function public.auth_college() returns uuid
language sql stable security definer set search_path = public as $$
  select college_id from public.profiles where id = auth.uid() and status = 'active'
$$;

revoke all on function public.auth_role() from public;
revoke all on function public.auth_college() from public;
grant execute on function public.auth_role() to authenticated;
grant execute on function public.auth_college() to authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'colleges','profiles','placement_cell_invitations','student_profiles','student_projects',
    'student_experience','resumes','companies','company_contacts','drives','drive_skills',
    'drive_eligibility','applications','application_status_history','exception_requests',
    'interviews','ai_analyses','notifications','audit_logs','system_settings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- colleges: any signed-in user may list colleges
create policy colleges_read on public.colleges for select to authenticated using (true);

-- profiles
create policy profiles_read on public.profiles for select to authenticated using (
  id = auth.uid()
  or public.auth_role() = 'admin'
  or (public.auth_role() = 'placement_cell' and college_id = public.auth_college())
);

-- invitations: admin only
create policy invitations_read on public.placement_cell_invitations for select to authenticated
  using (public.auth_role() = 'admin');

-- student data: the student, same-college staff, admin
create policy student_profiles_read on public.student_profiles for select to authenticated using (
  user_id = auth.uid()
  or public.auth_role() = 'admin'
  or (public.auth_role() = 'placement_cell' and college_id = public.auth_college())
);
create policy student_projects_read on public.student_projects for select to authenticated using (
  exists (select 1 from public.student_profiles sp where sp.user_id = student_id)
);
create policy student_experience_read on public.student_experience for select to authenticated using (
  exists (select 1 from public.student_profiles sp where sp.user_id = student_id)
);
create policy resumes_read on public.resumes for select to authenticated using (
  exists (select 1 from public.student_profiles sp where sp.user_id = student_id)
);

-- companies / drives
create policy companies_read on public.companies for select to authenticated using (
  public.auth_role() = 'admin'
  or college_id = public.auth_college()
);
create policy company_contacts_read on public.company_contacts for select to authenticated using (
  public.auth_role() in ('admin', 'placement_cell')
  and exists (select 1 from public.companies c where c.id = company_id)
);
create policy drives_read on public.drives for select to authenticated using (
  public.auth_role() = 'admin'
  or (public.auth_role() = 'placement_cell' and college_id = public.auth_college())
  or (public.auth_role() = 'student' and college_id = public.auth_college()
      and status in ('open', 'closed', 'completed'))
);
create policy drive_skills_read on public.drive_skills for select to authenticated using (
  exists (select 1 from public.drives d where d.id = drive_id)
);
create policy drive_eligibility_read on public.drive_eligibility for select to authenticated using (
  exists (select 1 from public.drives d where d.id = drive_id)
);

-- applications / exceptions / interviews
create policy applications_read on public.applications for select to authenticated using (
  student_id = auth.uid()
  or public.auth_role() = 'admin'
  or (public.auth_role() = 'placement_cell' and college_id = public.auth_college())
);
create policy app_history_read on public.application_status_history for select to authenticated using (
  exists (select 1 from public.applications a where a.id = application_id)
);
create policy exception_read on public.exception_requests for select to authenticated using (
  student_id = auth.uid()
  or public.auth_role() = 'admin'
  or (public.auth_role() = 'placement_cell' and college_id = public.auth_college())
);
create policy interviews_read on public.interviews for select to authenticated using (
  student_id = auth.uid()
  or public.auth_role() = 'admin'
  or (public.auth_role() = 'placement_cell' and college_id = public.auth_college())
);

-- AI results: only the subject (and admin)
create policy ai_read on public.ai_analyses for select to authenticated using (
  subject_user_id = auth.uid() or public.auth_role() = 'admin'
);

-- notifications: own only
create policy notifications_read on public.notifications for select to authenticated
  using (user_id = auth.uid());

-- audit log: admin only
create policy audit_read on public.audit_logs for select to authenticated
  using (public.auth_role() = 'admin');

-- settings contain no secrets; readable by any signed-in user (writes: API only)
create policy settings_read on public.system_settings for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Defence in depth: the browser-facing roles never write directly. Supabase grants ALL on new
-- public tables to anon/authenticated by default; take the write privileges back. All writes go
-- through the API (privileged connection / service role).
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke insert, update, delete, truncate on tables from anon, authenticated;

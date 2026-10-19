-- GEMS Call Audit portal (Supabase). Run once in the SQL editor of a new project.
-- People sign in with a one-time code emailed to their @gemsedu.in address (no passwords).
-- Who sees what is enforced here, in the database, by row-level security:
--   admin       everything, and manages users, school ticks and caller mapping
--   corporate   every school
--   principal   calls made by the team of the schools ticked for them
--   counsellor  their own calls (matched by email: arya.suresh@gemsedu.in -> caller arya.suresh)
-- A call belongs to the school its caller is mapped to in staff, so changing the mapping applies at once.
-- Call data is written only by sync_portal.py with the service key (which bypasses RLS).

create table public.schools (id text primary key, short text not null);   -- id = CRM territory
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text unique not null, name text not null default '',
  role text not null check (role in ('admin', 'corporate', 'principal', 'counsellor')),
  active boolean not null default true, created_at timestamptz not null default now());
create table public.profile_schools (
  profile_id uuid references public.profiles on delete cascade,
  school_id text references public.schools on update cascade on delete cascade,
  primary key (profile_id, school_id));
-- Everyone who makes calls (CRM user id = email before the @). The admin maps each one to a school and their Exotel numbers.
create table public.staff (
  id text primary key, name text not null, email text, team text,
  school_id text references public.schools on update cascade on delete set null,
  exotel_numbers text[] not null default '{}');
-- One row per audited call (rep = caller's staff id). data = what the site shows.
create table public.calls (
  id text primary key, rep text not null, at timestamptz, rubric text not null, data jsonb not null, updated_at timestamptz not null default now());
create index calls_rep on public.calls (rep);
create index calls_rubric_at on public.calls (rubric, at);
create table public.counsellors (id text primary key, data jsonb not null);   -- persona + call funnel per caller
create table public.meta (rubric text primary key, data jsonb not null, generated text);
create table public.reviews (
  call_id text references public.calls on delete cascade,
  reviewer uuid not null default auth.uid() references public.profiles on delete cascade,
  at timestamptz not null default now(), data jsonb not null,
  primary key (call_id, reviewer));

create function public.my_role() returns text language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() and active $$;
-- Can the signed-in person see this caller's calls?
create function public.can_see_rep(r text) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles p where p.id = auth.uid() and p.active and (
         p.role in ('admin', 'corporate')
      or (p.role = 'counsellor' and split_part(p.email, '@', 1) = r)
      or (p.role = 'principal' and exists (select 1 from staff s join profile_schools ps on ps.school_id = s.school_id
                                           where s.id = r and ps.profile_id = p.id)))) $$;

alter table public.schools enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_schools enable row level security;
alter table public.staff enable row level security;
alter table public.calls enable row level security;
alter table public.counsellors enable row level security;
alter table public.meta enable row level security;
alter table public.reviews enable row level security;

create policy schools_read on public.schools for select to authenticated using (my_role() is not null);
create policy schools_admin on public.schools for all to authenticated using (my_role() = 'admin') with check (my_role() = 'admin');
create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or my_role() = 'admin');
create policy profiles_admin on public.profiles for all to authenticated using (my_role() = 'admin') with check (my_role() = 'admin');
create policy ps_read on public.profile_schools for select to authenticated using (profile_id = auth.uid() or my_role() = 'admin');
create policy ps_admin on public.profile_schools for all to authenticated using (my_role() = 'admin') with check (my_role() = 'admin');
create policy staff_read on public.staff for select to authenticated using (can_see_rep(id));
create policy staff_admin on public.staff for all to authenticated using (my_role() = 'admin') with check (my_role() = 'admin');
create policy calls_read on public.calls for select to authenticated using (can_see_rep(rep));
create policy counsellors_read on public.counsellors for select to authenticated using (can_see_rep(id));
create policy meta_read on public.meta for select to authenticated using (my_role() is not null);
create policy reviews_read on public.reviews for select to authenticated using (exists (select 1 from calls c where c.id = call_id));
create policy reviews_write on public.reviews for insert to authenticated with check (reviewer = auth.uid() and exists (select 1 from calls c where c.id = call_id));
create policy reviews_update on public.reviews for update to authenticated using (reviewer = auth.uid()) with check (reviewer = auth.uid());

-- Recordings: private bucket, one file per call (<call id>.mp3). Readable only if the caller can see that call.
insert into storage.buckets (id, name, public) values ('recordings', 'recordings', false) on conflict do nothing;
create policy recordings_read on storage.objects for select to authenticated using (
  bucket_id = 'recordings' and exists (select 1 from public.calls c where c.id = split_part(storage.filename(name), '.', 1)));

insert into public.schools (id, short) values
  ('GEMS Millennium School - Indirapuram', 'GMS Indirapuram'), ('GEMS Millennium School - Gurugram', 'GMS Gurugram'),
  ('GEMS Millennium School - Kochi', 'GMS Kochi'), ('GEMS Modern Academy - Kochi', 'GMA Kochi'),
  ('GEMS Modern Academy - Coimbatore', 'GMA Coimbatore'), ('GEMS School of Excellence - Lucknow', 'GSE Lucknow'),
  ('GEMS School of Excellence - Jodhpur', 'GSE Jodhpur'), ('GEMS Millennium School - Vikhroli', 'GMS Vikhroli'),
  ('GEMS Millennium School - Varanasi', 'GMS Varanasi'), ('GEMS Millennium School - Raipur', 'GMS Raipur'),
  ('GEMS Millennium School - Kalyan', 'GMS Kalyan'), ('Little GEMS - Kochi', 'Little GEMS Kochi');

-- First admin: add yourself under Authentication > Users > Add user (tick auto-confirm), then run with your email:
--   insert into public.profiles (id, email, name, role) select id, email, 'Dr Jay Vora', 'admin' from auth.users where email = 'YOU@gemsedu.in';

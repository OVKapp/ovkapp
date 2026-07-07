-- Procella OVK – första säkra databasversionen
-- Kör hela filen i Supabase > SQL Editor > New query.

create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('procella_admin', 'procella_staff', 'board', 'resident');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.inspection_status as enum ('draft', 'planned', 'in_progress', 'approved', 'remarks', 'closed');
exception when duplicate_object then null; end $$;

create table if not exists public.brfs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  organization_number text,
  email text,
  phone text,
  address text,
  postal_code text,
  city text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  brf_id uuid not null references public.brfs(id) on delete cascade,
  name text,
  street_address text not null,
  postal_code text,
  city text,
  stairwells integer not null default 1 check (stairwells > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.apartments (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  apartment_number text not null,
  official_number text,
  floor text,
  rooms_count integer check (rooms_count > 0),
  notes text,
  created_at timestamptz not null default now(),
  unique(property_id, apartment_number)
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  phone text,
  role public.app_role not null default 'resident',
  brf_id uuid references public.brfs(id) on delete set null,
  apartment_id uuid references public.apartments(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (role in ('procella_admin', 'procella_staff') and brf_id is null and apartment_id is null)
    or (role = 'board' and brf_id is not null and apartment_id is null)
    or (role = 'resident' and (apartment_id is not null or brf_id is null))
  )
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  apartment_id uuid not null references public.apartments(id) on delete cascade,
  name text not null,
  room_type text,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.ventilation_units (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  label text not null,
  unit_type text not null check (unit_type in ('supply', 'extract', 'transfer', 'other')),
  manufacturer text,
  model text,
  expected_flow_lps numeric,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.inspections (
  id uuid primary key default gen_random_uuid(),
  brf_id uuid not null references public.brfs(id) on delete cascade,
  title text not null,
  inspection_date date,
  next_due_date date,
  status public.inspection_status not null default 'draft',
  inspector_company text not null default 'Procella Ventilation AB',
  inspector_name text,
  summary text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inspection_entries (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  ventilation_unit_id uuid not null references public.ventilation_units(id) on delete cascade,
  measured_flow_lps numeric,
  setting_value text,
  result text check (result in ('approved', 'remark', 'not_accessible', 'not_inspected')),
  comment text,
  inspected_at timestamptz,
  inspected_by uuid references public.profiles(id) on delete set null,
  unique(inspection_id, ventilation_unit_id)
);

create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  brf_id uuid not null references public.brfs(id) on delete cascade,
  apartment_id uuid not null references public.apartments(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete set null,
  ventilation_unit_id uuid references public.ventilation_units(id) on delete set null,
  inspection_id uuid references public.inspections(id) on delete set null,
  storage_path text not null unique,
  media_type text not null default 'photo' check (media_type in ('photo', 'video')),
  caption text,
  captured_at timestamptz,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  brf_id uuid not null references public.brfs(id) on delete cascade,
  apartment_id uuid references public.apartments(id) on delete cascade,
  inspection_id uuid references public.inspections(id) on delete set null,
  title text not null,
  document_type text,
  storage_path text not null unique,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.deviations (
  id uuid primary key default gen_random_uuid(),
  brf_id uuid not null references public.brfs(id) on delete cascade,
  apartment_id uuid not null references public.apartments(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete set null,
  inspection_id uuid references public.inspections(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'needs_review' check (status in ('needs_review', 'confirmed', 'action_required', 'resolved', 'dismissed')),
  due_date date,
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.board_contacts (
  id uuid primary key default gen_random_uuid(),
  brf_id uuid not null references public.brfs(id) on delete cascade,
  name text not null,
  title text,
  email text,
  phone text,
  ovk_responsible boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  table_name text not null,
  record_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Endast databasägaren kan läsa denna lista. Den används när första kontot skapas.
create table if not exists public.procella_admin_allowlist (
  email text primary key,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.procella_admin_allowlist(email)
values ('kewin.richert@procellavent.se')
on conflict (email) do update set active = true;

create or replace function public.current_role()
returns public.app_role language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() and active = true $$;

create or replace function public.current_brf_id()
returns uuid language sql stable security definer set search_path = public
as $$
  select coalesce(
    pr.brf_id,
    (select p.brf_id
     from public.apartments a
     join public.properties p on p.id = a.property_id
     where a.id = pr.apartment_id)
  )
  from public.profiles pr
  where pr.id = auth.uid() and pr.active = true
$$;

create or replace function public.current_apartment_id()
returns uuid language sql stable security definer set search_path = public
as $$ select apartment_id from public.profiles where id = auth.uid() and active = true $$;

create or replace function public.is_procella()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.current_role() in ('procella_admin', 'procella_staff'), false) $$;

create or replace function public.can_access_brf(target_brf_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select public.is_procella() or target_brf_id = public.current_brf_id() $$;

create or replace function public.can_access_property(target_property_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_procella() or exists (
    select 1 from public.properties p
    where p.id = target_property_id and (
      (public.current_role() = 'board' and p.brf_id = public.current_brf_id())
      or exists (select 1 from public.apartments a where a.id = public.current_apartment_id() and a.property_id = p.id)
    )
  )
$$;

create or replace function public.can_access_apartment(target_apartment_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_procella()
    or target_apartment_id = public.current_apartment_id()
    or (public.current_role() = 'board' and exists (
      select 1 from public.apartments a join public.properties p on p.id = a.property_id
      where a.id = target_apartment_id and p.brf_id = public.current_brf_id()
    ))
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare assigned_role public.app_role := 'resident';
begin
  if exists (
    select 1 from public.procella_admin_allowlist
    where lower(email) = lower(new.email) and active = true
  ) then assigned_role := 'procella_admin'; end if;

  insert into public.profiles(id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''), assigned_role)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.protect_profile_access_fields()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_procella() then
    new.role := old.role;
    new.brf_id := old.brf_id;
    new.apartment_id := old.apartment_id;
    new.active := old.active;
    new.email := old.email;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists protect_profile_access_fields on public.profiles;
create trigger protect_profile_access_fields before update on public.profiles
for each row execute procedure public.protect_profile_access_fields();

alter table public.brfs enable row level security;
alter table public.properties enable row level security;
alter table public.apartments enable row level security;
alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.ventilation_units enable row level security;
alter table public.inspections enable row level security;
alter table public.inspection_entries enable row level security;
alter table public.media enable row level security;
alter table public.documents enable row level security;
alter table public.deviations enable row level security;
alter table public.board_contacts enable row level security;
alter table public.audit_log enable row level security;
alter table public.procella_admin_allowlist enable row level security;

-- Procella har full åtkomst till verksamhetsdata.
create policy "procella_all_brfs" on public.brfs for all to authenticated using (public.is_procella()) with check (public.is_procella());
create policy "procella_all_properties" on public.properties for all to authenticated using (public.is_procella()) with check (public.is_procella());
create policy "procella_all_apartments" on public.apartments for all to authenticated using (public.is_procella()) with check (public.is_procella());
create policy "procella_all_profiles" on public.profiles for all to authenticated using (public.is_procella()) with check (public.is_procella());
create policy "procella_all_rooms" on public.rooms for all to authenticated using (public.is_procella()) with check (public.is_procella());
create policy "procella_all_units" on public.ventilation_units for all to authenticated using (public.is_procella()) with check (public.is_procella());
create policy "procella_all_inspections" on public.inspections for all to authenticated using (public.is_procella()) with check (public.is_procella());
create policy "procella_all_entries" on public.inspection_entries for all to authenticated using (public.is_procella()) with check (public.is_procella());
create policy "procella_all_media" on public.media for all to authenticated using (public.is_procella()) with check (public.is_procella());
create policy "procella_all_documents" on public.documents for all to authenticated using (public.is_procella()) with check (public.is_procella());
create policy "procella_all_deviations" on public.deviations for all to authenticated using (public.is_procella()) with check (public.is_procella());
create policy "procella_all_contacts" on public.board_contacts for all to authenticated using (public.is_procella()) with check (public.is_procella());
create policy "procella_read_audit" on public.audit_log for select to authenticated using (public.is_procella());

-- En användare får läsa sin egen profil. Styrelsen får se användare i sin BRF.
create policy "profile_scope_read" on public.profiles for select to authenticated using (
  id = auth.uid() or (public.current_role() = 'board' and brf_id = public.current_brf_id())
);
create policy "profile_self_update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- BRF och fastigheter: styrelse ser sin BRF. Boende får endast den BRF som den egna lägenheten tillhör.
create policy "brf_scope_read" on public.brfs for select to authenticated using (
  public.can_access_brf(id)
);
create policy "property_scope_read" on public.properties for select to authenticated using (
  public.can_access_property(id)
);
create policy "apartment_scope_read" on public.apartments for select to authenticated using (
  public.can_access_apartment(id)
);
create policy "room_scope_read" on public.rooms for select to authenticated using (
  apartment_id = public.current_apartment_id()
  or (public.current_role() = 'board' and exists (
    select 1 from public.apartments a join public.properties p on p.id = a.property_id
    where a.id = rooms.apartment_id and p.brf_id = public.current_brf_id()
  ))
);
create policy "unit_scope_read" on public.ventilation_units for select to authenticated using (
  exists (
    select 1 from public.rooms r join public.apartments a on a.id = r.apartment_id
    join public.properties p on p.id = a.property_id
    where r.id = ventilation_units.room_id
      and (a.id = public.current_apartment_id() or (public.current_role() = 'board' and p.brf_id = public.current_brf_id()))
  )
);

create policy "board_inspection_read" on public.inspections for select to authenticated using (
  public.current_role() = 'board' and brf_id = public.current_brf_id()
);
create policy "entry_scope_read" on public.inspection_entries for select to authenticated using (
  exists (
    select 1 from public.ventilation_units u join public.rooms r on r.id = u.room_id
    join public.apartments a on a.id = r.apartment_id join public.properties p on p.id = a.property_id
    where u.id = inspection_entries.ventilation_unit_id
      and (a.id = public.current_apartment_id() or (public.current_role() = 'board' and p.brf_id = public.current_brf_id()))
  )
);
create policy "media_scope_read" on public.media for select to authenticated using (
  apartment_id = public.current_apartment_id()
  or (public.current_role() = 'board' and brf_id = public.current_brf_id())
);
create policy "document_scope_read" on public.documents for select to authenticated using (
  (public.current_role() = 'board' and brf_id = public.current_brf_id())
  or apartment_id = public.current_apartment_id()
);
create policy "deviation_scope_read" on public.deviations for select to authenticated using (
  apartment_id = public.current_apartment_id()
  or (public.current_role() = 'board' and brf_id = public.current_brf_id())
);
create policy "contact_scope_read" on public.board_contacts for select to authenticated using (
  brf_id = public.current_brf_id()
  or exists (
    select 1 from public.apartments a join public.properties p on p.id = a.property_id
    where a.id = public.current_apartment_id() and p.brf_id = board_contacts.brf_id
  )
);

-- Privata filarkiv. Filväg för bilder: brf-id/lägenhets-id/filnamn.
insert into storage.buckets(id, name, public) values ('ventilation-media', 'ventilation-media', false)
on conflict (id) do update set public = false;
insert into storage.buckets(id, name, public) values ('ovk-documents', 'ovk-documents', false)
on conflict (id) do update set public = false;

create policy "procella_manage_ventilation_files" on storage.objects for all to authenticated
using (bucket_id = 'ventilation-media' and public.is_procella())
with check (bucket_id = 'ventilation-media' and public.is_procella());
create policy "scoped_read_ventilation_files" on storage.objects for select to authenticated
using (
  bucket_id = 'ventilation-media'
  and (storage.foldername(name))[1] = public.current_brf_id()::text
  and (
    public.current_role() = 'board'
    or (storage.foldername(name))[2] = public.current_apartment_id()::text
  )
);
create policy "procella_manage_document_files" on storage.objects for all to authenticated
using (bucket_id = 'ovk-documents' and public.is_procella())
with check (bucket_id = 'ovk-documents' and public.is_procella());
create policy "board_read_document_files" on storage.objects for select to authenticated
using (
  bucket_id = 'ovk-documents'
  and public.current_role() = 'board'
  and (storage.foldername(name))[1] = public.current_brf_id()::text
);

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.current_role() to authenticated;
grant execute on function public.current_brf_id() to authenticated;
grant execute on function public.current_apartment_id() to authenticated;
grant execute on function public.is_procella() to authenticated;
grant execute on function public.can_access_brf(uuid) to authenticated;
grant execute on function public.can_access_property(uuid) to authenticated;
grant execute on function public.can_access_apartment(uuid) to authenticated;
revoke all on public.procella_admin_allowlist from anon, authenticated;

-- Kontrollrad: ska ge 14 tabeller när installationen lyckats.
select count(*) as procella_tables_created
from information_schema.tables
where table_schema = 'public'
  and table_name in ('brfs','properties','apartments','profiles','rooms','ventilation_units','inspections','inspection_entries','media','documents','deviations','board_contacts','audit_log','procella_admin_allowlist');

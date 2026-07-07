-- Procella OVK – användarinbjudningar och automatisk behörighetskoppling
-- Kör hela filen en gång i Supabase SQL Editor.

create table if not exists public.access_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text,
  role public.app_role not null check (role in ('procella_staff', 'board', 'resident')),
  brf_id uuid references public.brfs(id) on delete cascade,
  apartment_id uuid references public.apartments(id) on delete cascade,
  invited_by uuid references public.profiles(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  check (
    (role = 'procella_staff' and brf_id is null and apartment_id is null)
    or (role = 'board' and brf_id is not null and apartment_id is null)
    or (role = 'resident' and brf_id is not null and apartment_id is not null)
  )
);

create unique index if not exists access_invitations_pending_email_idx
on public.access_invitations(lower(email)) where status = 'pending';

alter table public.access_invitations enable row level security;

drop policy if exists "procella_manage_invitations" on public.access_invitations;
create policy "procella_manage_invitations"
on public.access_invitations for all to authenticated
using (public.is_procella())
with check (public.is_procella());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned_role public.app_role := 'resident';
  assigned_brf uuid := null;
  assigned_apartment uuid := null;
  invitation_id uuid := null;
begin
  if exists (
    select 1 from public.procella_admin_allowlist
    where lower(email) = lower(new.email) and active = true
  ) then
    assigned_role := 'procella_admin';
  else
    select i.id, i.role, i.brf_id, i.apartment_id
      into invitation_id, assigned_role, assigned_brf, assigned_apartment
    from public.access_invitations i
    where lower(i.email) = lower(new.email) and i.status = 'pending'
    order by i.created_at desc
    limit 1;
  end if;

  insert into public.profiles(id, email, full_name, role, brf_id, apartment_id)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''),
             (select full_name from public.access_invitations where id = invitation_id), ''),
    assigned_role,
    assigned_brf,
    assigned_apartment
  )
  on conflict (id) do nothing;

  if invitation_id is not null then
    update public.access_invitations
    set status = 'accepted', accepted_at = now()
    where id = invitation_id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

grant select, insert, update, delete on public.access_invitations to authenticated;

select 'Användarinbjudningar är installerade' as result;

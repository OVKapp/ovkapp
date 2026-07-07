-- Procella OVK – dataradering och Autogiro-förfrågningar
-- Kör efter subscriptions.sql.

alter table public.brf_subscriptions
  add column if not exists data_deletion_at timestamptz,
  add column if not exists automatic_card_payment boolean not null default true;

update public.brf_subscriptions
set data_deletion_at = trial_ends_at
where data_deletion_at is null and trial_ends_at is not null and status in ('trialing','pending');

create table if not exists public.purged_brfs (
  id uuid primary key default gen_random_uuid(),
  original_brf_id uuid not null,
  brf_name text not null,
  organization_number text,
  apartment_count integer not null default 0,
  reason text not null,
  deleted_at timestamptz not null default now()
);
create unique index if not exists purged_brfs_original_id_idx on public.purged_brfs(original_brf_id);

create table if not exists public.autogiro_requests (
  id uuid primary key default gen_random_uuid(),
  brf_id uuid not null references public.brfs(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'requested' check (status in ('requested','quoted','active','declined','canceled')),
  provider_name text,
  provider_cost_ore integer check (provider_cost_ore is null or provider_cost_ore >= 0),
  markup_percent numeric(5,2) not null default 10.00,
  customer_addon_ore integer check (customer_addon_ore is null or customer_addon_ore >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists autogiro_open_request_idx on public.autogiro_requests(brf_id)
where status in ('requested','quoted','active');

create or replace function public.calculate_autogiro_addon()
returns trigger language plpgsql set search_path = public
as $$ begin
  if new.provider_cost_ore is not null then
    new.customer_addon_ore := ceil(new.provider_cost_ore * (1 + new.markup_percent / 100.0));
  else
    new.customer_addon_ore := null;
  end if;
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists on_autogiro_calculate_addon on public.autogiro_requests;
create trigger on_autogiro_calculate_addon before insert or update of provider_cost_ore, markup_percent
on public.autogiro_requests for each row execute procedure public.calculate_autogiro_addon();

alter table public.purged_brfs enable row level security;
alter table public.autogiro_requests enable row level security;

drop policy if exists "procella_read_purged_brfs" on public.purged_brfs;
drop policy if exists "procella_manage_autogiro" on public.autogiro_requests;
drop policy if exists "board_read_autogiro" on public.autogiro_requests;
drop policy if exists "board_request_autogiro" on public.autogiro_requests;

create policy "procella_read_purged_brfs" on public.purged_brfs for select to authenticated
using (public.is_procella());
create policy "procella_manage_autogiro" on public.autogiro_requests for all to authenticated
using (public.is_procella()) with check (public.is_procella());
create policy "board_read_autogiro" on public.autogiro_requests for select to authenticated
using (public.current_role() = 'board' and brf_id = public.current_brf_id());
create policy "board_request_autogiro" on public.autogiro_requests for insert to authenticated
with check (public.current_role() = 'board' and brf_id = public.current_brf_id() and requested_by = auth.uid());

grant select on public.purged_brfs to authenticated;
grant select, insert, update, delete on public.autogiro_requests to authenticated;

-- Uppdatera provperiodstriggern så raderingsdatum sätts samtidigt.
create or replace function public.start_brf_trial_on_first_board()
returns trigger language plpgsql security definer set search_path = public
as $$
declare trial_end timestamptz;
begin
  if new.role = 'board' and new.brf_id is not null and new.active = true then
    perform public.refresh_brf_subscription(new.brf_id);
    trial_end := now() + interval '3 months';
    update public.brf_subscriptions
    set status = case when status = 'pending' then 'trialing' else status end,
        trial_started_at = coalesce(trial_started_at, now()),
        trial_ends_at = coalesce(trial_ends_at, trial_end),
        data_deletion_at = coalesce(data_deletion_at, trial_end),
        updated_at = now()
    where brf_id = new.brf_id and trial_started_at is null;
  end if;
  return new;
end; $$;

select 'Dataradering och Autogiro-tillval är installerade' as result;

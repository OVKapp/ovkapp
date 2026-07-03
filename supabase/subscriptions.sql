-- Procella OVK – provperioder och BRF-abonnemang
-- Kör hela filen en gång i Supabase SQL Editor.

create table if not exists public.brf_subscriptions (
  brf_id uuid primary key references public.brfs(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','trialing','active','past_due','paused','canceled')),
  apartment_count integer not null default 0,
  plan_code text not null default 'small' check (plan_code in ('small','medium','large','custom')),
  monthly_price_ore integer,
  currency text not null default 'sek',
  prices_exclude_vat boolean not null default true,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_started_at timestamptz,
  current_period_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.subscription_plan_for_count(total integer)
returns table(plan_code text, monthly_price_ore integer)
language sql immutable
as $$
  select case
    when total <= 99 then 'small'
    when total <= 199 then 'medium'
    when total <= 499 then 'large'
    else 'custom'
  end,
  case
    when total <= 99 then 9900
    when total <= 199 then 19900
    when total <= 499 then 39900
    else null
  end
$$;

create or replace function public.refresh_brf_subscription(target_brf_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare total integer;
declare selected_plan text;
declare selected_price integer;
begin
  select count(*)::integer into total
  from public.apartments a
  join public.properties p on p.id = a.property_id
  where p.brf_id = target_brf_id;

  select plan_code, monthly_price_ore into selected_plan, selected_price
  from public.subscription_plan_for_count(total);

  insert into public.brf_subscriptions(brf_id, apartment_count, plan_code, monthly_price_ore)
  values (target_brf_id, total, selected_plan, selected_price)
  on conflict (brf_id) do update set
    apartment_count = excluded.apartment_count,
    plan_code = excluded.plan_code,
    monthly_price_ore = excluded.monthly_price_ore,
    updated_at = now();
end; $$;

create or replace function public.create_brf_subscription()
returns trigger language plpgsql security definer set search_path = public
as $$ begin
  perform public.refresh_brf_subscription(new.id);
  return new;
end; $$;

drop trigger if exists on_brf_create_subscription on public.brfs;
create trigger on_brf_create_subscription after insert on public.brfs
for each row execute procedure public.create_brf_subscription();

create or replace function public.refresh_subscription_from_apartment()
returns trigger language plpgsql security definer set search_path = public
as $$
declare old_brf uuid;
declare new_brf uuid;
begin
  if tg_op <> 'INSERT' then
    select p.brf_id into old_brf from public.properties p where p.id = old.property_id;
  end if;
  if tg_op <> 'DELETE' then
    select p.brf_id into new_brf from public.properties p where p.id = new.property_id;
  end if;
  if old_brf is not null then perform public.refresh_brf_subscription(old_brf); end if;
  if new_brf is not null and new_brf is distinct from old_brf then perform public.refresh_brf_subscription(new_brf); end if;
  return null;
end; $$;

drop trigger if exists on_apartment_refresh_subscription on public.apartments;
create trigger on_apartment_refresh_subscription
after insert or update of property_id or delete on public.apartments
for each row execute procedure public.refresh_subscription_from_apartment();

create or replace function public.refresh_subscription_from_property()
returns trigger language plpgsql security definer set search_path = public
as $$ begin
  if tg_op = 'INSERT' then
    perform public.refresh_brf_subscription(new.brf_id);
  elsif tg_op = 'DELETE' then
    perform public.refresh_brf_subscription(old.brf_id);
  else
    perform public.refresh_brf_subscription(old.brf_id);
    if new.brf_id is distinct from old.brf_id then perform public.refresh_brf_subscription(new.brf_id); end if;
  end if;
  return null;
end; $$;

drop trigger if exists on_property_refresh_subscription on public.properties;
create trigger on_property_refresh_subscription
after insert or update of brf_id or delete on public.properties
for each row execute procedure public.refresh_subscription_from_property();

create or replace function public.start_brf_trial_on_first_board()
returns trigger language plpgsql security definer set search_path = public
as $$ begin
  if new.role = 'board' and new.brf_id is not null and new.active = true then
    perform public.refresh_brf_subscription(new.brf_id);
    update public.brf_subscriptions
    set status = case when status = 'pending' then 'trialing' else status end,
        trial_started_at = coalesce(trial_started_at, now()),
        trial_ends_at = coalesce(trial_ends_at, now() + interval '3 months'),
        updated_at = now()
    where brf_id = new.brf_id and trial_started_at is null;
  end if;
  return new;
end; $$;

drop trigger if exists on_board_start_brf_trial on public.profiles;
create trigger on_board_start_brf_trial
after insert or update of active, role, brf_id on public.profiles
for each row execute procedure public.start_brf_trial_on_first_board();

insert into public.brf_subscriptions(brf_id)
select id from public.brfs
on conflict (brf_id) do nothing;

do $$ declare item record; begin
  for item in select id from public.brfs loop
    perform public.refresh_brf_subscription(item.id);
  end loop;
end $$;

-- Om en styrelse redan finns när migrationen körs startas provperioden från nu.
update public.brf_subscriptions s
set status = 'trialing', trial_started_at = now(), trial_ends_at = now() + interval '3 months', updated_at = now()
where s.trial_started_at is null
  and exists (select 1 from public.profiles p where p.brf_id = s.brf_id and p.role = 'board' and p.active = true);

create or replace function public.subscription_access_active(target_brf_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_procella() or exists (
    select 1 from public.brf_subscriptions s
    where s.brf_id = target_brf_id and (
      s.status = 'active'
      or (s.status in ('pending','trialing') and (s.trial_ends_at is null or s.trial_ends_at > now()))
      or (s.cancel_at_period_end = true and s.current_period_ends_at > now())
    )
  )
$$;

alter table public.brf_subscriptions enable row level security;
drop policy if exists "procella_manage_subscriptions" on public.brf_subscriptions;
drop policy if exists "brf_read_subscription" on public.brf_subscriptions;
create policy "procella_manage_subscriptions" on public.brf_subscriptions for all to authenticated
using (public.is_procella()) with check (public.is_procella());
create policy "brf_read_subscription" on public.brf_subscriptions for select to authenticated
using (brf_id = public.current_brf_id());

grant select on public.brf_subscriptions to authenticated;
grant execute on function public.subscription_access_active(uuid) to authenticated;

-- Abonnemanget läggs ovanpå de befintliga BRF-reglerna.
create or replace function public.can_access_brf(target_brf_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_procella()
    or (target_brf_id = public.current_brf_id() and public.subscription_access_active(target_brf_id))
$$;

create or replace function public.can_access_property(target_property_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_procella() or exists (
    select 1 from public.properties p
    where p.id = target_property_id
      and public.subscription_access_active(p.brf_id)
      and (
        (public.current_role() = 'board' and p.brf_id = public.current_brf_id())
        or exists (select 1 from public.apartments a where a.id = public.current_apartment_id() and a.property_id = p.id)
      )
  )
$$;

create or replace function public.can_access_apartment(target_apartment_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_procella() or exists (
    select 1 from public.apartments a join public.properties p on p.id = a.property_id
    where a.id = target_apartment_id
      and public.subscription_access_active(p.brf_id)
      and (a.id = public.current_apartment_id() or (public.current_role() = 'board' and p.brf_id = public.current_brf_id()))
  )
$$;

select 'Provperiod och abonnemang är installerade' as result;

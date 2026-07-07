-- Procella OVK – e-post- och pushnotiser
-- Kör hela filen en gång i Supabase SQL Editor efter messaging.sql.

create table if not exists public.notification_preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  email_enabled boolean not null default true,
  push_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('email','push')),
  status text not null check (status in ('sent','failed','skipped')),
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_profile_idx on public.push_subscriptions(profile_id);
create index if not exists notification_deliveries_message_idx on public.notification_deliveries(message_id);

insert into public.notification_preferences(profile_id)
select id from public.profiles
on conflict (profile_id) do nothing;

create or replace function public.create_notification_preferences()
returns trigger language plpgsql security definer set search_path = public
as $$ begin
  insert into public.notification_preferences(profile_id)
  values (new.id)
  on conflict (profile_id) do nothing;
  return new;
end; $$;

drop trigger if exists on_profile_create_notification_preferences on public.profiles;
create trigger on_profile_create_notification_preferences
after insert on public.profiles
for each row execute procedure public.create_notification_preferences();

alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_deliveries enable row level security;

drop policy if exists "own_notification_preferences_read" on public.notification_preferences;
drop policy if exists "own_notification_preferences_insert" on public.notification_preferences;
drop policy if exists "own_notification_preferences_update" on public.notification_preferences;
drop policy if exists "own_push_subscriptions" on public.push_subscriptions;
drop policy if exists "procella_notification_deliveries_read" on public.notification_deliveries;

create policy "own_notification_preferences_read"
on public.notification_preferences for select to authenticated
using (profile_id = auth.uid());

create policy "own_notification_preferences_insert"
on public.notification_preferences for insert to authenticated
with check (profile_id = auth.uid());

create policy "own_notification_preferences_update"
on public.notification_preferences for update to authenticated
using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy "own_push_subscriptions"
on public.push_subscriptions for all to authenticated
using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy "procella_notification_deliveries_read"
on public.notification_deliveries for select to authenticated
using (public.is_procella());

grant select, insert, update on public.notification_preferences to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select on public.notification_deliveries to authenticated;

select 'E-post och pushnotiser är installerade' as result;

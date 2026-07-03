-- Procella OVK – fakturabetalning en månad i förskott
-- Kör efter subscriptions.sql och retention-and-autogiro.sql.

alter table public.brf_subscriptions
  add column if not exists payment_method text not null default 'card';

alter table public.brf_subscriptions drop constraint if exists brf_subscriptions_payment_method_check;
alter table public.brf_subscriptions add constraint brf_subscriptions_payment_method_check
check (payment_method in ('card','invoice','autogiro'));

create table if not exists public.invoice_payment_requests (
  id uuid primary key default gen_random_uuid(),
  brf_id uuid not null references public.brfs(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  invoice_email text not null,
  organization_number text,
  reference_text text,
  status text not null default 'requested' check (status in ('requested','approved','active','declined','canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists invoice_payment_open_request_idx
on public.invoice_payment_requests(brf_id) where status in ('requested','approved','active');

create table if not exists public.subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  brf_id uuid not null references public.brfs(id) on delete cascade,
  external_invoice_number text,
  period_started_at timestamptz not null,
  period_ends_at timestamptz not null,
  subtotal_ore integer not null check (subtotal_ore > 0),
  vat_ore integer not null check (vat_ore >= 0),
  total_ore integer not null check (total_ore > 0),
  status text not null check (status in ('draft','sent','paid','overdue','void')),
  issued_at timestamptz not null default now(),
  due_at timestamptz not null,
  paid_at timestamptz,
  registered_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (period_ends_at > period_started_at)
);

create index if not exists subscription_invoices_brf_period_idx
on public.subscription_invoices(brf_id, period_ends_at desc);

alter table public.invoice_payment_requests enable row level security;
alter table public.subscription_invoices enable row level security;

drop policy if exists "procella_manage_invoice_requests" on public.invoice_payment_requests;
drop policy if exists "board_read_invoice_requests" on public.invoice_payment_requests;
drop policy if exists "board_create_invoice_request" on public.invoice_payment_requests;
drop policy if exists "procella_manage_subscription_invoices" on public.subscription_invoices;
drop policy if exists "brf_read_subscription_invoices" on public.subscription_invoices;

create policy "procella_manage_invoice_requests" on public.invoice_payment_requests for all to authenticated
using (public.is_procella()) with check (public.is_procella());
create policy "board_read_invoice_requests" on public.invoice_payment_requests for select to authenticated
using (public.current_role() = 'board' and brf_id = public.current_brf_id());
create policy "board_create_invoice_request" on public.invoice_payment_requests for insert to authenticated
with check (public.current_role() = 'board' and brf_id = public.current_brf_id() and requested_by = auth.uid());

create policy "procella_manage_subscription_invoices" on public.subscription_invoices for all to authenticated
using (public.is_procella()) with check (public.is_procella());
create policy "brf_read_subscription_invoices" on public.subscription_invoices for select to authenticated
using (brf_id = public.current_brf_id());

grant select, insert, update, delete on public.invoice_payment_requests to authenticated;
grant select, insert, update, delete on public.subscription_invoices to authenticated;

create or replace function public.register_paid_invoice(target_brf_id uuid, invoice_number text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare subscription_record public.brf_subscriptions%rowtype;
declare period_start timestamptz;
declare period_end timestamptz;
declare vat_amount integer;
declare invoice_id uuid;
begin
  if not public.is_procella() then raise exception 'Endast Procella kan registrera en fakturabetalning'; end if;
  select * into subscription_record from public.brf_subscriptions where brf_id = target_brf_id for update;
  if subscription_record.brf_id is null then raise exception 'Abonnemanget saknas'; end if;
  if subscription_record.monthly_price_ore is null then raise exception 'Föreningen behöver en personlig offert'; end if;
  if subscription_record.stripe_subscription_id is not null and subscription_record.payment_method = 'card' and subscription_record.status = 'active' then
    raise exception 'Avsluta först det automatiska kortabonnemanget för att undvika dubbelbetalning';
  end if;

  period_start := greatest(coalesce(subscription_record.current_period_ends_at, subscription_record.trial_ends_at, now()), now());
  period_end := period_start + interval '1 month';
  vat_amount := ceil(subscription_record.monthly_price_ore * 0.25);

  insert into public.subscription_invoices(brf_id, external_invoice_number, period_started_at, period_ends_at, subtotal_ore, vat_ore, total_ore, status, due_at, paid_at, registered_by)
  values (target_brf_id, nullif(trim(invoice_number),''), period_start, period_end, subscription_record.monthly_price_ore, vat_amount, subscription_record.monthly_price_ore + vat_amount, 'paid', period_start, now(), auth.uid())
  returning id into invoice_id;

  update public.brf_subscriptions set
    status = 'active', payment_method = 'invoice', current_period_started_at = period_start,
    current_period_ends_at = period_end, data_deletion_at = null, updated_at = now()
  where brf_id = target_brf_id;

  update public.invoice_payment_requests set status = 'active', updated_at = now()
  where brf_id = target_brf_id and status in ('requested','approved');
  return invoice_id;
end; $$;

grant execute on function public.register_paid_invoice(uuid,text) to authenticated;

create or replace function public.subscription_access_active(target_brf_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_procella() or exists (
    select 1 from public.brf_subscriptions s
    where s.brf_id = target_brf_id and (
      (s.status = 'active' and (s.payment_method <> 'invoice' or s.current_period_ends_at > now()))
      or (s.status in ('pending','trialing') and (s.trial_ends_at is null or s.trial_ends_at > now()))
      or (s.cancel_at_period_end = true and s.current_period_ends_at > now())
    )
  )
$$;

select 'Fakturabetalning i förskott är installerad' as result;

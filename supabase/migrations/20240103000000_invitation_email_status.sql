-- Procella OVK – leveransstatus för inbjudningsmejl
-- Kör hela filen en gång i Supabase SQL Editor.

alter table public.access_invitations
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_delivery_status text,
  add column if not exists email_delivery_error text;

alter table public.access_invitations
  drop constraint if exists access_invitations_email_delivery_status_check;

alter table public.access_invitations
  add constraint access_invitations_email_delivery_status_check
  check (email_delivery_status is null or email_delivery_status in ('sent','failed'));

select 'Inbjudningsmejl är förberett' as result;

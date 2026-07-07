-- Procella OVK – lokal seed-data (grunddata i public-schemat).
-- Körs automatiskt av Supabase CLI efter migrationerna vid `supabase start` / `supabase db reset`.
--
-- OBS: Auth-användare kan INTE skapas säkert med rå SQL mot auth.users, eftersom
-- GoTrues interna tabellstruktur (t.ex. auth.identities) skiljer sig mellan CLI-versioner.
-- De tre exempelanvändarna skapas därför via Supabase Admin API i ett separat steg:
--   node supabase/seed-users-and-data.mjs
-- Det scriptet skapar också rum, ventilationsdon, besiktning, avvikelser, dokument och
-- bilder (inklusive faktiska filer i Storage), eftersom det kräver de profil-ID:n som
-- uppstår när auth-användarna skapas. Se DEVELOPING.md för den fullständiga ordningen.
--
-- Denna fil sätter bara upp det som är stabilt att seeda med ren SQL:
--   1. En BRF, en fastighet och tre lägenheter (fasta ID:n, återanvänds av steg 2).
--   2. Väntande inbjudningar så att styrelse- och boende-kontot får rätt roll/koppling
--      automatiskt när de skapas (samma trigger som i produktion, ingen specialkod).
--   3. Ett lokalt admin-konto i `procella_admin_allowlist`.

insert into public.brfs (id, name, organization_number, email, address, postal_code, city)
values (
  '11111111-1111-1111-1111-111111111111',
  'BRF Lokal Utveckling',
  '769999-0001',
  'styrelsen@brf-lokal.test',
  'Testvägen 1',
  '111 11',
  'Stockholm'
)
on conflict (id) do nothing;

insert into public.properties (id, brf_id, name, street_address, postal_code, city, stairwells)
values (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'Testvägen 1',
  'Testvägen 1',
  '111 11',
  'Stockholm',
  2
)
on conflict (id) do nothing;

insert into public.apartments (id, property_id, apartment_number, rooms_count)
values
  ('33333333-3333-3333-3333-333333333331', '22222222-2222-2222-2222-222222222222', 'A-1101', 3),
  ('33333333-3333-3333-3333-333333333332', '22222222-2222-2222-2222-222222222222', 'A-1102', 2),
  ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'B-1201', 4)
on conflict (id) do nothing;

-- Lokalt admin-konto (motsvarar procella_admin_allowlist-raden i produktion,
-- men med en lokal testadress istället för en riktig Procella-adress).
-- `support@local.test` seedas separat som `procella_staff` av seed-users-and-data.mjs
-- (den rollen kan bara sättas manuellt, inte via allowlisten).
insert into public.procella_admin_allowlist (email, active)
values ('admin@local.test', true)
on conflict (email) do update set active = true;

-- Väntande inbjudningar – handle_new_user() kopplar automatiskt rätt roll/BRF/lägenhet
-- när kontot skapas med samma e-postadress (exakt samma flöde som i produktion).
-- `support@local.test` seedas som `procella_staff` via en inbjudan (utan BRF/lägenhet),
-- precis som en Procella-admin skulle bjuda in en supportkollega i produktion.
insert into public.access_invitations (email, full_name, role, brf_id, apartment_id, status)
values
  ('support@local.test', 'Procella Support', 'procella_staff', null, null, 'pending'),
  ('board@local.test', 'Styrelse Testsson', 'board', '11111111-1111-1111-1111-111111111111', null, 'pending'),
  ('resident@local.test', 'Boende Testsson', 'resident', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333331', 'pending')
on conflict (lower(email)) where status = 'pending' do nothing;

select 'Grunddata (BRF, fastighet, lägenheter, inbjudningar) seedad' as result;

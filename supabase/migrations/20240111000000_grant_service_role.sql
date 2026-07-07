-- Procella OVK – service_role saknade grants på public-schemat.
--
-- Edge Functions (send-invitation, notify-message, stripe-webhook, create-checkout,
-- create-portal, purge-expired-brfs) och seed-users-and-data.mjs använder alla
-- service_role-nyckeln mot PostgREST. service_role har `bypassrls`, men det ersätter
-- inte vanliga Postgres-privilegier – utan explicita grants nekas även service_role
-- åtkomst till tabellerna (upptäckt när seed-scriptet kördes lokalt första gången).

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function public.current_role() to service_role;
grant execute on function public.current_brf_id() to service_role;
grant execute on function public.current_apartment_id() to service_role;
grant execute on function public.is_procella() to service_role;
grant execute on function public.can_access_brf(uuid) to service_role;
grant execute on function public.can_access_property(uuid) to service_role;
grant execute on function public.can_access_apartment(uuid) to service_role;

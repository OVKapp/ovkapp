-- Procella OVK – korrigerar cirkulära RLS-regler
-- Kör hela filen en gång i Supabase SQL Editor.

create or replace function public.can_access_brf(target_brf_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_procella() or target_brf_id = public.current_brf_id()
$$;

create or replace function public.can_access_property(target_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_procella()
    or exists (
      select 1
      from public.properties p
      where p.id = target_property_id
        and (
          (public.current_role() = 'board' and p.brf_id = public.current_brf_id())
          or exists (
            select 1 from public.apartments a
            where a.id = public.current_apartment_id()
              and a.property_id = p.id
          )
        )
    )
$$;

create or replace function public.can_access_apartment(target_apartment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_procella()
    or target_apartment_id = public.current_apartment_id()
    or (
      public.current_role() = 'board'
      and exists (
        select 1
        from public.apartments a
        join public.properties p on p.id = a.property_id
        where a.id = target_apartment_id
          and p.brf_id = public.current_brf_id()
      )
    )
$$;

drop policy if exists "brf_scope_read" on public.brfs;
drop policy if exists "property_scope_read" on public.properties;
drop policy if exists "apartment_scope_read" on public.apartments;

create policy "brf_scope_read"
on public.brfs for select to authenticated
using (public.can_access_brf(id));

create policy "property_scope_read"
on public.properties for select to authenticated
using (public.can_access_property(id));

create policy "apartment_scope_read"
on public.apartments for select to authenticated
using (public.can_access_apartment(id));

grant execute on function public.can_access_brf(uuid) to authenticated;
grant execute on function public.can_access_property(uuid) to authenticated;
grant execute on function public.can_access_apartment(uuid) to authenticated;

select 'Säkerhetsreglerna är korrigerade' as result;

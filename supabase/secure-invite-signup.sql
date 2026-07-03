-- Procella OVK – förhindrar konton utan giltig inbjudan
-- Kör efter users-and-invitations.sql innan appen publiceras.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned_role public.app_role;
  assigned_brf uuid := null;
  assigned_apartment uuid := null;
  invitation_id uuid := null;
  allowed_admin boolean := false;
begin
  select exists (
    select 1 from public.procella_admin_allowlist
    where lower(email) = lower(new.email) and active = true
  ) into allowed_admin;

  if allowed_admin then
    assigned_role := 'procella_admin';
  else
    select i.id, i.role, i.brf_id, i.apartment_id
      into invitation_id, assigned_role, assigned_brf, assigned_apartment
    from public.access_invitations i
    where lower(i.email) = lower(new.email) and i.status = 'pending'
    order by i.created_at desc
    limit 1;

    if invitation_id is null then
      raise exception 'Du behöver en giltig inbjudan från Procella eller föreningens styrelse.';
    end if;
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
  );

  if invitation_id is not null then
    update public.access_invitations
    set status = 'accepted', accepted_at = now()
    where id = invitation_id;
  end if;
  return new;
end;
$$;

select 'Endast inbjudna användare kan skapa konto' as result;

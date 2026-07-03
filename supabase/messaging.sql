-- Procella OVK – säker intern meddelandecentral
-- Kör hela filen en gång i Supabase SQL Editor.

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  brf_id uuid not null references public.brfs(id) on delete cascade,
  apartment_id uuid references public.apartments(id) on delete set null,
  subject text not null,
  category text not null default 'general' check (category in ('notice','renovation','ventilation','inspection','general')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  primary key(conversation_id, profile_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete restrict,
  body text not null check (length(trim(body)) between 1 and 10000),
  created_at timestamptz not null default now()
);

create index if not exists conversations_brf_updated_idx on public.conversations(brf_id, updated_at desc);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at);
create index if not exists participants_profile_idx on public.conversation_participants(profile_id);

create or replace function public.can_access_conversation(target_conversation_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_procella()
    or exists (
      select 1 from public.conversations c
      where c.id = target_conversation_id
        and public.current_role() = 'board'
        and c.brf_id = public.current_brf_id()
    )
    or exists (
      select 1 from public.conversation_participants p
      where p.conversation_id = target_conversation_id
        and p.profile_id = auth.uid()
    )
$$;

create or replace function public.can_manage_conversation(target_conversation_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_procella()
    or exists (
      select 1 from public.conversations c
      where c.id = target_conversation_id
        and (
          c.created_by = auth.uid()
          or (public.current_role() = 'board' and c.brf_id = public.current_brf_id())
        )
    )
$$;

create or replace function public.touch_conversation()
returns trigger language plpgsql security definer set search_path = public
as $$ begin
  update public.conversations set updated_at = new.created_at where id = new.conversation_id;
  return new;
end; $$;

drop trigger if exists on_message_created on public.messages;
create trigger on_message_created after insert on public.messages
for each row execute procedure public.touch_conversation();

alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;

drop policy if exists "conversation_read" on public.conversations;
drop policy if exists "conversation_create" on public.conversations;
drop policy if exists "conversation_update" on public.conversations;
drop policy if exists "participant_read" on public.conversation_participants;
drop policy if exists "participant_add" on public.conversation_participants;
drop policy if exists "participant_update" on public.conversation_participants;
drop policy if exists "message_read" on public.messages;
drop policy if exists "message_send" on public.messages;

create policy "conversation_read" on public.conversations for select to authenticated
using (public.can_access_conversation(id));

create policy "conversation_create" on public.conversations for insert to authenticated
with check (
  created_by = auth.uid() and (
    public.is_procella()
    or (public.current_role() = 'board' and brf_id = public.current_brf_id())
    or (public.current_role() = 'resident' and brf_id = public.current_brf_id() and apartment_id = public.current_apartment_id())
  )
);

create policy "conversation_update" on public.conversations for update to authenticated
using (public.can_manage_conversation(id)) with check (public.can_manage_conversation(id));

create policy "participant_read" on public.conversation_participants for select to authenticated
using (public.can_access_conversation(conversation_id));
create policy "participant_add" on public.conversation_participants for insert to authenticated
with check (public.can_manage_conversation(conversation_id));
create policy "participant_update" on public.conversation_participants for update to authenticated
using (profile_id = auth.uid() or public.can_manage_conversation(conversation_id))
with check (profile_id = auth.uid() or public.can_manage_conversation(conversation_id));

create policy "message_read" on public.messages for select to authenticated
using (public.can_access_conversation(conversation_id));
create policy "message_send" on public.messages for insert to authenticated
with check (sender_id = auth.uid() and public.can_access_conversation(conversation_id));

grant select, insert, update on public.conversations to authenticated;
grant select, insert, update on public.conversation_participants to authenticated;
grant select, insert on public.messages to authenticated;
grant execute on function public.can_access_conversation(uuid) to authenticated;
grant execute on function public.can_manage_conversation(uuid) to authenticated;

select 'Meddelandecentralen är installerad' as result;

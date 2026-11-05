
-- BIRO UMUM CONNECT
-- Initial database schema - security improved

create extension if not exists pgcrypto;

-- 1. PROFILES
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'Pegawai',
  email text,
  position text,
  section text,
  role text not null default 'employee'
    check (role in ('admin','head','section_admin','employee')),
  created_at timestamptz not null default now()
);

-- 2. CONVERSATIONS
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text not null default 'group'
    check (type in ('direct','group')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. CONVERSATION MEMBERS
create table if not exists public.conversation_members (
  conversation_id uuid not null
    references public.conversations(id) on delete cascade,
  user_id uuid not null
    references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id,user_id)
);

-- 4. MESSAGES
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  body text not null default '',
  attachment_name text,
  attachment_path text,
  attachment_type text,
  created_at timestamptz not null default now(),
  constraint message_has_content check (
    length(trim(body)) > 0 or attachment_path is not null
  )
);

create index if not exists messages_conversation_created_idx
on public.messages(conversation_id,created_at);

create index if not exists members_user_idx
on public.conversation_members(user_id);

-- 5. CHECK CONVERSATION MEMBERSHIP
create or replace function public.is_conversation_member(cid uuid)
returns boolean
language sql stable security definer
set search_path=public
as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id=cid and user_id=auth.uid()
  );
$$;

-- 6. CHECK ADMIN WITHOUT RLS RECURSION
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path=public
as $$
  select exists (
    select 1 from public.profiles
    where id=auth.uid() and role='admin'
  );
$$;

-- 7. AUTOMATIC PROFILE WHEN USER REGISTERS
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path=public
as $$
begin
  insert into public.profiles(id,full_name,email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name','Pegawai'),
    new.email
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- 8. CREATE CONVERSATION
create or replace function public.create_conversation(
  p_title text,
  p_type text default 'group',
  p_member_ids uuid[] default '{}'
)
returns uuid
language plpgsql security definer
set search_path=public
as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if length(trim(coalesce(p_title,'')))=0 then
    raise exception 'Conversation title required';
  end if;

  if p_type not in ('group','direct') then
    raise exception 'Invalid conversation type';
  end if;

  insert into public.conversations(title,type,created_by)
  values(trim(p_title),p_type,auth.uid())
  returning id into new_id;

  insert into public.conversation_members(conversation_id,user_id)
  values(new_id,auth.uid());

  if p_member_ids is not null then
    insert into public.conversation_members(conversation_id,user_id)
    select new_id,member_id
    from unnest(p_member_ids) as member_id
    where member_id <> auth.uid()
    on conflict do nothing;
  end if;

  return new_id;
end;
$$;

-- 9. ENABLE ROW LEVEL SECURITY
alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

-- 10. REMOVE OLD POLICIES IF PRESENT
drop policy if exists "profiles visible to authenticated staff"
on public.profiles;

drop policy if exists "users update own limited profile"
on public.profiles;

drop policy if exists "admin manages profiles"
on public.profiles;

drop policy if exists "members read conversations"
on public.conversations;

drop policy if exists "members read membership"
on public.conversation_members;

drop policy if exists "members read messages"
on public.messages;

drop policy if exists "members send messages as self"
on public.messages;

-- 11. PROFILES POLICIES
create policy "authenticated staff read profiles"
on public.profiles
for select to authenticated
using (true);

create policy "admin manages profiles"
on public.profiles
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

-- 12. CONVERSATION POLICIES
create policy "members read conversations"
on public.conversations
for select to authenticated
using (public.is_conversation_member(id));

create policy "members read membership"
on public.conversation_members
for select to authenticated
using (public.is_conversation_member(conversation_id));

-- 13. MESSAGE POLICIES
create policy "members read messages"
on public.messages
for select to authenticated
using (public.is_conversation_member(conversation_id));

create policy "members send messages as self"
on public.messages
for insert to authenticated
with check (
  sender_id=auth.uid()
  and public.is_conversation_member(conversation_id)
);

-- 14. GRANTS
grant select on public.profiles to authenticated;
grant select on public.conversations to authenticated;
grant select on public.conversation_members to authenticated;
grant select,insert on public.messages to authenticated;

grant execute on function public.create_conversation(text,text,uuid[])
to authenticated;

grant execute on function public.is_conversation_member(uuid)
to authenticated;

grant execute on function public.is_admin()
to authenticated;

-- 15. ENABLE REALTIME FOR MESSAGES
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;

-- DATABASE FOUNDATION COMPLETE

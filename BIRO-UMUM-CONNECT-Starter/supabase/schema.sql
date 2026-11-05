-- BIRO UMUM CONNECT - initial schema
-- Jalankan di Supabase SQL Editor. Gunakan data uji coba terlebih dahulu.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'Pegawai',
  email text,
  position text,
  section text,
  role text not null default 'employee' check (role in ('admin','head','section_admin','employee')),
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text not null default 'group' check (type in ('direct','group')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id,user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  body text not null default '',
  attachment_name text,
  attachment_path text,
  attachment_type text,
  created_at timestamptz not null default now(),
  constraint message_has_content check (length(trim(body)) > 0 or attachment_path is not null)
);

create index if not exists messages_conversation_created_idx on public.messages(conversation_id,created_at);
create index if not exists members_user_idx on public.conversation_members(user_id);

create or replace function public.is_conversation_member(cid uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.conversation_members where conversation_id=cid and user_id=auth.uid()); $$;

create or replace function public.create_conversation(p_title text,p_type text default 'group',p_member_ids uuid[] default '{}')
returns uuid language plpgsql security definer set search_path=public
as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if length(trim(coalesce(p_title,'')))=0 then raise exception 'Group title required'; end if;
  if p_type not in ('group','direct') then raise exception 'Invalid conversation type'; end if;
  insert into public.conversations(title,type,created_by) values(trim(p_title),p_type,auth.uid()) returning id into new_id;
  insert into public.conversation_members(conversation_id,user_id) values(new_id,auth.uid());
  if p_member_ids is not null then
    insert into public.conversation_members(conversation_id,user_id)
    select new_id,member_id from unnest(p_member_ids) member_id
    where member_id <> auth.uid()
    on conflict do nothing;
  end if;
  return new_id;
end $$;

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

create policy "profiles visible to authenticated staff" on public.profiles
for select to authenticated using (true);
create policy "users update own limited profile" on public.profiles
for update to authenticated using (id=auth.uid()) with check (id=auth.uid());

create policy "members read conversations" on public.conversations
for select to authenticated using (public.is_conversation_member(id));
create policy "members read membership" on public.conversation_members
for select to authenticated using (public.is_conversation_member(conversation_id));
create policy "members read messages" on public.messages
for select to authenticated using (public.is_conversation_member(conversation_id));
create policy "members send messages as self" on public.messages
for insert to authenticated with check (sender_id=auth.uid() and public.is_conversation_member(conversation_id));

-- Only admins can change employee roles or create/edit profiles through the dashboard.
create policy "admin manages profiles" on public.profiles
for all to authenticated
using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'))
with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));

grant execute on function public.create_conversation(text,text,uuid[]) to authenticated;
grant execute on function public.is_conversation_member(uuid) to authenticated;

-- Enable Realtime for chat messages.
alter publication supabase_realtime add table public.messages;

-- Create a PRIVATE Storage bucket named chat-files in Storage dashboard.
-- Storage policies:
-- SELECT: bucket_id = 'chat-files' AND (storage.foldername(name))[1] IN
--   (SELECT conversation_id::text FROM public.conversation_members WHERE user_id = auth.uid())
-- INSERT: bucket_id = 'chat-files' AND (storage.foldername(name))[1] IN
--   (SELECT conversation_id::text FROM public.conversation_members WHERE user_id = auth.uid())

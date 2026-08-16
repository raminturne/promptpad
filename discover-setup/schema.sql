-- PromptPad "Discover" — Supabase (Postgres) schema.
-- Run ONCE: Supabase dashboard → SQL Editor → New query → paste all of this → Run.
-- Safe to re-run (idempotent).

-- ────────────────────────────────────────────────────────────────────────────
-- 1) Profiles — one row per auth user, created automatically on sign-up.
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text unique,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);
-- Moderation flag: a blocked user can't post or like (enforced by triggers below).
alter table public.profiles add column if not exists is_blocked boolean not null default false;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Categories — admin-editable. Seeded with a few defaults.
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.categories (
  slug  text primary key,
  label text not null,
  sort  int  not null default 0
);

insert into public.categories (slug, label, sort) values
  ('website',  'Website',  1),
  ('image',    'Image',    2),
  ('music',    'Music',    3),
  ('video',    'Video',    4),
  ('software', 'Software', 5),
  ('game',     'Game',     6),
  ('other',    'Other',    99)
on conflict (slug) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- 3) Posts — a shared prompt, optionally with an image (image lives in R2).
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.posts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  title      text not null,
  prompt     text not null,
  category   text references public.categories(slug),
  image_url  text,            -- Supabase Storage public URL (nullable: prompt-only)
  image_key  text,            -- Storage path ("<uid>/<uuid>.webp"), used for deletes
  byte_size  int  not null default 0,  -- compressed image size, for the storage meter
  status     text not null default 'pending'
             check (status in ('approved','pending','rejected')),
  created_at timestamptz not null default now()
);
-- A post used to go live the moment it was submitted; now every new post waits
-- for an admin to approve it (see the "force pending" block in
-- enforce_post_rules below — that's what actually makes this unbypassable, not
-- this default). This line re-points the column default on a database that
-- already has the table, since `create table if not exists` above is a no-op there.
alter table public.posts alter column status set default 'pending';

-- Extra columns (added here so re-running this file upgrades an existing DB).
alter table public.posts add column if not exists audio_url  text;   -- music posts (audio in Storage)
alter table public.posts add column if not exists audio_key  text;
alter table public.posts add column if not exists like_count int not null default 0;
alter table public.posts add column if not exists view_count int not null default 0;

create index if not exists posts_created_idx  on public.posts (created_at desc);
create index if not exists posts_category_idx on public.posts (category);

-- ────────────────────────────────────────────────────────────────────────────
-- 3b) Likes — one row per (user, post); a trigger keeps posts.like_count in sync.
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.likes (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  post_id    uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create or replace function public.bump_like_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set like_count = like_count + 1 where id = new.post_id;
  elsif tg_op = 'DELETE' then
    update public.posts set like_count = greatest(0, like_count - 1) where id = old.post_id;
  end if;
  return null;
end;
$$;

drop trigger if exists likes_count_ins on public.likes;
create trigger likes_count_ins after insert on public.likes
  for each row execute function public.bump_like_count();
drop trigger if exists likes_count_del on public.likes;
create trigger likes_count_del after delete on public.likes
  for each row execute function public.bump_like_count();

-- ────────────────────────────────────────────────────────────────────────────
-- 3c) Reports — users flag a post; admins review. One report per (user, post).
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason      text,
  created_at  timestamptz not null default now(),
  unique (post_id, reporter_id)
);
create index if not exists reports_post_idx on public.reports (post_id);

-- 3d) View counter — clients can't UPDATE view_count directly; they call this RPC.
create or replace function public.increment_post_view(pid uuid)
returns void
language sql security definer set search_path = public
as $$
  update public.posts set view_count = view_count + 1 where id = pid;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4) Row-Level Security.
-- ────────────────────────────────────────────────────────────────────────────
alter table public.profiles   enable row level security;
alter table public.posts      enable row level security;
alter table public.categories enable row level security;
alter table public.likes      enable row level security;
alter table public.reports    enable row level security;

-- Is the current request from an admin?
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- Protect privileged columns (is_admin, is_blocked) on profile UPDATEs. A change
-- to either is reverted when it comes from a signed-in NON-admin user — so a user
-- can't self-promote to admin, and a blocked user can't unblock themselves. Trusted
-- server contexts (SQL Editor / service role, auth.uid() null) and existing admins
-- pass through — that's how you bootstrap the first admin and how admins moderate.
create or replace function public.protect_privileged_cols()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.is_admin   is distinct from old.is_admin   then new.is_admin   := old.is_admin;   end if;
    if new.is_blocked is distinct from old.is_blocked then new.is_blocked := old.is_blocked; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_admin on public.profiles;
drop trigger if exists profiles_protect_cols on public.profiles;
create trigger profiles_protect_cols
  before update on public.profiles
  for each row execute function public.protect_privileged_cols();

-- profiles: anyone signed in can read (to show authors); you edit only yourself,
-- but an admin can update any profile (e.g. to block/unblock a user).
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (true);
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- categories: everyone reads; only admins write.
drop policy if exists categories_read on public.categories;
create policy categories_read on public.categories for select using (true);
drop policy if exists categories_admin_write on public.categories;
create policy categories_admin_write on public.categories
  for all using (public.is_admin()) with check (public.is_admin());

-- posts: everyone sees approved posts (plus your own + everything for admins);
-- you can insert your own; you (or an admin) can edit/delete your posts.
drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts for select
  using (status = 'approved' or user_id = auth.uid() or public.is_admin());
drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts for insert
  with check (user_id = auth.uid());
drop policy if exists posts_update_own_or_admin on public.posts;
create policy posts_update_own_or_admin on public.posts for update
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());
drop policy if exists posts_delete_own_or_admin on public.posts;
create policy posts_delete_own_or_admin on public.posts for delete
  using (user_id = auth.uid() or public.is_admin());

-- likes: everyone can read (to show counts / who-liked); you manage only your own likes.
drop policy if exists likes_read on public.likes;
create policy likes_read on public.likes for select using (true);
drop policy if exists likes_insert_own on public.likes;
create policy likes_insert_own on public.likes for insert with check (user_id = auth.uid());
drop policy if exists likes_delete_own on public.likes;
create policy likes_delete_own on public.likes for delete using (user_id = auth.uid());

-- reports: a signed-in user files their own reports; only admins can read/clear them.
drop policy if exists reports_insert_own on public.reports;
create policy reports_insert_own on public.reports for insert with check (reporter_id = auth.uid());
drop policy if exists reports_admin_read on public.reports;
create policy reports_admin_read on public.reports for select using (public.is_admin());
drop policy if exists reports_admin_delete on public.reports;
create policy reports_admin_delete on public.reports for delete using (public.is_admin());

-- ────────────────────────────────────────────────────────────────────────────
-- 4b) Anti-abuse — server-side rules that CANNOT be bypassed from the client
--     (the anon key is public, so client-only checks aren't enough).
-- ────────────────────────────────────────────────────────────────────────────

-- Admin-editable list of blocked words (matched on a word boundary, so e.g. the
-- Persian «عکس» is not tripped by «کس»). Seed mirrors the client filter.
create table if not exists public.banned_words (word text primary key);
alter table public.banned_words enable row level security;
drop policy if exists banned_read on public.banned_words;
create policy banned_read on public.banned_words for select using (true);
drop policy if exists banned_admin_write on public.banned_words;
create policy banned_admin_write on public.banned_words
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.banned_words (word) values
  ('fuck'),('fuk'),('shit'),('bitch'),('porn'),('pussy'),('masturbat'),('blowjob'),
  ('handjob'),('whore'),('cunt'),('nigger'),('faggot'),('hentai'),('dildo'),('orgasm'),
  ('pedophil'),('sex'),('ass'),('asshole'),('bastard'),('dick'),('anal'),('cum'),('nude'),
  ('nudes'),('nsfw'),('xxx'),('boobs'),('slut'),('incest'),('rape'),
  ('kir'),('kos'),('koss'),('koon'),('kon'),('koni'),('kony'),('kuni'),('jende'),('jakesh'),
  ('koskesh'),('kire'),('kiram'),
  ('کیر'),('کص'),('کس'),('کون'),('کونی'),('جنده'),('جاکش'),('کسکش'),('کسخل'),('گاییدن'),
  ('گایید'),('گاییدم'),('سکس'),('پورن'),('برهنه'),('لخت'),('اورگاسم'),('کوس'),('کوص'),('ساکزدن')
on conflict (word) do nothing;

-- One trigger enforces: not blocked + daily upload cap + size caps + content
-- filter + mandatory pending status. Only runs for real end users (auth.uid()
-- not null and not an admin); admin / SQL-editor inserts pass through.
create or replace function public.enforce_post_rules()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare cnt int; hit text;
begin
  if auth.uid() is not null and not public.is_admin() then
    if coalesce((select is_blocked from public.profiles where id = auth.uid()), false) then
      raise exception 'Your account is blocked from posting.';
    end if;
    select count(*) into cnt from public.posts
      where user_id = auth.uid() and created_at > now() - interval '24 hours';
    if cnt >= 15 then
      raise exception 'Daily upload limit reached (15 per day). Please try again tomorrow.';
    end if;
    -- Length caps. The Upload form already stops typing/pasting past these
    -- (maxlength), but the API is public — without a server-side cap too, a
    -- crafted request can still insert a huge title/prompt directly. A single
    -- very long unbroken run of characters is slow for the browser to wrap,
    -- badly enough that opening (or even scrolling past) that one card can
    -- feel like the whole tab froze — that's what got this added.
    if length(coalesce(new.title, '')) > 120 then
      raise exception 'Title is too long (max 120 characters).';
    end if;
    if length(coalesce(new.prompt, '')) > 4000 then
      raise exception 'Prompt is too long (max 4,000 characters).';
    end if;
    select word into hit from public.banned_words
      where lower(coalesce(new.title,'') || ' ' || coalesce(new.prompt,'')) ~* ('\y' || word || '\y')
      limit 1;
    if hit is not null then
      raise exception 'Post blocked by the content filter (no +18 / offensive words).';
    end if;
    -- Force pending regardless of what the client sent: the RLS insert policy
    -- only checks user_id, not status, so without this a crafted request could
    -- set status: 'approved' directly and skip review entirely.
    new.status := 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists posts_enforce_rules on public.posts;
create trigger posts_enforce_rules
  before insert on public.posts
  for each row execute function public.enforce_post_rules();

-- posts_update_own_or_admin lets an owner update their own row (e.g. to fix a
-- typo), but "own row" must not mean "own moderation status" — otherwise a user
-- could approve their own pending post with a plain UPDATE, same trick as
-- self-promoting to admin. Same shape as protect_privileged_cols on profiles.
create or replace function public.protect_post_status()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and new.status is distinct from old.status then
    new.status := old.status;
  end if;
  return new;
end;
$$;

drop trigger if exists posts_protect_status on public.posts;
create trigger posts_protect_status
  before update on public.posts
  for each row execute function public.protect_post_status();

-- Blocked users can't like either.
create or replace function public.enforce_like_rules()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is not null
     and coalesce((select is_blocked from public.profiles where id = auth.uid()), false) then
    raise exception 'Your account is blocked.';
  end if;
  return new;
end;
$$;

drop trigger if exists likes_enforce_rules on public.likes;
create trigger likes_enforce_rules
  before insert on public.likes
  for each row execute function public.enforce_like_rules();

-- Blocked users can't report either (reuse the same guard function).
drop trigger if exists reports_enforce_rules on public.reports;
create trigger reports_enforce_rules
  before insert on public.reports
  for each row execute function public.enforce_like_rules();

-- ────────────────────────────────────────────────────────────────────────────
-- 5) Storage — a public bucket for uploaded images, with per-user upload/delete.
-- ────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('discover-images', 'discover-images', true)
on conflict (id) do nothing;

-- Read: public bucket already serves images by URL; allow select for completeness.
drop policy if exists discover_read on storage.objects;
create policy discover_read on storage.objects for select
  using (bucket_id = 'discover-images');

-- Upload: signed-in users, only into their own "<uid>/..." folder.
drop policy if exists discover_insert_own on storage.objects;
create policy discover_insert_own on storage.objects for insert to authenticated
  with check (
    bucket_id = 'discover-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Delete: your own files, or anything if you're an admin.
drop policy if exists discover_delete_own_or_admin on storage.objects;
create policy discover_delete_own_or_admin on storage.objects for delete to authenticated
  using (
    bucket_id = 'discover-images'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 6) Admins. Sign up in the app FIRST (so the profile row exists), then run one
--    of these. Promote by username (works for any accounts you've registered):
-- ────────────────────────────────────────────────────────────────────────────
update public.profiles set is_admin = true
  where username in ('fastamozesh', 'raminturne');

-- Or promote by email:
-- update public.profiles set is_admin = true
--   where id = (select id from auth.users where email = 'you@example.com');

-- ────────────────────────────────────────────────────────────────────────────
-- 7) Shared notes — live collaboration on a single tab.
--    A user turns one of their tabs into a "shared note", invites someone by
--    username, and once that invite is accepted both edit the same text live.
--
--    This table is the source of truth, and `rev` is what puts every change in
--    one agreed order. A client writes with "... where id = ? and rev = ?", so
--    the write only lands if nothing else was accepted in the meantime; on
--    losing that race it re-reads the row, rebases its own text onto the
--    accepted revision, and tries again. Realtime only *delivers* revisions
--    (and presence / typing pings) — it is never the authority.
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.shared_notes (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  title      text not null default 'Shared note',
  content    text not null default '',
  dir        text not null default 'auto',
  rev        bigint not null default 1,   -- compare-and-swap target; bumped by the trigger below
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists shared_notes_owner_idx on public.shared_notes (owner_id);

-- Who is in a note. The owner is added here too (by the trigger below), so every
-- membership question is a single lookup against this one table.
create table if not exists public.note_members (
  note_id   uuid not null references public.shared_notes(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      text not null default 'editor' check (role in ('editor', 'viewer')),
  joined_at timestamptz not null default now(),
  primary key (note_id, user_id)
);
create index if not exists note_members_user_idx on public.note_members (user_id);

create table if not exists public.note_invites (
  id         uuid primary key default gen_random_uuid(),
  note_id    uuid not null references public.shared_notes(id) on delete cascade,
  from_id    uuid not null references public.profiles(id) on delete cascade,
  to_id      uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'editor' check (role in ('editor', 'viewer')),
  status     text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now()
);
-- Only one *pending* invite per (note, user) — re-inviting after a decline is fine.
create unique index if not exists note_invites_pending_uniq
  on public.note_invites (note_id, to_id) where status = 'pending';
create index if not exists note_invites_to_idx on public.note_invites (to_id, status);

-- The owner is a member from the moment the note exists.
create or replace function public.add_note_owner_member()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.note_members (note_id, user_id, role)
  values (new.id, new.owner_id, 'editor')
  on conflict do nothing;
  return new;
end;
$fn$;

drop trigger if exists shared_notes_owner_member on public.shared_notes;
create trigger shared_notes_owner_member
  after insert on public.shared_notes
  for each row execute function public.add_note_owner_member();

-- An editor may rewrite the text but must never take the note over. This is
-- also where `rev` is bumped: doing it server-side means two clients saving at
-- the same moment can't hand out the same revision number, so "is this update
-- older than what I already have?" is answerable on the client.
create or replace function public.stamp_note_write()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is not null and new.owner_id is distinct from old.owner_id then
    new.owner_id := old.owner_id;
  end if;
  new.rev := old.rev + 1;
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists shared_notes_protect_owner on public.shared_notes;
drop trigger if exists shared_notes_stamp_write on public.shared_notes;
create trigger shared_notes_stamp_write
  before update on public.shared_notes
  for each row execute function public.stamp_note_write();

-- ---- membership helpers ----------------------------------------------------
-- security definer, so the policies below can read note_members without RLS
-- recursing back into the very policy being evaluated.
create or replace function public.is_note_member(nid uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.note_members where note_id = nid and user_id = auth.uid()
  );
$fn$;

create or replace function public.is_note_owner(nid uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.shared_notes where id = nid and owner_id = auth.uid()
  );
$fn$;

create or replace function public.note_role(nid uuid)
returns text language sql stable security definer set search_path = public as $fn$
  select role from public.note_members where note_id = nid and user_id = auth.uid();
$fn$;

-- ---- Row-Level Security ----------------------------------------------------
alter table public.shared_notes enable row level security;
alter table public.note_members enable row level security;
alter table public.note_invites enable row level security;

-- shared_notes: members read; only the owner creates/deletes; owner + editors write.
drop policy if exists shared_notes_read on public.shared_notes;
create policy shared_notes_read on public.shared_notes for select
  using (owner_id = auth.uid() or public.is_note_member(id));
drop policy if exists shared_notes_insert on public.shared_notes;
create policy shared_notes_insert on public.shared_notes for insert
  with check (owner_id = auth.uid());
drop policy if exists shared_notes_update on public.shared_notes;
create policy shared_notes_update on public.shared_notes for update
  using (owner_id = auth.uid() or public.note_role(id) = 'editor')
  with check (owner_id = auth.uid() or public.note_role(id) = 'editor');
drop policy if exists shared_notes_delete on public.shared_notes;
create policy shared_notes_delete on public.shared_notes for delete
  using (owner_id = auth.uid());

-- note_members: members see the roster; the owner manages it; anyone can leave.
drop policy if exists note_members_read on public.note_members;
create policy note_members_read on public.note_members for select
  using (user_id = auth.uid() or public.is_note_member(note_id));
drop policy if exists note_members_owner_write on public.note_members;
create policy note_members_owner_write on public.note_members for insert
  with check (public.is_note_owner(note_id));
drop policy if exists note_members_owner_update on public.note_members;
create policy note_members_owner_update on public.note_members for update
  using (public.is_note_owner(note_id)) with check (public.is_note_owner(note_id));
drop policy if exists note_members_delete on public.note_members;
create policy note_members_delete on public.note_members for delete
  using (public.is_note_owner(note_id) or user_id = auth.uid());

-- note_invites: you see the ones you sent and the ones addressed to you.
drop policy if exists note_invites_read on public.note_invites;
create policy note_invites_read on public.note_invites for select
  using (to_id = auth.uid() or from_id = auth.uid());
drop policy if exists note_invites_insert on public.note_invites;
create policy note_invites_insert on public.note_invites for insert
  with check (from_id = auth.uid() and public.is_note_owner(note_id));
drop policy if exists note_invites_delete on public.note_invites;
create policy note_invites_delete on public.note_invites for delete
  using (from_id = auth.uid() or to_id = auth.uid());

-- ---- RPCs ------------------------------------------------------------------
-- Invite by username. The client never has to look a user id up itself (and
-- couldn't insert the membership row anyway), so both stay behind the policies.
create or replace function public.invite_to_note(nid uuid, uname text, r text default 'editor')
returns json language plpgsql security definer set search_path = public as $fn$
declare target uuid; tname text;
begin
  if not public.is_note_owner(nid) then
    return json_build_object('ok', false, 'error', 'not_owner');
  end if;
  if r not in ('editor', 'viewer') then r := 'editor'; end if;

  select id, username into target, tname
    from public.profiles where lower(username) = lower(trim(uname)) limit 1;
  if target is null then
    return json_build_object('ok', false, 'error', 'no_user');
  end if;
  if target = auth.uid() then
    return json_build_object('ok', false, 'error', 'self');
  end if;
  if exists (select 1 from public.note_members where note_id = nid and user_id = target) then
    return json_build_object('ok', false, 'error', 'already_member');
  end if;
  if exists (select 1 from public.note_invites
             where note_id = nid and to_id = target and status = 'pending') then
    return json_build_object('ok', false, 'error', 'already_invited');
  end if;

  insert into public.note_invites (note_id, from_id, to_id, role)
  values (nid, auth.uid(), target, r);

  return json_build_object('ok', true, 'username', tname);
end;
$fn$;

-- Accept or decline. Accepting is what creates the membership row.
create or replace function public.respond_note_invite(iid uuid, accept boolean)
returns json language plpgsql security definer set search_path = public as $fn$
declare inv public.note_invites;
begin
  select * into inv from public.note_invites where id = iid;
  if inv.id is null or inv.to_id <> auth.uid() then
    return json_build_object('ok', false, 'error', 'not_found');
  end if;
  if inv.status <> 'pending' then
    return json_build_object('ok', false, 'error', 'already_handled');
  end if;

  if accept then
    insert into public.note_members (note_id, user_id, role)
    values (inv.note_id, inv.to_id, inv.role)
    on conflict (note_id, user_id) do update set role = excluded.role;
    update public.note_invites set status = 'accepted' where id = iid;
    return json_build_object('ok', true, 'note_id', inv.note_id);
  end if;

  update public.note_invites set status = 'declined' where id = iid;
  return json_build_object('ok', true);
end;
$fn$;

-- Pending invites for the signed-in user, already joined to the note title and
-- the inviter's username (one round trip instead of three).
create or replace function public.my_note_invites()
returns table (
  id uuid, note_id uuid, role text, created_at timestamptz,
  note_title text, from_username text
)
language sql stable security definer set search_path = public as $fn$
  select i.id, i.note_id, i.role, i.created_at, n.title, p.username
    from public.note_invites i
    join public.shared_notes n on n.id = i.note_id
    join public.profiles     p on p.id = i.from_id
   where i.to_id = auth.uid() and i.status = 'pending'
   order by i.created_at desc;
$fn$;

-- Every note the signed-in user can open, with their role in it.
create or replace function public.my_shared_notes()
returns table (
  id uuid, title text, content text, dir text, rev bigint,
  owner_id uuid, owner_username text, role text, updated_at timestamptz
)
language sql stable security definer set search_path = public as $fn$
  select n.id, n.title, n.content, n.dir, n.rev,
         n.owner_id, p.username,
         case when n.owner_id = auth.uid() then 'owner' else m.role end,
         n.updated_at
    from public.note_members m
    join public.shared_notes n on n.id = m.note_id
    join public.profiles     p on p.id = n.owner_id
   where m.user_id = auth.uid()
   order by n.updated_at desc;
$fn$;

-- Roster for one note, plus anyone invited who hasn't answered yet.
create or replace function public.note_member_list(nid uuid)
returns table (user_id uuid, username text, role text, state text)
language sql stable security definer set search_path = public as $fn$
  select m.user_id, p.username,
         case when n.owner_id = m.user_id then 'owner' else m.role end,
         'member'::text
    from public.note_members m
    join public.profiles     p on p.id = m.user_id
    join public.shared_notes n on n.id = m.note_id
   where m.note_id = nid and public.is_note_member(nid)
  union all
  select i.to_id, p.username, i.role, 'pending'::text
    from public.note_invites i
    join public.profiles p on p.id = i.to_id
   where i.note_id = nid and i.status = 'pending' and public.is_note_member(nid);
$fn$;

-- Realtime: the app listens for incoming invites and for accepted revisions.
-- A note on DELETE events: Realtime can only apply RLS to the columns in a
-- table's replica identity (the primary key, by default). note_members' policy
-- is written against note_id + user_id, which ARE its primary key, so a client
-- reliably learns it was removed from a note — including via the cascade when
-- the owner deletes the note. That's why the app keys "sharing ended" off
-- note_members rather than off shared_notes.
do $pub$
begin
  begin execute 'alter publication supabase_realtime add table public.note_invites'; exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.shared_notes'; exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.note_members'; exception when duplicate_object then null; end;
end
$pub$;

-- ────────────────────────────────────────────────────────────────────────────
-- 8) Admin "new post" notifications. An admin's app subscribes to INSERT on
--    posts directly (see dcSubscribeAdminPosts in renderer.js); the posts_read
--    RLS policy already grants an admin visibility into every post regardless
--    of status, so adding the table to the publication is the only piece
--    missing — Realtime evaluates that same SELECT policy per connection, so a
--    non-admin's subscription would only ever see their own / approved posts.
-- ────────────────────────────────────────────────────────────────────────────
do $pub2$
begin
  begin execute 'alter publication supabase_realtime add table public.posts'; exception when duplicate_object then null; end;
end
$pub2$;

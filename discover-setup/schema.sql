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
  status     text not null default 'approved'
             check (status in ('approved','pending','rejected')),
  created_at timestamptz not null default now()
);

-- Extra columns (added here so re-running this file upgrades an existing DB).
alter table public.posts add column if not exists audio_url  text;   -- music posts (audio in Storage)
alter table public.posts add column if not exists audio_key  text;
alter table public.posts add column if not exists like_count int not null default 0;

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
-- 4) Row-Level Security.
-- ────────────────────────────────────────────────────────────────────────────
alter table public.profiles   enable row level security;
alter table public.posts      enable row level security;
alter table public.categories enable row level security;
alter table public.likes      enable row level security;

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

-- One trigger enforces: not blocked + daily upload cap + content filter. Only runs
-- for real end users (auth.uid() not null); admin / SQL-editor inserts pass through.
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
    select word into hit from public.banned_words
      where lower(coalesce(new.title,'') || ' ' || coalesce(new.prompt,'')) ~* ('\y' || word || '\y')
      limit 1;
    if hit is not null then
      raise exception 'Post blocked by the content filter (no +18 / offensive words).';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists posts_enforce_rules on public.posts;
create trigger posts_enforce_rules
  before insert on public.posts
  for each row execute function public.enforce_post_rules();

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

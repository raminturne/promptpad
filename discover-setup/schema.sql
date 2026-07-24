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

-- Stop a normal user from making themselves admin via a profile UPDATE. A change
-- is reverted only when it comes from a signed-in NON-admin user. Trusted server
-- contexts (the SQL Editor / service role, where auth.uid() is null) and existing
-- admins are allowed through — that's how you bootstrap the first admin.
create or replace function public.protect_is_admin()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.is_admin is distinct from old.is_admin
     and auth.uid() is not null
     and not public.is_admin() then
    new.is_admin := old.is_admin;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_admin on public.profiles;
create trigger profiles_protect_admin
  before update on public.profiles
  for each row execute function public.protect_is_admin();

-- profiles: anyone signed in can read (to show authors); you can edit only yourself.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (true);
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

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

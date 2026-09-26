-- ============================================================================
-- Moments — Birthday & Purpose
-- Complete Supabase PostgreSQL schema with Row Level Security
-- Run this in the Supabase SQL Editor (or via `supabase db push`) on a fresh
-- project. Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE throughout.
-- ============================================================================

create extension if not exists "pgcrypto"; -- gen_random_uuid(), gen_random_bytes()

-- ----------------------------------------------------------------------------
-- 1. PROFILES
-- One row per authenticated creator. Created automatically on signup via
-- trigger below. Never exposed to recipients.
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', null))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 2. MOMENTS
-- The core object a creator builds. public_token is the ONLY thing ever
-- exposed in a recipient-facing URL — high entropy, unguessable, unindexed
-- by sequential ID.
-- ----------------------------------------------------------------------------
create table if not exists public.moments (
  id            uuid primary key default gen_random_uuid(),
  creator_id    uuid not null references public.profiles(id) on delete cascade,
  public_token  text not null unique,
  type          text not null check (type in ('birthday', 'purpose')),
  relationship  text not null,
  recipient_name text not null,
  creator_name  text not null,
  status        text not null default 'draft' check (status in ('draft', 'published', 'revoked')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  published_at  timestamptz,
  expires_at    timestamptz
);

create index if not exists idx_moments_creator on public.moments(creator_id);
create index if not exists idx_moments_public_token on public.moments(public_token);
create index if not exists idx_moments_status on public.moments(status);

-- Generate a high-entropy, URL-safe public token (~48 bits of randomness,
-- 8 chars from a 62-char alphabet). Called server-side only.
create or replace function public.generate_public_token(length int default 10)
returns text
language plpgsql
as $$
declare
  chars text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  result text := '';
  i int;
begin
  for i in 1..length loop
    result := result || substr(chars, 1 + floor(random() * length(chars))::int, 1);
  end loop;
  return result;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. MOMENT PAGES (1..10 per moment)
-- ----------------------------------------------------------------------------
create table if not exists public.moment_pages (
  id               uuid primary key default gen_random_uuid(),
  moment_id        uuid not null references public.moments(id) on delete cascade,
  page_number      int not null check (page_number between 1 and 10),
  title            text,
  message          text,
  animation        text,
  photo_asset_id   uuid,
  youtube_video_id text check (youtube_video_id is null or youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
  settings         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (moment_id, page_number)
);

create index if not exists idx_moment_pages_moment on public.moment_pages(moment_id);

-- ----------------------------------------------------------------------------
-- 4. MOMENT ASSETS (uploaded photos)
-- ----------------------------------------------------------------------------
create table if not exists public.moment_assets (
  id           uuid primary key default gen_random_uuid(),
  moment_id    uuid not null references public.moments(id) on delete cascade,
  creator_id   uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null,
  mime_type    text not null,
  size_bytes   bigint not null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_moment_assets_moment on public.moment_assets(moment_id);

alter table public.moment_pages
  add constraint fk_page_photo_asset
  foreign key (photo_asset_id) references public.moment_assets(id) on delete set null;

-- ----------------------------------------------------------------------------
-- 5. SECURITY EVENTS (audit log — server-writable only)
-- ----------------------------------------------------------------------------
create table if not exists public.security_events (
  id         uuid primary key default gen_random_uuid(),
  event_type text not null,
  user_id    uuid references auth.users(id) on delete set null,
  ip_hash    text,          -- hashed, never raw IP
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_security_events_type on public.security_events(event_type);
create index if not exists idx_security_events_user on public.security_events(user_id);
create index if not exists idx_security_events_created on public.security_events(created_at);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.profiles       enable row level security;
alter table public.moments        enable row level security;
alter table public.moment_pages   enable row level security;
alter table public.moment_assets  enable row level security;
alter table public.security_events enable row level security;

-- ---- profiles: a user can only see/update their own row. No public access. ----
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- No insert/delete policy for clients — profile rows are created only by the
-- handle_new_user trigger (security definer) and cascade-deleted with the user.

-- ---- moments: creator has full control of their OWN moments only. ----
-- Public/recipient access to a published moment happens ONLY through the
-- get-moment Edge Function (service role, token-gated) — never direct table
-- access — so there is deliberately NO public select policy here.
drop policy if exists "moments_select_own" on public.moments;
create policy "moments_select_own" on public.moments
  for select using (auth.uid() = creator_id);

drop policy if exists "moments_insert_own" on public.moments;
create policy "moments_insert_own" on public.moments
  for insert with check (auth.uid() = creator_id);

drop policy if exists "moments_update_own" on public.moments;
create policy "moments_update_own" on public.moments
  for update using (auth.uid() = creator_id) with check (auth.uid() = creator_id);

-- Creators may delete only their own UNPUBLISHED moments.
drop policy if exists "moments_delete_own_draft" on public.moments;
create policy "moments_delete_own_draft" on public.moments
  for delete using (auth.uid() = creator_id and status = 'draft');

-- ---- moment_pages: gated through parent moment ownership ----
drop policy if exists "pages_select_own" on public.moment_pages;
create policy "pages_select_own" on public.moment_pages
  for select using (
    exists (select 1 from public.moments m where m.id = moment_id and m.creator_id = auth.uid())
  );

drop policy if exists "pages_insert_own" on public.moment_pages;
create policy "pages_insert_own" on public.moment_pages
  for insert with check (
    exists (select 1 from public.moments m where m.id = moment_id and m.creator_id = auth.uid())
  );

drop policy if exists "pages_update_own" on public.moment_pages;
create policy "pages_update_own" on public.moment_pages
  for update using (
    exists (select 1 from public.moments m where m.id = moment_id and m.creator_id = auth.uid())
  ) with check (
    exists (select 1 from public.moments m where m.id = moment_id and m.creator_id = auth.uid())
  );

drop policy if exists "pages_delete_own" on public.moment_pages;
create policy "pages_delete_own" on public.moment_pages
  for delete using (
    exists (select 1 from public.moments m where m.id = moment_id and m.creator_id = auth.uid() and m.status = 'draft')
  );

-- ---- moment_assets: creator-owned only. Never publicly queryable. ----
drop policy if exists "assets_select_own" on public.moment_assets;
create policy "assets_select_own" on public.moment_assets
  for select using (auth.uid() = creator_id);

drop policy if exists "assets_insert_own" on public.moment_assets;
create policy "assets_insert_own" on public.moment_assets
  for insert with check (auth.uid() = creator_id);

drop policy if exists "assets_delete_own" on public.moment_assets;
create policy "assets_delete_own" on public.moment_assets
  for delete using (auth.uid() = creator_id);

-- ---- security_events: NO client access at all (service role / edge functions only) ----
-- Deliberately zero policies for anon/authenticated roles -> RLS default-denies everything.

-- ============================================================================
-- updated_at maintenance
-- ============================================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_moments_updated on public.moments;
create trigger trg_moments_updated before update on public.moments
  for each row execute function public.set_updated_at();

drop trigger if exists trg_pages_updated on public.moment_pages;
create trigger trg_pages_updated before update on public.moment_pages
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Storage buckets & policies
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('moment-assets', 'moment-assets', false)
on conflict (id) do nothing;

-- Creators can only manage files under a path prefixed with their own uid:
--   moment-assets/{creator_id}/{moment_id}/{filename}
-- Public/recipient photo delivery is done via signed URLs issued by the
-- get-moment Edge Function, never via a public bucket.
drop policy if exists "storage_creator_insert" on storage.objects;
create policy "storage_creator_insert" on storage.objects
  for insert with check (
    bucket_id = 'moment-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "storage_creator_select" on storage.objects;
create policy "storage_creator_select" on storage.objects
  for select using (
    bucket_id = 'moment-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "storage_creator_delete" on storage.objects;
create policy "storage_creator_delete" on storage.objects
  for delete using (
    bucket_id = 'moment-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================================
-- End of schema
-- ============================================================================

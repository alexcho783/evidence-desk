-- Evidence Desk — database setup for optional account sync.
--
-- Run this once in your Supabase project: SQL Editor → New query → paste → Run.
-- It is safe to run more than once.
--
-- The security model in one line: every row carries the id of the person it belongs to,
-- and row-level security makes the database refuse any read or write where that id is
-- not the id of whoever is asking. One person cannot reach another's rows even if the
-- client code is wrong, because the client never gets to decide.

-- ── The table ────────────────────────────────────────────────────────────────

create table if not exists public.reading_list (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  paper_id    text not null,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint reading_list_one_per_paper unique (user_id, paper_id)
);

-- Every query is "my rows", so index that.
create index if not exists reading_list_user_idx on public.reading_list (user_id);

-- Keep a saved paper from being large enough to be used as free file storage.
alter table public.reading_list drop constraint if exists reading_list_size;
alter table public.reading_list
  add constraint reading_list_size check (pg_column_size(data) < 60000);

-- ── Row-level security ───────────────────────────────────────────────────────
-- Without this the anon key would let anyone read the whole table. With it, the
-- database applies "only your own rows" to every statement, including ones the
-- client did not intend.

alter table public.reading_list enable row level security;

drop policy if exists "read own rows"   on public.reading_list;
drop policy if exists "insert own rows" on public.reading_list;
drop policy if exists "update own rows" on public.reading_list;
drop policy if exists "delete own rows" on public.reading_list;

create policy "read own rows" on public.reading_list
  for select using (auth.uid() = user_id);

-- `with check` is what stops someone writing a row stamped with another person's id.
create policy "insert own rows" on public.reading_list
  for insert with check (auth.uid() = user_id);

create policy "update own rows" on public.reading_list
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "delete own rows" on public.reading_list
  for delete using (auth.uid() = user_id);

-- ── Account deletion ─────────────────────────────────────────────────────────
-- UK GDPR gives people the right to have their data erased, and a site with accounts
-- needs a working button for it rather than an email address and good intentions.
-- security definer lets this one function touch auth.users; it deletes only the caller,
-- which is why it takes no arguments.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  delete from public.reading_list where user_id = uid;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ── Check it worked ──────────────────────────────────────────────────────────
-- Should return one row, rowsecurity = true.
-- select tablename, rowsecurity from pg_tables where tablename = 'reading_list';
--
-- Should return four policies.
-- select policyname, cmd from pg_policies where tablename = 'reading_list';

-- ═══════════════════════════════════════════════════════════════════════════════
-- N12: shared read-only collections
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- A named collection can be given a link that anyone can open. The design choice that
-- matters: a shared collection is a SNAPSHOT, written at the moment you share, not a live
-- window onto your reading list.
--
-- Live would mean letting an anonymous reader select rows out of reading_list, which means
-- a policy on that table that is true for someone who is not signed in. Every such policy
-- is one mistake away from exposing the whole table, and reading_list is where the notes
-- live. A snapshot keeps reading_list owner-only, exactly as it is now, and puts only what
-- you chose to publish into a separate table. Re-share to update it.

create table if not exists public.shared_collections (
  slug         text primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  papers       jsonb not null,
  with_notes   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists shared_collections_user_idx on public.shared_collections (user_id);

-- Same reasoning as the reading list: a shared collection is not file storage.
alter table public.shared_collections drop constraint if exists shared_collections_size;
alter table public.shared_collections
  add constraint shared_collections_size check (pg_column_size(papers) < 400000);

alter table public.shared_collections enable row level security;

-- Supabase grants these by default on new tables in public; stated explicitly so this file
-- still does the right thing in a project where the default privileges were changed.
grant select, insert, update, delete on public.shared_collections to authenticated;
revoke all on public.shared_collections from anon;

drop policy if exists "anyone reads shared"    on public.shared_collections;
drop policy if exists "read own shared"        on public.shared_collections;
drop policy if exists "insert own shared"      on public.shared_collections;
drop policy if exists "update own shared"      on public.shared_collections;
drop policy if exists "delete own shared"      on public.shared_collections;

-- NO public select policy, deliberately. An earlier draft of this file had
-- `for select using (true)`, which is wrong in a way that is easy to miss: PostgREST
-- exposes every table, so `using (true)` would let anyone holding the anon key run
-- `select * from shared_collections` and read EVERY shared collection on the site. The
-- slug is supposed to be the secret, and a table you can list is not a secret.
--
-- Reading a shared collection therefore goes through one function that takes a slug and
-- returns at most one row. There is no way to ask it for a list.
create policy "read own shared" on public.shared_collections
  for select using (auth.uid() = user_id);

create policy "insert own shared" on public.shared_collections
  for insert with check (auth.uid() = user_id);

create policy "update own shared" on public.shared_collections
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "delete own shared" on public.shared_collections
  for delete using (auth.uid() = user_id);

-- The only way in from outside. security definer so it can read past the owner-only policy
-- above, and it is written so that the only thing it can ever return is the single row
-- whose slug you already knew.
create or replace function public.get_shared_collection(want_slug text)
returns table (slug text, name text, papers jsonb, with_notes boolean)
language sql
security definer
set search_path = public
stable
as $$
  select s.slug, s.name, s.papers, s.with_notes
  from public.shared_collections s
  where s.slug = want_slug
  limit 1;
$$;

revoke all on function public.get_shared_collection(text) from public;
grant execute on function public.get_shared_collection(text) to anon, authenticated;

-- Account deletion has to take shared collections with it. Replacing the function rather
-- than adding a second one keeps deletion a single transaction.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  delete from public.shared_collections where user_id = uid;
  delete from public.reading_list where user_id = uid;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Check: should return two tables, both with rowsecurity = true.
-- select tablename, rowsecurity from pg_tables
--   where tablename in ('reading_list','shared_collections');
--
-- Check: the shared table's SELECT policy must NOT be `true`. It should read
-- (auth.uid() = user_id). If qual is `true`, stop: anyone could list every shared
-- collection on the site.
-- select policyname, cmd, qual from pg_policies where tablename = 'shared_collections';
--
-- Check that a shared collection cannot be listed. Same caveat: use the anon role, not a
-- plain select. This one should raise a permission error, since anon is revoked outright.
--
-- begin;
--   set local role anon;
--   select count(*) from public.shared_collections;   -- must refuse
-- rollback;
--
-- Check that the private table really is private. NOT with a plain select in the SQL
-- editor: that connects as postgres, which has bypassrls and returns every row whatever
-- the policies say. Drop to the anon role for one transaction instead:
--
-- begin;
--   set local role anon;
--   select count(*) from public.reading_list;   -- must be 0
-- rollback;

-- ═══════════════════════════════════════════════════════════════════════════════
-- N11: saved search alerts
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- A signed-in person can save a search. Once a week a scheduled function reruns it and
-- emails anything new. This adds two things the site did not have before: a scheduled job,
-- and a reason to hold someone's email address for a purpose other than signing them in.
-- The privacy page has to say so before this is switched on.

create table if not exists public.saved_searches (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  query       text not null,
  source      text not null default 'med',
  filters     jsonb not null default '{}'::jsonb,
  paused      boolean not null default false,
  last_run    timestamptz,
  last_seen   text[] not null default '{}',
  created_at  timestamptz not null default now(),
  constraint saved_searches_query_len check (char_length(query) between 2 and 300)
);

create index if not exists saved_searches_user_idx on public.saved_searches (user_id);
create index if not exists saved_searches_due_idx  on public.saved_searches (paused, last_run);

-- One person cannot sit on an unbounded number of weekly jobs.
create or replace function public.saved_searches_cap()
returns trigger language plpgsql as $$
begin
  if (select count(*) from public.saved_searches where user_id = new.user_id) >= 20 then
    raise exception 'at most 20 saved searches';
  end if;
  return new;
end;
$$;
drop trigger if exists saved_searches_cap_trigger on public.saved_searches;
create trigger saved_searches_cap_trigger before insert on public.saved_searches
  for each row execute function public.saved_searches_cap();

alter table public.saved_searches enable row level security;

drop policy if exists "read own searches"   on public.saved_searches;
drop policy if exists "insert own searches" on public.saved_searches;
drop policy if exists "update own searches" on public.saved_searches;
drop policy if exists "delete own searches" on public.saved_searches;

create policy "read own searches" on public.saved_searches
  for select using (auth.uid() = user_id);
create policy "insert own searches" on public.saved_searches
  for insert with check (auth.uid() = user_id);
create policy "update own searches" on public.saved_searches
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own searches" on public.saved_searches
  for delete using (auth.uid() = user_id);

-- Account deletion, once more, so it stays one transaction.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  delete from public.saved_searches where user_id = uid;
  delete from public.shared_collections where user_id = uid;
  delete from public.reading_list where user_id = uid;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ── The weekly schedule ──────────────────────────────────────────────────────
-- Run this only after the function is deployed and its secrets are set. Replace
-- YOUR_PROJECT_REF and YOUR_CRON_SECRET with your own values.
--
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- select cron.schedule('evidence-desk-weekly-alerts', '0 8 * * 1', $job$
--   select net.http_post(
--     url     := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/weekly-alerts',
--     headers := '{"Content-Type":"application/json","x-cron-secret":"YOUR_CRON_SECRET"}'::jsonb,
--     body    := '{}'::jsonb
--   );
-- $job$);
--
-- To stop it:  select cron.unschedule('evidence-desk-weekly-alerts');

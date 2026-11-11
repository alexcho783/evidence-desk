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

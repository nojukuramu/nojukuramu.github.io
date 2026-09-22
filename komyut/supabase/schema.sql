-- ============================================================
-- TheCommuters — the whole database, in one file
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL -> New query).
-- It is written to be re-runnable: everything is `if not exists` or
-- `create or replace`, so applying it again after an edit is safe and will
-- not drop anybody's routes.
--
-- The rule this file exists to enforce
-- ------------------------------------
-- The browser is not trusted. static/js/sanitize.js trims and normalises
-- what people type, but a client can skip it entirely by talking to the API
-- directly, so every limit it applies is repeated here as a CHECK, and every
-- question of "who may do this" is answered by Row Level Security rather
-- than by the app remembering to ask.
--
-- In particular:
--   * A signed-out visitor can READ published routes, votes and comments,
--     and can do nothing else at all.
--   * A signed-in member can write routes, votes and comments AS THEMSELVES.
--     `author_id` is not a field the client gets to choose; the policies pin
--     it to auth.uid().
--   * The `validated` tag is not writable by members at any privilege the
--     browser holds. A trigger raises if a non-moderator moves it, so even
--     a policy mistake later cannot open it.
--   * Vote counts are not writable by anyone. They are maintained by
--     triggers from the votes table, so a route cannot be given a thousand
--     upvotes by PATCHing a column.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Extensions
-- ------------------------------------------------------------
create extension if not exists pgcrypto;
create extension if not exists citext;


-- ------------------------------------------------------------
-- 1. Profiles
--
-- One row per member, created by a trigger the moment auth.users gets a row
-- so there is never a signed-in member without a profile to attribute a
-- route to. The handle is the public identity; the email never leaves
-- auth.users and is not readable by anybody but its owner.
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  handle        citext unique not null,
  display_name  text,
  is_moderator  boolean not null default false,
  created_at    timestamptz not null default now(),

  constraint handle_shape check (handle ~ '^[a-z][a-z0-9_]{2,23}$'),
  constraint display_name_len check (display_name is null or char_length(display_name) between 1 and 40)
);

-- The handle a new member gets. The one they asked for on the sign-up page
-- (sent as user metadata) if it has the right shape and is free; otherwise
-- one derived from the email's local part, with a numeric suffix if it is
-- taken. Members can change it afterwards; what matters is that one exists
-- from the first second.
create or replace function public.pick_handle(wanted text, email text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  base text;
  candidate text;
  n int := 0;
begin
  wanted := lower(coalesce(wanted, ''));
  if wanted ~ '^[a-z][a-z0-9_]{2,23}$'
     and not exists (select 1 from public.profiles p where p.handle = wanted) then
    return wanted;
  end if;

  base := lower(regexp_replace(split_part(coalesce(email, 'commuter'), '@', 1), '[^a-z0-9_]', '', 'g'));
  if base !~ '^[a-z]' then base := 'c' || base; end if;
  base := left(base, 20);
  if char_length(base) < 3 then base := base || 'ter'; end if;

  candidate := base;
  while exists (select 1 from public.profiles p where p.handle = candidate) loop
    n := n + 1;
    candidate := left(base, 20) || n::text;
  end loop;
  return candidate;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, handle)
  values (new.id, public.pick_handle(new.raw_user_meta_data ->> 'handle', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- The account that signed up BEFORE this file was run has no profile: the
-- trigger above did not exist yet to make one. Every write in the app hangs
-- off a profile, so that member could sign in, save a handle that silently
-- matched no row, and then fail everywhere. Two repairs, both idempotent:
-- a backfill now, and a function the app calls on sign-in so a gap that
-- appears later closes itself.
-- One insert per member rather than one insert for all of them: a single
-- statement cannot see its own rows, so two addresses with the same local
-- part would both be handed the same handle and the unique index would
-- fail the whole script.
do $$
declare
  u record;
begin
  for u in select au.id, au.email, au.raw_user_meta_data
           from auth.users au
           where not exists (select 1 from public.profiles p where p.id = au.id)
  loop
    insert into public.profiles (id, handle)
    values (u.id, public.pick_handle(u.raw_user_meta_data ->> 'handle', u.email))
    on conflict (id) do nothing;
  end loop;
end;
$$;

-- Returns the caller's profile, making it first if it is missing. `created`
-- tells the app to offer the "choose your handle" step, since a handle made
-- here was picked by the database rather than by the person.
create or replace function public.ensure_profile()
returns table (id uuid, handle text, display_name text, is_moderator boolean,
               created_at timestamptz, created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  made boolean := false;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = me) then
    insert into public.profiles (id, handle)
    select u.id, public.pick_handle(u.raw_user_meta_data ->> 'handle', u.email)
    from auth.users u where u.id = me
    on conflict on constraint profiles_pkey do nothing;
    made := true;
  end if;
  return query
    select p.id, p.handle::text, p.display_name, p.is_moderator, p.created_at, made
    from public.profiles p where p.id = me;
end;
$$;


-- ------------------------------------------------------------
-- 2. Routes
--
-- `path` is the drawn line: a JSON array of [lat, lon] pairs. `stops` is the
-- list of named points the author built it from. Both are JSON rather than
-- PostGIS geometry on purpose — this app draws with Leaflet and plans in
-- JavaScript, nothing here does a spatial join, and adding PostGIS would be
-- a dependency paid for in nothing.
--
-- The four bbox columns ARE the spatial index. They are maintained by a
-- trigger from `path`, so "which routes could possibly pass near here" is an
-- ordinary indexed range query that a client can express in PostgREST.
-- ------------------------------------------------------------
create table if not exists public.routes (
  id                uuid primary key default gen_random_uuid(),
  author_id         uuid not null references public.profiles(id) on delete cascade,

  name              text not null,
  route_type        text not null,
  description       text,

  origin_name       text not null,
  destination_name  text not null,
  city              text,
  country_code      text not null default 'PH',

  fare_min          numeric(10,2),
  fare_max          numeric(10,2),
  currency          text not null default 'PHP',

  path              jsonb not null,
  stops             jsonb not null,
  distance_m        integer not null default 0,
  duration_s        integer not null default 0,

  -- maintained by triggers; not writable by anybody (see 6)
  min_lat           double precision,
  max_lat           double precision,
  min_lon           double precision,
  max_lon           double precision,
  upvotes           integer not null default 0,
  downvotes         integer not null default 0,
  score             integer not null default 0,
  comment_count     integer not null default 0,

  validated         boolean not null default false,
  validated_at      timestamptz,
  validated_by      uuid references public.profiles(id) on delete set null,
  validated_note    text,

  status            text not null default 'published',
  last_confirmed_at timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint name_len        check (char_length(name) between 3 and 90),
  constraint desc_len        check (description is null or char_length(description) <= 600),
  constraint origin_len      check (char_length(origin_name) between 1 and 80),
  constraint dest_len        check (char_length(destination_name) between 1 and 80),
  constraint city_len        check (city is null or char_length(city) <= 60),
  constraint country_shape   check (country_code ~ '^[A-Z]{2}$'),
  constraint currency_shape  check (currency ~ '^[A-Z]{3}$'),
  constraint fare_sane       check (
                               (fare_min is null or (fare_min >= 0 and fare_min <= 100000)) and
                               (fare_max is null or (fare_max >= 0 and fare_max <= 100000)) and
                               (fare_min is null or fare_max is null or fare_max >= fare_min)),
  constraint type_known      check (route_type in (
                               'jeepney','bus','uv','tricycle','habal','train',
                               'ferry','van','pedicab','walk','other')),
  constraint status_known    check (status in ('published','hidden','removed')),
  -- A line needs two points, and 4000 is far more than any real jeepney
  -- route: the cap is there so one row cannot be used to store a megabyte.
  constraint path_shape      check (jsonb_typeof(path) = 'array'
                                    and jsonb_array_length(path) between 2 and 4000),
  constraint stops_shape     check (jsonb_typeof(stops) = 'array'
                                    and jsonb_array_length(stops) between 2 and 25),
  constraint distance_sane   check (distance_m >= 0 and distance_m <= 2000000),
  constraint duration_sane   check (duration_s >= 0 and duration_s <= 604800)
);

-- Full text. 'simple' rather than 'english' deliberately: the searchable
-- words here are Philippine place names, and an English stemmer turns
-- "Bacoor" and "Baclaran" into things nobody typed.
alter table public.routes
  add column if not exists search tsvector
  generated always as (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(origin_name, '') || ' ' || coalesce(destination_name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(city, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(route_type, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'C')
  ) stored;

create index if not exists routes_search_idx    on public.routes using gin (search);
create index if not exists routes_bbox_idx      on public.routes (min_lat, max_lat, min_lon, max_lon)
                                                 where status = 'published';
create index if not exists routes_score_idx     on public.routes (score desc, created_at desc)
                                                 where status = 'published';
create index if not exists routes_author_idx    on public.routes (author_id, created_at desc);
create index if not exists routes_type_idx      on public.routes (route_type) where status = 'published';
create index if not exists routes_trgm_name_idx on public.routes (lower(name));


-- ------------------------------------------------------------
-- 3. Votes
--
-- One row per member per route, value +1 or -1. Changing your mind is an
-- UPDATE of your own row, not a second vote — which is the entire reason
-- the counters live in triggers rather than in the client.
-- ------------------------------------------------------------
create table if not exists public.route_votes (
  route_id   uuid not null references public.routes(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  value      smallint not null,
  created_at timestamptz not null default now(),
  primary key (route_id, user_id),
  constraint vote_value check (value in (-1, 1))
);
create index if not exists route_votes_user_idx on public.route_votes (user_id);


-- ------------------------------------------------------------
-- 4. Comments
--
-- Flat, not threaded. A two-level thread on a jeepney route is an
-- argument about a jeepney route with extra indentation.
--
-- Deleting is a tombstone rather than a DELETE, so the thread above and
-- below a removed comment still reads in order.
-- ------------------------------------------------------------
create table if not exists public.route_comments (
  id         uuid primary key default gen_random_uuid(),
  route_id   uuid not null references public.routes(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  body       text not null,
  upvotes    integer not null default 0,
  downvotes  integer not null default 0,
  score      integer not null default 0,
  deleted    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint body_len check (char_length(body) between 1 and 1000)
);
create index if not exists comments_route_idx on public.route_comments (route_id, created_at desc);
create index if not exists comments_user_idx  on public.route_comments (user_id);

create table if not exists public.comment_votes (
  comment_id uuid not null references public.route_comments(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  value      smallint not null,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id),
  constraint vote_value check (value in (-1, 1))
);


-- ------------------------------------------------------------
-- 5. Reports
--
-- Somewhere for "this route does not exist" that is not the comments. Only
-- the reporter and moderators can read a report back, so reporting is not
-- itself a public act.
-- ------------------------------------------------------------
create table if not exists public.route_reports (
  id         uuid primary key default gen_random_uuid(),
  route_id   uuid not null references public.routes(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  reason     text not null,
  detail     text,
  resolved   boolean not null default false,
  created_at timestamptz not null default now(),
  unique (route_id, user_id),
  constraint reason_known check (reason in ('not-real','wrong-path','duplicate','offensive','outdated','other')),
  constraint detail_len   check (detail is null or char_length(detail) <= 500)
);


-- ------------------------------------------------------------
-- 6. The columns nobody may write
--
-- Counters, the bounding box and the validated tag are all derived or
-- privileged. Rather than hope the UPDATE policy is narrow enough, these
-- triggers put the old value back. A client that PATCHes `upvotes` gets a
-- 200 and no change, which is the correct amount of attention to pay it.
-- ------------------------------------------------------------
create or replace function public.routes_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_mod boolean;
  pts jsonb;
  lats double precision[];
  lons double precision[];
begin
  select coalesce(p.is_moderator, false) into is_mod
  from public.profiles p where p.id = auth.uid();

  if tg_op = 'UPDATE' then
    -- Derived counters: restored, never rejected.
    new.upvotes       := old.upvotes;
    new.downvotes     := old.downvotes;
    new.score         := old.score;
    new.comment_count := old.comment_count;
    new.author_id     := old.author_id;
    new.created_at    := old.created_at;
    new.updated_at    := now();

    -- The validated tag: rejected loudly, because silently ignoring it
    -- would let a client believe it had the tag.
    if (new.validated is distinct from old.validated
        or new.validated_note is distinct from old.validated_note)
       and not coalesce(is_mod, false) then
      raise exception 'only a moderator can change the validated tag'
        using errcode = '42501';
    end if;

    if new.validated is distinct from old.validated then
      new.validated_at := case when new.validated then now() else null end;
      new.validated_by := case when new.validated then auth.uid() else null end;
    else
      new.validated_at := old.validated_at;
      new.validated_by := old.validated_by;
    end if;
  else
    new.upvotes := 0; new.downvotes := 0; new.score := 0; new.comment_count := 0;
    if new.validated and not coalesce(is_mod, false) then
      raise exception 'only a moderator can file a route as validated'
        using errcode = '42501';
    end if;
    if not new.validated then
      new.validated_at := null; new.validated_by := null; new.validated_note := null;
    end if;
  end if;

  -- The bounding box, from the path, every time the path changes.
  pts := new.path;
  select array_agg((e->>0)::double precision), array_agg((e->>1)::double precision)
    into lats, lons
  from jsonb_array_elements(pts) e;

  if lats is null or array_length(lats, 1) < 2 then
    raise exception 'a route needs at least two points' using errcode = '23514';
  end if;

  new.min_lat := (select min(v) from unnest(lats) v);
  new.max_lat := (select max(v) from unnest(lats) v);
  new.min_lon := (select min(v) from unnest(lons) v);
  new.max_lon := (select max(v) from unnest(lons) v);

  if new.min_lat < -90 or new.max_lat > 90 or new.min_lon < -180 or new.max_lon > 180 then
    raise exception 'a route point is not a coordinate' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists routes_guard_trg on public.routes;
create trigger routes_guard_trg
  before insert or update on public.routes
  for each row execute function public.routes_guard();


-- Counters, recomputed from the votes themselves rather than incremented,
-- so they cannot drift out of step with the rows they describe.
create or replace function public.recount_route(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare u int; d int;
begin
  select count(*) filter (where value = 1), count(*) filter (where value = -1)
    into u, d
  from public.route_votes where route_id = target;

  update public.routes set
    upvotes = coalesce(u, 0),
    downvotes = coalesce(d, 0),
    score = coalesce(u, 0) - coalesce(d, 0),
    -- An upvote is the community saying "this still runs", which is the
    -- freshness signal the reliability meter reads.
    last_confirmed_at = case when coalesce(u, 0) > upvotes then now() else last_confirmed_at end
  where id = target;
end;
$$;

create or replace function public.route_votes_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recount_route(coalesce(new.route_id, old.route_id));
  return null;
end;
$$;

drop trigger if exists route_votes_after_trg on public.route_votes;
create trigger route_votes_after_trg
  after insert or update or delete on public.route_votes
  for each row execute function public.route_votes_after();


create or replace function public.comments_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare target uuid;
begin
  target := coalesce(new.route_id, old.route_id);
  update public.routes r set comment_count = (
    select count(*) from public.route_comments c
    where c.route_id = target and not c.deleted
  ) where r.id = target;
  return null;
end;
$$;

drop trigger if exists comments_after_trg on public.route_comments;
create trigger comments_after_trg
  after insert or update or delete on public.route_comments
  for each row execute function public.comments_after();


create or replace function public.comment_votes_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare target uuid; u int; d int;
begin
  target := coalesce(new.comment_id, old.comment_id);
  select count(*) filter (where value = 1), count(*) filter (where value = -1)
    into u, d from public.comment_votes where comment_id = target;
  update public.route_comments set
    upvotes = coalesce(u, 0), downvotes = coalesce(d, 0),
    score = coalesce(u, 0) - coalesce(d, 0)
  where id = target;
  return null;
end;
$$;

drop trigger if exists comment_votes_after_trg on public.comment_votes;
create trigger comment_votes_after_trg
  after insert or update or delete on public.comment_votes
  for each row execute function public.comment_votes_after();


-- A comment's author and body are the author's; its counters are not.
create or replace function public.comments_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    new.upvotes := old.upvotes;
    new.downvotes := old.downvotes;
    new.score := old.score;
    new.user_id := old.user_id;
    new.route_id := old.route_id;
    new.created_at := old.created_at;
    new.updated_at := now();
    if new.deleted then new.body := '[removed]'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists comments_guard_trg on public.route_comments;
create trigger comments_guard_trg
  before insert or update on public.route_comments
  for each row execute function public.comments_guard();


-- ------------------------------------------------------------
-- 7. Row Level Security
--
-- Everything is denied until a policy allows it. Read the policies as the
-- answer to "what can a stranger with the anon key do": select published
-- routes, select their votes and comments, and nothing else.
-- ------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.routes         enable row level security;
alter table public.route_votes    enable row level security;
alter table public.route_comments enable row level security;
alter table public.comment_votes  enable row level security;
alter table public.route_reports  enable row level security;

-- Helper: is the caller a moderator? SECURITY DEFINER so a policy on
-- profiles cannot recurse into itself while answering.
create or replace function public.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_moderator from public.profiles p where p.id = auth.uid()), false);
$$;

-- profiles: public identities are public; only you may edit yours, and the
-- moderator flag is not in your gift.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid()
              and is_moderator = (select p.is_moderator from public.profiles p where p.id = auth.uid()));

-- routes
drop policy if exists routes_read on public.routes;
create policy routes_read on public.routes
  for select using (status = 'published' or author_id = auth.uid() or public.is_moderator());

drop policy if exists routes_insert on public.routes;
create policy routes_insert on public.routes
  for insert with check (auth.uid() is not null and author_id = auth.uid());

drop policy if exists routes_update_own on public.routes;
create policy routes_update_own on public.routes
  for update using (author_id = auth.uid() or public.is_moderator())
  with check (author_id = auth.uid() or public.is_moderator());

drop policy if exists routes_delete_own on public.routes;
create policy routes_delete_own on public.routes
  for delete using (author_id = auth.uid() or public.is_moderator());

-- votes: counts are public, and who voted which way is public too, because
-- the alternative is a vote nobody can verify and a UI that cannot show you
-- your own vote after a reload.
drop policy if exists votes_read on public.route_votes;
create policy votes_read on public.route_votes for select using (true);

drop policy if exists votes_write_own on public.route_votes;
create policy votes_write_own on public.route_votes
  for insert with check (auth.uid() is not null and user_id = auth.uid());

drop policy if exists votes_update_own on public.route_votes;
create policy votes_update_own on public.route_votes
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists votes_delete_own on public.route_votes;
create policy votes_delete_own on public.route_votes
  for delete using (user_id = auth.uid());

-- comments
drop policy if exists comments_read on public.route_comments;
create policy comments_read on public.route_comments for select using (true);

drop policy if exists comments_insert on public.route_comments;
create policy comments_insert on public.route_comments
  for insert with check (auth.uid() is not null and user_id = auth.uid());

drop policy if exists comments_update_own on public.route_comments;
create policy comments_update_own on public.route_comments
  for update using (user_id = auth.uid() or public.is_moderator())
  with check (user_id = auth.uid() or public.is_moderator());

drop policy if exists comments_delete_own on public.route_comments;
create policy comments_delete_own on public.route_comments
  for delete using (user_id = auth.uid() or public.is_moderator());

drop policy if exists comment_votes_read on public.comment_votes;
create policy comment_votes_read on public.comment_votes for select using (true);

drop policy if exists comment_votes_write on public.comment_votes;
create policy comment_votes_write on public.comment_votes
  for insert with check (auth.uid() is not null and user_id = auth.uid());

drop policy if exists comment_votes_update on public.comment_votes;
create policy comment_votes_update on public.comment_votes
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists comment_votes_delete on public.comment_votes;
create policy comment_votes_delete on public.comment_votes
  for delete using (user_id = auth.uid());

-- reports: writing one is not a public act.
drop policy if exists reports_read_own on public.route_reports;
create policy reports_read_own on public.route_reports
  for select using (user_id = auth.uid() or public.is_moderator());

drop policy if exists reports_insert on public.route_reports;
create policy reports_insert on public.route_reports
  for insert with check (auth.uid() is not null and user_id = auth.uid());


-- ------------------------------------------------------------
-- 8. The functions the app calls
--
-- Every one of these takes its arguments as parameters, so nothing the user
-- types is ever concatenated into SQL. They are SECURITY INVOKER (the
-- default), so RLS still applies inside them — a search cannot read a route
-- the caller could not have selected directly.
-- ------------------------------------------------------------

-- Search. Ranking is text relevance, a vote lift, and a penalty that pushes
-- a route with net-negative votes down the list rather than merely below
-- the others — which is what "negative votes push it down in searches"
-- has to mean if it is to be worth anything.
create or replace function public.search_routes(
  q              text default '',
  types          text[] default null,
  country        text default null,
  city_q         text default null,
  only_validated boolean default false,
  sort           text default 'best',
  max_rows       integer default 30,
  skip           integer default 0
)
returns table (
  id uuid, name text, route_type text, description text,
  origin_name text, destination_name text, city text, country_code text,
  fare_min numeric, fare_max numeric, currency text,
  distance_m integer, duration_s integer,
  upvotes integer, downvotes integer, score integer, comment_count integer,
  validated boolean, last_confirmed_at timestamptz, created_at timestamptz,
  author_handle text, relevance real
)
language sql
stable
as $$
  with tsq as (
    select case when coalesce(btrim(q), '') = '' then null
                else websearch_to_tsquery('simple', q) end as query
  )
  select r.id, r.name, r.route_type, r.description,
         r.origin_name, r.destination_name, r.city, r.country_code,
         r.fare_min, r.fare_max, r.currency,
         r.distance_m, r.duration_s,
         r.upvotes, r.downvotes, r.score, r.comment_count,
         r.validated, r.last_confirmed_at, r.created_at,
         p.handle::text as author_handle,
         case when (select query from tsq) is null then 0::real
              else ts_rank(r.search, (select query from tsq)) end as relevance
  from public.routes r
  join public.profiles p on p.id = r.author_id
  where r.status = 'published'
    and ((select query from tsq) is null or r.search @@ (select query from tsq))
    and (types is null or array_length(types, 1) is null or r.route_type = any (types))
    and (country is null or r.country_code = country)
    and (coalesce(btrim(city_q), '') = '' or r.city ilike '%' || city_q || '%')
    and (not only_validated or r.validated)
  order by
    case when sort = 'new' then extract(epoch from r.created_at) else null end desc nulls last,
    case when sort = 'top' then r.score else null end desc nulls last,
    case when sort = 'best' then
      -- text relevance, then the community's verdict, then the penalty
      (case when (select query from tsq) is null then 0
            else ts_rank(r.search, (select query from tsq)) * 4 end)
      + least(1.5, ln(1 + greatest(r.score, 0)) * 0.45)
      - least(3.0, ln(1 + greatest(-r.score, 0)) * 1.1)
      + (case when r.validated then 0.5 else 0 end)
    else null end desc nulls last,
    r.created_at desc
  limit greatest(1, least(coalesce(max_rows, 30), 100))
  offset greatest(0, coalesce(skip, 0));
$$;


-- Casting a vote. One call, so "change my mind" and "take it back" cannot
-- race each other into two rows, and so the client never has to decide
-- whether it is inserting or updating.
create or replace function public.cast_route_vote(target uuid, v integer)
returns table (upvotes integer, downvotes integer, score integer, my_vote integer)
language plpgsql
security invoker
set search_path = public
as $$
declare me uuid := auth.uid();
begin
  if me is null then
    raise exception 'sign in to vote' using errcode = '42501';
  end if;
  if v not in (-1, 0, 1) then
    raise exception 'a vote is up, down, or taken back' using errcode = '23514';
  end if;

  if v = 0 then
    delete from public.route_votes where route_id = target and user_id = me;
  else
    insert into public.route_votes (route_id, user_id, value)
    values (target, me, v::smallint)
    on conflict (route_id, user_id) do update set value = excluded.value, created_at = now();
  end if;

  return query
    select r.upvotes, r.downvotes, r.score,
           coalesce((select rv.value::integer from public.route_votes rv
                     where rv.route_id = target and rv.user_id = me), 0)
    from public.routes r where r.id = target;
end;
$$;


create or replace function public.cast_comment_vote(target uuid, v integer)
returns table (upvotes integer, downvotes integer, score integer, my_vote integer)
language plpgsql
security invoker
set search_path = public
as $$
declare me uuid := auth.uid();
begin
  if me is null then
    raise exception 'sign in to vote' using errcode = '42501';
  end if;
  if v not in (-1, 0, 1) then
    raise exception 'a vote is up, down, or taken back' using errcode = '23514';
  end if;

  if v = 0 then
    delete from public.comment_votes where comment_id = target and user_id = me;
  else
    insert into public.comment_votes (comment_id, user_id, value)
    values (target, me, v::smallint)
    on conflict (comment_id, user_id) do update set value = excluded.value, created_at = now();
  end if;

  return query
    select c.upvotes, c.downvotes, c.score,
           coalesce((select cv.value::integer from public.comment_votes cv
                     where cv.comment_id = target and cv.user_id = me), 0)
    from public.route_comments c where c.id = target;
end;
$$;


-- Every route whose bounding box overlaps the area being planned in, with
-- its path, so the journey planner can do the geometry in the browser.
-- Capped hard: a client that asks for the whole country gets the best 300
-- routes in it and not the whole table.
create or replace function public.routes_in_bbox(
  south double precision, west double precision,
  north double precision, east double precision,
  types text[] default null,
  max_rows integer default 300
)
returns table (
  id uuid, name text, route_type text,
  origin_name text, destination_name text, city text,
  fare_min numeric, fare_max numeric, currency text,
  distance_m integer, duration_s integer,
  upvotes integer, downvotes integer, score integer, comment_count integer,
  validated boolean, last_confirmed_at timestamptz, created_at timestamptz,
  path jsonb
)
language sql
stable
as $$
  select r.id, r.name, r.route_type,
         r.origin_name, r.destination_name, r.city,
         r.fare_min, r.fare_max, r.currency,
         r.distance_m, r.duration_s,
         r.upvotes, r.downvotes, r.score, r.comment_count,
         r.validated, r.last_confirmed_at, r.created_at,
         r.path
  from public.routes r
  where r.status = 'published'
    and r.max_lat >= south and r.min_lat <= north
    and r.max_lon >= west  and r.min_lon <= east
    and (types is null or array_length(types, 1) is null or r.route_type = any (types))
  order by r.score desc, r.validated desc, r.created_at desc
  limit greatest(1, least(coalesce(max_rows, 300), 600));
$$;


-- ------------------------------------------------------------
-- 9. Grants
--
-- PostgREST reaches the tables as `anon` or `authenticated`. RLS decides
-- what those roles may see; these grants decide that they may ask at all.
-- Note what is NOT granted: no DELETE on profiles, no access to anything
-- outside this schema, and no grant at all to `anon` beyond SELECT.
-- ------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select on public.profiles, public.routes, public.route_votes,
                 public.route_comments, public.comment_votes to anon, authenticated;

grant insert, update on public.profiles to authenticated;
grant insert, update, delete on public.routes to authenticated;
grant insert, update, delete on public.route_votes to authenticated;
grant insert, update, delete on public.route_comments to authenticated;
grant insert, update, delete on public.comment_votes to authenticated;
grant select, insert on public.route_reports to authenticated;

grant execute on function public.search_routes(text, text[], text, text, boolean, text, integer, integer) to anon, authenticated;
grant execute on function public.routes_in_bbox(double precision, double precision, double precision, double precision, text[], integer) to anon, authenticated;
grant execute on function public.cast_route_vote(uuid, integer) to authenticated;
grant execute on function public.cast_comment_vote(uuid, integer) to authenticated;
grant execute on function public.is_moderator() to anon, authenticated;
revoke execute on function public.ensure_profile() from public, anon;
grant execute on function public.ensure_profile() to authenticated;
-- pick_handle reads every handle to find a free one; it is for the trigger
-- and ensure_profile, not for the API.
revoke execute on function public.pick_handle(text, text) from public, anon, authenticated;

-- PostgREST answers from a cached picture of the schema, and a table or
-- function it has not noticed yet is a 404 — which the app used to show as
-- a bare "Not found." after sign-in. Supabase usually reloads the cache on
-- its own; this makes sure, so running this file is always enough.
notify pgrst, 'reload schema';


-- ------------------------------------------------------------
-- 10. Making somebody a moderator
--
-- There is no UI for this and there should not be. Run it here, by hand,
-- for the handles you trust:
--
--   update public.profiles set is_moderator = true where handle = 'yourname';
--
-- A moderator is the only account that can move the `validated` tag, hide a
-- route somebody else filed, or read the reports.
-- ------------------------------------------------------------

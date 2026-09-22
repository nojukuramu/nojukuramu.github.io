-- ============================================================
-- TheCommuters — did schema.sql actually take?
--
-- Run this in the Supabase SQL editor AFTER schema.sql. It writes nothing
-- and changes nothing; it just asks the database what it has, so "I think
-- I ran it" becomes a list you can read.
--
-- Every row should say ok. Anything that says MISSING means schema.sql
-- did not finish — scroll back to where it stopped, fix that, and run it
-- again. It is re-runnable and will not drop anybody's routes.
-- ============================================================

with expected_tables(name) as (
  values ('profiles'), ('routes'), ('route_votes'),
         ('route_comments'), ('comment_votes'), ('route_reports')
),
expected_functions(name) as (
  values ('search_routes'), ('routes_in_bbox'),
         ('cast_route_vote'), ('cast_comment_vote'), ('is_moderator'),
         ('ensure_profile'), ('pick_handle')
)

select 'table' as kind, e.name,
       case when t.tablename is null then 'MISSING'
            when not c.relrowsecurity then 'NO ROW LEVEL SECURITY'
            else 'ok (' || (select count(*) from pg_policies p
                            where p.schemaname = 'public' and p.tablename = e.name)
                 || ' policies)'
       end as status
from expected_tables e
left join pg_tables t on t.schemaname = 'public' and t.tablename = e.name
left join pg_class c on c.relname = e.name and c.relnamespace = 'public'::regnamespace

union all

select 'function', e.name,
       case when p.proname is null then 'MISSING' else 'ok' end
from expected_functions e
left join pg_proc p on p.proname = e.name and p.pronamespace = 'public'::regnamespace

union all

select 'trigger', 'on_auth_user_created',
       case when not exists (
         select 1 from pg_trigger where tgname = 'on_auth_user_created'
       ) then 'MISSING (new sign-ups will have no profile)' else 'ok' end

union all

select 'trigger', 'routes_guard_trg',
       case when not exists (
         select 1 from pg_trigger where tgname = 'routes_guard_trg'
       ) then 'MISSING (vote counts and the validated tag would be writable)' else 'ok' end

union all

select 'data', 'members with no profile',
       case when (select count(*) from auth.users u
                  where not exists (select 1 from public.profiles p where p.id = u.id)) = 0
            then 'ok'
            else (select count(*) from auth.users u
                  where not exists (select 1 from public.profiles p where p.id = u.id))::text
                 || ' MISSING (run schema.sql again; it backfills them)'
       end

union all

select 'data', 'routes filed so far', count(*)::text from public.routes

union all

select 'data', 'moderators', count(*)::text from public.profiles where is_moderator

order by 1, 2;

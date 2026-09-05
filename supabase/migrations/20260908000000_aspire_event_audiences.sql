-- EVENT-AUDIENCE-2: who sees an ASPIRE event, as a SET of portal roles.
--
-- Until now "Who sees this" was one value: 'internal' or 'all', and 'all' meant
-- the Student portal, the only outside surface with a delivery path. The Owner
-- (2026-09-04) asked for a multi-answer control: Internal team (always), plus
-- any of Student, Unit Leader, Academic Partner, Nursing Education & Leadership.
-- That is a set, so it gets an array column with a CHECK on the allowed values.
--
-- The old `audience` column STAYS and keeps being written (derived: 'all' when
-- the set is non-empty, 'internal' otherwise), so every existing reader of it
-- keeps working during and after the rollout. The new endpoint reads the array
-- and falls back to the old column while this migration is unapplied.
--
-- Backfill: every event whose audience was 'all' delivered to students and to
-- nobody else, so it becomes {student}. Nothing is widened by this migration.
--
-- Owner-gated per docs/security/OWNER_SQL_GATE.md. Verification:
-- db/audit/aspire_event_audiences_preflight_and_verification.sql

alter table public.aspire_events
  add column if not exists audiences text[] not null default '{}'::text[];

alter table public.aspire_events
  drop constraint if exists aspire_events_audiences_check;
alter table public.aspire_events
  add constraint aspire_events_audiences_check
  check (audiences <@ array['student','unit_leader','academic_partner','nursing_academic']::text[]);

update public.aspire_events
   set audiences = array['student']::text[]
 where audience = 'all'
   and audiences = '{}'::text[];

create index if not exists aspire_events_audiences_gin
  on public.aspire_events using gin (audiences);

comment on column public.aspire_events.audiences is
  'EVENT-AUDIENCE-2: portal roles that may see this event (student, unit_leader, academic_partner, nursing_academic). Empty = internal team only. Delivery is further gated by event type in api/portal/my-calendar-events.js.';

-- db/audit/keith_checkin_sorting_checks.sql
-- KEITH-CHECKIN-1, 2026-09-29. Read-only. PRE sections BEFORE
-- supabase/migrations/20261017000000_keith_checkin_sorting.sql, POST sections AFTER, one at a time.

-- ── PRE 1. What the migration needs is there, and the skill is not yet ───────────
SELECT
  to_regclass('public.support_checkin_events') IS NOT NULL AS support_checkin_events,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'keith_skills' AND column_name = 'run_mode') AS run_mode,
  to_regclass('public.keith_provenance') IS NOT NULL AS keith_provenance,
  NOT EXISTS (SELECT 1 FROM public.keith_skills WHERE slug = 'sort-checkin-reply') AS skill_absent,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'support_checkin_events_classification_check') AS classification_check;
-- EXPECT: one row: true, true, true, true, and
--         CHECK ((classification = ANY (ARRAY['urgent'::text, 'decline'::text, 'request'::text, 'needs_look'::text]))).
--         If classification_check is NULL, stop: the constraint has another name.

-- ── POST 1. thank_you is a classification ────────────────────────────────────────
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'support_checkin_events_classification_check';
-- EXPECT: the same list with 'thank_you'::text added.

-- ── POST 2. The skill: draft, disabled, in shadow, kept out of chat ──────────────
SELECT slug, status, enabled, run_mode, model_route, io_contract->>'surface' AS surface, left(instruction_body, 60) AS starts
FROM public.keith_skills WHERE slug = 'sort-checkin-reply';
-- EXPECT: sort-checkin-reply, draft, false, shadow, default, action_center,
--         "You sort ONE reply a nursing student wrote to "Do you need an".
-- Then, in Settings > Keith > Skills: Activate it, then Enable it. It stays in Shadow; the Action
-- Center shows "would" lines within ten minutes of the next reply.

-- ── POST 3. Nothing about existing check-ins changed ─────────────────────────────
SELECT classification, status, count(*) AS n FROM public.support_checkin_events GROUP BY 1, 2 ORDER BY 1, 2;
-- EXPECT: the same counts as before the migration; no thank_you rows yet.

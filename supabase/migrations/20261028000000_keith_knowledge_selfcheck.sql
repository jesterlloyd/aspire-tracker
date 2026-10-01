-- KEITH-KNOWLEDGE-SELFCHECK-1 (Phase 1, plumbing), 2026-09-30. OWNER-GATED: do not apply from a session.
--
-- Keith checks his own Knowledge Center: he compares the entries with what changed in the app (the
-- repository's commit history) and with the questions he could not answer, and proposes edits and new
-- Draft entries for the Owner to review. Owner decisions, 2026-09-30: both kinds of evidence; every
-- other week (the 1st and 15th) and on demand; an unanswered question is kept SCRUBBED (names, emails
-- and phone numbers removed) for 90 days, Owner-only; a missing topic becomes a Draft entry.
--
-- This migration is the plumbing only:
--   1. keith_knowledge_gaps       the scrubbed questions Keith's Knowledge Center did not cover. One row
--                                 per question, deleted 90 days after it was asked (expires_at). Only a
--                                 program question (policy_process, general_other) from a real session
--                                 is kept; a question answered from live records is never stored.
--   2. knowledge_revisions        + proposed_by ('person' default | 'keith') and evidence (jsonb): a
--                                 suggestion Keith files says so, and carries why (the commits, the
--                                 questions). author_id stays NOT NULL: Keith's suggestion is credited
--                                 to the Owner who reviews it, as enrichment's already is.
--   3. knowledge_entries          + proposed_by and proposal_evidence, for a Draft entry Keith writes for
--                                 a missing topic. A Draft is never retrieved, so Keith cannot use it
--                                 until the Owner activates it.
--
-- Every existing row reads 'person', so nothing already in the Knowledge Center changes. The three
-- lifecycle functions read these tables with SELECT * INTO a %ROWTYPE, which follows new columns.
-- RLS ON with no policy and no browser grant on the new table; the endpoints use the service role, as
-- for every knowledge table. Additive, one transaction, safe to re-run. The app runs on both sides of
-- it: before it runs, a missed question is simply not kept. Checks:
-- db/audit/keith_knowledge_selfcheck_checks.sql. Rollback: end of file.

BEGIN;

CREATE TABLE IF NOT EXISTS public.keith_knowledge_gaps (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL DEFAULT 'a5f1e000-0000-4000-8000-000000000001' REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  question     text        NOT NULL CHECK (char_length(question) BETWEEN 1 AND 500),
  intent       text        NOT NULL CHECK (intent IN ('policy_process', 'general_other')),
  top_score    numeric,
  asked_role   text,
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  used_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_keith_knowledge_gaps_created ON public.keith_knowledge_gaps (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_keith_knowledge_gaps_expires ON public.keith_knowledge_gaps (expires_at);

ALTER TABLE public.keith_knowledge_gaps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.keith_knowledge_gaps FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.keith_knowledge_gaps TO service_role;

ALTER TABLE public.knowledge_revisions ADD COLUMN IF NOT EXISTS proposed_by text NOT NULL DEFAULT 'person';
ALTER TABLE public.knowledge_revisions ADD COLUMN IF NOT EXISTS evidence jsonb;
ALTER TABLE public.knowledge_revisions DROP CONSTRAINT IF EXISTS knowledge_revisions_proposed_by_check;
ALTER TABLE public.knowledge_revisions ADD CONSTRAINT knowledge_revisions_proposed_by_check CHECK (proposed_by IN ('person', 'keith'));

ALTER TABLE public.knowledge_entries ADD COLUMN IF NOT EXISTS proposed_by text NOT NULL DEFAULT 'person';
ALTER TABLE public.knowledge_entries ADD COLUMN IF NOT EXISTS proposal_evidence jsonb;
ALTER TABLE public.knowledge_entries DROP CONSTRAINT IF EXISTS knowledge_entries_proposed_by_check;
ALTER TABLE public.knowledge_entries ADD CONSTRAINT knowledge_entries_proposed_by_check CHECK (proposed_by IN ('person', 'keith'));

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Rollback (run as one block) ──────────────────────────────────────────────────
-- BEGIN;
--   ALTER TABLE public.knowledge_entries DROP CONSTRAINT IF EXISTS knowledge_entries_proposed_by_check;
--   ALTER TABLE public.knowledge_entries DROP COLUMN IF EXISTS proposal_evidence;
--   ALTER TABLE public.knowledge_entries DROP COLUMN IF EXISTS proposed_by;
--   ALTER TABLE public.knowledge_revisions DROP CONSTRAINT IF EXISTS knowledge_revisions_proposed_by_check;
--   ALTER TABLE public.knowledge_revisions DROP COLUMN IF EXISTS evidence;
--   ALTER TABLE public.knowledge_revisions DROP COLUMN IF EXISTS proposed_by;
--   DROP TABLE IF EXISTS public.keith_knowledge_gaps;
-- COMMIT;

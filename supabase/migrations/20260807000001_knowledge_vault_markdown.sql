-- =====================================================================
-- KNOWLEDGE-VAULT-1: Markdown vault fields, link index, complete snapshots
-- =====================================================================
--
-- Plan of record: docs/product/KEITH_SKILLS_KNOWLEDGE_VAULT_PLAN.md, Section
-- 3.2 (Knowledge Vault, additive to existing tables). Decisions confirmed by
-- the Owner on 2026-08-07 are recorded in docs/product/KNOWLEDGE_VAULT_P2.md.
--
-- WHAT THIS MIGRATION DOES
--   1. Adds Markdown/vault metadata columns to knowledge_entries and, in
--      lockstep, to knowledge_entry_versions and knowledge_revisions.
--   2. Creates knowledge_links, the resolved [[wikilink]] index.
--   3. Replaces THREE content-writing governance RPCs so version snapshots
--      carry the new fields.
--
-- WHAT THIS MIGRATION DOES **NOT** DO - read this before running it
--   * It REWRITES NO EXISTING ROW. Every existing entry keeps its exact body,
--     byte for byte, and lands with body_format = 'plain', which renders
--     precisely as it does today. Markdown is opt-in per entry, applied later
--     through the normal revision workflow. Keith's answers cannot change as a
--     result of running this file.
--   * It DROPS NOTHING. No table, column, constraint, index, policy, grant or
--     function is dropped.
--   * It does NOT change permissions on knowledge_entries,
--     knowledge_entry_versions or knowledge_revisions. Those three tables have
--     no explicit REVOKE today (they rely on deny-all RLS alone, unlike the
--     newer keith_* chassis). Tightening them is a real permissions change and
--     is deliberately left OUT of this migration for a separate Owner
--     decision. The NEW table below does follow the keith_* chassis.
--   * It does NOT enforce expires_at. Expiry becomes a review SIGNAL only;
--     retrieval behavior is unchanged (Owner decision, 2026-08-07).
--   * It does NOT touch keith_* tables, skills, Usage & Cost, student data,
--     or any RLS policy anywhere.
--
-- IDEMPOTENCY: every statement uses IF NOT EXISTS / OR REPLACE, so re-running
-- the file is safe. Run it as one transaction; it is small and fast.
--
-- ROLLBACK: see the block at the very bottom. It is exact and complete.

BEGIN;

-- =====================================================================
-- PRECHECK - run this FIRST and read the output before proceeding.
-- Reports what will be touched and proves nothing is already in the way.
-- =====================================================================
DO $precheck$
DECLARE
  v_entries          integer;
  v_active           integer;
  v_versions         integer;
  v_revisions        integer;
  v_already_migrated boolean;
  v_links_exists     boolean;
  v_expired          integer;
BEGIN
  SELECT count(*) INTO v_entries   FROM public.knowledge_entries;
  SELECT count(*) INTO v_active    FROM public.knowledge_entries WHERE state = 'active';
  SELECT count(*) INTO v_versions  FROM public.knowledge_entry_versions;
  SELECT count(*) INTO v_revisions FROM public.knowledge_revisions;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'knowledge_entries' AND column_name = 'body_format'
  ) INTO v_already_migrated;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'knowledge_links'
  ) INTO v_links_exists;

  -- Informational only. This migration does NOT act on expiry; the count is
  -- here so the Owner can see the blast radius of a FUTURE enforcement change.
  SELECT count(*) INTO v_expired
  FROM public.knowledge_entries
  WHERE state = 'active' AND expires_at IS NOT NULL AND expires_at < CURRENT_DATE;

  RAISE NOTICE '--- KNOWLEDGE VAULT PRECHECK ---';
  RAISE NOTICE 'knowledge_entries rows            : %', v_entries;
  RAISE NOTICE '  of which state = active         : %', v_active;
  RAISE NOTICE 'knowledge_entry_versions rows     : %', v_versions;
  RAISE NOTICE 'knowledge_revisions (pending) rows: %', v_revisions;
  RAISE NOTICE 'columns already added?            : %', v_already_migrated;
  RAISE NOTICE 'knowledge_links already exists?   : %', v_links_exists;
  RAISE NOTICE 'ACTIVE entries already past expires_at (informational, NOT acted on): %', v_expired;
  RAISE NOTICE 'All rows above keep body_format = plain. No body is rewritten.';
END
$precheck$;

-- =====================================================================
-- 1. knowledge_entries - vault metadata
-- =====================================================================
-- body_format defaults to 'plain' so every existing row is correct on arrival
-- and renders exactly as it does today. NOT NULL is safe because of the
-- default. New entries created through the app will be authored as markdown.
ALTER TABLE public.knowledge_entries
  ADD COLUMN IF NOT EXISTS body_format text NOT NULL DEFAULT 'plain',
  ADD COLUMN IF NOT EXISTS aliases     text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tags        text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS review_date date NULL,
  ADD COLUMN IF NOT EXISTS confidence  text NULL,
  ADD COLUMN IF NOT EXISTS superseded_by uuid NULL;

DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_entries_body_format_check') THEN
    ALTER TABLE public.knowledge_entries
      ADD CONSTRAINT knowledge_entries_body_format_check
      CHECK (body_format IN ('plain', 'markdown'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_entries_confidence_check') THEN
    ALTER TABLE public.knowledge_entries
      ADD CONSTRAINT knowledge_entries_confidence_check
      CHECK (confidence IS NULL OR confidence IN ('verified', 'provisional'));
  END IF;
  -- Self-reference for supersession. ON DELETE SET NULL, not CASCADE: deleting
  -- a superseding page must never delete the page it replaced.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_entries_superseded_by_fkey') THEN
    ALTER TABLE public.knowledge_entries
      ADD CONSTRAINT knowledge_entries_superseded_by_fkey
      FOREIGN KEY (superseded_by) REFERENCES public.knowledge_entries(id) ON DELETE SET NULL;
  END IF;
  -- A page cannot supersede itself.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_entries_superseded_by_not_self') THEN
    ALTER TABLE public.knowledge_entries
      ADD CONSTRAINT knowledge_entries_superseded_by_not_self
      CHECK (superseded_by IS NULL OR superseded_by <> id);
  END IF;
END
$c$;

-- Tag filtering in the vault UI. GIN is the right index for array containment
-- and stays correct as the corpus grows past the current couple of dozen pages.
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_tags ON public.knowledge_entries USING GIN (tags);
-- The review queue: entries past review_date or expires_at.
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_review ON public.knowledge_entries (review_date) WHERE review_date IS NOT NULL;

COMMENT ON COLUMN public.knowledge_entries.body_format IS
  'plain = legacy text rendered as-is; markdown = rendered by the vault renderer. Opt-in per entry; existing entries stay plain.';
COMMENT ON COLUMN public.knowledge_entries.aliases IS
  'Alternate names. Score like the title in retrieval and resolve [[wikilinks]].';
COMMENT ON COLUMN public.knowledge_entries.confidence IS
  'verified | provisional | NULL (unstated). Advisory for reviewers; does not gate retrieval.';

-- =====================================================================
-- 2. Snapshot tables - the SAME fields, so history is a true point-in-time record
-- =====================================================================
-- Owner decision 2026-08-07: snapshot and restore everything. Without this,
-- governance_restore_knowledge_version would copy an old snapshot over a page
-- and silently blank its format, aliases and tags.
--
-- superseded_by is deliberately NOT versioned. It is a lifecycle RELATIONSHIP
-- between two entries, in the same family as `state` - which this schema has
-- never versioned either. Restoring an old body should not resurrect a
-- supersession pointer that governance has since resolved.
ALTER TABLE public.knowledge_entry_versions
  ADD COLUMN IF NOT EXISTS body_format text NOT NULL DEFAULT 'plain',
  ADD COLUMN IF NOT EXISTS aliases     text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tags        text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS review_date date NULL,
  ADD COLUMN IF NOT EXISTS confidence  text NULL;

ALTER TABLE public.knowledge_revisions
  ADD COLUMN IF NOT EXISTS body_format text NOT NULL DEFAULT 'plain',
  ADD COLUMN IF NOT EXISTS aliases     text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tags        text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS review_date date NULL,
  ADD COLUMN IF NOT EXISTS confidence  text NULL;

DO $c2$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_entry_versions_body_format_check') THEN
    ALTER TABLE public.knowledge_entry_versions
      ADD CONSTRAINT knowledge_entry_versions_body_format_check
      CHECK (body_format IN ('plain', 'markdown'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_entry_versions_confidence_check') THEN
    ALTER TABLE public.knowledge_entry_versions
      ADD CONSTRAINT knowledge_entry_versions_confidence_check
      CHECK (confidence IS NULL OR confidence IN ('verified', 'provisional'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_revisions_body_format_check') THEN
    ALTER TABLE public.knowledge_revisions
      ADD CONSTRAINT knowledge_revisions_body_format_check
      CHECK (body_format IN ('plain', 'markdown'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_revisions_confidence_check') THEN
    ALTER TABLE public.knowledge_revisions
      ADD CONSTRAINT knowledge_revisions_confidence_check
      CHECK (confidence IS NULL OR confidence IN ('verified', 'provisional'));
  END IF;
END
$c2$;

-- =====================================================================
-- 3. knowledge_links - the resolved [[wikilink]] index
-- =====================================================================
-- Rebuilt in full for ONE source entry on every save of that entry, inside the
-- same request. target_entry_id NULL means the link did not resolve (broken or
-- ambiguous); target_text always preserves what the author literally wrote, so
-- the link checker can show it back to them.
CREATE TABLE IF NOT EXISTS public.knowledge_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_entry_id uuid NOT NULL REFERENCES public.knowledge_entries(id) ON DELETE CASCADE,
  target_entry_id uuid NULL     REFERENCES public.knowledge_entries(id) ON DELETE SET NULL,
  target_text     text NOT NULL,
  link_label      text NULL,
  status          text NOT NULL DEFAULT 'resolved',
  matched_on      text NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_links_status_check
    CHECK (status IN ('resolved', 'broken', 'ambiguous', 'self')),
  CONSTRAINT knowledge_links_matched_on_check
    CHECK (matched_on IS NULL OR matched_on IN ('slug', 'title', 'alias')),
  -- One row per (source, literal target). Re-saving replaces the set.
  CONSTRAINT knowledge_links_unique UNIQUE (source_entry_id, target_text)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_links_source ON public.knowledge_links (source_entry_id);
-- The backlinks query: "what points at me?"
CREATE INDEX IF NOT EXISTS idx_knowledge_links_target ON public.knowledge_links (target_entry_id) WHERE target_entry_id IS NOT NULL;
-- The link-checker query: "what is broken anywhere?"
CREATE INDEX IF NOT EXISTS idx_knowledge_links_status ON public.knowledge_links (status) WHERE status <> 'resolved';

COMMENT ON TABLE public.knowledge_links IS
  'Resolved [[wikilink]] index, rebuilt per source entry on save. target_entry_id NULL = unresolved; target_text is always the literal authored target.';

-- NEW table, so it takes the current chassis (matching keith_*), not the
-- looser posture of the 2026-06 knowledge tables. This grants nothing that did
-- not already exist and revokes nothing anyone was using.
ALTER TABLE public.knowledge_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.knowledge_links FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.knowledge_links TO service_role;

-- =====================================================================
-- 4. Governance RPCs - carry the new fields into and out of snapshots
-- =====================================================================
-- THREE functions are replaced. governance_change_knowledge_state is
-- deliberately NOT touched: it moves state and writes an audit row, and never
-- reads or writes a content column, so the new fields cannot affect it.
--
-- Signatures are IDENTICAL to the originals, so every existing caller in
-- api/knowledge-admin.js keeps working unchanged and no GRANT needs reissuing
-- (EXECUTE is bound to the signature, which has not moved). Error codes,
-- lock order, transition rules and audit payloads are byte-for-byte the same;
-- the ONLY change in each is the column list carried through the snapshot.

CREATE OR REPLACE FUNCTION public.governance_activate_knowledge_entry(
  p_entry_id uuid,
  p_actor_profile_id uuid,
  p_change_note text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_entry public.knowledge_entries%ROWTYPE;
  v_actor_name text;
  v_actor_role text;
  v_next integer;
BEGIN
  SELECT full_name, role INTO v_actor_name, v_actor_role
  FROM public.user_profiles WHERE id = p_actor_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_invalid_actor' USING ERRCODE = 'P0107';
  END IF;

  SELECT * INTO v_entry FROM public.knowledge_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_target_not_found' USING ERRCODE = 'P0101';
  END IF;
  IF v_entry.state <> 'draft' THEN
    RAISE EXCEPTION 'governance_invalid_transition' USING ERRCODE = 'P0104';
  END IF;

  v_next := v_entry.current_version + 1;

  BEGIN
    INSERT INTO public.knowledge_entry_versions
      (entry_id, version_number, title, category, body, source_attribution, precedence_rank, change_note, editor_id,
       body_format, aliases, tags, review_date, confidence)
    VALUES
      (v_entry.id, v_next, v_entry.title, v_entry.category, v_entry.body, v_entry.source_attribution, v_entry.precedence_rank, p_change_note, p_actor_profile_id,
       v_entry.body_format, v_entry.aliases, v_entry.tags, v_entry.review_date, v_entry.confidence);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'governance_invalid_version_sequence' USING ERRCODE = 'P0106';
  END;

  UPDATE public.knowledge_entries
    SET state = 'active', current_version = v_next, updated_by = p_actor_profile_id
    WHERE id = v_entry.id;

  INSERT INTO public.activity_logs
    (user_id, user_name, user_role, action_type, entity_type, entity_id, cohort_id, description, metadata)
  VALUES
    (p_actor_profile_id, v_actor_name, v_actor_role, 'knowledge_entry_activated', 'knowledge_entry', v_entry.id::text, NULL,
     'Activated knowledge entry',
     jsonb_build_object('from_state', 'draft', 'to_state', 'active', 'to_version', v_next, 'change_note', p_change_note));

  RETURN jsonb_build_object('entry_id', v_entry.id, 'state', 'active', 'current_version', v_next);
END;
$$;

CREATE OR REPLACE FUNCTION public.governance_apply_knowledge_revision(
  p_entry_id uuid,
  p_actor_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_entry public.knowledge_entries%ROWTYPE;
  v_rev public.knowledge_revisions%ROWTYPE;
  v_actor_name text;
  v_actor_role text;
  v_next integer;
BEGIN
  SELECT full_name, role INTO v_actor_name, v_actor_role
  FROM public.user_profiles WHERE id = p_actor_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_invalid_actor' USING ERRCODE = 'P0107';
  END IF;

  SELECT * INTO v_entry FROM public.knowledge_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_target_not_found' USING ERRCODE = 'P0101';
  END IF;
  IF v_entry.state <> 'active' THEN
    RAISE EXCEPTION 'governance_invalid_transition' USING ERRCODE = 'P0104';
  END IF;

  SELECT * INTO v_rev FROM public.knowledge_revisions WHERE entry_id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_revision_not_found' USING ERRCODE = 'P0102';
  END IF;

  v_next := v_entry.current_version + 1;

  BEGIN
    INSERT INTO public.knowledge_entry_versions
      (entry_id, version_number, title, category, body, source_attribution, precedence_rank, change_note, editor_id,
       body_format, aliases, tags, review_date, confidence)
    VALUES
      (v_entry.id, v_next, v_rev.title, v_rev.category, v_rev.body, v_rev.source_attribution, v_rev.precedence_rank, v_rev.change_note, p_actor_profile_id,
       v_rev.body_format, v_rev.aliases, v_rev.tags, v_rev.review_date, v_rev.confidence);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'governance_invalid_version_sequence' USING ERRCODE = 'P0106';
  END;

  UPDATE public.knowledge_entries
    SET title = v_rev.title, category = v_rev.category, body = v_rev.body,
        source_attribution = v_rev.source_attribution, precedence_rank = v_rev.precedence_rank,
        body_format = v_rev.body_format, aliases = v_rev.aliases, tags = v_rev.tags,
        review_date = v_rev.review_date, confidence = v_rev.confidence,
        current_version = v_next, updated_by = p_actor_profile_id
    WHERE id = v_entry.id;

  DELETE FROM public.knowledge_revisions WHERE id = v_rev.id;

  INSERT INTO public.activity_logs
    (user_id, user_name, user_role, action_type, entity_type, entity_id, cohort_id, description, metadata)
  VALUES
    (p_actor_profile_id, v_actor_name, v_actor_role, 'knowledge_revision_applied', 'knowledge_entry', v_entry.id::text, NULL,
     'Applied knowledge revision',
     jsonb_build_object('revision_id', v_rev.id, 'to_version', v_next, 'change_note', v_rev.change_note));

  RETURN jsonb_build_object('entry_id', v_entry.id, 'state', 'active', 'current_version', v_next, 'applied_revision_id', v_rev.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.governance_restore_knowledge_version(
  p_entry_id uuid,
  p_version_number integer,
  p_actor_profile_id uuid,
  p_change_note text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_entry public.knowledge_entries%ROWTYPE;
  v_ver public.knowledge_entry_versions%ROWTYPE;
  v_actor_name text;
  v_actor_role text;
  v_next integer;
BEGIN
  SELECT full_name, role INTO v_actor_name, v_actor_role
  FROM public.user_profiles WHERE id = p_actor_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_invalid_actor' USING ERRCODE = 'P0107';
  END IF;

  SELECT * INTO v_entry FROM public.knowledge_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_target_not_found' USING ERRCODE = 'P0101';
  END IF;
  IF v_entry.state <> 'active' THEN
    RAISE EXCEPTION 'governance_invalid_transition' USING ERRCODE = 'P0104';
  END IF;

  SELECT * INTO v_ver FROM public.knowledge_entry_versions
    WHERE entry_id = p_entry_id AND version_number = p_version_number;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_version_not_found' USING ERRCODE = 'P0103';
  END IF;

  v_next := v_entry.current_version + 1;

  BEGIN
    INSERT INTO public.knowledge_entry_versions
      (entry_id, version_number, title, category, body, source_attribution, precedence_rank, change_note, editor_id,
       body_format, aliases, tags, review_date, confidence)
    VALUES
      (v_entry.id, v_next, v_ver.title, v_ver.category, v_ver.body, v_ver.source_attribution, v_ver.precedence_rank, p_change_note, p_actor_profile_id,
       v_ver.body_format, v_ver.aliases, v_ver.tags, v_ver.review_date, v_ver.confidence);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'governance_invalid_version_sequence' USING ERRCODE = 'P0106';
  END;

  UPDATE public.knowledge_entries
    SET title = v_ver.title, category = v_ver.category, body = v_ver.body,
        source_attribution = v_ver.source_attribution, precedence_rank = v_ver.precedence_rank,
        body_format = v_ver.body_format, aliases = v_ver.aliases, tags = v_ver.tags,
        review_date = v_ver.review_date, confidence = v_ver.confidence,
        current_version = v_next, updated_by = p_actor_profile_id
    WHERE id = v_entry.id;

  INSERT INTO public.activity_logs
    (user_id, user_name, user_role, action_type, entity_type, entity_id, cohort_id, description, metadata)
  VALUES
    (p_actor_profile_id, v_actor_name, v_actor_role, 'knowledge_entry_version_restored', 'knowledge_entry', v_entry.id::text, NULL,
     'Restored knowledge entry version',
     jsonb_build_object('from_version', p_version_number, 'to_version', v_next, 'change_note', p_change_note));

  RETURN jsonb_build_object('entry_id', v_entry.id, 'state', v_entry.state, 'current_version', v_next, 'restored_from_version', p_version_number);
END;
$$;

-- Signatures are unchanged, so the original REVOKE/GRANT set still applies.
-- Reasserted here so the migration is self-contained if replayed onto a
-- database that was restored from before the kt2b grants.
REVOKE ALL ON FUNCTION public.governance_activate_knowledge_entry(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.governance_activate_knowledge_entry(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.governance_apply_knowledge_revision(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.governance_apply_knowledge_revision(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.governance_restore_knowledge_version(uuid, integer, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.governance_restore_knowledge_version(uuid, integer, uuid, text) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFICATION - run AFTER the migration. Every check must pass.
-- =====================================================================
--
-- V1. All fifteen columns exist across the three tables (expect 15 rows).
--
--   SELECT table_name, column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name IN ('knowledge_entries','knowledge_entry_versions','knowledge_revisions')
--      AND column_name IN ('body_format','aliases','tags','review_date','confidence','superseded_by')
--    ORDER BY table_name, column_name;
--
-- V2. NO CONTENT WAS TOUCHED. Every pre-existing entry is still plain, and no
--     body changed. Expect plain_count = total_count and zero markdown.
--
--   SELECT count(*) AS total_count,
--          count(*) FILTER (WHERE body_format = 'plain')    AS plain_count,
--          count(*) FILTER (WHERE body_format = 'markdown') AS markdown_count,
--          count(*) FILTER (WHERE aliases <> '{}')          AS with_aliases,
--          count(*) FILTER (WHERE tags <> '{}')             AS with_tags
--     FROM public.knowledge_entries;
--
-- V3. knowledge_links exists, is RLS-enabled with ZERO policies, and grants
--     only to service_role. Expect rls_enabled = true, policy_count = 0, and
--     exactly three grantee rows all for service_role.
--
--   SELECT c.relrowsecurity AS rls_enabled,
--          (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='knowledge_links') AS policy_count
--     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--    WHERE n.nspname='public' AND c.relname='knowledge_links';
--
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema='public' AND table_name='knowledge_links'
--    ORDER BY grantee, privilege_type;
--
-- V4. The three replaced functions still have their original signatures and
--     are still SECURITY INVOKER with a pinned search_path. Expect 3 rows,
--     prosecdef = false, proconfig containing search_path.
--
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
--          p.prosecdef AS is_security_definer, p.proconfig
--     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public'
--      AND p.proname IN ('governance_activate_knowledge_entry',
--                        'governance_apply_knowledge_revision',
--                        'governance_restore_knowledge_version')
--    ORDER BY p.proname;
--
-- V5. EXECUTE is service_role only on all three. Expect exactly three rows,
--     all grantee = service_role.
--
--   SELECT r.routine_name, g.grantee, g.privilege_type
--     FROM information_schema.routine_privileges g
--     JOIN information_schema.routines r ON r.specific_name = g.specific_name
--    WHERE r.routine_schema='public'
--      AND r.routine_name IN ('governance_activate_knowledge_entry',
--                             'governance_apply_knowledge_revision',
--                             'governance_restore_knowledge_version')
--    ORDER BY r.routine_name, g.grantee;
--
-- V6. The untouched fourth RPC is still present and unmodified.
--
--   SELECT proname, pg_get_function_identity_arguments(oid) AS args
--     FROM pg_proc WHERE proname = 'governance_change_knowledge_state';
--
-- V7. Snapshot round trip on a DISPOSABLE draft only. Do NOT run against a
--     real entry. Create a throwaway draft in the UI, note its id, then:
--
--   -- after activating it through the app, the version row must carry format:
--   SELECT version_number, body_format, aliases, tags
--     FROM public.knowledge_entry_versions
--    WHERE entry_id = '<throwaway-id>' ORDER BY version_number;
--
-- V8. Existing behavior is untouched: the category and state CHECKs are
--     exactly as before (expect the original 8 categories and 4 states).
--
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conname IN ('knowledge_entries_category_check','knowledge_entries_state_check');
--
-- =====================================================================
-- ROLLBACK - exact and complete. Run inside one transaction.
-- =====================================================================
--
-- This restores the schema to its pre-migration shape. It is safe to run at
-- any time BEFORE any entry has been switched to body_format='markdown'.
--
-- AFTER an entry has been authored as Markdown, dropping body_format means
-- that entry's Markdown body renders as plain text (the content itself is NOT
-- lost - only the flag saying how to render it). Export the vault first if any
-- page has been converted.
--
--   BEGIN;
--
--   -- 1. Restore the three RPCs to their pre-migration bodies. The originals
--   --    are in supabase/migrations/20260610000001_kt2b_pre_governance_lifecycle_rpcs.sql
--   --    lines 74-128 (activate), 134-197 (apply), 203-267 (restore).
--   --    Replay those three CREATE FUNCTION blocks as CREATE OR REPLACE.
--   --    Do this FIRST: the current bodies reference columns dropped below.
--
--   -- 2. Drop the link index table (CASCADE not needed; nothing references it).
--   DROP TABLE IF EXISTS public.knowledge_links;
--
--   -- 3. Drop the added constraints, then the columns.
--   ALTER TABLE public.knowledge_entries
--     DROP CONSTRAINT IF EXISTS knowledge_entries_body_format_check,
--     DROP CONSTRAINT IF EXISTS knowledge_entries_confidence_check,
--     DROP CONSTRAINT IF EXISTS knowledge_entries_superseded_by_fkey,
--     DROP CONSTRAINT IF EXISTS knowledge_entries_superseded_by_not_self;
--   ALTER TABLE public.knowledge_entry_versions
--     DROP CONSTRAINT IF EXISTS knowledge_entry_versions_body_format_check,
--     DROP CONSTRAINT IF EXISTS knowledge_entry_versions_confidence_check;
--   ALTER TABLE public.knowledge_revisions
--     DROP CONSTRAINT IF EXISTS knowledge_revisions_body_format_check,
--     DROP CONSTRAINT IF EXISTS knowledge_revisions_confidence_check;
--
--   DROP INDEX IF EXISTS public.idx_knowledge_entries_tags;
--   DROP INDEX IF EXISTS public.idx_knowledge_entries_review;
--
--   ALTER TABLE public.knowledge_entries
--     DROP COLUMN IF EXISTS body_format, DROP COLUMN IF EXISTS aliases,
--     DROP COLUMN IF EXISTS tags,        DROP COLUMN IF EXISTS review_date,
--     DROP COLUMN IF EXISTS confidence,  DROP COLUMN IF EXISTS superseded_by;
--   ALTER TABLE public.knowledge_entry_versions
--     DROP COLUMN IF EXISTS body_format, DROP COLUMN IF EXISTS aliases,
--     DROP COLUMN IF EXISTS tags,        DROP COLUMN IF EXISTS review_date,
--     DROP COLUMN IF EXISTS confidence;
--   ALTER TABLE public.knowledge_revisions
--     DROP COLUMN IF EXISTS body_format, DROP COLUMN IF EXISTS aliases,
--     DROP COLUMN IF EXISTS tags,        DROP COLUMN IF EXISTS review_date,
--     DROP COLUMN IF EXISTS confidence;
--
--   COMMIT;
--   NOTIFY pgrst, 'reload schema';
--
-- Note: no entry body, version row, revision row or activity_log row is
-- deleted by this rollback. Only the added schema is removed.

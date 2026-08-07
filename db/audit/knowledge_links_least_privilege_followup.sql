-- =====================================================================
-- FOLLOW-UP (OWNER-GATED): knowledge_links least privilege
-- =====================================================================
--
-- STATUS: NOT APPLIED. Prepared for manual review. This is a SEPARATE change
-- from 20260807000001_knowledge_vault_markdown.sql, which is already applied
-- and must not be modified or rerun.
--
-- NOT A DEPLOYMENT BLOCKER. See the assessment at the bottom.
--
-- ---------------------------------------------------------------------
-- CAUSE
-- ---------------------------------------------------------------------
-- Supabase ships a project-level default privilege along the lines of
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
-- so EVERY newly created table in public starts with ALL granted to all four.
--
-- The applied migration did:
--   REVOKE ALL ON public.knowledge_links FROM PUBLIC, anon, authenticated;
--   GRANT SELECT, INSERT, DELETE ON public.knowledge_links TO service_role;
--
-- service_role was never in the REVOKE list, so it kept the default ALL, and
-- the GRANT that follows is a no-op against an existing broader grant. The
-- REVOKE did its most important job correctly - anon, authenticated and PUBLIC
-- hold nothing - but service_role ended up with all seven privileges instead
-- of the three the migration's own comment claims.
--
-- This mirrors the keith_* chassis, which uses the same
-- "FROM PUBLIC, anon, authenticated" form and therefore has the same
-- characteristic. The repo already contains the correct idiom, in
-- 20260725000000_unit_leader_evaluation_release_gate.sql:
--   REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role;
--   GRANT SELECT, INSERT, UPDATE ... TO service_role;
-- Revoke from service_role FIRST, then grant back exactly what is needed.
--
-- ---------------------------------------------------------------------
-- WHAT THE RUNTIME ACTUALLY NEEDS (verified from code, not assumed)
-- ---------------------------------------------------------------------
-- Every knowledge_links operation in the codebase, api/knowledge-admin.js:
--   L387  .delete().eq('source_entry_id', entryId)   -> DELETE
--   L399  .insert(rows)                              -> INSERT
--   L814  .select(...)  get_entry_links outgoing     -> SELECT
--   L820  .select(...)  get_entry_links incoming     -> SELECT
--   L850  .select(...)  link_report broken           -> SELECT
--   L859  .select(...)  link_report orphans          -> SELECT
--
-- Required: SELECT, INSERT, DELETE.  Zero UPDATE calls exist: the index is
-- rebuilt per source entry by delete-then-insert, deliberately, because a full
-- replace cannot leave a stale row behind the way a partial update can.
--
-- NOT needed by the runtime:
--   UPDATE      - no code path updates a link row
--   TRUNCATE    - no code path truncates; deletes are always scoped by source
--   TRIGGER     - creating triggers is DDL, done by the owner, never at runtime
--   REFERENCES  - creating FKs is DDL, done by the owner, never at runtime
--
-- postgres retains full owner privileges. That is correct and intentional:
-- it is the table owner and the role that applies migrations. Nothing below
-- touches it.

BEGIN;

-- Re-assert the intended posture. Revoking from service_role first is what the
-- original statement was missing; the GRANT then lands on a clean slate.
REVOKE ALL ON TABLE public.knowledge_links FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.knowledge_links TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- VERIFY (run after; expect exactly the three rows, all service_role)
-- ---------------------------------------------------------------------
--   SELECT grantee, privilege_type
--     FROM information_schema.role_table_grants
--    WHERE table_schema='public' AND table_name='knowledge_links'
--      AND grantee <> 'postgres'
--    ORDER BY grantee, privilege_type;
--
-- Expect exactly:
--   service_role | DELETE
--   service_role | INSERT
--   service_role | SELECT
--
-- Then confirm the app still works: open a knowledge entry, save a draft
-- containing a [[wikilink]], and check the Links panel still populates. That
-- exercises DELETE, INSERT and SELECT in one action.

-- ---------------------------------------------------------------------
-- ROLLBACK (restores the current, broader state)
-- ---------------------------------------------------------------------
--   BEGIN;
--   GRANT ALL ON TABLE public.knowledge_links TO service_role;
--   COMMIT;
--   NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- ASSESSMENT: worth doing, NOT worth blocking a deploy for
-- ---------------------------------------------------------------------
-- The privileges in question are held by service_role, which is the trusted
-- server-side identity. It bypasses RLS everywhere by design and already holds
-- broad access across the schema, so removing UPDATE/TRUNCATE/TRIGGER/
-- REFERENCES on one table closes no live exposure. Anyone holding the
-- service-role key can already do more than this changes.
--
-- What it does buy is that the grant matches the stated intent, so a future
-- reviewer reading the migration is not misled, and an accidental UPDATE
-- against this table fails loudly instead of silently corrupting a derived
-- index. That is real but modest value.
--
-- RECOMMENDATION: fold this into the already-queued Owner-gated grant
-- hardening item alongside the explicit anon/authenticated REVOKEs on
-- knowledge_entries / knowledge_entry_versions / knowledge_revisions, and
-- consider the same sweep for the keith_* tables, which share the pattern.
-- Do not hold the Knowledge Vault deployment for it.

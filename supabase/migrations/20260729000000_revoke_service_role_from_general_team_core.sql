-- ############################################################################
-- Revoke service_role EXECUTE from the internal general-team core
--
-- Owner-gated. NOT auto-applied by this branch.
--
-- Reconciliation follow-up to 20260728000000_enable_academic_partner_team_messages.sql. That migration
-- intended public.messages_start_general_team_conversation_core to be INTERNAL ONLY (invoked solely by
-- the two SECURITY DEFINER entry RPCs, granted to no role). Its original REVOKE named only
-- PUBLIC/anon/authenticated, so service_role retained an inherited EXECUTE privilege in production. The
-- Owner manually revoked it there; this migration makes that revoke explicit and idempotent so every
-- future environment lands in the same state after applying the migration set.
--
-- Idempotent: REVOKE of a privilege that is already absent is a no-op. Safe to run more than once.
-- Additive/privilege-only: no function is created or replaced, no table or data changes, no backfill.
-- The core is granted to NO role, before or after.
-- ############################################################################

BEGIN;

REVOKE ALL ON FUNCTION public.messages_start_general_team_conversation_core(
  uuid, text, uuid, text, text, text, text, jsonb, text
)
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

-- ############################################################################
-- Verification (run AFTER applying; OUTSIDE the transaction). Expect can_exec = false for all three.
-- ############################################################################
--   SELECT r.rolname,
--          has_function_privilege(
--            r.rolname,
--            'public.messages_start_general_team_conversation_core(uuid, text, uuid, text, text, text, text, jsonb, text)',
--            'EXECUTE') AS can_exec
--   FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname);
--   -- Expect:
--   --   anon          | f
--   --   authenticated | f
--   --   service_role  | f
--
-- The core stays reachable ONLY through the two SECURITY DEFINER entry RPCs
-- (messages_start_general_team_conversation and messages_start_general_team_conversation_ap), which
-- execute as the owner and therefore do not require any role to hold direct EXECUTE on the core.

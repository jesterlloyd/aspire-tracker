-- ============================================================================
-- PORTAL INVITATION EVENTS ledger (R2) -- APPLIED 2026-08-03
-- ============================================================================
-- *** STATUS: APPLIED MANUALLY by the Owner in the Supabase SQL editor on    ***
-- *** 2026-08-03, in one transaction. VERIFICATION V1 through V7 PASSED.     ***
-- *** The PRECHECK below aborted-on-existing by design and passed (the       ***
-- *** table did not previously exist); it remains for the historical record. ***
-- *** Related production confirmations recorded the same day: the Email OTP  ***
-- *** expiration WAS 3600 seconds (activation links lived 1 hour), and the   ***
-- *** redirect allow-list entry https://aspireintelligence.app/** covers     ***
-- *** both /auth/activate and /auth/reset-password.                          ***
-- ***                                                                        ***
-- *** SUPERSEDED 2026-08-10: the Owner set the Email OTP expiration to       ***
-- *** 86400 seconds (24 hours). The 3600-second figure above is the record   ***
-- *** of 2026-08-03 and is NOT current configuration. This migration's DDL   ***
-- *** is unaffected - the TTL is a Supabase Auth project setting, not schema ***
-- *** - and nothing below was changed. See lib/server/activationLifetime.js. ***
--
-- PORTAL-ACTIVATION-RELIABILITY-1: a privacy-safe diagnostics ledger for the
-- portal invitation and activation lifecycle, so the next "my activation link
-- did not work" report is answerable with one query instead of a full audit.
--
-- WRITERS (both fully defensive AND strictly allowlisted: a missing table or a
-- failed insert never breaks an invitation or an activation, and each writer
-- builds its insert row from a fixed field list with a sanitized detail
-- object, so a token, token hash, link, password, or header can never reach
-- this table even by programmer error):
--   - api/invite-portal-user.js (recordInviteEvent + sanitizeDetail): invite /
--     resend request, link_generated (with the LINK TYPE only, never a link),
--     email_send_attempted / email_sent / email_send_failed.
--   - api/portal-activation-event.js: activation_succeeded / activation_failed
--     (broad allowlisted category only) and recovery_requested, authenticated
--     by the caller's own session; the target email comes from the verified
--     session, never the request body.
-- FIRST PORTAL LOGIN is intentionally NOT duplicated here: the tracked
-- touch_my_last_login function (20260730000000) already stamps
-- user_profiles.last_login_at once per session and remains the source of truth.
--
-- PRIVACY: stores the event type, normalized lowercase target email, profile
-- ids, link TYPE, request id, broad category, and a BOUNDED jsonb detail
-- object. NO tokens, NO token hashes, NO links, NO passwords, NO headers,
-- ever. Read access is Owner/Admin only (RLS over an explicit authenticated
-- SELECT grant); clients have no write privilege; the two server writers use
-- the service role, granted INSERT and sequence usage explicitly below.
-- ============================================================================

BEGIN;

-- PRECHECK: this migration creates the table exactly once. If it already
-- exists (including from a partial prior apply), abort so the live state is
-- inspected and reconciled deliberately.
DO $precheck$
BEGIN
  IF to_regclass('public.portal_invitation_events') IS NOT NULL THEN
    RAISE EXCEPTION 'PRECHECK FAILED: public.portal_invitation_events already exists; inspect and reconcile the prior apply before running this migration';
  END IF;
END;
$precheck$;

CREATE TABLE public.portal_invitation_events (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  event_type        text        NOT NULL CHECK (event_type IN (
                      'invite_requested', 'link_generated',
                      'email_send_attempted', 'email_sent', 'email_send_failed',
                      'resend_requested',
                      'activation_succeeded', 'activation_failed',
                      'recovery_requested')),
  -- Normalized identity key: nonblank, bounded, and exactly equal to its own
  -- trimmed lowercase form (so no case variants and no stray whitespace).
  target_email      text        NOT NULL CHECK (
                      btrim(target_email) <> ''
                      AND target_email = lower(btrim(target_email))
                      AND length(target_email) <= 320),
  target_profile_id uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  actor_profile_id  uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  link_type         text        CHECK (link_type IS NULL OR link_type IN ('invite', 'recovery', 'none')),
  request_id        text        CHECK (request_id IS NULL OR length(request_id) <= 128),
  category          text        CHECK (category IS NULL OR length(category) <= 64),
  -- Bounded JSON OBJECT only: never an array/scalar, never oversized payloads.
  detail            jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (
                      jsonb_typeof(detail) = 'object'
                      AND pg_column_size(detail) <= 2048)
);

CREATE INDEX IF NOT EXISTS idx_pie_email    ON public.portal_invitation_events (target_email);
CREATE INDEX IF NOT EXISTS idx_pie_occurred ON public.portal_invitation_events (occurred_at DESC);

ALTER TABLE public.portal_invitation_events ENABLE ROW LEVEL SECURITY;

-- Owner/Admin read-only through RLS; NO client write policy of any kind. The
-- DROP makes re-application after a partial prior apply deterministic.
DROP POLICY IF EXISTS "portal_invitation_events_owner_admin_read" ON public.portal_invitation_events;
CREATE POLICY "portal_invitation_events_owner_admin_read"
  ON public.portal_invitation_events FOR SELECT TO authenticated
  USING (public.is_active_owner_or_admin());

-- Explicit, deterministic privileges (never rely on default grants):
--   anon/PUBLIC: nothing at all.
--   authenticated: SELECT only (RLS then narrows rows to active Owner/Admin);
--     INSERT/UPDATE/DELETE revoked explicitly.
--   service_role: SELECT + INSERT plus usage of the identity sequence its
--     inserts consume. No UPDATE/DELETE: the ledger is append-only for
--     every writer.
REVOKE ALL ON public.portal_invitation_events FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.portal_invitation_events FROM authenticated;
GRANT SELECT ON public.portal_invitation_events TO authenticated;
REVOKE UPDATE, DELETE ON public.portal_invitation_events FROM service_role;
GRANT SELECT, INSERT ON public.portal_invitation_events TO service_role;
DO $grants$
DECLARE
  v_seq text := pg_get_serial_sequence('public.portal_invitation_events', 'id');
BEGIN
  IF v_seq IS NULL THEN
    RAISE EXCEPTION 'identity sequence for portal_invitation_events.id not found';
  END IF;
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', v_seq);
  EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role', v_seq);
END;
$grants$;

COMMENT ON TABLE public.portal_invitation_events IS
  'Privacy-safe portal invitation/activation diagnostics. Event types, normalized emails, link TYPES '
  'and broad categories only: never tokens, token hashes, links, passwords, or headers. Owner/Admin '
  'read via RLS; service-role append-only write.';

COMMIT;

-- ############################################################################
-- VERIFICATION (read-only; run after COMMIT)
-- ############################################################################

-- V1. Table exists with RLS enabled (expect one row, rls_enabled true).
SELECT relname, relrowsecurity AS rls_enabled
FROM pg_class WHERE oid = 'public.portal_invitation_events'::regclass;

-- V2. The Owner/Admin helper the policy depends on exists in public
--     (expect one row).
SELECT p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'is_active_owner_or_admin';

-- V3. EXACTLY ONE policy, and its exact definition: SELECT, to authenticated,
--     gated on is_active_owner_or_admin (expect one row matching all columns).
SELECT policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'portal_invitation_events';

-- V4. Table privileges are exactly as declared (expect: authenticated SELECT
--     true and all writes false; service_role SELECT+INSERT true and
--     UPDATE/DELETE false; anon nothing).
SELECT
  has_table_privilege('authenticated', 'public.portal_invitation_events', 'SELECT') AS auth_select,
  has_table_privilege('authenticated', 'public.portal_invitation_events', 'INSERT') AS auth_insert,
  has_table_privilege('authenticated', 'public.portal_invitation_events', 'UPDATE') AS auth_update,
  has_table_privilege('authenticated', 'public.portal_invitation_events', 'DELETE') AS auth_delete,
  has_table_privilege('service_role', 'public.portal_invitation_events', 'SELECT')  AS service_select,
  has_table_privilege('service_role', 'public.portal_invitation_events', 'INSERT')  AS service_insert,
  has_table_privilege('service_role', 'public.portal_invitation_events', 'UPDATE')  AS service_update,
  has_table_privilege('service_role', 'public.portal_invitation_events', 'DELETE')  AS service_delete,
  has_table_privilege('anon', 'public.portal_invitation_events', 'SELECT')          AS anon_select;

-- V5. The identity sequence is usable by service_role and by nobody else
--     (expect service_usage true, auth_usage false, anon_usage false).
SELECT
  has_sequence_privilege('service_role',  pg_get_serial_sequence('public.portal_invitation_events', 'id'), 'USAGE') AS service_usage,
  has_sequence_privilege('authenticated', pg_get_serial_sequence('public.portal_invitation_events', 'id'), 'USAGE') AS auth_usage,
  has_sequence_privilege('anon',          pg_get_serial_sequence('public.portal_invitation_events', 'id'), 'USAGE') AS anon_usage;

-- V6. The data-shape constraints are present (expect rows for the event_type
--     allowlist, the normalized-email rule, and the bounded detail object).
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.portal_invitation_events'::regclass
  AND contype = 'c'
ORDER BY conname;

-- V7. No token-shaped columns exist (expect zero rows).
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'portal_invitation_events'
  AND (column_name ILIKE '%token%' OR column_name ILIKE '%link_url%' OR column_name ILIKE '%hash%'
       OR column_name ILIKE '%password%' OR column_name ILIKE '%header%' OR column_name ILIKE '%secret%');

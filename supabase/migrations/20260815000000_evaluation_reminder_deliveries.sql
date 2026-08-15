-- =============================================================================
-- Evaluation & survey reminders: durable delivery ledger  (EVALUATION-REMINDERS-1)
-- Migration: 20260815000000_evaluation_reminder_deliveries
-- =============================================================================
--
-- WHAT THIS IS FOR
-- Weekly reminders for incomplete evaluation/survey assignments at 7, 14 and 21
-- days after the original successful send. Two properties have to hold no matter
-- how many times a cron retries or how many invocations overlap:
--
--   1. A given (assignment, reminder number) is sent AT MOST ONCE. That is the
--      job of uq_erd_assignment_reminder - a UNIQUE constraint, not a read-then-
--      write check. notification_log has no unique constraint anywhere, so every
--      existing evaluation dedup is inherently racy; this ledger is the fix.
--   2. A worker that dies mid-send must not wedge the reminder forever. Claims
--      expire (claimed_at + p_stale_seconds) and are recovered by the claim
--      function itself, bounded by `attempts`.
--
-- THE CRASH WINDOW, AND WHY delivery_epoch EXISTS
-- The dangerous moment is: the provider accepted the email, and then the ledger
-- update failed (or the process died). The row is left mid-flight, and a later
-- worker has to decide what happened WITHOUT being able to ask.
--
-- It resolves that by re-sending the byte-identical request under the SAME
-- provider idempotency key, which makes the provider itself the authority: a
-- repeat of an accepted request returns the ORIGINAL result instead of sending
-- again. That only works if the payload is stable, so the reminder's token is
-- DERIVED from (assignment, reminder_number, delivery_epoch) rather than being
-- randomly re-minted per attempt. `delivery_epoch` advances only on a KNOWN
-- provider failure - never on a crash - so:
--   • crash after acceptance -> same epoch -> same token -> same key -> the
--     provider de-duplicates, the delivered link is the one that survives, and
--     the ledger is finally written truthfully.
--   • known failure -> epoch advances -> a genuinely fresh token and key, and
--     the undelivered token is revoked while the previously delivered link
--     stays valid.
--
-- `sending` is durable and is written BEFORE the provider call, so a recovered
-- row can distinguish "we never called the provider" (claimed) from "a provider
-- call was in flight" (sending) and never records a false failure for the latter.
-- The sender refuses to call the provider at all unless that transition
-- committed, so an unrecorded send cannot happen.
--
-- THE PROVIDER ONLY REMEMBERS A KEY FOR 24 HOURS, AND THIS CRON IS WEEKLY.
-- Provider de-duplication therefore cannot be relied on a week later, so it is
-- not asked to be. Two mechanisms bound the risk instead:
--
--   1. A RECOVERY SWEEP runs hourly (p_recover_only), reconciling only rows that
--      already reached the provider. Reminders themselves stay on the weekly
--      7/14/21 cadence - the sweep never selects new recipients - so every
--      ambiguous attempt is resolved within hours, well inside the 24-hour
--      window where the key is still honoured.
--   2. first_attempted_at makes the window checkable. Once an unresolved attempt
--      is older than p_provider_window_seconds, retrying is no longer provably
--      safe, so the row becomes 'needs_reconciliation' - TERMINAL for automation
--      and explicitly a human's call. A possible duplicate is never risked to
--      tidy a ledger.
--
-- A RETRY IS ONLY SAFE IF THE REQUEST IS UNCHANGED, and this system resolves the
-- recipient from live records that genuinely move (a student is hired, changes
-- address, or leaves Active Rotation between attempts). payload_fingerprint is a
-- SHA-256 of the exact request that was attempted. On any retry the request is
-- rebuilt and re-fingerprinted: identical means the same key may be reused;
-- different means the audience or copy moved, and the row goes to
-- 'needs_reconciliation' rather than sending changed content under an old key or
-- issuing a new key that could duplicate. It is a digest, so it holds no address,
-- no name, and no token.
--
-- `cleanup_pending` exists so that retiring superseded tokens can fail without
-- the ledger lying: delivery is recorded as done, cleanup is recorded as owed,
-- and the row stays claimable so cleanup is retried.
--
-- WHAT IT DELIBERATELY DOES NOT STORE
-- No raw token. No survey URL. No email address, name, or any other copied PII -
-- assignment_id joins to everything a report needs. The only free-text column,
-- `reason`, is constrained to a short snake_case token by chk_erd_reason_shape,
-- so a URL, a JWT, or a 43-character base64url token is STRUCTURALLY unable to
-- be written there even by mistake. That constraint is a privacy control, not a
-- formatting preference.
--
-- SCOPE. Additive and isolated: one new table, one new function. It alters no
-- existing table, changes no existing behavior, and instruments no send. Nothing
-- reads or writes it until the reminder cron ships. RLS is enabled with NO
-- policies (service-role code bypasses RLS; every client role is denied).
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute. *** APPLY MANUALLY
-- (Owner/Jester). Claude Code has applied NOTHING. *** Run the verification block
-- below (confirming the table is empty and both constraint tests behave), THEN
-- authorize the reminder cron. Idempotent: IF NOT EXISTS / OR REPLACE throughout.
-- =============================================================================

BEGIN;

-- ── 1. Table ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.evaluation_reminder_deliveries (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id       uuid        NOT NULL
                                  REFERENCES public.evaluation_assignments(id) ON DELETE CASCADE,
  -- 1 = day 7, 2 = day 14, 3 = day 21. There is deliberately no 4: the response
  -- window is 28 days, and a reminder on the day the window shuts is not a
  -- reminder. The CHECK makes a "day 28 reminder" unrepresentable.
  reminder_number     smallint    NOT NULL,
  status              text        NOT NULL DEFAULT 'pending',
  -- Incremented at CLAIM time, so a worker that dies after claiming still
  -- consumes an attempt and cannot spin forever.
  attempts            integer     NOT NULL DEFAULT 0,
  -- Advances ONLY on a known provider failure - never on a crash. It seeds both
  -- the derived reminder token and the provider idempotency key, so a recovered
  -- in-flight attempt reproduces a byte-identical request (the provider then
  -- de-duplicates it) while a genuinely failed attempt gets a fresh token.
  delivery_epoch      smallint    NOT NULL DEFAULT 0,
  claimed_at          timestamptz,
  claimed_by          text,
  -- When the provider was FIRST called for this reminder. Fixed for the row's
  -- lifetime, so "is this still inside the provider's idempotency window?" is
  -- answerable without trusting claim timestamps that move on every retry.
  first_attempted_at  timestamptz,
  -- SHA-256 of the exact request that was attempted. A digest only: no address,
  -- no name, no token. Its whole job is to detect that the audience or copy
  -- moved between attempts, which makes reusing the old key unsafe.
  payload_fingerprint text,
  sent_at             timestamptz,
  notification_log_id uuid        REFERENCES public.notification_log(id) ON DELETE SET NULL,
  resend_email_id     text,
  -- Sanitized outcome token for failed/suppressed rows ONLY (e.g. 'completed',
  -- 'missing_verified_cedars_email', 'provider_error'). Shape-constrained below.
  reason              text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- THE duplicate guarantee. One row per assignment per reminder number.
  CONSTRAINT uq_erd_assignment_reminder UNIQUE (assignment_id, reminder_number),

  CONSTRAINT chk_erd_reminder_number CHECK (reminder_number IN (1, 2, 3)),
  CONSTRAINT chk_erd_status CHECK (status IN (
    'pending', 'claimed', 'sending', 'sent', 'cleanup_pending',
    'needs_reconciliation', 'failed', 'suppressed'
  )),
  -- The fingerprint is a hex digest and structurally cannot become anything else
  -- - not an address, not a URL, not a token.
  CONSTRAINT chk_erd_payload_fingerprint_shape CHECK (
    payload_fingerprint IS NULL OR payload_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT chk_erd_attempts_nonnegative CHECK (attempts >= 0),
  CONSTRAINT chk_erd_delivery_epoch_nonnegative CHECK (delivery_epoch >= 0),
  -- A row holding a claim always names its holder, so stale-claim recovery can
  -- report one. 'sending' holds the same claim as 'claimed'.
  CONSTRAINT chk_erd_claimed_fields CHECK (
    status NOT IN ('claimed', 'sending') OR (claimed_at IS NOT NULL AND claimed_by IS NOT NULL)
  ),
  -- Any row that asserts delivery carries the moment it was delivered.
  -- cleanup_pending means "delivered, cleanup still owed", so it qualifies.
  CONSTRAINT chk_erd_sent_fields CHECK (
    status NOT IN ('sent', 'cleanup_pending') OR sent_at IS NOT NULL
  ),
  -- A reason only exists for the statuses that need explaining.
  CONSTRAINT chk_erd_reason_scope CHECK (
    reason IS NULL OR status IN ('failed', 'suppressed', 'cleanup_pending', 'needs_reconciliation')
  ),
  -- PRIVACY CONTROL: reason is a short snake_case token. A URL, a JWT, or a
  -- base64url token cannot satisfy this pattern, so the one free-text column in
  -- this table cannot become a place a secret leaks into.
  CONSTRAINT chk_erd_reason_shape CHECK (reason IS NULL OR reason ~ '^[a-z0-9_]{1,64}$'),
  -- RECOVERY EVIDENCE. The two facts a recovering worker needs - when the
  -- provider was first called, and exactly what was sent - only mean anything
  -- together. Either both are recorded or neither is, and a row that claims a
  -- provider call is in flight must carry both. This makes it impossible to
  -- reach 'sending' without the evidence a safe retry depends on.
  CONSTRAINT chk_erd_recovery_evidence CHECK (
    (first_attempted_at IS NULL) = (payload_fingerprint IS NULL)
    AND (status <> 'sending' OR (first_attempted_at IS NOT NULL AND payload_fingerprint IS NOT NULL))
  )
);

COMMENT ON TABLE public.evaluation_reminder_deliveries IS
  'Durable at-most-once ledger for evaluation/survey reminder emails (7/14/21 days after the original send). One row per (assignment_id, reminder_number); the UNIQUE constraint - not a read-then-write check - is what prevents a duplicate reminder under cron retries and overlapping invocations. Stores NO raw token, NO survey URL, and no copied PII; `reason` is shape-constrained to a snake_case token so a secret cannot be written to it. Service-role only: RLS enabled with no policies.';

COMMENT ON COLUMN public.evaluation_reminder_deliveries.reminder_number IS
  '1 = day 7, 2 = day 14, 3 = day 21. No value 4 exists: the 28-day response window closes instead of producing a fourth reminder.';
COMMENT ON COLUMN public.evaluation_reminder_deliveries.attempts IS
  'Incremented when the row is CLAIMED, so an interrupted worker consumes an attempt. Bounds retries via claim_evaluation_reminders(p_max_attempts).';
COMMENT ON COLUMN public.evaluation_reminder_deliveries.delivery_epoch IS
  'Seeds the derived reminder token and the provider idempotency key. Advances ONLY on a known provider failure, never on a crash, so a recovered in-flight attempt reproduces a byte-identical request and the provider de-duplicates it instead of sending twice.';
COMMENT ON COLUMN public.evaluation_reminder_deliveries.status IS
  'pending -> claimed -> sending -> sent. sending is durable and written before the provider call so a recovered row never records a false failure. cleanup_pending means delivered but superseded tokens are not yet retired, and is claimable so cleanup is retried. sent and suppressed are terminal.';
COMMENT ON COLUMN public.evaluation_reminder_deliveries.reason IS
  'Sanitized snake_case outcome token for failed/suppressed rows only. Never a message, URL, token, or email address.';

-- ── 2. Indexes ───────────────────────────────────────────────────────────────
-- uq_erd_assignment_reminder covers lookup by assignment (leading column).
-- One partial index for stale-claim recovery, which scans claimed rows by age.
CREATE INDEX IF NOT EXISTS idx_erd_claimed_at
  ON public.evaluation_reminder_deliveries (claimed_at)
  WHERE status IN ('claimed', 'sending');

-- ── 3. Row Level Security - ENABLED, NO POLICIES ─────────────────────────────
-- Mirrors cron_runs / automation_settings / message_archive: service-role code
-- bypasses RLS; with no policies, no client (anon/authenticated) can read or
-- write. There is no client-facing surface for this ledger.
ALTER TABLE public.evaluation_reminder_deliveries ENABLE ROW LEVEL SECURITY;

-- ── 4. Table privileges (deny by default, then least privilege) ──────────────
REVOKE ALL ON public.evaluation_reminder_deliveries
  FROM PUBLIC, anon, authenticated, service_role;

-- No DELETE and no TRUNCATE for any role: the ledger is append-and-update only,
-- because deleting a row would silently re-arm a reminder that already sent.
GRANT SELECT, INSERT, UPDATE ON public.evaluation_reminder_deliveries TO service_role;

-- ── 5. Atomic claim function (service-role only) ─────────────────────────────
-- Given the candidate (assignment, reminder_number) pairs the worker computed,
-- this: recovers stale claims, materializes any missing ledger rows, then claims
-- a bounded batch with FOR UPDATE SKIP LOCKED. Eligibility itself stays in
-- JavaScript (testable, and it needs student/lifecycle context this function has
-- no business knowing); atomicity and at-most-once live here.
--
-- Candidate rows for assignments that no longer exist are ignored rather than
-- raising, so a deleted assignment cannot abort an entire run.
CREATE OR REPLACE FUNCTION public.claim_evaluation_reminders(
  p_worker                  text,
  p_candidates              jsonb,
  p_limit                   integer DEFAULT 25,
  p_stale_seconds           integer DEFAULT 900,
  p_max_attempts            integer DEFAULT 3,
  -- The provider forgets an idempotency key after this long. Past it, retrying
  -- is no longer provably duplicate-free.
  p_provider_window_seconds integer DEFAULT 86400,
  -- Recovery sweep: reconcile only rows that already reached the provider, and
  -- select no new recipients. This is what runs hourly.
  p_recover_only            boolean DEFAULT false
)
RETURNS SETOF public.evaluation_reminder_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  IF p_worker IS NULL OR length(btrim(p_worker)) = 0 THEN
    RAISE EXCEPTION 'p_worker must be non-null and non-empty';
  END IF;
  IF p_candidates IS NULL OR jsonb_typeof(p_candidates) <> 'array' THEN
    RAISE EXCEPTION 'p_candidates must be a jsonb array';
  END IF;
  IF p_limit IS NULL OR p_limit <= 0 OR p_limit > 200 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 200';
  END IF;
  IF p_stale_seconds IS NULL OR p_stale_seconds <= 0 OR p_stale_seconds > 86400 THEN
    RAISE EXCEPTION 'p_stale_seconds must be between 1 and 86400';
  END IF;
  IF p_max_attempts IS NULL OR p_max_attempts <= 0 OR p_max_attempts > 10 THEN
    RAISE EXCEPTION 'p_max_attempts must be between 1 and 10';
  END IF;
  IF p_provider_window_seconds IS NULL OR p_provider_window_seconds <= 0 OR p_provider_window_seconds > 86400 THEN
    RAISE EXCEPTION 'p_provider_window_seconds must be between 1 and 86400 (the provider forgets a key after 24 hours)';
  END IF;

  -- 5a. Stale-claim recovery, in three honest outcomes. A worker that died left
  --     the row either 'claimed' (no provider call was made) or 'sending' (a
  --     provider call was in flight, and we cannot know whether it landed).
  --
  --     While attempts remain, both return to 'pending' and are retried. The
  --     retry of a 'sending' row is SAFE and self-resolving: it reproduces the
  --     same derived token and the same idempotency key, so the provider either
  --     de-duplicates the earlier acceptance or genuinely sends for the first
  --     time. Either way the recipient receives exactly one email.
  --     FIRST, THE WINDOW. An attempt that reached the provider and is older
  --     than the provider's idempotency memory can no longer be retried safely:
  --     the key has been forgotten, so a retry would be a fresh send and could
  --     duplicate. Those rows stop automating and wait for a person. This runs
  --     before any recovery so an expired row can never be handed back out.
  UPDATE public.evaluation_reminder_deliveries d
  SET status     = 'needs_reconciliation',
      reason     = 'provider_window_elapsed',
      claimed_at = NULL,
      claimed_by = NULL,
      updated_at = v_now
  WHERE d.status IN ('claimed', 'sending')
    AND d.first_attempted_at IS NOT NULL
    AND d.first_attempted_at < v_now - (p_provider_window_seconds || ' seconds')::interval;

  UPDATE public.evaluation_reminder_deliveries d
  SET status     = 'pending',
      claimed_at = NULL,
      claimed_by = NULL,
      updated_at = v_now
  WHERE d.status IN ('claimed', 'sending')
    AND d.claimed_at IS NOT NULL
    AND d.claimed_at < v_now - (p_stale_seconds || ' seconds')::interval
    AND d.attempts < p_max_attempts;

  --     Out of attempts while a provider call was in flight: we must NOT claim
  --     the send failed, because it may well have succeeded. This is not a
  --     failure and not a delivery - it is unresolved, and it says so.
  UPDATE public.evaluation_reminder_deliveries d
  SET status     = 'needs_reconciliation',
      reason     = 'delivery_unconfirmed',
      claimed_at = NULL,
      claimed_by = NULL,
      updated_at = v_now
  WHERE d.status = 'sending'
    AND d.claimed_at IS NOT NULL
    AND d.claimed_at < v_now - (p_stale_seconds || ' seconds')::interval
    AND d.attempts >= p_max_attempts;

  --     Out of attempts having never reached the provider: a plain expiry.
  UPDATE public.evaluation_reminder_deliveries d
  SET status     = 'failed',
      reason     = 'claim_expired',
      claimed_at = NULL,
      claimed_by = NULL,
      updated_at = v_now
  WHERE d.status = 'claimed'
    AND d.claimed_at IS NOT NULL
    AND d.claimed_at < v_now - (p_stale_seconds || ' seconds')::interval
    AND d.attempts >= p_max_attempts;

  -- 5b. Materialize missing ledger rows for this run's candidates. ON CONFLICT
  --     DO NOTHING means two concurrent workers racing on the same candidate
  --     produce exactly one row; the loser simply finds it already present.
  -- DISTINCT: a caller that repeats a candidate must not make this statement try
  -- to insert the same pair twice.
  INSERT INTO public.evaluation_reminder_deliveries (assignment_id, reminder_number)
  SELECT DISTINCT
         (c.value->>'assignment_id')::uuid,
         (c.value->>'reminder_number')::smallint
  FROM jsonb_array_elements(p_candidates) AS c
  JOIN public.evaluation_assignments a
    ON a.id = (c.value->>'assignment_id')::uuid
  WHERE (c.value->>'reminder_number')::smallint IN (1, 2, 3)
  ON CONFLICT (assignment_id, reminder_number) DO NOTHING;

  -- 5c. Claim a bounded batch. 'sent' and 'suppressed' are terminal and are
  --     never claimed, which is what makes a retried or concurrent run a no-op.
  --     'cleanup_pending' IS claimable: delivery already happened, but retiring
  --     the superseded tokens did not, and that work must be retried.
  RETURN QUERY
  WITH cand AS (
    SELECT (c.value->>'assignment_id')::uuid       AS assignment_id,
           (c.value->>'reminder_number')::smallint AS reminder_number
    FROM jsonb_array_elements(p_candidates) AS c
  ),
  claimable AS (
    SELECT d.id
    FROM public.evaluation_reminder_deliveries d
    WHERE (
        -- Recovery sweep: only work that already reached the provider, and no
        -- new recipients at all.
        (p_recover_only AND (d.first_attempted_at IS NOT NULL OR d.status = 'cleanup_pending'))
        OR
        (NOT p_recover_only
         AND (d.assignment_id, d.reminder_number) IN (SELECT assignment_id, reminder_number FROM cand))
      )
      AND d.status IN ('pending', 'failed', 'cleanup_pending')
      AND d.attempts < p_max_attempts
    ORDER BY d.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.evaluation_reminder_deliveries d
  SET status     = 'claimed',
      claimed_at = v_now,
      claimed_by = p_worker,
      attempts   = d.attempts + 1,
      reason     = NULL,
      updated_at = v_now
  FROM claimable
  WHERE d.id = claimable.id
  RETURNING d.*;
END;
$$;

COMMENT ON FUNCTION public.claim_evaluation_reminders(text, jsonb, integer, integer, integer, integer, boolean) IS
  'Service-role-only. First retires any attempt older than p_provider_window_seconds to needs_reconciliation/provider_window_elapsed, because the provider has forgotten the idempotency key and a retry could duplicate. Then recovers stale claims older than p_stale_seconds in three outcomes: attempts remaining -> pending (a retry is safe because the sender reproduces the same derived token and idempotency key); attempts exhausted from sending -> needs_reconciliation/delivery_unconfirmed (NOT failed - the provider may have accepted it); attempts exhausted from claimed -> failed/claim_expired. Then materializes ledger rows for the supplied candidate (assignment_id, reminder_number) pairs via ON CONFLICT DO NOTHING and atomically claims up to p_limit using FOR UPDATE SKIP LOCKED, incrementing attempts. With p_recover_only the candidate list is ignored and only rows that already reached the provider (or owe token cleanup) are claimed, so a recovery sweep never selects a new recipient. Claimable: pending, failed, and cleanup_pending (delivered but superseded tokens not yet retired). Terminal rows (sent, suppressed, needs_reconciliation) are never claimed, so a retried cron or a concurrent invocation cannot produce a second reminder. Candidates whose assignment no longer exists are ignored.';

-- ── 6. Function privileges (service-role only) ───────────────────────────────
REVOKE ALL ON FUNCTION public.claim_evaluation_reminders(text, jsonb, integer, integer, integer, integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_evaluation_reminders(text, jsonb, integer, integer, integer, integer, boolean)
  TO service_role;

-- ── 7. Reload schema cache ───────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;


-- =============================================================================
-- VERIFICATION (Owner runs after applying - not part of the migration)
-- =============================================================================
--
-- (a) table + function exist
--   SELECT to_regclass('public.evaluation_reminder_deliveries');        -- expect: not null
--   SELECT proname FROM pg_proc WHERE proname = 'claim_evaluation_reminders';  -- expect: 1 row
--
-- (b) all 16 columns, in order
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'evaluation_reminder_deliveries'
--    ORDER BY ordinal_position;
--   -- expect, in order:
--   --   id, assignment_id, reminder_number, status, attempts, delivery_epoch,
--   --   claimed_at, claimed_by, first_attempted_at, payload_fingerprint, sent_at,
--   --   notification_log_id, resend_email_id, reason, created_at, updated_at
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'evaluation_reminder_deliveries';   -- expect: 16
--
-- (c) constraints - 1 PK, 1 UNIQUE, 2 FKs, 10 CHECKs
--   SELECT conname, contype, pg_get_constraintdef(oid) AS def
--     FROM pg_constraint
--    WHERE conrelid = 'public.evaluation_reminder_deliveries'::regclass
--    ORDER BY contype, conname;
--   -- expect uq_erd_assignment_reminder UNIQUE (assignment_id, reminder_number)
--   -- and these 10 CHECKs:
--   --   chk_erd_attempts_nonnegative, chk_erd_claimed_fields,
--   --   chk_erd_delivery_epoch_nonnegative, chk_erd_payload_fingerprint_shape,
--   --   chk_erd_reason_scope, chk_erd_reason_shape, chk_erd_recovery_evidence,
--   --   chk_erd_reminder_number, chk_erd_sent_fields, chk_erd_status
--   SELECT count(*) FROM pg_constraint
--    WHERE conrelid = 'public.evaluation_reminder_deliveries'::regclass
--      AND contype = 'c';                                                              -- expect: 10
--
-- (d) RLS enabled, ZERO policies
--   SELECT relrowsecurity FROM pg_class
--    WHERE oid = 'public.evaluation_reminder_deliveries'::regclass;      -- expect: true
--   SELECT policyname FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'evaluation_reminder_deliveries';  -- expect: 0 rows
--
-- (e) privileges - service_role only, and no DELETE for anyone
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND table_name = 'evaluation_reminder_deliveries'
--    ORDER BY grantee, privilege_type;
--   -- expect ONLY: service_role -> SELECT, INSERT, UPDATE   (no DELETE, no anon, no authenticated)
--   SELECT has_function_privilege('anon',
--     'public.claim_evaluation_reminders(text,jsonb,integer,integer,integer,integer,boolean)', 'EXECUTE');   -- expect: false
--   SELECT has_function_privilege('authenticated',
--     'public.claim_evaluation_reminders(text,jsonb,integer,integer,integer,integer,boolean)', 'EXECUTE');   -- expect: false
--   SELECT has_function_privilege('service_role',
--     'public.claim_evaluation_reminders(text,jsonb,integer,integer,integer,integer,boolean)', 'EXECUTE');   -- expect: true
--
-- (f) no accidental rows
--   SELECT COUNT(*) FROM public.evaluation_reminder_deliveries;          -- expect: 0
--
-- (g) CONSTRAINT SMOKE TEST - always rolls back, leaves the table empty.
--     Substitute a real evaluation_assignments id for <ASSIGNMENT_ID>.
--   BEGIN;
--     -- a fourth reminder is unrepresentable:
--     --   INSERT INTO evaluation_reminder_deliveries (assignment_id, reminder_number)
--     --     VALUES ('<ASSIGNMENT_ID>', 4);                          -- FAILS chk_erd_reminder_number
--     -- a URL cannot be written to reason:
--     --   INSERT INTO evaluation_reminder_deliveries (assignment_id, reminder_number, status, reason)
--     --     VALUES ('<ASSIGNMENT_ID>', 1, 'failed',
--     --             'https://aspireintelligence.app/evaluation/readiness#t=abc');  -- FAILS chk_erd_reason_shape
--     -- a reason on a sent row is rejected:
--     --   INSERT INTO evaluation_reminder_deliveries (assignment_id, reminder_number, status, sent_at, reason)
--     --     VALUES ('<ASSIGNMENT_ID>', 1, 'sent', now(), 'completed');            -- FAILS chk_erd_reason_scope
--     -- the duplicate guard holds:
--     INSERT INTO evaluation_reminder_deliveries (assignment_id, reminder_number) VALUES ('<ASSIGNMENT_ID>', 1);
--     --   INSERT INTO evaluation_reminder_deliveries (assignment_id, reminder_number)
--     --     VALUES ('<ASSIGNMENT_ID>', 1);                          -- FAILS uq_erd_assignment_reminder
--     SELECT COUNT(*) FROM evaluation_reminder_deliveries;           -- expect: 1 inside the txn
--   ROLLBACK;
--   SELECT COUNT(*) FROM evaluation_reminder_deliveries;             -- expect: 0
--
-- (h) CLAIM SMOKE TEST - always rolls back. Proves at-most-once and terminality.
--   BEGIN;
--     SELECT id, status, attempts FROM claim_evaluation_reminders(
--       'verify:1', jsonb_build_array(jsonb_build_object(
--         'assignment_id', '<ASSIGNMENT_ID>', 'reminder_number', 1)));
--     -- expect: 1 row, status='claimed', attempts=1
--     SELECT count(*) FROM claim_evaluation_reminders(
--       'verify:2', jsonb_build_array(jsonb_build_object(
--         'assignment_id', '<ASSIGNMENT_ID>', 'reminder_number', 1)));
--     -- expect: 0  (a concurrent/retried worker claims nothing)
--     UPDATE evaluation_reminder_deliveries SET status='sent', sent_at=now()
--      WHERE assignment_id='<ASSIGNMENT_ID>' AND reminder_number=1;
--     SELECT count(*) FROM claim_evaluation_reminders(
--       'verify:3', jsonb_build_array(jsonb_build_object(
--         'assignment_id', '<ASSIGNMENT_ID>', 'reminder_number', 1)));
--     -- expect: 0  (sent is terminal - this is the at-most-once guarantee)
--   ROLLBACK;
--
-- (i) CRASH-RECOVERY SMOKE TEST - always rolls back. Proves the three outcomes.
--   BEGIN;
--     -- A 'sending' row MUST carry both pieces of recovery evidence
--     -- (chk_erd_recovery_evidence), so the synthetic row supplies a timestamp
--     -- and a real 64-character hex fingerprint.
--     INSERT INTO evaluation_reminder_deliveries
--       (assignment_id, reminder_number, status, attempts, claimed_at, claimed_by,
--        first_attempted_at, payload_fingerprint)
--     VALUES ('<ASSIGNMENT_ID>', 2, 'sending', 1, now() - interval '2 hours', 'dead-worker',
--             now() - interval '2 hours', repeat('a', 64));
--     -- attempts remain -> recovered to pending, and the retry is idempotent
--     SELECT count(*) FROM claim_evaluation_reminders(
--       'verify:4', jsonb_build_array(jsonb_build_object(
--         'assignment_id', '<ASSIGNMENT_ID>', 'reminder_number', 2)), 25, 60, 3);
--     -- expect: 1, and delivery_epoch is UNCHANGED (same token, same key on retry)
--     SELECT status, attempts, delivery_epoch FROM evaluation_reminder_deliveries
--      WHERE assignment_id='<ASSIGNMENT_ID>' AND reminder_number=2;
--     -- expect: claimed, 2, 0
--
--     -- evidence is all-or-nothing, and 'sending' cannot exist without it:
--     --   INSERT INTO evaluation_reminder_deliveries
--     --     (assignment_id, reminder_number, first_attempted_at)
--     --     VALUES ('<ASSIGNMENT_ID>', 3, now());              -- FAILS chk_erd_recovery_evidence
--     --   INSERT INTO evaluation_reminder_deliveries
--     --     (assignment_id, reminder_number, status, claimed_at, claimed_by)
--     --     VALUES ('<ASSIGNMENT_ID>', 3, 'sending', now(), 'w');  -- FAILS chk_erd_recovery_evidence
--     --   INSERT INTO evaluation_reminder_deliveries
--     --     (assignment_id, reminder_number, first_attempted_at, payload_fingerprint)
--     --     VALUES ('<ASSIGNMENT_ID>', 3, now(), 'not-a-digest');   -- FAILS chk_erd_payload_fingerprint_shape
--
--     -- exhausted while sending -> UNRESOLVED, never recorded as a provider failure
--     UPDATE evaluation_reminder_deliveries
--        SET status='sending', attempts=3, claimed_at=now() - interval '2 hours'
--      WHERE assignment_id='<ASSIGNMENT_ID>' AND reminder_number=2;
--     PERFORM claim_evaluation_reminders('verify:5', '[]'::jsonb, 25, 60, 3);
--     SELECT status, reason FROM evaluation_reminder_deliveries
--      WHERE assignment_id='<ASSIGNMENT_ID>' AND reminder_number=2;
--     -- expect: needs_reconciliation, delivery_unconfirmed
--     --         (NOT 'failed' - the provider may well have accepted it)
--
--     -- cleanup_pending is claimable so token retirement is retried
--     UPDATE evaluation_reminder_deliveries
--        SET status='cleanup_pending', attempts=0, sent_at=now(), reason='token_cleanup_failed'
--      WHERE assignment_id='<ASSIGNMENT_ID>' AND reminder_number=2;
--     SELECT count(*) FROM claim_evaluation_reminders(
--       'verify:6', jsonb_build_array(jsonb_build_object(
--         'assignment_id', '<ASSIGNMENT_ID>', 'reminder_number', 2)));
--     -- expect: 1  (delivered, but cleanup is still owed)
--   ROLLBACK;
--
-- =============================================================================
-- ROLLBACK (safe - both objects are new; nothing else references them)
-- =============================================================================
--   DROP FUNCTION IF EXISTS public.claim_evaluation_reminders(text, jsonb, integer, integer, integer, integer, boolean);
--   DROP TABLE IF EXISTS public.evaluation_reminder_deliveries;   -- drops its PK/FK/UNIQUE/CHECKs
--   NOTIFY pgrst, 'reload schema';
-- =============================================================================

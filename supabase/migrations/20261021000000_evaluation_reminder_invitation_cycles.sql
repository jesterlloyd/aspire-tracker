-- Apply before deploying the cycle-aware reminder sender. No emails are sent.
-- Historical deliveries stay intact; deduplication is per invitation, not forever.
BEGIN;
LOCK TABLE public.evaluation_reminder_deliveries IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public.evaluation_reminder_deliveries
  ADD COLUMN invitation_sent_at timestamptz,
  ADD COLUMN token_version smallint NOT NULL DEFAULT 1;

-- Only associate legacy work with today's invitation when its earliest provider
-- attempt (or creation if never attempted) belongs to that invitation. Uncertain
-- and older history keeps NULL rather than inventing a historical invitation date.
UPDATE public.evaluation_reminder_deliveries d
SET invitation_sent_at = a.sent_at
FROM public.evaluation_assignments a
WHERE a.id = d.assignment_id AND a.sent_at IS NOT NULL
  AND coalesce(d.first_attempted_at, d.sent_at, d.created_at) >= a.sent_at;

ALTER TABLE public.evaluation_reminder_deliveries
  DROP CONSTRAINT uq_erd_assignment_reminder,
  ADD CONSTRAINT uq_erd_invitation_reminder UNIQUE (assignment_id, invitation_sent_at, reminder_number),
  ADD CONSTRAINT chk_erd_token_version CHECK (token_version IN (1, 2)),
  ADD CONSTRAINT chk_erd_current_invitation CHECK (token_version = 1 OR invitation_sent_at IS NOT NULL),
  ALTER COLUMN token_version SET DEFAULT 2;

COMMENT ON COLUMN public.evaluation_reminder_deliveries.invitation_sent_at IS
  'Invitation cycle: exact assignment sent_at at claim time. NULL is retained historical work that cannot belong to the current invitation. Never rearm or delete history to resend.';
COMMENT ON COLUMN public.evaluation_reminder_deliveries.token_version IS
  '1 preserves legacy token and provider keys for recovery. 2 binds token and key to the unique delivery ID, separating reissued invitations.';
COMMENT ON TABLE public.evaluation_reminder_deliveries IS
  'Reminder history and at-most-once delivery per assignment, invitation sent_at, and reminder number. Legacy historical rows may have an unknown NULL invitation date and are never reclaimed. No raw tokens, survey links or copied PII.';

CREATE OR REPLACE FUNCTION public.claim_evaluation_reminders(
  p_worker text, p_candidates jsonb, p_limit integer DEFAULT 25,
  p_stale_seconds integer DEFAULT 900, p_max_attempts integer DEFAULT 3,
  p_provider_window_seconds integer DEFAULT 86400, p_recover_only boolean DEFAULT false
) RETURNS SETOF public.evaluation_reminder_deliveries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE v_now timestamptz := now();
BEGIN
  IF p_worker IS NULL OR length(btrim(p_worker)) = 0 THEN RAISE EXCEPTION 'invalid worker'; END IF;
  IF p_candidates IS NULL OR jsonb_typeof(p_candidates) <> 'array' THEN RAISE EXCEPTION 'invalid candidates'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid limit'; END IF;
  IF p_stale_seconds IS NULL OR p_stale_seconds NOT BETWEEN 1 AND 86400 THEN RAISE EXCEPTION 'invalid stale seconds'; END IF;
  IF p_max_attempts IS NULL OR p_max_attempts NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'invalid max attempts'; END IF;
  IF p_provider_window_seconds IS NULL OR p_provider_window_seconds NOT BETWEEN 1 AND 86400 THEN RAISE EXCEPTION 'invalid provider window'; END IF;

  -- Prior-cycle work cannot mutate a newly reissued link. Preserve accepted or
  -- uncertain deliveries for review; never classify them as a failed email.
  UPDATE public.evaluation_reminder_deliveries d
  SET status = CASE WHEN d.first_attempted_at IS NOT NULL OR d.sent_at IS NOT NULL
                    THEN 'needs_reconciliation' ELSE 'suppressed' END,
      reason = 'invitation_reissued', claimed_at = NULL, claimed_by = NULL, updated_at = v_now
  FROM public.evaluation_assignments a
  WHERE a.id = d.assignment_id
    AND (d.invitation_sent_at IS NULL OR d.invitation_sent_at IS DISTINCT FROM a.sent_at)
    AND d.status IN ('pending', 'claimed', 'sending', 'failed', 'cleanup_pending');

  UPDATE public.evaluation_reminder_deliveries d
  SET status = 'needs_reconciliation', reason = 'provider_window_elapsed',
      claimed_at = NULL, claimed_by = NULL, updated_at = v_now
  WHERE d.status IN ('claimed', 'sending') AND d.sent_at IS NULL
    AND d.first_attempted_at < v_now - make_interval(secs => p_provider_window_seconds);

  UPDATE public.evaluation_reminder_deliveries d
  SET status = 'pending', claimed_at = NULL, claimed_by = NULL, updated_at = v_now
  WHERE d.status IN ('claimed', 'sending')
    AND d.claimed_at < v_now - make_interval(secs => p_stale_seconds) AND d.attempts < p_max_attempts;

  UPDATE public.evaluation_reminder_deliveries d
  SET status = 'needs_reconciliation', reason = 'delivery_unconfirmed',
      claimed_at = NULL, claimed_by = NULL, updated_at = v_now
  WHERE d.status = 'sending' AND d.sent_at IS NULL
    AND d.claimed_at < v_now - make_interval(secs => p_stale_seconds) AND d.attempts >= p_max_attempts;

  UPDATE public.evaluation_reminder_deliveries d
  SET status = CASE WHEN d.sent_at IS NOT NULL THEN 'needs_reconciliation' ELSE 'failed' END,
      reason = CASE WHEN d.sent_at IS NOT NULL THEN 'token_cleanup_failed' ELSE 'claim_expired' END,
      claimed_at = NULL, claimed_by = NULL, updated_at = v_now
  WHERE d.status = 'claimed'
    AND d.claimed_at < v_now - make_interval(secs => p_stale_seconds) AND d.attempts >= p_max_attempts;

  INSERT INTO public.evaluation_reminder_deliveries (assignment_id, invitation_sent_at, reminder_number)
  SELECT DISTINCT a.id, a.sent_at, (c.value->>'reminder_number')::smallint
  FROM jsonb_array_elements(p_candidates) c
  JOIN public.evaluation_assignments a ON a.id = (c.value->>'assignment_id')::uuid
  WHERE NOT p_recover_only AND a.sent_at IS NOT NULL
    AND (c.value->>'reminder_number')::smallint IN (1, 2, 3)
    AND (NOT c.value ? 'invitation_sent_at' OR (c.value->>'invitation_sent_at')::timestamptz = a.sent_at)
  ON CONFLICT (assignment_id, invitation_sent_at, reminder_number) DO NOTHING;

  RETURN QUERY
  WITH claimable AS (
    SELECT d.id FROM public.evaluation_reminder_deliveries d
    JOIN public.evaluation_assignments a ON a.id = d.assignment_id AND a.sent_at = d.invitation_sent_at
    WHERE d.status IN ('pending', 'failed', 'cleanup_pending') AND d.attempts < p_max_attempts
      AND ((p_recover_only AND (d.first_attempted_at IS NOT NULL OR d.sent_at IS NOT NULL))
        OR (NOT p_recover_only AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_candidates) c
          WHERE (c.value->>'assignment_id')::uuid = d.assignment_id
            AND (c.value->>'reminder_number')::smallint = d.reminder_number
            AND (NOT c.value ? 'invitation_sent_at' OR (c.value->>'invitation_sent_at')::timestamptz = d.invitation_sent_at)
        )))
    ORDER BY d.created_at, d.id FOR UPDATE OF d SKIP LOCKED LIMIT p_limit
  )
  UPDATE public.evaluation_reminder_deliveries d
  SET status = 'claimed', claimed_at = v_now, claimed_by = p_worker,
      attempts = d.attempts + 1, reason = NULL, updated_at = v_now
  FROM claimable WHERE d.id = claimable.id RETURNING d.*;
END;
$$;

COMMENT ON FUNCTION public.claim_evaluation_reminders(text, jsonb, integer, integer, integer, integer, boolean) IS
  'Service-role-only atomic claims scoped to the current invitation sent_at. Old-cycle sends stay historical; unresolved old-cycle work is suppressed or needs reconciliation. New-cycle deliveries get token_version 2 and independent ledger IDs. Recovery respects the provider window and never materializes new recipients. Accepted deliveries recover activation only.';

-- Retain the proven staging/activation transaction behind cycle-checking wrappers.
-- Internal functions lose service-role EXECUTE; only the guarded entry points
-- below remain callable by the application.
ALTER FUNCTION public.prepare_evaluation_reminder_token(uuid, text, timestamptz)
  RENAME TO prepare_evaluation_reminder_token_internal;
ALTER FUNCTION public.activate_evaluation_reminder_token(uuid, text)
  RENAME TO activate_evaluation_reminder_token_internal;
REVOKE ALL ON FUNCTION public.prepare_evaluation_reminder_token_internal(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.activate_evaluation_reminder_token_internal(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.prepare_evaluation_reminder_token(
  p_delivery_id uuid, p_token_hash text, p_expires_at timestamptz, p_token_version smallint DEFAULT 1
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d public.evaluation_reminder_deliveries%ROWTYPE; invitation timestamptz;
BEGIN
  SELECT * INTO d FROM public.evaluation_reminder_deliveries WHERE id = p_delivery_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'missing reminder delivery'; END IF;
  SELECT sent_at INTO invitation FROM public.evaluation_assignments WHERE id = d.assignment_id FOR UPDATE;
  IF d.invitation_sent_at IS NULL OR d.invitation_sent_at IS DISTINCT FROM invitation THEN
    RAISE EXCEPTION 'invitation changed';
  END IF;
  IF p_token_version IS DISTINCT FROM d.token_version THEN RAISE EXCEPTION 'reminder sender upgrade required'; END IF;
  RETURN public.prepare_evaluation_reminder_token_internal(p_delivery_id, p_token_hash, p_expires_at);
END;
$$;

CREATE FUNCTION public.activate_evaluation_reminder_token(p_delivery_id uuid, p_token_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d public.evaluation_reminder_deliveries%ROWTYPE; invitation timestamptz;
BEGIN
  SELECT * INTO d FROM public.evaluation_reminder_deliveries WHERE id = p_delivery_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT sent_at INTO invitation FROM public.evaluation_assignments WHERE id = d.assignment_id FOR UPDATE;
  IF d.invitation_sent_at IS NULL OR d.invitation_sent_at IS DISTINCT FROM invitation THEN RETURN false; END IF;
  RETURN public.activate_evaluation_reminder_token_internal(p_delivery_id, p_token_hash);
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_evaluation_reminder_token(uuid, text, timestamptz, smallint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.activate_evaluation_reminder_token(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_evaluation_reminder_token(uuid, text, timestamptz, smallint) TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_evaluation_reminder_token(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.claim_evaluation_reminders(text, jsonb, integer, integer, integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_evaluation_reminders(text, jsonb, integer, integer, integer, integer, boolean) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;

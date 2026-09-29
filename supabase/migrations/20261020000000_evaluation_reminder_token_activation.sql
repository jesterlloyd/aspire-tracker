-- Apply before deploying the staged-token reminder sender.
-- Keep uq_eval_tokens_one_active. Pending links remain revoked until acceptance.
BEGIN;

ALTER TABLE public.evaluation_assignment_tokens
  ADD COLUMN IF NOT EXISTS reminder_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_delivery_id uuid REFERENCES public.evaluation_reminder_deliveries(id),
  ADD COLUMN IF NOT EXISTS reminder_previous_hash text;

CREATE OR REPLACE FUNCTION public.prepare_evaluation_reminder_token(
  p_delivery_id uuid, p_token_hash text, p_expires_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d public.evaluation_reminder_deliveries%ROWTYPE;
  t public.evaluation_assignment_tokens%ROWTYPE;
  previous_hash text;
BEGIN
  SELECT * INTO d FROM public.evaluation_reminder_deliveries WHERE id = p_delivery_id FOR UPDATE;
  IF NOT FOUND OR d.status NOT IN ('claimed', 'sending') OR d.sent_at IS NOT NULL THEN
    RAISE EXCEPTION 'reminder delivery is not sendable';
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' OR p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'invalid reminder token parameters';
  END IF;
  SELECT * INTO t FROM public.evaluation_assignment_tokens WHERE token_hash = p_token_hash;
  IF FOUND THEN
    IF t.assignment_id <> d.assignment_id OR (t.reminder_delivery_id IS NOT NULL AND t.reminder_delivery_id <> d.id)
       OR (t.revoked_at IS NOT NULL AND NOT t.reminder_pending) OR t.used_at IS NOT NULL THEN
      RAISE EXCEPTION 'reminder token cannot be reused';
    END IF;
    RETURN jsonb_build_object('id', t.id, 'created', false);
  END IF;
  SELECT token_hash INTO previous_hash FROM public.evaluation_assignment_tokens
    WHERE assignment_id = d.assignment_id AND revoked_at IS NULL AND used_at IS NULL;
  INSERT INTO public.evaluation_assignment_tokens
    (assignment_id, token_hash, token_hash_prefix, expires_at, revoked_at,
     reminder_pending, reminder_delivery_id, reminder_previous_hash)
  VALUES (d.assignment_id, p_token_hash, left(p_token_hash, 8), p_expires_at, now(), true, d.id, previous_hash)
  RETURNING * INTO t;
  RETURN jsonb_build_object('id', t.id, 'created', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_evaluation_reminder_token(
  p_delivery_id uuid, p_token_hash text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d public.evaluation_reminder_deliveries%ROWTYPE;
  t public.evaluation_assignment_tokens%ROWTYPE;
  a public.evaluation_assignments%ROWTYPE;
  current_hash text;
BEGIN
  SELECT * INTO d FROM public.evaluation_reminder_deliveries WHERE id = p_delivery_id FOR UPDATE;
  IF NOT FOUND OR d.sent_at IS NULL THEN RETURN false; END IF;
  SELECT * INTO a FROM public.evaluation_assignments WHERE id = d.assignment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  -- Serialize token changes; a conflicting concurrent writer rolls back this transaction.
  PERFORM id FROM public.evaluation_assignment_tokens WHERE assignment_id = d.assignment_id ORDER BY id FOR UPDATE;
  SELECT * INTO t FROM public.evaluation_assignment_tokens
    WHERE assignment_id = d.assignment_id AND token_hash = p_token_hash;
  IF NOT FOUND THEN RETURN false; END IF;
  IF t.reminder_delivery_id IS NOT NULL AND t.reminder_delivery_id <> d.id THEN RETURN false; END IF;
  -- Consumed, completed, revoked or expired workflows must never be reopened.
  IF t.used_at IS NOT NULL OR a.completed_at IS NOT NULL OR a.revoked_at IS NOT NULL
     OR a.status IN ('completed', 'revoked', 'expired') OR a.expires_at <= now() THEN RETURN true; END IF;
  IF NOT t.reminder_pending THEN RETURN t.revoked_at IS NULL; END IF;
  IF t.expires_at <= now() THEN RETURN false; END IF;
  SELECT token_hash INTO current_hash FROM public.evaluation_assignment_tokens
    WHERE assignment_id = d.assignment_id AND revoked_at IS NULL AND used_at IS NULL;
  -- A manual reissue after staging takes precedence; don't overwrite its link.
  IF current_hash IS DISTINCT FROM t.reminder_previous_hash THEN RETURN false; END IF;
  UPDATE public.evaluation_assignment_tokens SET revoked_at = now()
    WHERE assignment_id = d.assignment_id AND id <> t.id AND revoked_at IS NULL AND used_at IS NULL;
  UPDATE public.evaluation_assignment_tokens SET revoked_at = NULL, reminder_pending = false WHERE id = t.id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_evaluation_reminder_token(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.activate_evaluation_reminder_token(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_evaluation_reminder_token(uuid, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_evaluation_reminder_token(uuid, text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;

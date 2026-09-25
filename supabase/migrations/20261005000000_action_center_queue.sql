-- ACTION-CENTER-1: durable per-user snoozes, auditable support-check-in
-- classification, and notification fan-out from existing lifecycle records.
-- Additive only. No existing task or notification rows are rewritten.

BEGIN;

CREATE TABLE IF NOT EXISTS public.action_snoozes (
  user_id       uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  item_key      text        NOT NULL,
  snoozed_until timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_key),
  CONSTRAINT action_snoozes_item_key_nonempty CHECK (btrim(item_key) <> '')
);

ALTER TABLE public.action_snoozes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "action_snoozes_own_read" ON public.action_snoozes;
DROP POLICY IF EXISTS "action_snoozes_own_insert" ON public.action_snoozes;
DROP POLICY IF EXISTS "action_snoozes_own_update" ON public.action_snoozes;
DROP POLICY IF EXISTS "action_snoozes_own_delete" ON public.action_snoozes;
CREATE POLICY "action_snoozes_own_read" ON public.action_snoozes
  FOR SELECT TO authenticated USING (user_id = public.portal_profile_id());
CREATE POLICY "action_snoozes_own_insert" ON public.action_snoozes
  FOR INSERT TO authenticated WITH CHECK (user_id = public.portal_profile_id());
CREATE POLICY "action_snoozes_own_update" ON public.action_snoozes
  FOR UPDATE TO authenticated
  USING (user_id = public.portal_profile_id())
  WITH CHECK (user_id = public.portal_profile_id());
CREATE POLICY "action_snoozes_own_delete" ON public.action_snoozes
  FOR DELETE TO authenticated USING (user_id = public.portal_profile_id());
REVOKE ALL ON TABLE public.action_snoozes FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.action_snoozes TO authenticated;
GRANT ALL ON TABLE public.action_snoozes TO service_role;

CREATE TABLE IF NOT EXISTS public.support_checkin_events (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_log_id      uuid        NOT NULL REFERENCES public.student_shift_logs(id) ON DELETE RESTRICT,
  student_id        uuid        NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  cohort_id         uuid        NOT NULL REFERENCES public.cohorts(id) ON DELETE RESTRICT,
  reply_fingerprint text        NOT NULL,
  classification    text        NOT NULL CHECK (classification IN ('urgent', 'decline', 'request', 'needs_look')),
  status            text        NOT NULL CHECK (status IN ('open', 'closed_auto', 'reopened', 'closed_staff')),
  rule_key          text        NOT NULL,
  actor_profile_id  uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_checkin_events_fingerprint_nonempty CHECK (btrim(reply_fingerprint) <> ''),
  CONSTRAINT support_checkin_events_rule_nonempty CHECK (btrim(rule_key) <> ''),
  CONSTRAINT support_checkin_events_idempotent UNIQUE (shift_log_id, reply_fingerprint, status, rule_key)
);
CREATE INDEX IF NOT EXISTS support_checkin_events_latest_idx
  ON public.support_checkin_events (shift_log_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS support_checkin_events_cohort_idx
  ON public.support_checkin_events (cohort_id, created_at DESC);

ALTER TABLE public.support_checkin_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "support_checkin_events_staff_read" ON public.support_checkin_events;
CREATE POLICY "support_checkin_events_staff_read" ON public.support_checkin_events
  FOR SELECT TO authenticated USING (public.is_active_owner_or_admin());
REVOKE ALL ON TABLE public.support_checkin_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.support_checkin_events TO authenticated;
GRANT ALL ON TABLE public.support_checkin_events TO service_role;

-- One editable classifier. Safety always wins, then an exact decline, then a
-- question/problem; Keith and all other ambiguous text land in needs_look.
CREATE OR REPLACE FUNCTION public.classify_support_checkin(p_reply text)
RETURNS TABLE(classification text, status text, rule_key text)
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v text := lower(btrim(COALESCE(p_reply, '')));
  v_plain text;
BEGIN
  IF v ~ '\m(harm|injur(y|ed|ies)|unsafe|harass(ment|ed|ing)?|needlestick|needle[ -]?stick|exposure|exposed|ill(ness)?|sick)\M' THEN
    RETURN QUERY SELECT 'urgent'::text, 'open'::text, 'safety_term'::text;
    RETURN;
  END IF;

  v_plain := btrim(regexp_replace(v, '[.!,:;]+$', '', 'g'));
  IF v_plain ~ '^(no|no thank you|no thanks|all good|i''m good|im good|i am good|i''m fine|im fine|i am fine|not right now|thank you|thanks)$'
     OR v ~ '^(i )?enjoyed my shift([.! ]+(thank you|thanks))?[.! ]*$'
     OR v ~ '^[[:space:]👍👌😊🙂😀😁🙏❤️❤✨💛💙💜🤍🙌👏💯✅]+$' THEN
    RETURN QUERY SELECT 'decline'::text, 'closed_auto'::text, 'clear_decline'::text;
    RETURN;
  END IF;

  IF v LIKE '%?%'
     OR v ~ '\m(how|help|issue|problem|unable)\M'
     OR v ~ '\mcan i\M'
     OR v ~ '\m(can''t|cannot)\M' THEN
    RETURN QUERY SELECT 'request'::text, 'open'::text, 'question_or_problem'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'needs_look'::text, 'open'::text, 'ambiguous'::text;
END;
$fn$;
REVOKE ALL ON FUNCTION public.classify_support_checkin(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.classify_support_checkin(text) TO service_role;

CREATE OR REPLACE FUNCTION public.capture_support_checkin_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_reply text := btrim(COALESCE(NEW.support_needed, ''));
  v_fingerprint text;
  v_classification text;
  v_status text;
  v_rule text;
BEGIN
  IF v_reply = '' OR (TG_OP = 'UPDATE' AND v_reply IS NOT DISTINCT FROM btrim(COALESCE(OLD.support_needed, ''))) THEN
    RETURN NEW;
  END IF;
  v_fingerprint := md5(v_reply);
  SELECT c.classification, c.status, c.rule_key
    INTO v_classification, v_status, v_rule
    FROM public.classify_support_checkin(v_reply) c;
  INSERT INTO public.support_checkin_events
    (shift_log_id, student_id, cohort_id, reply_fingerprint, classification, status, rule_key)
  VALUES
    (NEW.id, NEW.student_id, NEW.cohort_id, v_fingerprint, v_classification, v_status, v_rule)
  ON CONFLICT (shift_log_id, reply_fingerprint, status, rule_key) DO NOTHING;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.capture_support_checkin_event() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_capture_support_checkin_event ON public.student_shift_logs;
CREATE TRIGGER trg_capture_support_checkin_event
AFTER INSERT OR UPDATE OF support_needed ON public.student_shift_logs
FOR EACH ROW EXECUTE FUNCTION public.capture_support_checkin_event();

CREATE OR REPLACE FUNCTION public.record_support_checkin_decision(p_shift_log_id uuid, p_action text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_me uuid := public.portal_profile_id();
  v_latest public.support_checkin_events%ROWTYPE;
  v_id uuid;
  v_status text;
  v_classification text;
  v_rule text;
BEGIN
  IF v_me IS NULL OR NOT public.is_active_owner_or_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = 'MS403';
  END IF;
  IF p_action NOT IN ('reopen', 'close_no_help', 'open_request') THEN
    RAISE EXCEPTION 'invalid action' USING ERRCODE = 'MS400';
  END IF;
  SELECT * INTO v_latest
    FROM public.support_checkin_events
   WHERE shift_log_id = p_shift_log_id
   ORDER BY created_at DESC, id DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'check-in not found' USING ERRCODE = 'MS404';
  END IF;

  v_status := CASE WHEN p_action = 'close_no_help' THEN 'closed_staff' ELSE 'reopened' END;
  v_classification := CASE WHEN p_action = 'open_request' THEN 'request' ELSE v_latest.classification END;
  v_rule := 'staff_' || p_action;
  INSERT INTO public.support_checkin_events
    (shift_log_id, student_id, cohort_id, reply_fingerprint, classification, status, rule_key, actor_profile_id)
  VALUES
    (v_latest.shift_log_id, v_latest.student_id, v_latest.cohort_id, v_latest.reply_fingerprint,
     v_classification, v_status, v_rule, v_me)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.record_support_checkin_decision(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_support_checkin_decision(uuid, text) TO authenticated, service_role;

-- Existing lifecycle records fan out durable notifications. In-app-only rows
-- use queue_status=suppressed; calendar changes are also queued for email.
CREATE OR REPLACE FUNCTION public.action_center_message_notification()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_subject text;
  v_actor_name text;
BEGIN
  IF NEW.event_type NOT IN ('assignment_change', 'resolved') THEN RETURN NEW; END IF;
  SELECT subject INTO v_subject FROM public.conversations WHERE id = NEW.conversation_id;
  SELECT full_name INTO v_actor_name FROM public.user_profiles WHERE id = NEW.actor_profile_id;

  IF NEW.event_type = 'assignment_change'
     AND NEW.to_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    INSERT INTO public.staff_notifications
      (correlation_id, recipient_profile_id, recipient_email, event_type, actor_profile_id,
       actor_name, actor_role, subject, dest_url, queue_status)
    SELECT 'message-assigned:' || NEW.id, up.id, COALESCE(up.email, ''), 'message_assigned', NEW.actor_profile_id,
           v_actor_name, 'owner_admin', COALESCE(v_subject, 'Message thread') || ' was assigned to you',
           '/connect/messages?conversation=' || NEW.conversation_id, 'suppressed'
      FROM public.user_profiles up
     WHERE up.id = NEW.to_value::uuid AND up.id <> NEW.actor_profile_id
       AND COALESCE(up.is_active, true)
    ON CONFLICT (correlation_id, recipient_profile_id) DO NOTHING;
  ELSIF NEW.event_type = 'resolved' THEN
    INSERT INTO public.staff_notifications
      (correlation_id, recipient_profile_id, recipient_email, event_type, actor_profile_id,
       actor_name, actor_role, subject, dest_url, queue_status)
    SELECT 'message-resolved:' || NEW.id, up.id, COALESCE(up.email, ''), 'followed_message_resolved', NEW.actor_profile_id,
           v_actor_name, 'owner_admin', COALESCE(v_subject, 'Message thread') || ' was resolved',
           '/connect/messages?conversation=' || NEW.conversation_id, 'suppressed'
      FROM public.conversations c
      JOIN public.user_profiles up
        ON up.id IN (c.assigned_staff_profile_id, c.follow_up_flagged_by)
     WHERE c.id = NEW.conversation_id AND up.id <> NEW.actor_profile_id
       AND COALESCE(up.is_active, true)
    ON CONFLICT (correlation_id, recipient_profile_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.action_center_message_notification() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_action_center_message_notification ON public.conversation_events;
CREATE TRIGGER trg_action_center_message_notification
AFTER INSERT ON public.conversation_events
FOR EACH ROW EXECUTE FUNCTION public.action_center_message_notification();

CREATE OR REPLACE FUNCTION public.action_center_signature_notification()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_actor uuid;
BEGIN
  IF NEW.status <> 'completed' OR OLD.status = 'completed' OR NEW.sender_id IS NULL THEN RETURN NEW; END IF;
  SELECT s.user_profile_id INTO v_actor
    FROM public.sig_request_signers s
   WHERE s.request_id = NEW.id AND s.signed_at IS NOT NULL
   ORDER BY s.signed_at DESC LIMIT 1;
  IF NEW.sender_id = v_actor THEN RETURN NEW; END IF;
  INSERT INTO public.staff_notifications
    (correlation_id, recipient_profile_id, recipient_email, event_type, actor_profile_id,
     actor_name, actor_role, subject, dest_url, queue_status)
  SELECT 'signed-copy-returned:' || NEW.id, up.id, COALESCE(up.email, ''), 'signed_copy_returned', v_actor,
         actor.full_name, 'signer', NEW.title || ' is fully signed',
         '/catalog/signatures?tab=requests&request=' || NEW.id, 'suppressed'
    FROM public.user_profiles up
    LEFT JOIN public.user_profiles actor ON actor.id = v_actor
   WHERE up.id = NEW.sender_id AND COALESCE(up.is_active, true)
  ON CONFLICT (correlation_id, recipient_profile_id) DO NOTHING;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.action_center_signature_notification() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_action_center_signature_notification ON public.sig_requests;
CREATE TRIGGER trg_action_center_signature_notification
AFTER UPDATE OF status ON public.sig_requests
FOR EACH ROW EXECUTE FUNCTION public.action_center_signature_notification();

CREATE OR REPLACE FUNCTION public.action_center_calendar_notification()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
BEGIN
  IF NEW.created_by IS NULL OR NEW.updated_by IS NULL OR NEW.created_by = NEW.updated_by THEN RETURN NEW; END IF;
  INSERT INTO public.staff_notifications
    (correlation_id, recipient_profile_id, recipient_email, event_type, actor_profile_id,
     actor_name, actor_role, subject, dest_url, queue_status, next_attempt_at)
  SELECT 'calendar-change:' || NEW.id || ':' || md5(row_to_json(NEW)::text),
         recipient.id, recipient.email, 'calendar_event_changed', NEW.updated_by,
         actor.full_name, 'owner_admin', NEW.title || ' changed', '/interviews', 'queued', now()
    FROM public.user_profiles recipient
    LEFT JOIN public.user_profiles actor ON actor.id = NEW.updated_by
   WHERE recipient.id = NEW.created_by AND COALESCE(recipient.is_active, true)
     AND btrim(COALESCE(recipient.email, '')) <> ''
  ON CONFLICT (correlation_id, recipient_profile_id) DO NOTHING;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.action_center_calendar_notification() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_action_center_calendar_notification ON public.aspire_events;
CREATE TRIGGER trg_action_center_calendar_notification
AFTER UPDATE ON public.aspire_events
FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
EXECUTE FUNCTION public.action_center_calendar_notification();

CREATE OR REPLACE FUNCTION public.action_center_evaluation_notification()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_label text;
BEGIN
  IF NEW.status NOT IN ('sent', 'opened', 'reminder_due')
     OR (TG_OP = 'UPDATE' AND OLD.status IN ('sent', 'opened', 'reminder_due')) THEN RETURN NEW; END IF;
  SELECT COALESCE(i.display_name, i.slug, 'Evaluation') INTO v_label
    FROM public.evaluation_instruments i WHERE i.id = NEW.instrument_id;
  INSERT INTO public.staff_notifications
    (correlation_id, recipient_profile_id, recipient_email, event_type, actor_profile_id,
     actor_name, actor_role, student_id, subject, dest_url, queue_status)
  SELECT 'evaluation-window-opened:' || NEW.id, up.id, COALESCE(up.email, ''), 'evaluation_window_opened', NEW.assigned_by,
         actor.full_name, 'owner_admin', NEW.student_id, v_label || ' window opened', '/evaluation', 'suppressed'
    FROM public.user_profiles up
    LEFT JOIN public.user_profiles actor ON actor.id = NEW.assigned_by
   WHERE (up.is_owner IS TRUE OR up.role IN ('owner', 'admin'))
     AND COALESCE(up.is_active, true) AND up.id <> NEW.assigned_by
  ON CONFLICT (correlation_id, recipient_profile_id) DO NOTHING;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.action_center_evaluation_notification() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_action_center_evaluation_notification ON public.evaluation_assignments;
CREATE TRIGGER trg_action_center_evaluation_notification
AFTER INSERT OR UPDATE OF status ON public.evaluation_assignments
FOR EACH ROW EXECUTE FUNCTION public.action_center_evaluation_notification();

COMMIT;

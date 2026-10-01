-- EVALUATION-REMINDER-RERUN-REPAIR (2026-09-30). APPLIED by the Owner on 2026-09-30.
--
-- What happened: 20261020000000_evaluation_reminder_token_activation.sql was re-run
-- AFTER 20261021000000_evaluation_reminder_invitation_cycles.sql was already applied.
-- Its CREATE OR REPLACE statements (a) replaced the guarded
-- activate_evaluation_reminder_token(uuid,text) with the unguarded original body, losing
-- the invitation-cycle check, and (b) recreated a spare 3-argument
-- prepare_evaluation_reminder_token(uuid,text,timestamptz) beside the 4-argument wrapper.
-- No email was sent and no reminder row changed. The app calls prepare with four named
-- arguments, so the spare function was never what it called.
--
-- LESSON: the activation migration must never run after the cycles migration. Check first.
--
-- Proven before the Owner ran it: on PGlite, both migrations then the activation migration
-- again reproduced the exact state below; after this repair every reminder function's
-- definition and grants equalled a clean single apply, and a second run changed nothing.

-- ── CHECK (read-only). Before the repair: 5 rows, activate false/false/true and the
--    3-argument prepare present. After: 4 rows, activate true/true/true, no 3-argument
--    prepare, both _internal false/false/false, the 4-argument prepare true/true/true.
select p.oid::regprocedure::text as signature,
       position('invitation_sent_at' in p.prosrc) > 0 as has_cycle_check,
       position('_internal(' in p.prosrc) > 0 as calls_internal,
       coalesce(array_to_string(p.proacl, ','), '') like '%service_role=X%' as service_role_can_run
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like '%evaluation_reminder_token%'
order by 1;

-- ── REPAIR (one transaction; safe to run twice).
BEGIN;

-- 1. Remove the spare 3-argument prepare function that re-running the activation
--    migration created. The app calls the 4-argument one; this one has no cycle check.
DROP FUNCTION IF EXISTS public.prepare_evaluation_reminder_token(uuid, text, timestamptz);

-- 2. Put back the guarded activate function (the invitation-cycle check), exactly as
--    20261021000000_evaluation_reminder_invitation_cycles.sql defines it.
CREATE OR REPLACE FUNCTION public.activate_evaluation_reminder_token(p_delivery_id uuid, p_token_hash text)
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

REVOKE ALL ON FUNCTION public.activate_evaluation_reminder_token(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_evaluation_reminder_token(uuid, text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;

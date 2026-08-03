-- ============================================================================
-- PORTAL ACTIVATION DIAGNOSTICS for the reported cases (READ-ONLY; NOT RUN)
-- ============================================================================
-- Every statement is a SELECT. Run as the service role or owner in the Supabase
-- SQL editor ONLY with Owner approval. Replace the Lucy placeholder with her
-- address of record before running.
--
-- Interpretation guide (from the 2026-08-03 activation audit):
--   - a token consumed within seconds of generation, with the user's click
--     failing later, indicates an email-security scanner consumed the link;
--   - two link generations close together indicate supersession (the older
--     emailed link died the moment the newer one was minted);
--   - one generation followed by a next-day verification failure is plain
--     expiry, which the old email copy actively encouraged.
-- ============================================================================

-- D1. Auth account timeline for the reporters.
SELECT id, email, created_at, invited_at, confirmation_sent_at, recovery_sent_at,
       email_confirmed_at, last_sign_in_at,
       raw_user_meta_data->>'password_set'    AS password_set,
       raw_user_meta_data->>'password_set_at' AS password_set_at
FROM auth.users
WHERE lower(email) IN ('amanlan3@calstatela.edu', 'lucy.van.otterloo@example.edu');

-- D2. Outstanding one-time tokens. A consumed or superseded token is deleted,
--     so a row here means an UNCONSUMED link of that type is currently live.
SELECT u.email, t.token_type, t.created_at, t.updated_at
FROM auth.one_time_tokens t
JOIN auth.users u ON u.id = t.user_id
WHERE lower(u.email) IN ('amanlan3@calstatela.edu', 'lucy.van.otterloo@example.edu')
ORDER BY u.email, t.created_at;

-- D3. Auth audit trail: link generation and verification attempts, timestamped.
SELECT created_at, payload->>'action' AS action, payload->>'actor_username' AS actor_username, payload
FROM auth.audit_log_entries
WHERE payload::text ILIKE '%amanlan3@calstatela.edu%'
   OR payload::text ILIKE '%van otterloo%'
   OR payload::text ILIKE '%vanotterloo%'
ORDER BY created_at DESC
LIMIT 200;

-- D4. App-side provisioning state.
SELECT p.id, p.email, p.role, p.is_active, p.auth_user_id, p.last_login_at, p.created_at
FROM public.user_profiles p
WHERE lower(p.email) IN ('amanlan3@calstatela.edu', 'lucy.van.otterloo@example.edu');

-- D5. Role grants (revoked history included).
SELECT p.email, g.role, g.starts_at, g.expires_at, g.revoked_at, g.granted_by
FROM public.user_role_grants g
JOIN public.user_profiles p ON p.id = g.user_profile_id
WHERE lower(p.email) IN ('amanlan3@calstatela.edu', 'lucy.van.otterloo@example.edu')
ORDER BY p.email, g.starts_at;

-- D6. School scopes (revoked history included).
SELECT p.email, s.school_key, s.cohort_id, s.starts_at, s.expires_at, s.revoked_at
FROM public.user_school_scopes s
JOIN public.user_profiles p ON p.id = s.user_profile_id
WHERE lower(p.email) IN ('amanlan3@calstatela.edu', 'lucy.van.otterloo@example.edu')
ORDER BY p.email, s.starts_at;

-- D7. Once the invitation-events ledger (20260804000000) is applied, the same
--     question becomes a single query for ANY future report:
-- SELECT occurred_at, event_type, link_type, category, request_id, detail
-- FROM public.portal_invitation_events
-- WHERE target_email = lower('amanlan3@calstatela.edu')
-- ORDER BY occurred_at;

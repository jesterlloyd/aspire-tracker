-- Phase S.1A: Remove anonymous access to public.communications.
--
-- Verified live preconditions:
--   - RLS is enabled on public.communications and is not forced.
--   - "anon_all_comms" is live and grants ALL row-level access to anon.
--   - anon holds direct table privileges including SELECT, INSERT, UPDATE,
--     DELETE, TRUNCATE, REFERENCES, and TRIGGER.
--   - PUBLIC holds no direct table privileges on public.communications.
--   - No public or unauthenticated workflow reads or writes communications.
--   - Existing authenticated and service-role pathways remain intentionally unchanged.
--
-- Scope:
--   - Remove anonymous access only.
--   - Do not change authenticated policies.
--   - Do not change service-role access.
--   - Do not modify frontend or API code.

BEGIN;

DROP POLICY IF EXISTS "anon_all_comms"
  ON public.communications;

REVOKE ALL PRIVILEGES ON TABLE public.communications FROM anon;

COMMIT;

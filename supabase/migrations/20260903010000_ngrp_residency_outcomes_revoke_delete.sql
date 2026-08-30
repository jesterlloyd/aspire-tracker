-- NGRP durable employment-history privilege repair
--
-- The NGRP foundation intends ngrp_residency_outcomes to be server-only and
-- non-deletable. This repair records the post-foundation revoke for databases
-- where the foundation migration has already run. It is safe to run after the
-- manual repair because REVOKE is idempotent.

BEGIN;

REVOKE DELETE ON TABLE public.ngrp_residency_outcomes FROM service_role;

COMMIT;

-- Verification:
-- SELECT has_table_privilege(
--   'service_role',
--   'public.ngrp_residency_outcomes',
--   'DELETE'
-- ) AS service_role_can_delete_outcomes;
-- Expected: false

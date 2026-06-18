-- =============================================================================
-- ASPIRE Catalog: Interviewer read-only access  (CATALOG-ACCESS-1)
-- Migration: 20260618000000_catalog_access1_interviewer_read
-- =============================================================================
--
-- Grants Interviewers READ access to ACTIVE catalog_resources rows only, so they can use
-- the Catalog as a read-only resource library. Owner/Admin access is UNCHANGED (they keep
-- full read of active AND inactive rows via the existing policy). This is ADDITIVE: it adds
-- one new SELECT policy and changes no schema, no table, and NO Storage policy.
--
-- RLS combines permissive SELECT policies with OR, so:
--   - Owner/Admin  → existing policy (all rows, active + inactive)
--   - Interviewer  → new policy (active rows only)
--   - everyone else → no policy → no access (unchanged)
--
-- There is still NO client write policy on catalog_resources; all writes remain service-role
-- only behind the Owner/Admin-gated upload/update endpoints. Interviewers cannot write.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute. Claude Code applies nothing —
-- the Owner applies this manually and verifies, THEN authorizes commit of this file.
-- Idempotent: DROP POLICY IF EXISTS before CREATE.
-- =============================================================================

-- Interviewers may read ACTIVE resources only (never inactive/soft-removed rows).
DROP POLICY IF EXISTS "catalog_resources_interviewer_read_active" ON catalog_resources;
CREATE POLICY "catalog_resources_interviewer_read_active"
  ON catalog_resources FOR SELECT
  TO authenticated
  USING (
    is_active = true
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE auth_user_id = auth.uid()
        AND role = 'interviewer'
    )
  );

-- Reload schema cache.
NOTIFY pgrst, 'reload schema';

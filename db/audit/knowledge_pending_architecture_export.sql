-- ============================================================================
-- KNOWLEDGE VAULT: pending-architecture export (READ-ONLY)
-- ============================================================================
-- Purpose: export the full active corpus and every pending revision as ONE
-- JSON value, so the proposed enrichment can be analyzed as a single
-- knowledge architecture (links, orphans, hubs, tag vocabulary) BEFORE any
-- revision is applied.
--
-- This statement reads two tables and writes nothing. It has no side effects
-- and is safe to run at any time.
--
-- How to use:
--   1. Run in the Supabase SQL editor.
--   2. It returns one row, one column (vault_export).
--   3. Use "Download CSV" (or copy the cell) and hand the file over for
--      analysis. The value is a JSON object: { exported_at, entries[],
--      revisions[] }.
-- ============================================================================

SELECT json_build_object(
  'exported_at', now(),
  'entries', (
    SELECT coalesce(json_agg(to_jsonb(e) ORDER BY e.title), '[]'::json)
    FROM public.knowledge_entries e
  ),
  'revisions', (
    SELECT coalesce(json_agg(to_jsonb(r) ORDER BY r.submitted_at), '[]'::json)
    FROM public.knowledge_revisions r
  )
)::text AS vault_export;

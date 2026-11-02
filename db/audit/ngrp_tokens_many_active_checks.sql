-- TRANSITION-REMINDER-1: checks for 20261117000000_ngrp_tokens_many_active.sql. Read-only.
-- PRE: one_active_index_present is true, and no assignment holds more than one active link.
-- POST: one_active_index_present is false.
SELECT
  EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ngrp_tokens_one_active') AS one_active_index_present,
  (SELECT count(*) FROM (
     SELECT assignment_id FROM public.ngrp_transition_tokens WHERE status = 'active'
     GROUP BY assignment_id HAVING count(*) > 1
   ) many) AS assignments_with_several_active_links,
  (SELECT count(*) FROM public.ngrp_transition_assignments a
    WHERE a.revoked_at IS NULL AND a.status IN ('sent', 'opened', 'in_progress') AND a.revision_count = 0) AS forms_waiting;

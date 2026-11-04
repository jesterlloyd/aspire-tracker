-- STUDENT-IMPORT-KEITH-1 follow-up (Owner, 2026-11-04): map Spring 2026 as a source cohort of the
-- Winter 2027 Residency Cohort, so its Completed alumni reach Residency the way the other three
-- source cohorts' do. The Owner chose this over hand-adding the 45 alumni imported into Spring 2026.
-- One row; a re-run does nothing (UNIQUE (cycle_id, cohort_id)). The 5 Spring 2026 alumni already
-- added by hand keep their rows; the roster lists each student once.
-- Undo: DELETE FROM public.ngrp_cycle_source_cohorts
--         WHERE cycle_id = '47a06647-28c2-4ae4-9ec5-0ccef082d154'
--           AND cohort_id = '802e3b9c-b227-4cc4-8b9f-18526ffdb070';

INSERT INTO public.ngrp_cycle_source_cohorts (cycle_id, cohort_id, created_by_profile_id)
VALUES ('47a06647-28c2-4ae4-9ec5-0ccef082d154', '802e3b9c-b227-4cc4-8b9f-18526ffdb070',
        'cacd1576-6a34-416d-9386-9cd1e59a2ab3')
ON CONFLICT (cycle_id, cohort_id) DO NOTHING
RETURNING id, is_demo;

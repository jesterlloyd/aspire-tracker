-- BUDGET-CONCUR-1 follow-up, 2026-09-30. OWNER-GATED: do not apply from a session.
--
-- The prepare-concur skill was seeded with an example report name that used the retired program
-- wording (the house rule: write ASPIRE, never the two-word form). 20261026000000 is corrected in the
-- repo; this corrects the copy already in the database. It changes only that example, only while the
-- seeded text is still there, so an instruction the Owner has since edited is left alone. The old
-- wording is built from two pieces so this file does not contain it.
--
-- Safe to re-run. Check: SELECT position('Platform Subscriptions' IN instruction_body) > 0 AS has_example,
--   position(('ASPIRE ' || 'Program') IN instruction_body) AS old_wording FROM keith_skills WHERE slug = 'prepare-concur';
--   Expect true and 0.

UPDATE public.keith_skills
SET instruction_body = replace(instruction_body, 'ASPIRE ' || 'Program Platform Subscriptions', 'ASPIRE Platform Subscriptions')
WHERE slug = 'prepare-concur' AND position(('ASPIRE ' || 'Program Platform Subscriptions') IN instruction_body) > 0;

-- SUB-APPROVAL-1 (PROGRAM-BUDGET), 2026-09-27. OWNER-GATED: do not apply from a session.
--
-- The Owner's subscriptions, from "Program Budget Subscriptions With Resend.docx" (2026-09-27),
-- as PROPOSED: shown on the Subscriptions tab for the approval conversation, counted against
-- nothing. Nothing had been paid from the budget or filed in Concur. Apply AFTER
-- supabase/migrations/20261010000000_budget_subscription_approval.sql.
--
-- From the document and the Owner's answers the same day:
--   * Claude Max: start date was blank; June 1, 2026 is the first billing period the document verifies.
--   * Supabase Pro: the invoice covers ASPIRE and Golden Oar; ASPIRE carries HALF of the ~$35 estimate.
--   * Resend: the Amex ending 2002 is Personal (Concur).
--   * Claude Pro annual: ended when Claude Max began (end May 31, 2026), so it never touches FY27;
--     recorded for the history only.
--   * The $9.99 aspireintelligence.app domain (July 4, 2026) is a one-time purchase, not a
--     subscription, and is not here.
--
-- Idempotent: a subscription already on file under the same name is left alone.
-- Checks: db/audit/budget_subscription_approval_checks.sql (SEED 1). Rollback: end of file.

BEGIN;

INSERT INTO public.budget_subscriptions
  (program, name, plan, vendor, billing, amount, anchor_date, start_date, end_date, payment_method, category_id, auto_renew, notes, approval_state)
SELECT 'ASPIRE', v.name, v.plan, v.vendor, v.billing, v.amount, v.anchor::date, v.start::date, v.ending::date, 'personal_concur', c.id, v.auto, v.notes, 'proposed'
FROM (VALUES
  ('Claude Max', 'Claude Max 5x, 1 seat', 'Anthropic, PBC', 'monthly', 100.00, '2026-09-01', '2026-06-01', NULL, true,
   'First verified Max billing period June 1 to July 1, 2026; original upgrade date unconfirmed. Receipt #2140-0108-6262.'),
  ('Supabase Pro', 'Pro plan; compute usage varies', 'Supabase Pte. Ltd.', 'usage', 17.50, '2026-08-29', '2026-05-29', NULL, true,
   'ASPIRE carries half of the invoice ($25 Pro + $10 compute, about $35); the other half is Golden Oar. Earlier totals $26.45 (Jun 29) and $28.52 (Jul 29). Invoice #LOENXJ-00006.'),
  ('Vercel Pro', 'Pro, 1 seat', 'Vercel Inc.', 'monthly', 20.00, '2026-09-01', '2026-06-01', NULL, true,
   'First paid Pro period began June 1, 2026. Receipt #2792-3316. The $9.99 domain (July 4, 2026) is a separate one-time purchase.'),
  ('Resend', 'Transactional Pro, 1 plan', 'Resend', 'monthly', 20.00, '2026-09-16', '2026-07-16', NULL, true,
   'Paid July 16, August 16 and September 16, 2026 on the Amex ending 2002 (personal). Invoice #9S4B2PID-0003; receipt #2206-7024.'),
  ('Claude Pro annual purchase', 'Claude Pro, 1 seat', 'Anthropic, PBC', 'annual', 200.00, '2026-04-15', '2026-04-15', '2026-05-31', false,
   'Ended when Claude Max began. The April 15, 2026 charge predates FY27. Receipt #2111-1559-8320.')
) AS v(name, plan, vendor, billing, amount, anchor, start, ending, auto, notes)
LEFT JOIN public.budget_categories c ON c.program = 'ASPIRE' AND c.name = 'Technology & Software'
WHERE NOT EXISTS (SELECT 1 FROM public.budget_subscriptions s WHERE s.program = 'ASPIRE' AND s.name = v.name AND s.deleted_at IS NULL);

COMMIT;

-- ── Rollback (removes these proposals only, and only while they are still proposed) ──
-- BEGIN;
--   DELETE FROM public.budget_subscriptions WHERE program = 'ASPIRE' AND approval_state = 'proposed'
--     AND name IN ('Claude Max', 'Supabase Pro', 'Vercel Pro', 'Resend', 'Claude Pro annual purchase');
-- COMMIT;

-- REASSIGN-1 (Owner, 2026-10-27): the Witness step is retired from the CSMC Experience
-- Confidentiality Policy Acknowledgment. The second signer role is now Program Lead, fixed
-- to the Owner's account, so Prepare and send pre-fills it and the Owner signs in the app.
-- Data only: one template row, its version bumped so requests record which roles they used.
-- Requests already sent keep template_version 1 and are moved one by one in the app
-- (Signature requests > Reassign to me). Safe to re-run: a row already reading Program
-- Lead is unchanged. Checks: db/audit/sig_template_program_lead_checks.sql.

UPDATE public.sig_templates t
SET signer_roles = (
      SELECT jsonb_agg(
               CASE WHEN r->>'key' = 'r2'
                    THEN r || jsonb_build_object('label', 'Program Lead', 'defaultName', 'Jester Lloyd Bautista', 'defaultEmail', 'JesterLloyd.Bautista@cshs.org')
                    ELSE r END
               ORDER BY o)
      FROM jsonb_array_elements(t.signer_roles) WITH ORDINALITY AS e(r, o)),
    version = t.version + 1,
    updated_at = now()
WHERE t.id = '4cb7fb1b-4557-487d-9b4b-078615462053'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.signer_roles) r WHERE r->>'key' = 'r2' AND r->>'label' IS DISTINCT FROM 'Program Lead');

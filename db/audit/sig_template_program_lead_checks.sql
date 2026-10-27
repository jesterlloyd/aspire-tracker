-- REASSIGN-1 (Owner, 2026-10-27): the CSMC Experience Confidentiality Policy Acknowledgment
-- template's second signer role becomes Program Lead, fixed to the Owner, so every new send
-- runs student, then the Program Lead, then sealed copies. Read-only. Run PRE before
-- db/maintenance/sig_template_program_lead_20261027.sql and POST after it.

-- PRE 1 / POST 1: the template's roles as stored (expect r2 label Witness before, Program Lead after).
SELECT id, version, status,
       (SELECT jsonb_agg(jsonb_build_object('key', r->>'key', 'label', r->>'label', 'defaultName', r->>'defaultName', 'defaultEmail', r->>'defaultEmail', 'type', r->>'type') ORDER BY o)
          FROM jsonb_array_elements(signer_roles) WITH ORDINALITY AS t(r, o)) AS roles
FROM public.sig_templates
WHERE id = '4cb7fb1b-4557-487d-9b4b-078615462053';

-- PRE 2 / POST 2: the Owner account the role is fixed to (expect one active owner row).
SELECT id, email, full_name, role, is_active
FROM public.user_profiles
WHERE id = 'cacd1576-6a34-416d-9386-9cd1e59a2ab3';

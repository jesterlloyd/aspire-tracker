-- ORGANIZATION-SETTINGS-3: separate the Nightfall footer logo from the header logo.
BEGIN;

ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS footer_logo_path text;

COMMIT;

-- ORGANIZATION-SETTINGS-1: canonical tenant branding and public contact data.
-- This deployment has one organization today; the primary key is deliberately a
-- UUID so a future workspace/tenant relationship can be added without renaming data.
BEGIN;

CREATE TABLE IF NOT EXISTS public.organization_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL CHECK (btrim(display_name) <> '' AND char_length(display_name) <= 200),
  header_short_name text NOT NULL CHECK (btrim(header_short_name) <> '' AND char_length(header_short_name) <= 100),
  legal_name text,
  logo_alt_text text NOT NULL DEFAULT 'Organization logo',
  header_logo_path text,
  document_logo_path text,
  address_line_1 text NOT NULL DEFAULT '',
  address_line_2 text,
  city text NOT NULL DEFAULT '',
  state_province text NOT NULL DEFAULT '',
  postal_code text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT 'United States',
  main_phone text NOT NULL DEFAULT '',
  general_email text NOT NULL CHECK (general_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  website text,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.organization_settings (
  display_name, header_short_name, legal_name, logo_alt_text,
  address_line_1, city, state_province, postal_code, country,
  main_phone, general_email, website
)
SELECT
  'Cedars-Sinai', 'Cedars-Sinai', 'Cedars-Sinai Medical Center', 'Cedars-Sinai logo',
  '8700 Beverly Blvd', 'Los Angeles', 'CA', '90048', 'United States',
  '310-423-3277', 'aspire@cshs.org', 'https://www.cedars-sinai.org'
WHERE NOT EXISTS (SELECT 1 FROM public.organization_settings);

ALTER TABLE public.organization_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_settings FROM anon, authenticated;

DO $bucket$
BEGIN
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('organization-branding', 'organization-branding', true)
  ON CONFLICT (id) DO UPDATE SET public = true;
EXCEPTION WHEN undefined_table THEN NULL;
END
$bucket$;

NOTIFY pgrst, 'reload schema';
COMMIT;

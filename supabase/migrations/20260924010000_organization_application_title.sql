-- ORGANIZATION-SETTINGS-2: use the existing header field as the exact application title.
BEGIN;

UPDATE public.organization_settings
SET header_short_name = 'ASPIRE Intelligence'
WHERE header_short_name = 'Cedars-Sinai';

COMMIT;

-- SIGNATURES-PHASE2 (ASPIRE Catalog Phase 2), 2026-09-23. OWNER-GATED: do not apply from a session.
--
-- ASPIRE's own e-signature engine inside the Catalog, behind the feature flag
-- `catalog.signatures`, which this migration creates OFF. Nothing here is reachable by a
-- signer or a staff member until the Owner turns the flag on (section 1), and the brief
-- keeps it off in production until Legal and IT sign off.
--
-- What this adds, all additive:
--   1. organizations + feature_flags: one organization for now (the product will serve
--      more than one); the flag table the Catalog reads.
--   2. sig_settings: per-organization seal provider (which certificate signs, by name, no
--      secret), RFC 3161 timestamp authority URL, time zone, current disclosure version.
--   3. sig_disclosures: the consent-to-electronic-records text, versioned per organization.
--   4. sig_templates, sig_bulk_sends, sig_requests, sig_request_signers, sig_field_values,
--      sig_events (append-only, hash-chained by a trigger, UPDATE and DELETE refused).
--   5. The private 'signature-documents' bucket.
--
-- Every new table carries org_id and its read policy requires the caller's organization
-- (sig_caller_org_id(), which returns the single organization today). Writes are the
-- service role only, through endpoints that verify the caller or the signer's token.
--
-- Checks: db/audit/signatures_phase2_checks.sql. Rollback: end of file.

BEGIN;

-- ── 1. Organizations and feature flags ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organizations (
  id          uuid        PRIMARY KEY,
  slug        text        NOT NULL UNIQUE,
  name        text        NOT NULL,
  time_zone   text        NOT NULL DEFAULT 'America/Los_Angeles',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- The one organization today. The id is fixed so code and every default agree on it.
INSERT INTO organizations (id, slug, name, time_zone)
VALUES ('a5f1e000-0000-4000-8000-000000000001', 'cedars-sinai-aspire', 'Cedars-Sinai ASPIRE', 'America/Los_Angeles')
ON CONFLICT (id) DO NOTHING;

-- The caller's organization. One organization today; when a second customer arrives this
-- becomes a lookup on the caller's membership, and every policy below follows it.
CREATE OR REPLACE FUNCTION public.sig_caller_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$ SELECT 'a5f1e000-0000-4000-8000-000000000001'::uuid $$;

REVOKE ALL ON FUNCTION public.sig_caller_org_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sig_caller_org_id() TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS feature_flags (
  org_id      uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key         text        NOT NULL,
  state       text        NOT NULL DEFAULT 'off',
  updated_by  uuid        REFERENCES user_profiles(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, key),
  -- off: hidden from everyone. owner: visible to the Owner only, for testing in
  -- production before sign-off. on: visible to every Owner and Admin.
  CONSTRAINT chk_feature_flags_state CHECK (state IN ('off', 'owner', 'on'))
);

INSERT INTO feature_flags (org_id, key, state)
VALUES ('a5f1e000-0000-4000-8000-000000000001', 'catalog.signatures', 'off')
ON CONFLICT (org_id, key) DO NOTHING;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "organizations_staff_read" ON organizations;
CREATE POLICY "organizations_staff_read" ON organizations FOR SELECT TO authenticated
  USING (id = public.sig_caller_org_id() AND public.is_staff());

DROP POLICY IF EXISTS "feature_flags_staff_read" ON feature_flags;
CREATE POLICY "feature_flags_staff_read" ON feature_flags FOR SELECT TO authenticated
  USING (org_id = public.sig_caller_org_id() AND public.is_staff());


-- ── 2. Signature settings (no secrets here: the provider reads its own) ─────────

CREATE TABLE IF NOT EXISTS sig_settings (
  org_id                      uuid        PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  -- Which certificate signs the seal. 'env_p12': a PKCS#12 file in the server's
  -- environment (SIG_SEAL_P12_BASE64, SIG_SEAL_P12_PASSPHRASE). A key-vault provider
  -- names itself here and keeps its non-secret coordinates in seal_provider_config.
  seal_provider               text        NOT NULL DEFAULT 'env_p12',
  seal_provider_config        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- RFC 3161 trusted timestamp on every seal.
  tsa_url                     text        NOT NULL DEFAULT 'http://timestamp.digicert.com',
  tsa_name                    text        NOT NULL DEFAULT 'DigiCert Timestamp Authority',
  time_zone                   text        NOT NULL DEFAULT 'America/Los_Angeles',
  current_disclosure_version  text        NOT NULL DEFAULT '1.0',
  code_ttl_minutes            integer     NOT NULL DEFAULT 10,
  code_max_attempts           integer     NOT NULL DEFAULT 5,
  updated_by                  uuid        REFERENCES user_profiles(id) ON DELETE SET NULL,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_sig_settings_tsa_url CHECK (tsa_url ~ '^https?://'),
  CONSTRAINT chk_sig_settings_provider_config CHECK (jsonb_typeof(seal_provider_config) = 'object')
);

INSERT INTO sig_settings (org_id) VALUES ('a5f1e000-0000-4000-8000-000000000001')
ON CONFLICT (org_id) DO NOTHING;

ALTER TABLE sig_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sig_settings_owner_admin_read" ON sig_settings;
CREATE POLICY "sig_settings_owner_admin_read" ON sig_settings FOR SELECT TO authenticated
  USING (org_id = public.sig_caller_org_id() AND public.is_active_owner_or_admin());


-- ── 3. Consent disclosures, versioned ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sig_disclosures (
  org_id      uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version     text        NOT NULL,
  title       text        NOT NULL,
  body        jsonb       NOT NULL,   -- { intro, points: [..], paper_copy_contact }
  created_by  uuid        REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, version)
);

-- v1.0: the brief's six points, in plain words. DRAFT for Legal review (section 10).
INSERT INTO sig_disclosures (org_id, version, title, body)
VALUES ('a5f1e000-0000-4000-8000-000000000001', '1.0', 'Consent to electronic records and signatures',
  jsonb_build_object(
    'intro', 'Before you sign, please read this. It covers this document only.',
    'points', jsonb_build_array(
      'You may ask for a paper copy of this document instead, at no cost. Use Request a paper copy, or contact the sender.',
      'You may withdraw this consent before you sign by choosing Decline to sign. The sender is told, and nothing you entered is kept. Declining does not affect documents you already signed.',
      'This consent applies to this document only.',
      'To change the email address this document is sent to, contact the sender.',
      'After you sign, you can download your copy, and every party receives the sealed copy by email. You may also ask the sender for a paper copy after signing, at no cost.',
      'You need a current web browser and a way to open PDF files.'),
    'paper_copy_contact', 'the sender'))
ON CONFLICT (org_id, version) DO NOTHING;

ALTER TABLE sig_disclosures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sig_disclosures_owner_admin_read" ON sig_disclosures;
CREATE POLICY "sig_disclosures_owner_admin_read" ON sig_disclosures FOR SELECT TO authenticated
  USING (org_id = public.sig_caller_org_id() AND public.is_active_owner_or_admin());


-- ── 4. Templates, requests, signers, values, events ─────────────────────────────

CREATE TABLE IF NOT EXISTS sig_templates (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid        NOT NULL DEFAULT 'a5f1e000-0000-4000-8000-000000000001' REFERENCES organizations(id),
  catalog_resource_id  uuid        REFERENCES catalog_resources(id) ON DELETE SET NULL,
  name                 text        NOT NULL,
  document_type        text        NOT NULL,
  excluded_type_confirmed_by uuid  REFERENCES user_profiles(id) ON DELETE SET NULL,
  source_path          text        NOT NULL,           -- in 'signature-documents'
  source_sha256        text        NOT NULL,
  page_count           integer     NOT NULL,
  page_sizes           jsonb       NOT NULL DEFAULT '[]'::jsonb,   -- [{w,h}] in PDF points
  fields               jsonb       NOT NULL DEFAULT '[]'::jsonb,
  signer_roles         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  signing_order        text        NOT NULL DEFAULT 'sequential',
  retention_days       integer     NOT NULL DEFAULT 2555,          -- 7 years
  legal_hold           boolean     NOT NULL DEFAULT false,
  version              integer     NOT NULL DEFAULT 1,
  status               text        NOT NULL DEFAULT 'draft',
  created_by           uuid        REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_sig_templates_status CHECK (status IN ('draft', 'active', 'archived')),
  CONSTRAINT chk_sig_templates_order CHECK (signing_order IN ('sequential', 'parallel')),
  CONSTRAINT chk_sig_templates_retention CHECK (retention_days >= 1)
);

CREATE TABLE IF NOT EXISTS sig_bulk_sends (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid        NOT NULL DEFAULT 'a5f1e000-0000-4000-8000-000000000001' REFERENCES organizations(id),
  template_id          uuid        REFERENCES sig_templates(id) ON DELETE SET NULL,
  title                text        NOT NULL,
  audience_label       text,
  sender_id            uuid        REFERENCES user_profiles(id) ON DELETE SET NULL,
  sent_at              timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz,
  is_demo              boolean     NOT NULL DEFAULT false
  -- Counts are never stored: they are computed from the child requests.
);

CREATE TABLE IF NOT EXISTS sig_requests (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid        NOT NULL DEFAULT 'a5f1e000-0000-4000-8000-000000000001' REFERENCES organizations(id),
  template_id          uuid        REFERENCES sig_templates(id) ON DELETE SET NULL,
  template_version     integer,
  catalog_resource_id  uuid        REFERENCES catalog_resources(id) ON DELETE SET NULL,
  parent_bulk_id       uuid        REFERENCES sig_bulk_sends(id) ON DELETE SET NULL,
  envelope_code        text        NOT NULL UNIQUE,
  title                text        NOT NULL,
  document_type        text        NOT NULL,
  mode                 text        NOT NULL DEFAULT 'one',
  signing_order        text        NOT NULL DEFAULT 'sequential',
  status               text        NOT NULL DEFAULT 'draft',
  sender_id            uuid        REFERENCES user_profiles(id) ON DELETE SET NULL,
  sender_name          text,
  sender_email         text,
  subject              text,
  message              text,
  reminder_rule        text        NOT NULL DEFAULT 'every_3_days',
  expires_at           timestamptz,
  due_at               timestamptz,                        -- overdue = past due and not completed (computed, never stored)
  sent_at              timestamptz,
  completed_at         timestamptz,
  voided_at            timestamptz,
  void_reason          text,
  fields               jsonb       NOT NULL DEFAULT '[]'::jsonb,   -- snapshot of the template's fields at send
  draft_state          jsonb,                              -- an unsent request: the editor's state, no signers, no events
  page_sizes           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  document_path        text,                               -- the PDF the signers see
  original_sha256      text,
  sealed_path          text,
  sealed_sha256        text,
  seal_timestamp       jsonb,                              -- { gen_time, tsa_url, tsa_name, serial, policy }
  seal_attempts        integer     NOT NULL DEFAULT 0,
  retention_until      timestamptz,
  legal_hold           boolean     NOT NULL DEFAULT false,
  is_demo              boolean     NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_sig_requests_mode CHECK (mode IN ('one', 'each')),
  CONSTRAINT chk_sig_requests_order CHECK (signing_order IN ('sequential', 'parallel')),
  CONSTRAINT chk_sig_requests_status CHECK (status IN
    ('draft', 'sent', 'opened', 'progress', 'completed', 'declined', 'voided', 'expired')),
  CONSTRAINT chk_sig_requests_reminder CHECK (reminder_rule IN ('every_3_days', 'once_before_expiry', 'off'))
);

CREATE INDEX IF NOT EXISTS idx_sig_requests_status ON sig_requests (org_id, status, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_sig_requests_bulk   ON sig_requests (parent_bulk_id) WHERE parent_bulk_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sig_request_signers (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid        NOT NULL DEFAULT 'a5f1e000-0000-4000-8000-000000000001' REFERENCES organizations(id),
  request_id           uuid        NOT NULL REFERENCES sig_requests(id) ON DELETE CASCADE,
  role_key             text        NOT NULL,           -- which template role this person fills (r1, r2, ...)
  order_index          integer     NOT NULL,
  recipient_type       text        NOT NULL DEFAULT 'signer',
  name                 text        NOT NULL,
  email                text        NOT NULL,
  phone                text,
  student_id           uuid        REFERENCES students(id) ON DELETE SET NULL,
  contact_id           uuid        REFERENCES contacts(id) ON DELETE SET NULL,
  school_name          text,
  user_profile_id      uuid        REFERENCES user_profiles(id) ON DELETE SET NULL,  -- a staff signer
  color                text        NOT NULL DEFAULT 'plum',
  status               text        NOT NULL DEFAULT 'pending',
  access_token_hash    text        UNIQUE,              -- SHA-256 of the derived link token
  link_version         integer     NOT NULL DEFAULT 1,  -- bump to retire every earlier link
  session_hash         text,                            -- SHA-256 of the post-code session
  session_expires_at   timestamptz,
  code_hash            text,
  code_expires_at      timestamptz,
  code_attempts        integer     NOT NULL DEFAULT 0,
  code_sends           integer     NOT NULL DEFAULT 0,
  code_sent_to         text,                              -- masked
  verified_at          timestamptz,
  verify_method        text,
  sample_pdf_opened_at timestamptz,
  consent_version      text,
  consented_at         timestamptz,
  opened_at            timestamptz,
  signed_at            timestamptz,
  declined_at          timestamptz,
  decline_reason       text,
  adopted_signature    jsonb,                             -- { kind: 'type'|'draw', text, initials, svg }
  completed_copy_sent_at timestamptz,
  notified_at          timestamptz,                       -- when their turn's email went out
  last_reminded_at     timestamptz,
  reminder_count       integer     NOT NULL DEFAULT 0,
  delegation           jsonb,                             -- { name, email, reason, requested_at, status }
  paper_copy_requested_at timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_sig_signers_type CHECK (recipient_type IN ('signer', 'viewer', 'cc')),
  CONSTRAINT chk_sig_signers_status CHECK (status IN
    ('pending', 'sent', 'delivered', 'verified', 'consented', 'opened', 'signed', 'declined', 'completed_copy_sent', 'replaced')),
  CONSTRAINT chk_sig_signers_color CHECK (color IN ('plum', 'teal', 'navy', 'amber', 'green', 'slate'))
);

CREATE INDEX IF NOT EXISTS idx_sig_signers_request ON sig_request_signers (request_id, order_index);
CREATE INDEX IF NOT EXISTS idx_sig_signers_user    ON sig_request_signers (user_profile_id) WHERE user_profile_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sig_field_values (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL DEFAULT 'a5f1e000-0000-4000-8000-000000000001' REFERENCES organizations(id),
  request_id  uuid        NOT NULL REFERENCES sig_requests(id) ON DELETE CASCADE,
  field_id    text        NOT NULL,
  signer_id   uuid        REFERENCES sig_request_signers(id) ON DELETE CASCADE,   -- NULL: filled by the sender
  value       text        NOT NULL,
  filled_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, field_id)
);

CREATE TABLE IF NOT EXISTS sig_events (
  id          bigserial   PRIMARY KEY,
  org_id      uuid        NOT NULL DEFAULT 'a5f1e000-0000-4000-8000-000000000001' REFERENCES organizations(id),
  request_id  uuid        NOT NULL REFERENCES sig_requests(id) ON DELETE RESTRICT,
  signer_id   uuid        REFERENCES sig_request_signers(id) ON DELETE RESTRICT,
  type        text        NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  actor       text,
  ip          text,
  user_agent  text,
  details     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  prev_hash   text,
  hash        text
);

CREATE INDEX IF NOT EXISTS idx_sig_events_request ON sig_events (request_id, id);

-- The chain: each event's hash covers the previous event's hash for the same request,
-- computed here so no caller can supply or skip one. The advisory lock serializes
-- inserts per request so two concurrent events cannot fork the chain.
CREATE OR REPLACE FUNCTION public.sig_events_chain()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  prior text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.request_id::text, 0));
  SELECT hash INTO prior FROM sig_events WHERE request_id = NEW.request_id ORDER BY id DESC LIMIT 1;
  NEW.at := coalesce(NEW.at, now());
  NEW.prev_hash := coalesce(prior, 'GENESIS');
  NEW.hash := encode(sha256(convert_to(
    NEW.prev_hash || '|' || NEW.request_id::text || '|' || coalesce(NEW.signer_id::text, '') || '|' ||
    NEW.type || '|' || to_char(NEW.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' ||
    coalesce(NEW.actor, '') || '|' || coalesce(NEW.ip, '') || '|' || coalesce(NEW.user_agent, '') || '|' ||
    NEW.details::text, 'UTF8')), 'hex');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sig_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'sig_events is append-only: % refused', TG_OP USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_sig_events_chain ON sig_events;
CREATE TRIGGER trg_sig_events_chain BEFORE INSERT ON sig_events
  FOR EACH ROW EXECUTE FUNCTION public.sig_events_chain();

DROP TRIGGER IF EXISTS trg_sig_events_append_only ON sig_events;
CREATE TRIGGER trg_sig_events_append_only BEFORE UPDATE OR DELETE ON sig_events
  FOR EACH ROW EXECUTE FUNCTION public.sig_events_append_only();

-- TRUNCATE is a statement, not a row: refuse it too.
DROP TRIGGER IF EXISTS trg_sig_events_no_truncate ON sig_events;
CREATE TRIGGER trg_sig_events_no_truncate BEFORE TRUNCATE ON sig_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.sig_events_append_only();

-- Read policies: Owner/Admin of the caller's organization. No client write policy.
ALTER TABLE sig_templates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sig_bulk_sends       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sig_requests         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sig_request_signers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sig_field_values     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sig_events           ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sig_templates', 'sig_bulk_sends', 'sig_requests', 'sig_request_signers', 'sig_field_values', 'sig_events']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner_admin_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (org_id = public.sig_caller_org_id() AND public.is_active_owner_or_admin())',
      t || '_owner_admin_read', t);
  END LOOP;
END $$;

-- Private bucket, no storage.objects policy: only the service role reads or writes it,
-- and the app has no delete or overwrite path for a sealed file.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('signature-documents', 'signature-documents', false, 26214400, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Turning the feature on (Owner, after review) ─────────────────────────────────
--   Owner only, for testing in production:
--     UPDATE feature_flags SET state = 'owner', updated_at = now()
--      WHERE org_id = 'a5f1e000-0000-4000-8000-000000000001' AND key = 'catalog.signatures';
--   Everyone (after Legal and IT sign-off): the same with state = 'on'.
--   Off again: state = 'off'.
--
-- ── Rollback (run as one block; loses every signature request and its audit trail) ──
-- BEGIN;
--   DROP TRIGGER IF EXISTS trg_sig_events_no_truncate ON sig_events;
--   DROP TRIGGER IF EXISTS trg_sig_events_append_only ON sig_events;
--   DROP TRIGGER IF EXISTS trg_sig_events_chain ON sig_events;
--   DROP TABLE IF EXISTS sig_events, sig_field_values, sig_request_signers, sig_requests,
--     sig_bulk_sends, sig_templates, sig_disclosures, sig_settings, feature_flags;
--   DROP FUNCTION IF EXISTS public.sig_events_append_only(), public.sig_events_chain(), public.sig_caller_org_id();
--   DROP TABLE IF EXISTS organizations;
--   -- The bucket is left in place on purpose: delete its objects by hand first if it must go.
-- COMMIT;

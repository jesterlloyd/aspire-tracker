-- ============================================================
-- ASPIRE Intelligence — Contacts Table
-- ============================================================
--
-- Phase 1: foundation for managing external contact relationships.
-- Seeded with 6 school placement coordinators.
-- Phase 2 (future): migrate unit_leaders, executives, BNI NPD-Ps.
--
-- HOW TO RUN: paste into Supabase SQL Editor.
-- All statements use IF NOT EXISTS / ON CONFLICT DO NOTHING.
-- Safe to re-run.
-- ============================================================


-- ── Contacts table ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  full_name       TEXT NOT NULL,
  preferred_name  TEXT,
  email           TEXT,
  phone           TEXT,

  -- Affiliation
  organization    TEXT NOT NULL,
  role            TEXT NOT NULL,             -- e.g. 'School Coordinator', 'Unit Leader', 'Executive'
  role_qualifier  TEXT,                      -- e.g. 'Primary', 'CC-only'
  school_name     TEXT,                      -- canonical match to students.school
  program_type    TEXT,                      -- NULL = catch-all for the school; non-null = specific program route
  unit_name       TEXT,                      -- for future Unit Leader contacts
  related_units   TEXT[],                    -- supplemental unit associations

  -- Status
  is_active BOOLEAN DEFAULT TRUE,

  -- Notification preferences
  notification_preferences JSONB DEFAULT '{"weekly_digest": true, "transactional": true}'::JSONB,

  -- CRM-lite tracking
  last_contacted_at      TIMESTAMPTZ,
  last_contact_type      TEXT,
  last_contact_summary   TEXT,

  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contacts_organization     ON contacts(organization);
CREATE INDEX IF NOT EXISTS idx_contacts_role             ON contacts(role);
CREATE INDEX IF NOT EXISTS idx_contacts_school_program   ON contacts(school_name, program_type)
  WHERE role = 'School Coordinator';

DROP TRIGGER IF EXISTS set_updated_at_contacts ON contacts;
CREATE TRIGGER set_updated_at_contacts
  BEFORE UPDATE ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contacts_authenticated_select" ON contacts;
DROP POLICY IF EXISTS "contacts_authenticated_insert" ON contacts;
DROP POLICY IF EXISTS "contacts_authenticated_update" ON contacts;
DROP POLICY IF EXISTS "contacts_authenticated_delete" ON contacts;

CREATE POLICY "contacts_authenticated_select"
  ON contacts FOR SELECT TO authenticated USING (true);
CREATE POLICY "contacts_authenticated_insert"
  ON contacts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "contacts_authenticated_update"
  ON contacts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "contacts_authenticated_delete"
  ON contacts FOR DELETE TO authenticated USING (true);

-- Service role for cron / API functions
CREATE POLICY "contacts_service_role_all"
  ON contacts FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ── Add contact_id to notification_log ───────────────────────────────────────
-- Allows the digest dedup query to filter by (contact_id, notification_type, window_start).

ALTER TABLE notification_log
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notification_log_contact
  ON notification_log(contact_id, notification_type, sent_at DESC);


-- ── Seed: 6 school placement coordinators ────────────────────────────────────
--
-- school_name values must exactly match what is stored in students.school.
-- program_type = NULL means catch-all for any program at that school.
-- For Cal State LA: Alyssa handles ABSN; Marissa is the NULL catch-all.
--
-- WCU: Joelene Balatero (Anaheim) and Tony Kim (NoHo) are the primary
-- coordinator recipients for the weekly digest; Rena Youssef and Silvia
-- St George remain in recipients.js as CC recipients for transactional sends.

INSERT INTO contacts (
  full_name, email, organization, role,
  school_name, program_type, notes
) VALUES
  (
    'Susan Hunter',
    'shunter@apu.edu',
    'Azusa Pacific University',
    'School Coordinator',
    'Azusa Pacific University',
    NULL,
    'Clinical Placement Coordinator, College of Nursing and Health Sciences. Covers all APU pre-licensure programs.'
  ),
  (
    'Alyssa Manlangit',
    'amanlan3@calstatela.edu',
    'Cal State LA',
    'School Coordinator',
    'Cal State LA',
    'Accelerated BSN',
    'ABSN program coordinator. Routes students with program_type = ''Accelerated BSN''.'
  ),
  (
    'Marissa Grafil Ramirez',
    'Marissa.Ramirez119@calstatela.edu',
    'Cal State LA',
    'School Coordinator',
    'Cal State LA',
    NULL,
    'BSN Clinical Placement & Contracts. Catch-all coordinator for all non-ABSN Cal State LA programs.'
  ),
  (
    'Lucy Van Otterloo',
    'Lucy.VanOtterloo@csulb.edu',
    'Cal State Long Beach',
    'School Coordinator',
    'Cal State Long Beach',
    NULL,
    'Professor, School of Nursing. Covers all CSULB pre-licensure programs.'
  ),
  (
    'Joelene Balatero',
    'jbalatero@westcoastuniversity.edu',
    'West Coast University Anaheim',
    'School Coordinator',
    'West Coast University Anaheim',
    NULL,
    'Manager, Clinical Faculty. Primary digest recipient for WCU Anaheim.'
  ),
  (
    'Tony Kim',
    'ToKim@westcoastuniversity.edu',
    'West Coast University North Hollywood',
    'School Coordinator',
    'West Coast University North Hollywood',
    NULL,
    'Manager, Clinical Faculty. Primary digest recipient for WCU North Hollywood.'
  )
ON CONFLICT DO NOTHING;


-- ── Verification queries ──────────────────────────────────────────────────────

-- Confirm 6 rows seeded:
-- SELECT full_name, school_name, program_type, email FROM contacts
--   WHERE role = 'School Coordinator' ORDER BY school_name, program_type NULLS LAST;

-- Confirm contact_id column added:
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'notification_log' AND column_name = 'contact_id';

NOTIFY pgrst, 'reload schema';

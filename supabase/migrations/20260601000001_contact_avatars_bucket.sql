-- =============================================================================
-- ASPIRE Connect: contact-avatars Storage bucket
-- Migration: 20260601000001_contact_avatars_bucket
-- =============================================================================
--
-- Creates the contact-avatars Storage bucket for contact profile photos.
-- Public read (URLs are embedded in the contacts table as avatar_url).
-- Write restricted to owner and admin roles via user_profiles.role check.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute.
-- Idempotent: bucket INSERT uses ON CONFLICT DO NOTHING.
-- =============================================================================

-- ── 1. Create the bucket ─────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contact-avatars',
  'contact-avatars',
  true,              -- public: URLs are embedded directly in avatar_url column
  2097152,           -- 2 MB max per file (matches client-side validation)
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;


-- ── 2. Public read policy ─────────────────────────────────────────────────────
-- Allows anyone (anon + authenticated) to read contact avatar images.
-- Required because avatar_url is stored as a public URL in the contacts table.

DROP POLICY IF EXISTS "contact-avatars-public-read" ON storage.objects;
CREATE POLICY "contact-avatars-public-read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'contact-avatars');


-- ── 3. Owner/admin upload policy ─────────────────────────────────────────────
-- Only users whose user_profiles.role is 'owner' or 'admin' may upload.
-- This mirrors the authorization check in api/contacts-upsert.js.

DROP POLICY IF EXISTS "contact-avatars-owner-admin-insert" ON storage.objects;
CREATE POLICY "contact-avatars-owner-admin-insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'contact-avatars'
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE auth_user_id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  );


-- ── 4. Owner/admin update policy ─────────────────────────────────────────────
-- Allows upsert (upload with { upsert: true }) for existing files.

DROP POLICY IF EXISTS "contact-avatars-owner-admin-update" ON storage.objects;
CREATE POLICY "contact-avatars-owner-admin-update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'contact-avatars'
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE auth_user_id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  );


-- ── 5. Reload schema cache ────────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';

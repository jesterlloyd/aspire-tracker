-- Checks for supabase/migrations/20260915000000_ngrp_outcome_cs_email.sql
-- Read-only. Run each numbered section on its own in the Supabase SQL editor.

-- ── PRE 1: the table exists and the column does not ──────────────────────────
-- Expect: table = true, cs_email_exists = false
SELECT to_regclass('public.ngrp_residency_outcomes') IS NOT NULL AS "table",
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'ngrp_residency_outcomes'
                  AND column_name = 'cs_email') AS cs_email_exists;

-- ── POST 1: the column exists, nullable text ─────────────────────────────────
-- Expect: one row, data_type = text, is_nullable = YES
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'ngrp_residency_outcomes' AND column_name = 'cs_email';

-- ── POST 2: the shape CHECK is in force ──────────────────────────────────────
-- Expect: one row mentioning cs_email
SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conrelid = 'public.ngrp_residency_outcomes'::regclass
   AND pg_get_constraintdef(oid) LIKE '%cs_email%';

-- ── POST 3: nothing recorded yet, and every hire that still needs one ────────
-- Expect: with_cs_email = 0; hired_without names the residents to fill in
SELECT count(*) FILTER (WHERE cs_email IS NOT NULL) AS with_cs_email,
       count(*) FILTER (WHERE hired_at IS NOT NULL AND cs_email IS NULL) AS hired_without
  FROM public.ngrp_residency_outcomes;

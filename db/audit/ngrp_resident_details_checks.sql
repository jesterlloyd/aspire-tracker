-- Checks for supabase/migrations/20260919000000_ngrp_resident_details.sql
-- Read-only. Run each numbered section on its own in the Supabase SQL editor.

-- ── PRE 1: the table exists; none of the three columns does yet ──────────────
-- Expect: outcomes true, position_title false, preceptor_name false, phone false
SELECT to_regclass('public.ngrp_residency_outcomes') IS NOT NULL AS outcomes,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                AND table_name = 'ngrp_residency_outcomes' AND column_name = 'position_title') AS position_title,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                AND table_name = 'ngrp_residency_outcomes' AND column_name = 'preceptor_name') AS preceptor_name,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                AND table_name = 'ngrp_residency_outcomes' AND column_name = 'phone') AS phone;

-- ── POST 1: the three columns exist, nullable text ───────────────────────────
-- Expect: three rows (phone, position_title, preceptor_name), each text, YES
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'ngrp_residency_outcomes'
   AND column_name IN ('position_title', 'preceptor_name', 'phone')
 ORDER BY column_name;

-- ── POST 2: each column carries its nonblank-and-length CHECK ─────────────────
-- Expect: three rows, one definition naming each of phone (40),
--         position_title (120) and preceptor_name (200)
SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conrelid = 'public.ngrp_residency_outcomes'::regclass
   AND contype = 'c'
   AND (pg_get_constraintdef(oid) LIKE '%position_title%'
     OR pg_get_constraintdef(oid) LIKE '%preceptor_name%'
     OR pg_get_constraintdef(oid) LIKE '%phone%')
 ORDER BY conname;

-- ── POST 3: grants unchanged, nothing recorded yet ───────────────────────────
-- Expect: delete_revoked false (DELETE stays revoked from service_role),
--         titles 0, preceptors 0, phones 0
SELECT has_table_privilege('service_role', 'public.ngrp_residency_outcomes', 'DELETE') AS delete_revoked,
       (SELECT count(*) FROM public.ngrp_residency_outcomes WHERE position_title IS NOT NULL) AS titles,
       (SELECT count(*) FROM public.ngrp_residency_outcomes WHERE preceptor_name IS NOT NULL) AS preceptors,
       (SELECT count(*) FROM public.ngrp_residency_outcomes WHERE phone IS NOT NULL)          AS phones;

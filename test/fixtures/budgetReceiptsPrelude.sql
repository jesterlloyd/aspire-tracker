-- test/fixtures/budgetReceiptsPrelude.sql
-- The tables Program Budget's Phase B migration builds on, cut to the columns it touches, so the
-- real migration runs on PGlite (test/budgetReceipts.test.mjs). Not a migration; never applied.
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $f$;
CREATE OR REPLACE FUNCTION public.append_only_refuse() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501'; END $f$;
CREATE TABLE public.organizations (id uuid PRIMARY KEY);
INSERT INTO public.organizations VALUES ('a5f1e000-0000-4000-8000-000000000001');
CREATE TABLE public.user_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id uuid, full_name text, email text, role text, is_owner boolean, is_active boolean DEFAULT true, created_at timestamptz DEFAULT now());
CREATE TABLE public.cohorts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, is_demo boolean DEFAULT false, created_at timestamptz DEFAULT now());
CREATE TABLE public.students (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cohort_id uuid, status text, is_demo boolean DEFAULT false);
CREATE TABLE public.user_role_grants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role text NOT NULL);
-- record_documents as 20260926000000_catalog_revamp_1.sql made it.
CREATE TABLE public.record_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subject_type text NOT NULL, student_id uuid REFERENCES public.students(id) ON DELETE CASCADE,
  school_name text, title text NOT NULL, file_name text NOT NULL, storage_path text NOT NULL UNIQUE, content_type text, size_bytes bigint,
  source text NOT NULL, source_ref uuid, is_demo boolean NOT NULL DEFAULT false, created_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_record_documents_subject CHECK ((subject_type = 'student' AND student_id IS NOT NULL AND school_name IS NULL) OR (subject_type = 'school' AND school_name IS NOT NULL AND student_id IS NULL)),
  CONSTRAINT chk_record_documents_source CHECK (source IN ('catalog_move', 'staff_upload', 'form_submission', 'signature'))
);
ALTER TABLE public.record_documents ENABLE ROW LEVEL SECURITY;
-- keith_skills, keith_requests and keith_skill_invocations as 20260805000001 made them (the columns used here).
CREATE TABLE public.keith_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, display_name text NOT NULL, description text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'draft', enabled boolean NOT NULL DEFAULT false,
  allowed_roles text[] NOT NULL DEFAULT '{}', required_tools text[] NOT NULL DEFAULT '{}', required_data text[] NOT NULL DEFAULT '{}',
  trigger_phrases text[] NOT NULL DEFAULT '{}', data_classification text NOT NULL DEFAULT 'internal', model_route text NOT NULL DEFAULT 'default',
  io_contract jsonb NOT NULL DEFAULT '{}'::jsonb, instruction_body text NOT NULL DEFAULT '', owner_label text NOT NULL DEFAULT 'ASPIRE', provenance text NOT NULL DEFAULT '',
  CONSTRAINT keith_skills_no_viewer CHECK (NOT ('viewer' = ANY (allowed_roles)))
);
CREATE TABLE public.keith_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id text, profile_id uuid, role text, intent text, skill_id uuid, skill_version integer, model text, model_route text, rounds integer, input_tokens integer, output_tokens integer, duration_ms integer, outcome text, rate_limited boolean, created_at timestamptz DEFAULT now());
CREATE TABLE public.keith_skill_invocations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), skill_id uuid, skill_slug text, skill_version integer, request_id text, invoked_by uuid, invoked_role text, cohort_id uuid, student_id uuid, invocation_mode text, data_sources jsonb, outcome text, denial_reason text, model text, input_tokens integer, output_tokens integer, duration_ms integer, created_at timestamptz DEFAULT now());

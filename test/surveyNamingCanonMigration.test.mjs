// SURVEY-NAMING-CANON-V3: the governed Knowledge Center entry must stay aligned
// with the Owner-approved survey names and current Review & Release semantics.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const here = dirname(fileURLToPath(import.meta.url))
const migration = readFileSync(join(here, '..', 'supabase/migrations/20261026000002_survey_naming_canon_v3.sql'), 'utf8')

test('the migration targets only the existing active survey naming canon', () => {
  assert.match(migration, /WHERE slug = 'aspire-survey-naming-canon'/)
  assert.match(migration, /IF v_entry\.state <> 'active'/)
  assert.match(migration, /a pending revision already exists/)
  assert.doesNotMatch(migration, /UPDATE\s+public\.knowledge_entries/i,
    'the migration must not bypass governed lifecycle history')
})

test('the migration applies a full governed revision and preserves version history', () => {
  assert.match(migration, /INSERT INTO public\.knowledge_revisions/)
  assert.match(migration, /PERFORM public\.governance_apply_knowledge_revision\(v_entry\.id, v_actor_id\)/)
  assert.match(migration, /body_format,[\s\S]*aliases,[\s\S]*tags,[\s\S]*review_date,[\s\S]*confidence/)
  assert.match(migration, /'markdown'/)
  assert.match(migration, /'verified'/)
})

test('Keith receives the four owner-approved instrument names', () => {
  for (const name of [
    'Casey-Fink Readiness for Practice',
    "Preceptor's Assessment of Student Readiness",
    "Student's Feedback on Unit and Preceptor",
    "Student's Feedback on ASPIRE",
  ]) assert.ok(migration.includes(name), `missing canonical name: ${name}`)
})

test('the canon documents current workflow and respondent-routing semantics', () => {
  const first = migration.indexOf("1. Student's Feedback on Unit and Preceptor")
  const second = migration.indexOf('2. Casey-Fink Readiness for Practice (Post-Rotation)')
  const third = migration.indexOf("3. Student's Feedback on ASPIRE")
  assert.ok(first > 0 && second > first && third > second, 'post-rotation sequence is not canonical')
  assert.match(migration, /Owner may select an active secondary or coverage preceptor/)
  assert.match(migration, /one assessment per student per timepoint/)
  assert.match(migration, /student feedback remains structured around the primary preceptor and unit/i)
})

test('the canon keeps email subjects as action sentences and canonical names in bodies', () => {
  for (const subject of [
    'Before Your Rotation: Complete Your ASPIRE Readiness Survey',
    'Complete Your ASPIRE Readiness Survey',
    'ASPIRE: Share Feedback on Your Preceptor and Unit',
    'Share Your ASPIRE Rotation Feedback',
  ]) assert.ok(migration.includes(subject), `missing email subject: ${subject}`)
  assert.match(migration, /Email subjects remain concise action sentences/)
})

test('the SQL executes against the governance contract and advances version 2 to version 3', async () => {
  const db = new PGlite()
  await db.exec(`
    CREATE TABLE public.user_profiles (
      id uuid PRIMARY KEY,
      full_name text NOT NULL,
      role text NOT NULL
    );
    CREATE TABLE public.knowledge_entries (
      id uuid PRIMARY KEY,
      title text NOT NULL,
      slug text NOT NULL UNIQUE,
      category text NOT NULL,
      body text NOT NULL DEFAULT '',
      source_attribution text NOT NULL DEFAULT '',
      precedence_rank integer NOT NULL DEFAULT 100,
      state text NOT NULL DEFAULT 'draft',
      effective_date date,
      expires_at date,
      current_version integer NOT NULL DEFAULT 0,
      created_by uuid NOT NULL REFERENCES public.user_profiles(id),
      updated_by uuid NOT NULL REFERENCES public.user_profiles(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      body_format text NOT NULL DEFAULT 'plain',
      aliases text[] NOT NULL DEFAULT '{}',
      tags text[] NOT NULL DEFAULT '{}',
      review_date date,
      confidence text,
      superseded_by uuid
    );
    CREATE TABLE public.knowledge_revisions (
      id uuid PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000003',
      entry_id uuid NOT NULL UNIQUE REFERENCES public.knowledge_entries(id),
      title text NOT NULL,
      category text NOT NULL,
      body text NOT NULL DEFAULT '',
      source_attribution text NOT NULL DEFAULT '',
      precedence_rank integer NOT NULL DEFAULT 100,
      change_note text NOT NULL DEFAULT '',
      author_id uuid NOT NULL REFERENCES public.user_profiles(id),
      submitted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      body_format text NOT NULL DEFAULT 'plain',
      aliases text[] NOT NULL DEFAULT '{}',
      tags text[] NOT NULL DEFAULT '{}',
      review_date date,
      confidence text
    );
    CREATE TABLE public.knowledge_entry_versions (
      id uuid PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000004',
      entry_id uuid NOT NULL REFERENCES public.knowledge_entries(id),
      version_number integer NOT NULL,
      title text NOT NULL,
      category text NOT NULL,
      body text NOT NULL,
      source_attribution text NOT NULL,
      precedence_rank integer NOT NULL,
      change_note text NOT NULL,
      editor_id uuid NOT NULL REFERENCES public.user_profiles(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      body_format text NOT NULL,
      aliases text[] NOT NULL,
      tags text[] NOT NULL,
      review_date date,
      confidence text
    );
    CREATE TABLE public.activity_logs (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id uuid,
      user_name text,
      user_role text,
      action_type text,
      entity_type text,
      entity_id text,
      cohort_id uuid,
      description text,
      metadata jsonb
    );
    CREATE FUNCTION public.governance_apply_knowledge_revision(
      p_entry_id uuid,
      p_actor_profile_id uuid
    ) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_entry public.knowledge_entries%ROWTYPE;
      v_rev public.knowledge_revisions%ROWTYPE;
      v_next integer;
    BEGIN
      SELECT * INTO STRICT v_entry FROM public.knowledge_entries WHERE id = p_entry_id FOR UPDATE;
      SELECT * INTO STRICT v_rev FROM public.knowledge_revisions WHERE entry_id = p_entry_id FOR UPDATE;
      v_next := v_entry.current_version + 1;
      INSERT INTO public.knowledge_entry_versions (
        entry_id, version_number, title, category, body, source_attribution,
        precedence_rank, change_note, editor_id, body_format, aliases, tags,
        review_date, confidence
      ) VALUES (
        v_entry.id, v_next, v_rev.title, v_rev.category, v_rev.body,
        v_rev.source_attribution, v_rev.precedence_rank, v_rev.change_note,
        p_actor_profile_id, v_rev.body_format, v_rev.aliases, v_rev.tags,
        v_rev.review_date, v_rev.confidence
      );
      UPDATE public.knowledge_entries
         SET title = v_rev.title,
             category = v_rev.category,
             body = v_rev.body,
             source_attribution = v_rev.source_attribution,
             precedence_rank = v_rev.precedence_rank,
             current_version = v_next,
             updated_by = p_actor_profile_id,
             body_format = v_rev.body_format,
             aliases = v_rev.aliases,
             tags = v_rev.tags,
             review_date = v_rev.review_date,
             confidence = v_rev.confidence
       WHERE id = v_entry.id;
      DELETE FROM public.knowledge_revisions WHERE id = v_rev.id;
      RETURN jsonb_build_object('current_version', v_next);
    END;
    $$;
    INSERT INTO public.user_profiles (id, full_name, role)
    VALUES ('00000000-0000-0000-0000-000000000001', 'Jester Lloyd Bautista', 'owner');
    INSERT INTO public.knowledge_entries (
      id, title, slug, category, body, source_attribution, precedence_rank,
      state, current_version, created_by, updated_by, body_format, aliases,
      tags, confidence
    ) VALUES (
      '00000000-0000-0000-0000-000000000002',
      'ASPIRE Survey Naming Canon',
      'aspire-survey-naming-canon',
      'terminology_navigation',
      'Version 2 body',
      'Version 2 source',
      50,
      'active',
      2,
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001',
      'markdown',
      ARRAY['survey naming'],
      ARRAY['evaluation-surveys'],
      'verified'
    );
  `)

  await db.exec(migration)

  const entry = await db.query(`
    SELECT current_version, body_format, confidence, body
      FROM public.knowledge_entries
     WHERE slug = 'aspire-survey-naming-canon'
  `)
  assert.equal(entry.rows[0].current_version, 3)
  assert.equal(entry.rows[0].body_format, 'markdown')
  assert.equal(entry.rows[0].confidence, 'verified')
  assert.match(entry.rows[0].body, /Student's Feedback on ASPIRE/)

  const history = await db.query(`
    SELECT version_number, change_note
      FROM public.knowledge_entry_versions
     WHERE entry_id = '00000000-0000-0000-0000-000000000002'
  `)
  assert.equal(history.rows[0].version_number, 3)
  assert.match(history.rows[0].change_note, /September 20 survey names/)

  const pending = await db.query('SELECT count(*)::integer AS count FROM public.knowledge_revisions')
  assert.equal(pending.rows[0].count, 0)
  await db.close()
})

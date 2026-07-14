// PHASE2-STUDENT-VIEWS: static guard for the student portal read-surface
// migration. Verifies the three scoped, column-limited views, their
// security_barrier + my_linked_student_ids() scoping, the least-privilege
// grants, exclusion of staff-only columns, and the explicit transaction.
//
// Run: node --test test/phase2StudentPortalViews.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(
  join(here, '../supabase/migrations/20260712000008_phase2_student_portal_views.sql'),
  'utf8'
)

const VIEWS = ['portal_my_shift_logs', 'portal_my_evaluation_assignments', 'portal_my_certificates']

// Staff-internal columns that MUST NOT appear as selected columns in the views.
const FORBIDDEN_COLUMNS = ['admin_notes', 'exception_flags', 'reviewed_by', 'attestation', 'school_email']

test('Phase 2 student portal views', async (t) => {
  await t.test('explicit BEGIN and COMMIT wrap the views and grants', () => {
    assert.match(sql, /^BEGIN;/m)
    assert.match(sql, /^COMMIT;/m)
    assert.ok(sql.indexOf('\nBEGIN;') < sql.indexOf('CREATE OR REPLACE VIEW'), 'BEGIN before first view')
    assert.ok(sql.indexOf('\nCOMMIT;') > sql.lastIndexOf('TO service_role;'), 'COMMIT after last grant')
    assert.ok(sql.indexOf('-- Verification') > sql.indexOf('\nCOMMIT;'), 'verification block after COMMIT')
  })

  await t.test('creates the three scoped views with security_barrier', () => {
    for (const v of VIEWS) {
      const m = sql.match(new RegExp(`CREATE OR REPLACE VIEW public\\.${v}\\s+WITH \\(security_barrier = true\\)`))
      assert.ok(m, `view ${v} must be created WITH (security_barrier = true)`)
    }
  })

  await t.test('every view scopes rows by my_linked_student_ids()', () => {
    // Split into per-view definition blocks and assert each has the scoping predicate.
    for (const v of VIEWS) {
      const start = sql.indexOf(`CREATE OR REPLACE VIEW public.${v}`)
      assert.ok(start >= 0, `view ${v} not found`)
      // The definition runs until the next CREATE or the privileges section.
      const rest = sql.slice(start)
      const end = rest.indexOf('CREATE OR REPLACE VIEW', 10)
      const block = end > 0 ? rest.slice(0, end) : rest.slice(0, rest.indexOf('-- ── 4. Privileges'))
      assert.match(block, /student_id IN \(SELECT public\.my_linked_student_ids\(\)\)/,
        `view ${v} must filter student_id by my_linked_student_ids()`)
    }
  })

  await t.test('evaluation view restricts to the student respondent', () => {
    assert.match(sql, /respondent_type = 'student'/, 'evaluation view must restrict to respondent_type student')
  })

  await t.test('evaluation view sources instrument_title from live display_name column', () => {
    // Live evaluation_instruments has display_name, not title.
    assert.match(sql, /i\.display_name\s+AS instrument_title/, 'instrument_title must source from i.display_name')
    assert.doesNotMatch(sql, /i\.title\b/, 'no reference to the nonexistent i.title column may remain')
    // Portal-facing output column name is preserved.
    assert.match(sql, /AS instrument_title/, 'output alias instrument_title must be preserved')
    assert.match(sql, /i\.slug\s+AS instrument_slug/, 'instrument_slug mapping must be preserved')
  })

  await t.test('no staff-only columns are selected in any view', () => {
    // Only inspect the view-definition region (before the privileges section).
    const defs = sql.slice(0, sql.indexOf('-- ── 4. Privileges'))
    for (const col of FORBIDDEN_COLUMNS) {
      // Allow the column name to appear in comments; forbid it as a selected `l.col`/`a.col`/`c.col`.
      assert.doesNotMatch(defs, new RegExp(`^\\s*[a-z]\\.${col}\\b`, 'm'),
        `staff-only column ${col} must not be selected`)
    }
  })

  await t.test('grants: revoke PUBLIC/anon, grant SELECT to authenticated and service_role only', () => {
    assert.match(sql, /REVOKE ALL ON public\.portal_my_shift_logs,[^;]*FROM PUBLIC, anon;/)
    assert.match(sql, /GRANT SELECT ON public\.portal_my_shift_logs,[^;]*TO authenticated;/)
    assert.match(sql, /GRANT SELECT ON public\.portal_my_shift_logs,[^;]*TO service_role;/)
    // No write grant to authenticated on the views.
    assert.doesNotMatch(sql, /GRANT (ALL|INSERT|UPDATE|DELETE)[^;]*portal_my_[^;]*TO authenticated/i)
  })

  await t.test('creates no table, function, policy, or trigger and inserts no data', () => {
    assert.doesNotMatch(sql, /CREATE TABLE/i, 'must not create tables')
    assert.doesNotMatch(sql, /CREATE (OR REPLACE )?FUNCTION/i, 'must not create functions')
    assert.doesNotMatch(sql, /CREATE POLICY|CREATE TRIGGER/i, 'must not create policies/triggers')
    assert.doesNotMatch(sql, /\bINSERT INTO\b/i, 'must not insert data')
    assert.doesNotMatch(sql, /security_invoker/i, 'views are owner-rights by design, not security_invoker')
  })

  await t.test('does not touch read-receipt or identity tables', () => {
    assert.doesNotMatch(sql, /student_reads|session_reads|support_request_reads|user_profiles/,
      'migration must not reference read-receipt or user_profiles tables')
  })
})

// PHASE0B-WAVE-D-PREREQ: guards that the public /shift-log "Log a past shift"
// screen (ShiftLogPage) resolves the student ONLY through the secure
// /api/shift-log/lookup-student endpoint, never with a browser-side read of
// public.students or public.units. This is the code prerequisite for Phase 0B
// Wave D, which removes all anon access to public.students. A regression here
// would re-break the past-shift workflow the moment Wave D is applied.
//
// Run: node --test test/shiftLogPageSecureLookup.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '../src/components/ShiftLogPage.jsx'), 'utf8')

test('ShiftLogPage secure lookup (Wave D prerequisite)', async (t) => {
  await t.test('does NOT read public.students with the browser client', () => {
    assert.doesNotMatch(
      source,
      /from\(\s*['"`]students['"`]\s*\)/,
      'ShiftLogPage must not query the students table directly'
    )
  })

  await t.test('does NOT read public.units with the browser client', () => {
    assert.doesNotMatch(
      source,
      /from\(\s*['"`]units['"`]\s*\)/,
      'ShiftLogPage must not query the units table directly'
    )
  })

  await t.test('does NOT import the browser supabase client', () => {
    assert.doesNotMatch(
      source,
      /from\s+['"`][^'"`]*lib\/supabase['"`]/,
      'ShiftLogPage must not import the browser supabase client'
    )
  })

  await t.test('resolves the student via the secure lookup hook', () => {
    assert.match(
      source,
      /useLookupStudent/,
      'ShiftLogPage must use the useLookupStudent hook (secure endpoint)'
    )
    assert.match(
      source,
      /await\s+lookup\s*\(/,
      'ShiftLogPage must call the secure lookup() to resolve the student'
    )
  })

  await t.test('does not embed a service-role key or secret in client code', () => {
    assert.doesNotMatch(source, /SERVICE_ROLE/i, 'no service-role reference in client code')
    assert.doesNotMatch(source, /service_role/, 'no service_role reference in client code')
  })
})

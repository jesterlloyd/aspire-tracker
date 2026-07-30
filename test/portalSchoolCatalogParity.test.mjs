// PORTAL-SCHOOL-CATALOG-DRIFT-1: parity guards for the school catalog.
//
// The database `schools` seed (migration 20260712000012) is the approved
// seven-school catalog. Two code-side mirrors must never drift from it again:
//   1. src/lib/portalScopeCatalog.js SCHOOL_SCOPE_OPTIONS (Grant Portal Access
//      modal: Assigned schools list + contact autofill via matchSchoolKeys)
//   2. api/lib/schoolAliases.js (server-side alias-aware school matching)
// This test parses the migration seed as the source of truth and checks both
// mirrors behaviorally. Pure imports only; no database, no network.
//
// Run: node --test test/portalSchoolCatalogParity.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { SCHOOL_SCOPE_OPTIONS } from '../src/lib/portalScopeCatalog.js'
import { matchSchoolKeys } from '../src/lib/contactSearchCore.js'
import { resolveSchoolAliases, schoolMatches } from '../api/lib/schoolAliases.js'

const here = dirname(fileURLToPath(import.meta.url))
const migration = readFileSync(
  join(here, '..', 'supabase/migrations/20260712000012_phase4_school_portal.sql'), 'utf8')

// Parse the seed rows: ('canonical', 'operative', ARRAY['a', 'b', ...])
const seedBlock = migration.slice(
  migration.indexOf('INSERT INTO public.schools'),
  migration.indexOf('ON CONFLICT (canonical_name)'))
const DB_SCHOOLS = [...seedBlock.matchAll(
  /\('([^']+)',\s*'([^']+)',\s*\n?\s*ARRAY\[([^\]]*)\]\)/g,
)].map(m => ({
  canonical: m[1],
  operative: m[2],
  aliases: [...m[3].matchAll(/'([^']+)'/g)].map(a => a[1]),
}))

test('the migration seed parses to the approved seven-school catalog', () => {
  assert.equal(DB_SCHOOLS.length, 7, 'expected exactly 7 seeded schools')
  const canonicals = DB_SCHOOLS.map(s => s.canonical)
  assert.ok(canonicals.includes('California State University, Northridge'))
  assert.ok(canonicals.includes('University of California, Los Angeles'))
})

test('SCHOOL_SCOPE_OPTIONS carries exactly the seven DB canonicals, alphabetically', () => {
  const values = SCHOOL_SCOPE_OPTIONS.map(o => o.value)
  assert.deepEqual(
    [...values].sort((a, b) => a.localeCompare(b)), values,
    'Assigned schools must list alphabetically by canonical name')
  assert.deepEqual(
    new Set(values), new Set(DB_SCHOOLS.map(s => s.canonical)),
    'SCHOOL_SCOPE_OPTIONS drifted from the database schools seed')
  for (const o of SCHOOL_SCOPE_OPTIONS) {
    assert.equal(o.label, o.value, `label must equal the canonical name: ${o.value}`)
  }
})

test('every option covers its DB aliases and operative display name', () => {
  for (const s of DB_SCHOOLS) {
    const opt = SCHOOL_SCOPE_OPTIONS.find(o => o.value === s.canonical)
    assert.ok(opt, `missing option for ${s.canonical}`)
    for (const a of s.aliases) {
      assert.ok(opt.aliases.includes(a), `${s.canonical} option is missing DB alias "${a}"`)
    }
    if (s.operative !== s.canonical) {
      assert.ok(opt.aliases.includes(s.operative),
        `${s.canonical} option must alias its operative name "${s.operative}" for autofill`)
    }
  }
})

test('new-school display hints match the DB operative shorthand', () => {
  assert.equal(SCHOOL_SCOPE_OPTIONS.find(o => o.value === 'California State University, Northridge')?.hint, 'CSUN')
  assert.equal(SCHOOL_SCOPE_OPTIONS.find(o => o.value === 'University of California, Los Angeles')?.hint, 'UCLA')
})

test('contact autofill resolves both partner affiliations to the right scope keys', () => {
  // Rebekah Howerton Child (CSUN): contact rows may hold the operative name or
  // the initialism.
  for (const src of ['Cal State Northridge', 'CSUN', 'CSU Northridge', 'California State University, Northridge']) {
    assert.deepEqual(
      matchSchoolKeys([src, null], SCHOOL_SCOPE_OPTIONS),
      ['California State University, Northridge'], `autofill failed for "${src}"`)
  }
  // Mayra Ontaneda (UCLA).
  for (const src of ['UCLA', 'UC Los Angeles', 'University of California, Los Angeles']) {
    assert.deepEqual(
      matchSchoolKeys([null, src], SCHOOL_SCOPE_OPTIONS),
      ['University of California, Los Angeles'], `autofill failed for "${src}"`)
  }
  // Ambiguity guard: an unrelated organization never auto-selects a school.
  assert.deepEqual(matchSchoolKeys(['University of California'], SCHOOL_SCOPE_OPTIONS), [])
})

test('server alias matching covers every DB school, both directions', () => {
  for (const s of DB_SCHOOLS) {
    for (const term of [s.operative, ...s.aliases]) {
      assert.ok(schoolMatches(s.canonical, term),
        `schoolMatches("${s.canonical}", "${term}") must be true`)
      assert.ok(schoolMatches(term, s.canonical),
        `schoolMatches("${term}", "${s.canonical}") must be true`)
    }
    const expanded = resolveSchoolAliases(s.aliases[0])
    assert.ok(expanded.length > 1,
      `resolveSchoolAliases("${s.aliases[0]}") must expand to its alias group`)
  }
})

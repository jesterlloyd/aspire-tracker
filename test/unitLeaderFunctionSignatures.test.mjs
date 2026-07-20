// UL-PORTAL: PostgreSQL function-signature regression guards.
//
// Written after a blocking defect: messages_start_conversation declared
// `p_unit_key text DEFAULT NULL` at position 5, ahead of four required parameters.
// PostgreSQL rejects that outright ("input parameters after one with a default
// value must also have defaults"), so the migration could never have applied. It
// also meant the declared signature would have been
// (uuid, text, uuid, uuid, text, text, text, text, jsonb) while every DROP, REVOKE,
// GRANT, verification, and rollback reference targeted
// (uuid, text, uuid, uuid, text, text, text, jsonb, text).
//
// These guards are generic: they parse EVERY function declaration in the migration
// rather than special-casing the one that broke.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const migration = read('supabase/migrations/20260720000000_unit_leader_portal_foundation.sql')
const preflight = read('db/audit/unit_leader_portal_preflight_and_verification.sql')

// Executable body: the rollback block comment removed.
const migrationLive = migration.replace(/\/\*[\s\S]*?\*\//g, '')
// The rollback block on its own.
const rollback = (migration.match(/\/\*[\s\S]*?\*\//g) || []).join('\n')

const START_FN = 'messages_start_conversation'
// The one true signature, in order.
const START_SIG = ['uuid', 'text', 'uuid', 'uuid', 'text', 'text', 'text', 'jsonb', 'text']
// The Phase 3 signature this migration replaces.
const OLD_SIG = ['uuid', 'text', 'uuid', 'uuid', 'text', 'text', 'text', 'jsonb']

/**
 * Parse every `CREATE [OR REPLACE] FUNCTION public.name(...)` declaration.
 * Returns [{ name, params: [{ name, type, hasDefault }] }].
 * Only NAMED parameter declarations are parsed, which is what the migration uses.
 */
function parseDeclarations(sql) {
  const out = []
  const re = /CREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\s+public\.(\w+)\s*\(([\s\S]*?)\)\s*\nRETURNS/g
  let m
  while ((m = re.exec(sql)) !== null) {
    const [, name, raw] = m
    const params = raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(decl => {
        const hasDefault = /\bDEFAULT\b/i.test(decl)
        const parts = decl.split(/\s+/)
        return { name: parts[0], type: (parts[1] || '').toLowerCase(), hasDefault, decl }
      })
    out.push({ name, params })
  }
  return out
}

const declarations = parseDeclarations(migrationLive)

test('the migration declares the functions we expect to parse', () => {
  assert.ok(declarations.length >= 10, `parsed ${declarations.length} declarations`)
  assert.ok(declarations.some(d => d.name === START_FN), `${START_FN} must be parsed`)
})

// ── The defect class: a defaulted parameter before a required one ────────────
test('NO defaulted input parameter precedes a required input parameter', () => {
  for (const { name, params } of declarations) {
    let seenDefault = null
    for (const p of params) {
      if (p.hasDefault) {
        seenDefault = p.name
        continue
      }
      assert.equal(
        seenDefault, null,
        `public.${name}: required parameter "${p.name}" follows defaulted parameter ` +
        `"${seenDefault}". PostgreSQL rejects this declaration.`)
    }
  }
})

test('every defaulted parameter sits at the END of its parameter list', () => {
  for (const { name, params } of declarations) {
    const firstDefaultIdx = params.findIndex(p => p.hasDefault)
    if (firstDefaultIdx === -1) continue
    const tail = params.slice(firstDefaultIdx)
    assert.ok(
      tail.every(p => p.hasDefault),
      `public.${name}: parameters after the first defaulted one must all have defaults`)
  }
})

// ── messages_start_conversation specifically ─────────────────────────────────
const startDecls = declarations.filter(d => d.name === START_FN)

test('exactly ONE messages_start_conversation is declared in the executable body', () => {
  assert.equal(startDecls.length, 1,
    `a second declaration would create an ambiguous overload; found ${startDecls.length}`)
})

test('messages_start_conversation has the exact 9-parameter signature, in order', () => {
  const [decl] = startDecls
  assert.deepEqual(decl.params.map(p => p.type), START_SIG)
  assert.deepEqual(
    decl.params.map(p => p.name),
    ['p_actor_profile_id', 'p_actor_kind', 'p_participant_profile_id', 'p_student_id',
     'p_subject', 'p_category', 'p_body', 'p_delivery', 'p_unit_key'])
})

test('p_unit_key is the ninth and final parameter, and is the ONLY defaulted one', () => {
  const [decl] = startDecls
  const last = decl.params[decl.params.length - 1]
  assert.equal(last.name, 'p_unit_key')
  assert.equal(last.type, 'text')
  assert.ok(last.hasDefault, 'p_unit_key must carry DEFAULT NULL')
  assert.equal(decl.params.filter(p => p.hasDefault).length, 1)
  assert.match(last.decl, /DEFAULT\s+NULL/i)
})

// ── Existing 8-argument callers stay compatible ──────────────────────────────
test('8-argument callers remain compatible through the trailing default', () => {
  const [decl] = startDecls
  // The first eight parameters must be exactly the Phase 3 signature, so an
  // existing 8-argument call binds positionally and p_unit_key defaults to NULL.
  assert.deepEqual(decl.params.slice(0, 8).map(p => p.type), OLD_SIG)
  // And none of those eight may be defaulted, or the call would be ambiguous.
  assert.ok(decl.params.slice(0, 8).every(p => !p.hasDefault))
})

test('a unit_leader actor is required to supply the unit key, despite the default', () => {
  // The default exists for 8-argument compatibility, not to let a direct thread be
  // created without a unit. The body must reject a NULL unit key for that actor.
  const body = migrationLive.slice(migrationLive.indexOf(`CREATE OR REPLACE FUNCTION public.${START_FN}`))
  assert.match(body, /v_unit_key\s+text\s*:=\s*nullif\(btrim\(coalesce\(p_unit_key, ''\)\), ''\)/)
  assert.match(body, /IF v_unit_key IS NULL THEN[\s\S]{0,200}unit key is required to start a direct thread/)
})

// ── Every reference site targets the same signature ──────────────────────────
const sigPattern = (types) =>
  new RegExp(types.join(',\\s*').replace(/,\\s\*/g, ',\\s*'), 'i')

function signatureRefs(text, fn) {
  // Capture the argument list of every DROP / REVOKE / GRANT referencing the fn.
  const re = new RegExp(
    `(DROP FUNCTION IF EXISTS|REVOKE ALL ON FUNCTION|GRANT EXECUTE ON FUNCTION)\\s+public\\.${fn}\\s*\\(([\\s\\S]*?)\\)`,
    'g')
  const out = []
  let m
  while ((m = re.exec(text)) !== null) {
    out.push({
      kind: m[1],
      types: m[2].split(',').map(t => t.trim().toLowerCase()).filter(Boolean),
    })
  }
  return out
}

test('the executable body DROPs the OLD 8-argument signature exactly', () => {
  const drops = signatureRefs(migrationLive, START_FN).filter(r => r.kind.startsWith('DROP'))
  assert.equal(drops.length, 1, 'exactly one DROP in the executable body')
  assert.deepEqual(drops[0].types, OLD_SIG,
    'the DROP must target the Phase 3 8-argument form, not the new one')
})

test('the executable REVOKE and GRANT target the NEW 9-argument signature', () => {
  const refs = signatureRefs(migrationLive, START_FN)
    .filter(r => !r.kind.startsWith('DROP'))
  assert.equal(refs.length, 2, 'one REVOKE and one GRANT')
  for (const r of refs) {
    assert.deepEqual(r.types, START_SIG, `${r.kind} must target the 9-argument form`)
  }
  assert.match(migrationLive, /GRANT EXECUTE ON FUNCTION public\.messages_start_conversation\([\s\S]{0,120}\) TO service_role/)
  assert.match(migrationLive, /REVOKE ALL ON FUNCTION public\.messages_start_conversation\([\s\S]{0,120}\) FROM PUBLIC, anon, authenticated/)
})

test('the rollback DROPs the NEW signature and restores the OLD grants', () => {
  const refs = signatureRefs(rollback, START_FN)
  const drops = refs.filter(r => r.kind.startsWith('DROP'))
  const grants = refs.filter(r => !r.kind.startsWith('DROP'))
  assert.equal(drops.length, 1)
  assert.deepEqual(drops[0].types, START_SIG,
    'the rollback must drop the 9-argument form it created')
  assert.equal(grants.length, 2)
  for (const g of grants) {
    assert.deepEqual(g.types, OLD_SIG,
      'the rollback must restore grants on the Phase 3 8-argument form')
  }
})

test('the rollback re-declares the OLD 8-argument signature', () => {
  const rbDecls = parseDeclarations(rollback).filter(d => d.name === START_FN)
  assert.equal(rbDecls.length, 1)
  assert.deepEqual(rbDecls[0].params.map(p => p.type), OLD_SIG)
  assert.ok(rbDecls[0].params.every(p => !p.hasDefault),
    'the Phase 3 form has no defaulted parameter')
})

// ── Verification agrees with the migration ───────────────────────────────────
test('VERIFY 7e checks for exactly one overload and the correct argument order', () => {
  assert.match(preflight, /VERIFY 7e: exactly ONE messages_start_conversation, with grants/)
  assert.match(preflight, /pg_get_function_identity_arguments/)
  assert.match(preflight, /jsonb, text/)
  assert.match(preflight, /STOP if more than one row is returned/)
  assert.match(preflight, /has_function_privilege\('service_role'/)
  assert.match(preflight, /has_function_privilege\('authenticated'/)
})

test('no em dash in the signature guards', () => {
  assert.doesNotMatch(migration, /—/)
  assert.doesNotMatch(preflight, /—/)
})

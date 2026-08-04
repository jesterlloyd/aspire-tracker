// Interview availability: every client that creates a block must satisfy the server's
// create_block contract.
//
// Regression origin: WAVE F-2 moved scheduling attribution from a free-text
// interviewer_name to a linked interviewer ACCOUNT (interviewer_profile_id) in
// api/availability.js and updated AvailabilityManagerModal, but the calendar's
// "Add Availability" popover kept sending interviewer_name. For an Owner/Admin caller
// (adminLevel) the server then found no interviewer_profile_id and returned
// 400 invalid_request, which the popover printed as the bare slug "invalid_request".
//
// These tests derive the required field list FROM the server source and check every
// create_block payload in the app against it, so a new or edited caller that drops a
// required field fails here rather than in production. They also pin that availability
// responses are surfaced as the server's safe sentence, never as a bare error slug.
//
// Run: node --test test/interviewAvailabilityCreateBlock.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const availability = read('api/availability.js')
const calendar     = read('src/components/InterviewCalendar.jsx')
const modal        = read('src/components/AvailabilityManagerModal.jsx')

// ── Contract extraction ──────────────────────────────────────────────────────

// The fields create_block requires, read from the handler itself: the destructured
// required set, plus the identity field when the handler rejects a missing one.
function serverRequiredFields(src) {
  const start = src.indexOf("action === 'create_block'")
  const end   = src.indexOf("action === 'delete_block'")
  assert.ok(start > -1 && end > start, 'create_block branch not found in api/availability.js')
  const branch = src.slice(start, end)
  const destructured = branch.match(/const \{([^}]+)\} = body/)
  assert.ok(destructured, 'create_block required-field destructuring not found')
  const fields = destructured[1].split(',').map(s => s.trim()).filter(Boolean)
  if (/field: 'interviewer_profile_id'/.test(branch)) fields.push('interviewer_profile_id')
  return fields
}

// The top-level keys of every JSON.stringify({...}) payload that posts create_block.
function createBlockPayloads(src) {
  const payloads = []
  const re = /JSON\.stringify\(\{([\s\S]*?)\}\)/g
  let m
  while ((m = re.exec(src)) !== null) {
    const body = m[1]
    if (!/action:\s*'create_block'/.test(body)) continue
    payloads.push((body.match(/^\s*([a-zA-Z_]+)\s*:/gm) || []).map(k => k.replace(/[\s:]/g, '')))
  }
  return payloads
}

// Every source file under src/ that posts create_block, so the sweep cannot go stale.
function createBlockCallers() {
  const found = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!/\.(jsx?|mjs)$/.test(name)) continue
      const src = readFileSync(full, 'utf8')
      if (/action:\s*'create_block'/.test(src)) found.push(relative(root, full))
    }
  }
  walk(join(root, 'src'))
  return found.sort()
}

// ── The contract ─────────────────────────────────────────────────────────────

test('server requires an interviewer ACCOUNT id, never a free-text name', () => {
  const required = serverRequiredFields(availability)
  assert.ok(required.includes('interviewer_profile_id'), 'identity field is part of the contract')
  assert.deepEqual(
    required.sort(),
    ['block_date', 'cohort_id', 'duration_minutes', 'end_time', 'interviewer_profile_id', 'start_time'],
  )
  // The name stored on the block is derived from the account, not taken from the request.
  assert.match(availability, /const interviewerName = \(interviewerAcct\.full_name \|\| ''\)\.trim\(\)/)
  assert.doesNotMatch(availability, /interviewer_name:\s*body\./)
})

test('every create_block caller sends every required field (the WAVE F-2 regression)', () => {
  const required = serverRequiredFields(availability)
  const callers = createBlockCallers()
  assert.deepEqual(callers, ['src/components/AvailabilityManagerModal.jsx', 'src/components/InterviewCalendar.jsx'])

  let checked = 0
  for (const file of callers) {
    const payloads = createBlockPayloads(read(file))
    assert.ok(payloads.length > 0, `no create_block payload parsed from ${file}`)
    for (const keys of payloads) {
      for (const field of required) {
        assert.ok(keys.includes(field), `${file} create_block payload is missing ${field}`)
      }
      // The pre-WAVE-F2 name field is attribution the server no longer accepts.
      assert.ok(!keys.includes('interviewer_name'), `${file} still sends interviewer_name`)
      checked++
    }
  }
  assert.ok(checked >= 2, 'expected a create_block payload in each caller')
})

test('calendar popover binds the interviewer picker to profile ids, not names', () => {
  assert.match(calendar, /<option key=\{p\.id\} value=\{p\.id\}>\{p\.full_name\}<\/option>/)
  assert.match(calendar, /<select value=\{interviewerProfileId\}/)
  // A self-scheduling (non-admin) interviewer still resolves to an account id, and the default is
  // derived per render so a late-arriving profiles query still populates the picker.
  //
  // SUPERSEDED BY AVAILABILITY-CALENDAR-1C: the default used to be
  // interviewerProfiles[0] for admins, which pre-selected whoever sorted first
  // regardless of who was signed in (availability got attributed to the wrong
  // interviewer in production). It is now LOGIN-AWARE and resolved by canonical
  // profile id, falling back to an explained empty field rather than a stranger.
  assert.match(calendar, /const signedInIsEligible = !!userProfile\?\.id && interviewerProfiles\.some\(p => p\.id === userProfile\.id\)/)
  assert.match(calendar, /const defaultInterviewerId = signedInIsEligible \? userProfile\.id : ''/)
  assert.match(calendar, /const interviewerProfileId = form\.interviewer_profile_id === null\s*\n\s*\? defaultInterviewerId\s*\n\s*: form\.interviewer_profile_id/)
  // Blocked before the request when no account is resolved, instead of a server 400.
  assert.match(calendar, /if \(!interviewerProfileId\) \{\s*\n\s*setError\('Select a linked interviewer account\.'\); return/)
})

test('availability failures surface the safe server sentence, never a bare slug', () => {
  for (const [file, src] of [['InterviewCalendar.jsx', calendar], ['AvailabilityManagerModal.jsx', modal]]) {
    assert.match(src, /const safeServerError = \(json, fallback\) => json\?\.message \|\| fallback/, `${file} defines the rule`)
    // No availability response is rendered by reading .error directly.
    assert.doesNotMatch(src, /setError\((?:data|json)\.error\)/, `${file} shows a bare slug`)
    assert.doesNotMatch(src, /alert\((?:`[^`]*\$\{)?(?:data|json)\.error/, `${file} alerts a bare slug`)
  }
  assert.match(calendar, /setError\(safeServerError\(data, 'Could not create the availability block\.'\)\)/)
})

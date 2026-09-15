// MENTORSHIP-1 (Owner, 2026-09-14): Support is Before Residency | At the Start of Residency |
// During Residency. During Residency is the mentorship record that replaces Cedars-Sinai's
// mentorship platform; the session shape is the one future self-logging will write.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  SESSION_FORMAT_KEYS, SESSION_LOGGER_KEYS, validateSessionDetails, DURATION_MIN, DURATION_MAX,
} from '../src/lib/ngrp/ngrpMentorshipSession.js'
import { validateSupportEntry } from '../lib/server/ngrpSupport.js'
import { ngrpSubTabs, resolveNgrpPath } from '../src/lib/ngrp/ngrpTabs.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const code = src => src.split('\n').filter(l => !/^\s*--/.test(l)).join('\n')
const migration = code(read('supabase/migrations/20260920000000_ngrp_mentorship_session_details.sql'))
const tab = read('src/components/ngrp/SupportTab.jsx')
const api = read('api/ngrp-support.js')
const gate = read('docs/security/OWNER_SQL_GATE.md')
const listIn = (sql, col) => sql.match(new RegExp(`${col} IN \\(([^)]*)\\)`))[1].match(/'([a-z_]+)'/g).map(s => s.replace(/'/g, ''))

test('Support reads Before Residency | At the Start of Residency | During Residency', () => {
  assert.deepEqual(ngrpSubTabs('support').map(s => [s.id, s.label]), [
    ['before', 'Before Residency'], ['start', 'At the Start of Residency'], ['during', 'During Residency'],
  ])
  // Existing links keep working: /support/during is the mentorship record now.
  assert.equal(resolveNgrpPath('/ngrp/support/during').redirect, null)
  assert.equal(resolveNgrpPath('/portal/residency/support/start', '/portal/residency').redirect, null)
})

test('the migration lists are exactly the shared lists, and nothing else changes', () => {
  assert.deepEqual(listIn(migration, 'session_format'), [...SESSION_FORMAT_KEYS])
  assert.deepEqual(listIn(migration, 'logged_by'), [...SESSION_LOGGER_KEYS])
  assert.match(migration, new RegExp(`duration_minutes BETWEEN ${DURATION_MIN} AND ${DURATION_MAX}`))
  assert.match(migration, /ADD COLUMN IF NOT EXISTS logged_by text NOT NULL DEFAULT 'aspire_team'/)
  assert.match(migration, /activity = 'mentorship_session'\s+OR \(session_format IS NULL AND duration_minutes IS NULL AND topics IS NULL AND next_steps IS NULL\)/)
  assert.doesNotMatch(migration, /GRANT|DELETE FROM|UPDATE public|CREATE TABLE/)
  // Applied by the Owner 2026-09-15, every check as expected.
  assert.match(gate, /\| 20260920000000_ngrp_mentorship_session_details\.sql \| MENTORSHIP-1, .*\*\*APPLIED 2026-09-15 by the Owner\.\*\*/)
})

test('a session needs its format and topics; duration and next steps are optional', () => {
  assert.deepEqual(validateSessionDetails({ session_format: 'in_person', topics: ' Nights ', duration_minutes: '45', next_steps: '' }), {
    ok: true, details: { session_format: 'in_person', duration_minutes: 45, topics: 'Nights', next_steps: null, logged_by: 'aspire_team' },
  })
  const bad = validateSessionDetails({ session_format: 'carrier_pigeon', duration_minutes: 2, topics: '' })
  assert.deepEqual(bad.errors.map(e => e.field), ['session_format', 'duration_minutes', 'topics'])
  assert.equal(validateSessionDetails({ session_format: 'phone', topics: 'x', duration_minutes: 30.5 }).ok, false, 'whole minutes')
  assert.equal(validateSessionDetails({ session_format: 'phone', topics: 'x' }, { loggedBy: 'mentor' }).details.logged_by, 'mentor', 'the future self-logging path')
})

test('the server merges session details into a mentorship session only, and decides who logged it', () => {
  const session = validateSupportEntry({
    activity: 'mentorship_session', occurred_on: '2026-09-10', mentor_name: 'Jester Lloyd Bautista',
    session_format: 'virtual', duration_minutes: 30, topics: 'First nights', next_steps: 'Ask for a charge buddy', logged_by: 'mentor',
  }, { today: '2026-09-11' })
  assert.equal(session.ok, true)
  assert.equal(session.entry.logged_by, 'aspire_team', 'a request cannot claim to be the mentor')
  assert.deepEqual([session.entry.session_format, session.entry.duration_minutes, session.entry.topics, session.entry.next_steps],
    ['virtual', 30, 'First nights', 'Ask for a charge buddy'])
  assert.equal(validateSupportEntry({ activity: 'mentorship_session', occurred_on: '2026-09-10' }, { today: '2026-09-11' }).ok, false)
  // Before Residency keeps its exact shape, so it records without the new columns.
  const before = validateSupportEntry({ activity: 'resume_review', occurred_on: '2026-09-10', session_format: 'virtual', topics: 'x' }, { today: '2026-09-11' })
  assert.deepEqual(Object.keys(before.entry), ['activity', 'occurred_on', 'note', 'mentor_name', 'event_id'])
})

test('the endpoint reads the session columns widest first and refuses a session it cannot store', () => {
  assert.match(api, /const SESSION_FIELDS = 'session_format, duration_minutes, topics, next_steps, logged_by'/)
  assert.match(api, /readEntries\(`\$\{ENTRY_FIELDS\}, \$\{SESSION_FIELDS\}`\)/)
  assert.match(api, /if \(e\.error && isMissingNgrpColumn\(e\.error\)\) \{\s*\n\s*sessionDetailsProvisioned = false/)
  assert.match(api, /sessionDetailsProvisioned,\n\s*reflections:/)
  assert.match(api, /if \(isMissingNgrpColumn\(ins\.error\)\) return res\.status\(200\)\.json\(\{ provisioned: false, error: 'session_details_unavailable' \}\)/)
})

test('the three panels: the reflection tool moved to Start, mentorship owns During', () => {
  assert.match(tab, /if \(subTab === 'start'\) return <StartPanel /)
  assert.match(tab, /if \(subTab === 'during'\) return <MentorshipPanel /)
  const start = tab.slice(tab.indexOf('function StartPanel('), tab.indexOf('// ── MENTORSHIP-1: During Residency'))
  const during = tab.slice(tab.indexOf('function MentorshipPanel('), tab.indexOf('export default function SupportTab'))
  assert.match(start, />\s*Start Reflections\s*</)
  assert.doesNotMatch(start, /MentorCell|Record Session|mentorship_session/)
  assert.match(during, /<MentorCell /)
  assert.match(during, /<SessionLog /)
  assert.doesNotMatch(during, /reflection_start|Start Reflections/)
  for (const h of ['Date', 'Resident', 'Mentor', 'Format', 'Topics Discussed', 'Next Steps', 'Logged By']) {
    assert.ok(tab.includes(`<th className="aspire-th">${h}</th>`), `session log column ${h}`)
  }
  // The session form sends the record the shared validator expects.
  assert.match(tab, /activity: 'mentorship_session',\s*\n\s*candidate_id: candidateId,/)
  assert.match(tab, /session_format: format,\s*\n\s*duration_minutes: duration === '' \? null : Number\(duration\),\s*\n\s*topics,\s*\n\s*next_steps: nextSteps,/)
})

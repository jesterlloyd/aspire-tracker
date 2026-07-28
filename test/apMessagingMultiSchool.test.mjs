// Owner-gate correction, Commit 4: authorized MULTI-school Academic Partner messaging. The browser
// selection is never authorization: the API verifies the selected school against the caller's active
// user_school_scopes and passes only a verified canonical key to the dedicated AP RPC, which
// re-verifies it (exact match; WCU isolated). A single-school AP auto-resolves server-side; a missing
// or invalid selection fails closed. Source guards over the server + client wiring.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const teamStart = read('api/portal/team-messages-start.js')
const svc = read('lib/server/messages/conversationService.js')
const client = read('src/lib/messages/portalMessagesApiClient.js')
const panel = read('src/portal/PortalTeamMessagesPanel.jsx')
const layer = read('src/portal/PortalUtilityLayer.jsx')
const app = read('src/portal/PortalApp.jsx')

test('the endpoint resolves the AP school server-side: single auto, multi verified, else fail closed', () => {
  // school_key is accepted only as the AP-selected school (verified below); ignored for other roles.
  assert.match(teamStart, /const ALLOWED_FIELDS = new Set\(\['request_id', 'body', 'school_key'\]\)/)
  // Single active scope auto-resolves.
  assert.match(teamStart, /if \(caller\.schoolKeys\.length === 1\) \{\s*\n\s*apSchoolKey = caller\.schoolKeys\[0\]/)
  // Multi-school: the selected school is required and must be one of the caller's ACTIVE scopes.
  assert.match(teamStart, /const requested = typeof parsed\.body\.school_key === 'string' \? parsed\.body\.school_key\.trim\(\) : ''/)
  assert.match(teamStart, /if \(!requested\) return res\.status\(400\)\.json\(\{ error: 'school_selection_required' \}\)/)
  assert.match(teamStart, /if \(!caller\.schoolKeys\.includes\(requested\)\) return res\.status\(403\)\.json\(\{ error: 'invalid_school_scope' \}\)/)
  // The verified key (never the raw browser value) is passed to the start service.
  assert.match(teamStart, /schoolKey: apSchoolKey/)
})

test('the endpoint verifies against the SERVER-derived active scopes, not a browser-supplied list', () => {
  // caller.schoolKeys comes from verifyPortalMessagesCaller (active user_school_scopes), never the body.
  assert.match(teamStart, /caller\.schoolKeys\.includes\(requested\)/)
  assert.doesNotMatch(teamStart, /parsed\.body\.school_keys|req\.body\.schools/)
})

test('conversationService routes AP to the dedicated AP RPC with the verified school; student/UL unchanged', () => {
  assert.match(svc, /startGeneralTeamConversationForPortal\(\s*\n?\s*deps,\s*\n?\s*\{ profile, actorKind, requestId, body, schoolKey = null \}/)
  assert.match(svc, /actorKind === 'academic_partner'\s*\n\s*\? await deps\.db\.rpc\('messages_start_general_team_conversation_ap', \{/)
  assert.match(svc, /p_school_key: schoolKey/)
  // Student / Unit Leader still use the original 8-arg RPC with p_actor_kind.
  assert.match(svc, /: await deps\.db\.rpc\('messages_start_general_team_conversation', \{[\s\S]*?p_actor_kind: actorKind/)
})

test('the client includes school_key only when provided (omitted otherwise)', () => {
  assert.match(client, /export function startGeneralTeamConversation\(\{ requestId, body, schoolKey, signal \} = \{\}\)/)
  assert.match(client, /if \(schoolKey\) payload\.school_key = schoolKey/)
})

test('the launcher panel lets a MULTI-school AP pick the school and sends the verified choice', () => {
  assert.match(panel, /schools = \[\],/)
  assert.match(panel, /const apMultiSchool = variant === 'academic_partner' && Array\.isArray\(schools\) && schools\.length > 1/)
  assert.match(panel, /const effectiveSchool = apMultiSchool \? \(schoolChoice \|\| schools\[0\]\) : null/)
  // The school select renders only for a multi-school AP.
  assert.match(panel, /\{apMultiSchool && \(/)
  assert.match(panel, /<select id="ptl-team-start-school"/)
  // Only a multi-school AP sends a school; single-school and non-AP omit it (server auto-resolves).
  assert.match(panel, /schoolKey: effectiveSchool \|\| undefined/)
})

test('the AP portal passes its authorized schools down to the launcher only', () => {
  assert.match(app, /schools=\{access\?\.school_keys \|\| \[\]\}/)
  assert.match(layer, /schools=\{isAcademicPartnerPortal \? schools : \[\]\}/)
})

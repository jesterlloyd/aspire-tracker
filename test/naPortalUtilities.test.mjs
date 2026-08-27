// test/naPortalUtilities.test.mjs
//
// NA-PORTAL-UTILITIES-1: Messages + Send Feedback for the Nursing Education &
// Leadership portal.
//   1. The Owner-gated migration: widened constraints, the NA read branch, the
//      core's NA arms, the dedicated _na RPC, least-privilege grants, sentinel
//      LAST.
//   2. The capability gates (behavioral): env+sentinel for messages, sentinel
//      alone for feedback, fail-closed everywhere.
//   3. API admission: messages caller chain order, start-endpoint gate,
//      dedicated RPC selection, feedback reporter context.
//   4. Client wiring: capability-gated nav tab, utility layer fourth kind,
//      honest prepared state.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  naMessagingEnvEnabled, resolveNaMessagingCapability, resolveNaFeedbackCapability,
} from '../api/lib/naPortalUtilitiesCapability.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const MIGRATION = read('supabase/migrations/20260828000000_enable_nursing_academic_portal_utilities.sql')

// ── 1. The migration ────────────────────────────────────────────────────────

test('the migration widens all five CHECK constraints additively', () => {
  assert.match(MIGRATION, /chk_participant_scope_kind\s*\n\s*CHECK \(scope_kind IN \('student', 'unit', 'school', 'general'\)\)/)
  assert.match(MIGRATION, /\(participant_role = 'nursing_academic'\s*\n\s*AND scope_kind = 'general'\s*\n\s*AND scope_student_id IS NULL\s*\n\s*AND scope_unit_key IS NULL\s*\n\s*AND scope_school_key IS NULL\s*\n\s*AND scope_cohort_id IS NULL\)/)
  assert.match(MIGRATION, /chk_conversations_created_by_role\s*\n\s*CHECK \(created_by_role IN \('student', 'unit_leader', 'academic_partner', 'preceptor', 'staff', 'nursing_academic'\)\)/)
  assert.match(MIGRATION, /chk_messages_author_role\s*\n\s*CHECK \(author_role IN \('student', 'unit_leader', 'academic_partner', 'preceptor', 'staff', 'nursing_academic'\)\)/)
  assert.match(MIGRATION, /chk_portal_feedback_role\s*\n\s*CHECK \(portal_role IN \('student', 'unit_leader', 'academic_partner', 'nursing_academic'\)\)/)
})

test('the NA read branch is general-threads-only with an active org-wide grant', () => {
  assert.match(MIGRATION, /cp\.participant_role = 'nursing_academic'\s*\n\s*AND cp\.scope_kind = 'general'/)
  // Conversation context must be NULL (the general-team discriminator).
  const naBranch = MIGRATION.slice(MIGRATION.indexOf("cp.participant_role = 'nursing_academic'"))
  assert.match(naBranch.slice(0, 1600), /c\.related_student_id IS NULL/)
  assert.match(naBranch.slice(0, 1600), /g\.role = 'nursing_academic'/)
})

test('the core admits nursing_academic with the shared-inbox lock and the general participant shape', () => {
  assert.match(MIGRATION, /IF p_actor_kind NOT IN \('student', 'unit_leader', 'academic_partner', 'nursing_academic'\) THEN/)
  assert.match(MIGRATION, /IF p_actor_kind IN \('academic_partner', 'nursing_academic'\) THEN\s*\n\s*v_ap_recipient_kind/)
  assert.match(MIGRATION, /'portal messages must be sent to the ASPIRE Team'/)
  assert.match(MIGRATION, /message_profile_has_active_nursing_academic_portal_scope\(p_actor_profile_id\)/)
  assert.match(MIGRATION, /v_conversation_id, p_actor_profile_id, 'nursing_academic', 'general',\s*\n\s*NULL, NULL, NULL, NULL, v_now/)
})

test('the dedicated _na RPC verifies the grant BEFORE delegating; grants are service_role only', () => {
  assert.match(MIGRATION, /FUNCTION public\.messages_start_general_team_conversation_na\(/)
  const rpc = MIGRATION.slice(MIGRATION.indexOf('messages_start_general_team_conversation_na('))
  assert.ok(rpc.indexOf('message_profile_has_active_nursing_academic_portal_scope') < rpc.indexOf('messages_start_general_team_conversation_core'))
  // The internal core stays granted to NO ONE, service_role included.
  assert.match(MIGRATION, /REVOKE ALL ON FUNCTION public\.messages_start_general_team_conversation_core[\s\S]{0,200}?FROM PUBLIC, anon, authenticated, service_role;/)
  assert.match(MIGRATION, /GRANT EXECUTE ON FUNCTION public\.messages_start_general_team_conversation_na[\s\S]{0,120}?TO service_role;/)
})

test('the sentinel is created LAST, inside the one transaction', () => {
  const begin = MIGRATION.indexOf('BEGIN;')
  const commit = MIGRATION.indexOf('\nCOMMIT;')
  const sentinel = MIGRATION.indexOf('FUNCTION public.na_portal_utilities_capability()')
  assert.ok(begin > -1 && sentinel > begin && sentinel < commit)
  // Nothing but the sentinel's own revoke/grant follows it before COMMIT.
  const after = MIGRATION.slice(sentinel, commit)
  assert.doesNotMatch(after, /CREATE OR REPLACE FUNCTION public\.(?!na_portal_utilities_capability)/)
})

// ── 2. Capability gates (behavioral) ────────────────────────────────────────

test('messages capability requires env AND sentinel; feedback needs sentinel alone', async () => {
  const prior = process.env.NA_MESSAGING_ENABLED
  try {
    delete process.env.NA_MESSAGING_ENABLED
    assert.equal(naMessagingEnvEnabled(), false)
    let probed = 0
    const db = { rpc: async () => { probed += 1; return { data: true, error: null } } }
    assert.equal(await resolveNaMessagingCapability(db), false)
    assert.equal(probed, 0, 'a disabled deployment never probes the database')
    assert.equal(await resolveNaFeedbackCapability(db), true, 'feedback ignores the messaging env flag')

    process.env.NA_MESSAGING_ENABLED = 'true'
    assert.equal(await resolveNaMessagingCapability(db), true)
    // Sentinel missing (undefined_function) => fail closed.
    const notApplied = { rpc: async () => ({ data: null, error: { message: 'function does not exist' } }) }
    assert.equal(await resolveNaMessagingCapability(notApplied), false)
    assert.equal(await resolveNaFeedbackCapability(notApplied), false)
    // A throwing probe also fails closed.
    const throwing = { rpc: async () => { throw new Error('boom') } }
    assert.equal(await resolveNaMessagingCapability(throwing), false)
  } finally {
    if (prior === undefined) delete process.env.NA_MESSAGING_ENABLED
    else process.env.NA_MESSAGING_ENABLED = prior
  }
})

// ── 3. API admission ────────────────────────────────────────────────────────

test('the messages caller admits nursing_academic LAST, with empty scopes', () => {
  const auth = read('api/lib/messagesAuth.js')
  const fn = auth.slice(auth.indexOf('export async function verifyPortalMessagesCaller'), auth.indexOf('export async function verifyPortalStudentCaller'))
  assert.ok(fn.indexOf('verifyPortalAcademicPartnerCaller') < fn.indexOf('verifyPortalNursingAcademicCaller'))
  assert.match(fn, /actorKind: 'nursing_academic',\s*\n\s*studentIds: \[\],\s*\n\s*unitKeys: \[\],\s*\n\s*schoolKeys: \[\],/)
})

test('thread creation and capabilities are fail-closed behind the NA gates', () => {
  const start = read('api/portal/team-messages-start.js')
  assert.match(start, /caller\.actorKind === 'nursing_academic'/)
  assert.match(start, /resolveNaMessagingCapability\(getServiceDb\(\)\)/)
  assert.match(start, /na_messaging_capability_unavailable/)
  const service = read('lib/server/messages/conversationService.js')
  assert.match(service, /messages_start_general_team_conversation_na/)
  const caps = read('api/portal/portal-capabilities.js')
  assert.match(caps, /na_messaging: naMessaging === true/)
  assert.match(caps, /na_feedback: naFeedback === true/)
})

test('feedback admits an active nursing_academic grant with its own reporter context', () => {
  const endpoint = read('api/portal/feedback-submit.js')
  assert.match(endpoint, /hasActiveRoleGrant\(db, asPartner\.profile\.id, 'nursing_academic'\)/)
  assert.match(endpoint, /portalRole: 'nursing_academic',\s*\n\s*portalType: 'nursing_academic',/)
  assert.match(endpoint, /reporterContextFromNursingAcademic\(auth\)/)
})

// ── 4. Client wiring ────────────────────────────────────────────────────────

test('the NA portal mounts capability-gated Messages: nav tab, route space, workspace, prepared state', () => {
  const app = read('src/portal/PortalApp.jsx')
  assert.match(app, /function naThreadIdFromPath\(pathname\)/)
  assert.match(app, /const naMessagesEnabled = isNursingAcademic && naMessagingCapable/)
  assert.match(app, /const naFeedbackEnabled = isNursingAcademic && naFeedbackCapable/)
  assert.match(app, /\/portal\/academics\/messages/)
  const chrome = read('src/portal/na/NursingAcademicsChrome.jsx')
  assert.match(chrome, /messagesEnabled \? \[\.\.\.SECTIONS, MESSAGES_SECTION\] : SECTIONS/)
  assert.match(chrome, /ptl-nav-badge/)
  const portal = read('src/portal/na/NursingAcademicsPortal.jsx')
  assert.match(portal, /variant="nursing_academic"/)
  assert.match(portal, /This section is being prepared and is not active yet\./)
  const constants = read('src/lib/messages/portalMessagesConstants.js')
  assert.match(constants, /NA_PORTAL_SUBTITLE/)
})

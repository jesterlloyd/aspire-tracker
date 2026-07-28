// GENERAL ASPIRE TEAM THREADS: backend contract and static migration guards.
//
// Run: node --test test/generalTeamThreadsBackend.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  buildGeneralTeamPayloadFingerprint,
  deriveGeneralTeamSubject,
  startGeneralTeamConversationForPortal,
} from '../lib/server/messages/conversationService.js'
import { mapRpcError } from '../api/lib/messagesApi.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripComments = (s) => s.replace(/--[^\n]*/g, '')

const migration = read('supabase/migrations/20260724000001_general_team_threads_backend.sql')
const executableSql = stripComments(migration)
const endpoint = read('api/portal/team-messages-start.js')
const portalClient = read('src/lib/messages/portalMessagesApiClient.js')
const messagesList = read('api/portal/messages-list.js')
const messagesThread = read('api/portal/messages-thread.js')
const context = read('api/lib/messagesContext.js')
const teamPanel = read('src/portal/PortalTeamMessagesPanel.jsx')
const newDrawer = read('src/portal/messages/PortalNewMessageDrawer.jsx')
const unitStart = read('api/portal/unit-messages-start.js')
const studentStart = read('api/portal/messages-start.js')
const handoff = read('docs/product/GENERAL_ASPIRE_TEAM_THREADS_BACKEND_HANDOFF.md')
const audit = read('db/audit/general_team_threads_backend_preflight_and_verification.sql')

function fnBody(name) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`)
  assert.notEqual(start, -1, `missing function ${name}`)
  const end = migration.indexOf('CREATE OR REPLACE FUNCTION public.', start + 10)
  return migration.slice(start, end === -1 ? migration.length : end)
}

const PROFILE = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'portal@example.edu',
  full_name: 'Portal User',
}
const REQUEST_ID = '22222222-2222-4222-8222-222222222222'
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'
const MESSAGE_ID = '44444444-4444-4444-8444-444444444444'
const DELIVERY_ID = '55555555-5555-4555-8555-555555555555'

function mockDb({ result }) {
  const calls = []
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args })
      return { data: result, error: null }
    },
    from: () => ({
      update: () => ({
        eq: () => ({
          in: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        }),
      }),
      insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'log-1' }, error: null }) }) }),
    }),
  }
}

function mockResend() {
  return { emails: { send: async () => ({ data: { id: 're_1' }, error: null }) } }
}

test('general team subject derivation is deterministic, bounded, and valid', () => {
  assert.equal(deriveGeneralTeamSubject('  Need help with onboarding  \nSecond line'), 'Need help with onboarding')
  assert.equal(deriveGeneralTeamSubject('\n\n'), 'Message to ASPIRE Team')
  assert.equal(deriveGeneralTeamSubject('x'.repeat(200)).length, 120)
  assert.equal(deriveGeneralTeamSubject('ok'), 'Message to ASPIRE Team')
})

test('general team payload fingerprint uses normalized server fields', () => {
  const base = {
    actorKind: 'student',
    subject: 'Need help',
    category: 'General question',
    body: 'hello',
  }
  assert.equal(buildGeneralTeamPayloadFingerprint(base), buildGeneralTeamPayloadFingerprint({ ...base }))
  assert.notEqual(buildGeneralTeamPayloadFingerprint(base), buildGeneralTeamPayloadFingerprint({ ...base, body: 'changed' }))
  assert.match(buildGeneralTeamPayloadFingerprint(base), /^[0-9a-f]{64}$/)
})

test('service layer calls the idempotent general-start RPC with server-derived fields', async () => {
  const db = mockDb({
    result: {
      conversation_id: CONVERSATION_ID,
      message_id: MESSAGE_ID,
      delivery_id: DELIVERY_ID,
      created_at: '2026-07-23T00:00:00Z',
      status: 'open',
      thread_kind: 'team_general',
      idempotent_replay: false,
    },
  })
  const out = await startGeneralTeamConversationForPortal(
    { db, resend: mockResend() },
    { profile: PROFILE, actorKind: 'unit_leader', requestId: REQUEST_ID, body: 'First line\nSecond line' },
  )
  assert.equal(out.ok, true)
  const call = db.calls.find((c) => c.name === 'messages_start_general_team_conversation')
  assert.ok(call)
  assert.equal(call.args.p_actor_profile_id, PROFILE.id)
  assert.equal(call.args.p_actor_kind, 'unit_leader')
  assert.equal(call.args.p_request_id, REQUEST_ID)
  assert.equal(call.args.p_subject, 'First line')
  assert.equal(call.args.p_category, 'General question')
  assert.equal(call.args.p_body, 'First line\nSecond line')
  assert.match(call.args.p_payload_fingerprint, /^[0-9a-f]{64}$/)
  assert.equal(call.args.p_delivery.recipient_kind, 'shared_inbox')
  assert.equal(call.args.p_delivery.event_type, 'new_conversation')
  assert.equal(call.args.p_delivery.snapshot_category, 'General question')
  assert.doesNotMatch(JSON.stringify(call.args.p_delivery), /Second line/)
})

test('service layer does not attempt notification send on idempotent replay', async () => {
  const db = {
    calls: [],
    rpc: async (name, args) => {
      db.calls.push({ name, args })
      return {
        data: {
          conversation_id: CONVERSATION_ID,
          message_id: MESSAGE_ID,
          delivery_id: DELIVERY_ID,
          created_at: '2026-07-23T00:00:00Z',
          status: 'open',
          thread_kind: 'team_general',
          idempotent_replay: true,
        },
        error: null,
      }
    },
    from: () => { throw new Error('delivery claim should not run for replay') },
  }
  const out = await startGeneralTeamConversationForPortal(
    { db, resend: mockResend() },
    { profile: PROFILE, actorKind: 'student', requestId: REQUEST_ID, body: 'Replay body' },
  )
  assert.equal(out.ok, true)
  assert.equal(out.send.outcome, 'idempotent_replay')
})

test('MS429 from the transactional RPC maps to a safe rate_limited response', () => {
  assert.deepEqual(mapRpcError({ code: 'MS429', message: 'new conversation rate limited' }), {
    status: 429,
    error: 'rate_limited',
  })
})

test('migration creates durable request-level idempotency separate from delivery idempotency', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.message_creation_requests/)
  assert.match(migration, /operation_kind\s+text\s+NOT NULL/)
  assert.match(migration, /request_id\s+uuid\s+NOT NULL/)
  assert.match(migration, /payload_fingerprint\s+text\s+NOT NULL/)
  assert.match(migration, /conversation_id\s+uuid\s+REFERENCES public\.conversations/)
  assert.match(migration, /message_id\s+uuid\s+REFERENCES public\.messages/)
  assert.match(migration, /delivery_id\s+uuid\s+REFERENCES public\.message_notification_deliveries/)
  assert.match(migration, /UNIQUE \(actor_profile_id, operation_kind, request_id\)/)
  assert.match(migration, /CHECK \(payload_fingerprint ~ '\^\[0-9a-f\]\{64\}\$'\)/)
  assert.doesNotMatch(fnBody('messages_start_general_team_conversation'), /ON CONFLICT \(idempotency_key\) DO NOTHING/)
})

test('migration guarantees idempotent replay and mismatched payload conflict', () => {
  const body = fnBody('messages_start_general_team_conversation')
  assert.match(body, /ON CONFLICT \(actor_profile_id, operation_kind, request_id\) DO NOTHING/)
  assert.match(body, /FOR UPDATE/)
  assert.match(body, /payload_fingerprint IS DISTINCT FROM p_payload_fingerprint/)
  assert.match(body, /ERRCODE = 'MS409'/)
  assert.match(body, /'idempotent_replay', true/)
  assert.match(body, /'idempotent_replay', false/)
})

test('migration transactionally creates the complete authoritative result', () => {
  const body = fnBody('messages_start_general_team_conversation')
  for (const token of [
    'INSERT INTO public.conversations',
    'INSERT INTO public.conversation_participants',
    'INSERT INTO public.messages',
    'INSERT INTO public.conversation_events',
    'INSERT INTO public.participant_conversation_reads',
    'INSERT INTO public.message_notification_deliveries',
    'UPDATE public.message_creation_requests',
  ]) {
    assert.match(body, new RegExp(token.replace(/[.]/g, '\\.')))
  }
  assert.match(body, /related_student_id, related_unit_key, related_school_key, related_cohort_id/)
  assert.match(body, /NULL, NULL, NULL, NULL/)
})

test('migration supports general Student and Unit Leader rows without fake context', () => {
  assert.match(migration, /participant_role = 'student'[\s\S]*scope_kind = 'student'[\s\S]*scope_unit_key IS NULL/)
  assert.match(migration, /participant_role = 'unit_leader'[\s\S]*scope_kind = 'unit'[\s\S]*scope_cohort_id IS NULL/)
  const body = fnBody('messages_start_general_team_conversation')
  assert.match(body, /'student', 'student'[\s\S]*NULL, NULL, NULL, NULL/)
  assert.match(body, /'unit_leader', 'unit'[\s\S]*NULL, NULL, NULL, NULL/)
  assert.doesNotMatch(body, /p_student_id|p_unit_key|p_school_key/)
})

test('migration preserves student-linked and direct-student scope checks', () => {
  const readFn = fnBody('message_participant_can_read')
  const sendFn = fnBody('message_participant_can_send')
  assert.match(readFn, /cp\.scope_student_id IS NOT NULL/)
  assert.match(readFn, /l\.student_id = cp\.scope_student_id/)
  assert.match(sendFn, /cp\.scope_unit_key IS NOT NULL[\s\S]*s\.unit_key = cp\.scope_unit_key/)
  assert.match(sendFn, /cp\.scope_unit_key IS NULL[\s\S]*message_profile_has_active_unit_leader_portal_scope/)
})

test('migration authorizes only Student and Unit Leader general starts', () => {
  const body = fnBody('messages_start_general_team_conversation')
  assert.match(body, /p_actor_kind NOT IN \('student', 'unit_leader'\)/)
  assert.match(body, /message_profile_has_active_student_portal\(p_actor_profile_id\)/)
  assert.match(body, /message_profile_has_active_unit_leader_portal_scope\(p_actor_profile_id\)/)
  assert.doesNotMatch(stripComments(body), /academic_partner|preceptor|co_lead|viewer|interviewer|is_staff/)
})

test('migration consumes existing rate limits only for newly inserted requests', () => {
  const body = fnBody('messages_start_general_team_conversation')
  assert.ok(body.indexOf('IF v_request_row_id IS NULL THEN') < body.indexOf('consume_message_rate_limit'))
  assert.match(body, /consume_message_rate_limit\(\s*p_actor_profile_id, 'new_conversation', 3600, 5/)
  assert.match(body, /consume_message_rate_limit\(\s*p_actor_profile_id, 'message', 600, 20/)
  assert.match(body, /ERRCODE = 'MS429'/)
})

test('migration grants the new write boundary service-role only', () => {
  assert.match(migration, /REVOKE ALL ON TABLE public\.message_creation_requests FROM PUBLIC, anon, authenticated/)
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.message_creation_requests TO service_role/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.messages_start_general_team_conversation\(uuid, text, uuid, text, text, text, text, jsonb\)[\s\S]*FROM PUBLIC, anon, authenticated/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.messages_start_general_team_conversation\(uuid, text, uuid, text, text, text, text, jsonb\)[\s\S]*TO service_role/)
  assert.doesNotMatch(executableSql, /GRANT EXECUTE[^;]*messages_start_general_team_conversation[^;]*authenticated/)
})

test('new endpoint contract accepts request_id, body, and the AP-only selected school_key', () => {
  assert.match(endpoint, /res\.setHeader\('Cache-Control', 'no-store'\)/)
  assert.match(endpoint, /methodGuard\(req, res, \['POST'\]\)/)
  assert.match(endpoint, /verifyPortalMessagesCaller\(req\)/)
  assert.match(endpoint, /caller\.actorKind === 'unit_leader'[\s\S]*no_active_unit_scope/)
  // school_key is accepted only to carry an Academic Partner's selected school; verified server-side.
  assert.match(endpoint, /const ALLOWED_FIELDS = new Set\(\['request_id', 'body', 'school_key'\]\)/)
  for (const forbidden of ['student_id', 'unit_key', 'role', 'portal_type', 'profile_id', 'actor_profile_id', 'destination', 'category', 'subject']) {
    assert.doesNotMatch(endpoint, new RegExp(`parsed\\.body\\.${forbidden}\\b`), forbidden)
  }
  // school_key is consumed ONLY on the academic_partner path, verified against active scopes.
  assert.match(endpoint, /caller\.schoolKeys\.includes\(requested\)/)
  assert.match(endpoint, /isUuid\(requestId\)/)
  assert.match(endpoint, /validateBody\(parsed\.body\.body\)/)
  assert.match(endpoint, /startGeneralTeamConversationForPortal/)
})

test('browser helper is adopted only by the shared docked ASPIRE Team composer', () => {
  assert.match(portalClient, /export function startGeneralTeamConversation/)
  assert.match(portalClient, /\/api\/portal\/team-messages-start/)
  assert.match(portalClient, /const payload = \{ request_id: requestId, body \}/)
  assert.match(portalClient, /if \(schoolKey\) payload\.school_key = schoolKey/)
  assert.doesNotMatch(portalClient.match(/export function startGeneralTeamConversation[\s\S]*?\n}/)?.[0] || '', /student_id|unit_key|role|profile_id|subject|category|destination/)
  assert.match(teamPanel, /startGeneralTeamConversation/)
  assert.match(teamPanel, /api\.startGeneralTeamConversation\(\{\s*\n\s*requestId: stableRequestId,\s*\n\s*body: normalized,\s*\n\s*\/\/[^\n]*\n\s*schoolKey: effectiveSchool \|\| undefined,\s*\n\s*\}\)/)
  assert.doesNotMatch(newDrawer, /startGeneralTeamConversation/)
})

test('existing start endpoints are preserved and not repurposed', () => {
  assert.match(studentStart, /verifyPortalStudentCaller\(req\)/)
  assert.match(studentStart, /startConversationForPortal/)
  assert.match(unitStart, /destination: 'student'/)
  assert.match(unitStart, /destination: 'aspire'/)
  assert.match(unitStart, /startConcernThreadForUnitLeader/)
  assert.match(unitStart, /startDirectThreadForUnitLeader/)
  assert.doesNotMatch(unitStart, /team-messages-start|messages_start_general_team_conversation/)
  assert.doesNotMatch(studentStart, /team-messages-start|messages_start_general_team_conversation/)
})

test('portal list and thread responses attach explicit thread_kind safely', () => {
  assert.match(messagesList, /classifyPortalConversations\(svc, conversations, caller\.profile\.id\)/)
  assert.match(messagesThread, /classifyPortalConversations\(svc, \[conversation\], caller\.profile\.id\)/)
  assert.match(context, /thread_kind: 'team_general'/)
  assert.match(context, /thread_kind: 'team_student_context'/)
  assert.match(context, /thread_kind: 'direct_student'/)
  assert.match(context, /context_student_id/)
  assert.match(context, /context_student_name/)
  assert.match(context, /context_label/)
  assert.match(context, /direct_student_name/)
  assert.match(context, /\.in\('conversation_id', ids\)/)
})

test('classification rules distinguish general, student-context, and direct rows', async () => {
  const { classifyPortalConversations } = await import('../api/lib/messagesContext.js')
  const viewer = 'p1'
  const rows = [
    { id: 'general', subject: 'General' },
    { id: 'context', subject: 'Context' },
    { id: 'direct', subject: 'Direct' },
  ]
  const db = {
    from: (table) => ({
      select: () => ({
        in: (_field, ids) => ({
          is: () => ({
            order: async () => ({
              data: [
                { conversation_id: 'general', participant_profile_id: viewer, participant_role: 'student', scope_student_id: null, scope_unit_key: null },
                { conversation_id: 'context', participant_profile_id: viewer, participant_role: 'unit_leader', scope_student_id: 's1', scope_unit_key: 'Unit A' },
                { conversation_id: 'direct', participant_profile_id: viewer, participant_role: 'unit_leader', scope_student_id: 's2', scope_unit_key: 'Unit A' },
                { conversation_id: 'direct', participant_profile_id: 'p2', participant_role: 'student', scope_student_id: 's2', scope_unit_key: null },
              ].filter((r) => ids.includes(r.conversation_id)),
              error: null,
            }),
          }),
          then: undefined,
          ...(table === 'conversations' ? {
            then: undefined,
          } : {}),
        }),
      }),
    }),
  }
  db.from = (table) => {
    if (table === 'conversation_participants') {
      return {
        select: () => ({
          in: (_field, ids) => ({
            is: () => ({
              order: async () => ({
                data: [
                  { conversation_id: 'general', participant_profile_id: viewer, participant_role: 'student', scope_student_id: null, scope_unit_key: null },
                  { conversation_id: 'context', participant_profile_id: viewer, participant_role: 'unit_leader', scope_student_id: 's1', scope_unit_key: 'Unit A' },
                  { conversation_id: 'direct', participant_profile_id: viewer, participant_role: 'unit_leader', scope_student_id: 's2', scope_unit_key: 'Unit A' },
                  { conversation_id: 'direct', participant_profile_id: 'p2', participant_role: 'student', scope_student_id: 's2', scope_unit_key: null },
                ].filter((r) => ids.includes(r.conversation_id)),
                error: null,
              }),
            }),
          }),
        }),
      }
    }
    if (table === 'conversations') {
      return {
        select: () => ({
          in: async (_field, ids) => ({
            data: ids.map((id) => ({ id, related_student_id: null })),
            error: null,
          }),
        }),
      }
    }
    return {
      select: () => ({
        in: async () => ({
          data: [
            { id: 's1', first_name: 'Ava', preferred_first_name: null, last_name: 'Context' },
            { id: 's2', first_name: 'Ben', preferred_first_name: 'Benny', last_name: 'Direct' },
          ],
          error: null,
        }),
      }),
    }
  }
  const out = await classifyPortalConversations(db, rows, viewer)
  assert.equal(out.find((r) => r.id === 'general').thread_kind, 'team_general')
  assert.equal(out.find((r) => r.id === 'context').thread_kind, 'team_student_context')
  assert.equal(out.find((r) => r.id === 'context').context_student_name, 'Ava Context')
  assert.equal(out.find((r) => r.id === 'direct').thread_kind, 'direct_student')
  assert.equal(out.find((r) => r.id === 'direct').direct_student_name, 'Benny Direct')
})

test('handoff documentation and SQL audit runbook cover the manual apply path', () => {
  for (const token of [
    'POST /api/portal/team-messages-start',
    'message_creation_requests',
    'messages_start_general_team_conversation',
    'thread_kind',
    'Academic Partner Messages remain excluded',
    'Do not enable Academic Partner Messages',
  ]) {
    assert.match(handoff, new RegExp(token.replace(/[()]/g, '\\$&')))
  }
  assert.match(audit, /READ-ONLY PREFLIGHT AND VERIFICATION/)
  assert.match(audit, /to_regclass\('public\.message_creation_requests'\)/)
  assert.match(audit, /role_routine_grants/)
  assert.match(audit, /chk_participant_role_scope/)
  assert.doesNotMatch(audit, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bALTER\b|\bCREATE\b|\bDROP\b/i)
})

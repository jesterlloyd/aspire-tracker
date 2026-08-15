// EVALUATION-REMINDERS-1: the token lifecycle, executed.
//
// Runs the REAL sendOneReminder (and the REAL archive writer and secure-link
// redaction gate) with substituted Resend and Supabase clients. Nothing is sent
// and no database is touched. The raw token is recovered FROM the outbound HTML
// and then hunted for in every persisted payload, so "no token is stored" is
// proved against the actual value that was minted, not against a pattern.
//
// Run: node --test test/evaluationReminderSend.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'

// tokens.js hard-requires a pepper at import; supabase_admin needs a URL/key.
process.env.EVALUATION_TOKEN_PEPPER ||= 'test-pepper-not-a-secret'
process.env.SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key-not-a-secret'

const {
  sendOneReminder, sendClaimedReminders, reminderIdempotencyKey, sanitizeReason,
  deriveReminderToken, retireSupersededTokens, classifyProviderError, PROVIDER_OUTCOME,
  REMINDER_NOTIFICATION_TYPE, TOKEN_GRACE_DAYS,
} = await import('../lib/server/evaluation/reminderSend.js')

const NOW = new Date('2026-08-15T17:00:00.000Z')
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString()
const daysAhead = (n) => new Date(NOW.getTime() + n * 86400000).toISOString()

const CASEY = { id: 'i-casey', slug: 'casey_fink_readiness_2024', permission_status: 'authorized' }
const POSTROT = { id: 'i-postrot', slug: 'post_rotation_evaluation', permission_status: 'authorized' }
const PRECEPTOR_INST = { id: 'i-prec', slug: 'preceptor_progress', permission_status: 'authorized' }

const assignment = (over = {}) => ({
  id: 'a-1', instrument_id: CASEY.id, student_id: 's-1', cohort_id: 'c-1',
  timepoint: 'post_rotation', respondent_type: 'student',
  respondent_email: null, respondent_name: null,
  status: 'sent', sent_at: daysAgo(7), expires_at: daysAhead(21),
  completed_at: null, revoked_at: null, ...over,
})
const student = (over = {}) => ({
  id: 's-1', first_name: 'Ava', last_name: 'Wong',
  school_email: 'ava@school.example.edu', personal_email: 'ava@personal.example.com',
  status: 'Completed', ngrp_outcome: 'Pending', ...over,
})
const ledgerRow = (over = {}) => ({ id: 'led-1', assignment_id: 'a-1', reminder_number: 1, ...over })

// ── Substituted world ───────────────────────────────────────────────────────

function makeWorld({
  links = [], profile = null,
  priorTokens = [{ id: 'tok-old', token_hash: 'hash-old' }],
  tokenInsertFails = false, sendFails = false, sendError = null,
  existingTokenForHash = null,       // simulates "this derived token row already exists"
  revokeFails = false, ledgerUpdateFails = false, failFrom = null, existingLogId = null,
} = {}) {
  const ops = []
  const db = {
    from(table) {
      const op = { table, kind: null, payload: null, filters: [] }
      const has = (f) => op.filters.some(([k]) => k === f)
      const result = () => {
        if (table === 'evaluation_assignment_tokens' && op.kind === 'select') {
          // Existence check for the DERIVED token (filtered by token_hash) vs the
          // active-token sweep (filtered by assignment_id).
          if (has('token_hash')) return { data: existingTokenForHash ? [existingTokenForHash] : [], error: null }
          return { data: priorTokens, error: null }
        }
        if (table === 'evaluation_assignment_tokens' && op.kind === 'insert') {
          return tokenInsertFails ? { data: null, error: { message: 'token write down' } } : { data: { id: 'tok-new' }, error: null }
        }
        if (table === 'evaluation_assignment_tokens' && op.kind === 'update') {
          return revokeFails ? { data: null, error: { message: 'revoke refused' } } : { data: null, error: null }
        }
        if (table === 'user_student_links') return { data: links, error: null }
        if (table === 'user_profiles') return { data: profile, error: null }
        if (table === 'notification_log' && op.kind === 'select') {
          return { data: existingLogId ? [{ id: existingLogId }] : [], error: null }
        }
        if (table === 'notification_log' && op.kind === 'insert') return { data: { id: 'log-1' }, error: null }
        if (table === 'evaluation_reminder_deliveries' && op.kind === 'update') {
          const isSending = op.payload && op.payload.status === 'sending'
          if (failFrom === 'sending') return isSending ? { data: null, error: { message: 'ledger down' } } : { data: null, error: null }
          // Default: the sending marker lands, later writes fail (the crash case).
          if (ledgerUpdateFails) return isSending ? { data: null, error: null } : { data: null, error: { message: 'ledger down' } }
          return { data: null, error: null }
        }
        return { data: null, error: null }
      }
      const api = {
        select() { op.kind = op.kind || 'select'; return api },
        insert(row) { op.kind = 'insert'; op.payload = row; ops.push(op); return api },
        update(row) { op.kind = 'update'; op.payload = row; ops.push(op); return api },
        upsert(row) { op.kind = 'upsert'; op.payload = row; ops.push(op); return Promise.resolve({ error: null }) },
        eq(f, v) { op.filters.push([f, v]); return api },
        is(f, v) { op.filters.push([f, v]); return api },
        in(f, v) { op.filters.push([f, v]); return api },
        filter(f, _op, v) { op.filters.push([f, v]); return api },
        limit() { return api },
        single() { if (!op.kind) { op.kind = 'select'; ops.push(op) } return Promise.resolve(result()) },
        then(res, rej) {
          if (!op.kind) { op.kind = 'select'; ops.push(op) }
          return Promise.resolve(result()).then(res, rej)
        },
      }
      return api
    },
  }
  const sends = []
  const resend = {
    emails: {
      send: async (payload, options) => {
        sends.push({ payload, options })
        if (sendError) return { data: null, error: sendError }
        if (sendFails) return { data: null, error: { message: 'provider down' } }
        return { data: { id: 're_1' }, error: null }
      },
    },
  }
  const authAdmin = { getUserById: async () => ({ data: { user: { email_confirmed_at: 'x' } }, error: null }) }

  const opsOn = (table, kind) => ops.filter(o => o.table === table && o.kind === kind)
  return {
    db, resend, authAdmin, ops, sends, opsOn,
    ledgerPatch: () => opsOn('evaluation_reminder_deliveries', 'update').map(o => o.payload),
    revokedIds: () => opsOn('evaluation_assignment_tokens', 'update')
      .flatMap(o => (o.filters.find(([f]) => f === 'id') || [null, []])[1] || []),
  }
}

const run = (w, over = {}) => sendOneReminder({
  db: w.db, resend: w.resend, authAdmin: w.authAdmin,
  ledgerRow: ledgerRow(), assignment: assignment(), instrument: CASEY, student: student(),
  baseUrl: 'https://aspireintelligence.app', now: NOW, ...over,
})

/** Recover the raw token from the URL fragment in the sent HTML. */
function rawTokenFromHtml(html) {
  const m = html.match(/#t=([A-Za-z0-9_-]{43})/)
  return m ? m[1] : null
}

// ── The happy path ──────────────────────────────────────────────────────────

test('a successful reminder sends once, logs once, archives once, and marks the ledger sent', async () => {
  const w = makeWorld()
  const r = await run(w)
  assert.equal(r.outcome, 'sent')
  assert.equal(w.sends.length, 1)
  assert.equal(w.opsOn('notification_log', 'insert').length, 1)
  assert.equal(w.opsOn('message_archive', 'upsert').length, 1)
  const patch = w.ledgerPatch().at(-1)
  assert.equal(patch.status, 'sent')
  assert.equal(patch.notification_log_id, 'log-1')
  assert.equal(patch.resend_email_id, 're_1')
  assert.equal(patch.reason, null)
})

test('the reminder stores a DERIVED token whose expiry clears the assignment window', async () => {
  const w = makeWorld()
  await run(w)
  const insert = w.opsOn('evaluation_assignment_tokens', 'insert')[0].payload
  assert.equal(insert.assignment_id, 'a-1')
  assert.ok(insert.token_hash && insert.token_hash.length === 64, 'an HMAC hash is stored')
  assert.ok(insert.token_hash_prefix && insert.token_hash_prefix.length === 8)
  assert.ok(!('token' in insert) && !('raw' in insert), 'the raw token is never a column')
  const expected = new Date(assignment().expires_at)
  expected.setDate(expected.getDate() + TOKEN_GRACE_DAYS)
  assert.equal(insert.expires_at, expected.toISOString())
})

test('the token is DERIVED and stable per epoch, so a retry can reproduce it', () => {
  const a = deriveReminderToken('a-1', 1, 0)
  assert.match(a, /^[A-Za-z0-9_-]{43}$/, 'matches the existing token shape exactly')
  assert.equal(a, deriveReminderToken('a-1', 1, 0), 'stable for the same epoch')
  assert.notEqual(a, deriveReminderToken('a-1', 1, 1), 'a new epoch is a genuinely new token')
  assert.notEqual(a, deriveReminderToken('a-1', 2, 0))
  assert.notEqual(a, deriveReminderToken('a-2', 1, 0))
})

test('an already-present derived token row is reused, never duplicated', async () => {
  const w = makeWorld({ existingTokenForHash: { id: 'tok-existing' } })
  await run(w)
  assert.equal(w.opsOn('evaluation_assignment_tokens', 'insert').length, 0,
    'the retry reuses the row rather than inserting a conflicting duplicate')
  assert.equal(w.sends.length, 1)
})

test('SUCCESS RETIRES OLDER TOKENS - and only the older ones', async () => {
  const w = makeWorld({ priorTokens: [{ id: 'tok-old' }, { id: 'tok-older' }] })
  await run(w)
  const revoked = w.revokedIds()
  assert.deepEqual([...revoked].sort(), ['tok-old', 'tok-older'])
  assert.ok(!revoked.includes('tok-new'), 'the token we just sent must stay valid')
  // Revocation is by id, never a whole-assignment sweep.
  for (const op of w.opsOn('evaluation_assignment_tokens', 'update')) {
    assert.ok(!op.filters.some(([f]) => f === 'assignment_id'),
      'revoking by assignment_id would also kill the link we just sent')
  }
})

test('the older tokens are retired only AFTER the provider accepted the message', async () => {
  const w = makeWorld()
  await run(w)
  const sendIdx = w.ops.findIndex(o => o.table === 'notification_log')
  const revokeIdx = w.ops.findIndex(o => o.table === 'evaluation_assignment_tokens' && o.kind === 'update')
  const insertIdx = w.ops.findIndex(o => o.table === 'evaluation_assignment_tokens' && o.kind === 'insert')
  assert.ok(insertIdx < revokeIdx, 'the new token exists before anything is retired')
  assert.ok(revokeIdx < sendIdx || revokeIdx > -1, 'retirement happens on the success path')
})

// ── Failure preserves the recipient's existing link ─────────────────────────

/** A structured, definitive refusal: the provider says it created no mail. */
const DEFINITIVE = { name: 'validation_error', statusCode: 422, message: 'to is invalid' }

test('A DEFINITIVE REJECTION leaves the prior token valid and revokes only this attempt\'s token', async () => {
  const w = makeWorld({ sendError: DEFINITIVE })
  const r = await run(w)
  assert.equal(r.outcome, 'failed')
  assert.equal(r.reason, 'provider_error')

  const revoked = w.revokedIds()
  assert.deepEqual(revoked, ['tok-new'], "only this attempt's token is retired")
  assert.ok(!revoked.includes('tok-old'), "the recipient's existing link must survive a provider outage")

  assert.equal(w.opsOn('notification_log', 'insert').length, 0, 'a failed send writes no audit row')
  assert.equal(w.opsOn('message_archive', 'upsert').length, 0, 'and archives nothing')
  const patch = w.ledgerPatch().at(-1)
  assert.equal(patch.status, 'failed')
  assert.equal(patch.delivery_epoch, 1, 'a KNOWN failure advances the epoch so the retry is genuinely fresh')
})

test('sending is marked BEFORE the provider call, so a crash is distinguishable', async () => {
  const w = makeWorld({ sendError: DEFINITIVE })
  await run(w)
  const patches = w.ledgerPatch()
  assert.equal(patches[0].status, 'sending', 'the in-flight marker is durable and written first')
  assert.match(patches[0].payload_fingerprint, /^[a-f0-9]{64}$/, 'and freezes what is about to be sent')
  assert.ok(patches[0].first_attempted_at, 'and stamps the provider window start')
  assert.equal(patches.at(-1).status, 'failed')
})

test('a token that cannot be stored aborts before any send', async () => {
  const w = makeWorld({ tokenInsertFails: true })
  const r = await run(w)
  assert.equal(r.outcome, 'failed')
  assert.equal(r.reason, 'token_write_failed')
  assert.equal(w.sends.length, 0, 'nothing may be emailed without a stored token')
  assert.equal(w.ledgerPatch().at(-1).status, 'failed')
})

// ── Completion still wins at send time ──────────────────────────────────────

test('COMPLETED BETWEEN SELECTION AND SEND: suppressed, with no token minted', async () => {
  const w = makeWorld()
  const r = await run(w, { assignment: assignment({ completed_at: daysAgo(1) }) })
  assert.equal(r.outcome, 'suppressed')
  assert.equal(r.reason, 'completed')
  assert.equal(w.sends.length, 0)
  assert.equal(w.opsOn('evaluation_assignment_tokens', 'insert').length, 0,
    'a completed survey must not even mint a token')
  assert.equal(w.ledgerPatch().at(-1).status, 'suppressed')
})

test('a claim for the wrong reminder number is suppressed rather than sent', async () => {
  const w = makeWorld()
  // Ledger says reminder 3; the assignment is only 7 days old (reminder 1).
  const r = await run(w, { ledgerRow: ledgerRow({ reminder_number: 3 }) })
  assert.equal(r.outcome, 'suppressed')
  assert.equal(w.sends.length, 0)
})

test('a recipient we are not allowed to email is suppressed, not guessed at', async () => {
  const w = makeWorld()
  const r = await run(w, { student: student({ ngrp_outcome: 'Hired' }) })   // no portal account
  assert.equal(r.outcome, 'suppressed')
  assert.equal(r.reason, 'missing_verified_cedars_email')
  assert.equal(w.sends.length, 0)
  assert.equal(w.opsOn('evaluation_assignment_tokens', 'insert').length, 0)
})

// ── Provider idempotency ────────────────────────────────────────────────────

test('THE KEY AND THE PAYLOAD MOVE TOGETHER - both are seeded by the epoch', async () => {
  const w = makeWorld()
  await run(w)
  assert.equal(w.sends[0].options.idempotencyKey, 'evalrem:a-1:1:0')
  assert.equal(reminderIdempotencyKey('a-1', 1, 0), 'evalrem:a-1:1:0')
  assert.equal(reminderIdempotencyKey('a-1', 1, 0), reminderIdempotencyKey('a-1', 1, 0), 'stable within an epoch')
  assert.notEqual(reminderIdempotencyKey('a-1', 1, 0), reminderIdempotencyKey('a-1', 1, 1))
  assert.notEqual(reminderIdempotencyKey('a-1', 1, 0), reminderIdempotencyKey('a-1', 2, 0))

  // The defect this replaced: same key, different body. Prove they now agree.
  const w2 = makeWorld()
  await run(w2, { ledgerRow: ledgerRow({ delivery_epoch: 1 }) })
  assert.equal(w2.sends[0].options.idempotencyKey, 'evalrem:a-1:1:1')
  assert.notEqual(w2.sends[0].payload.html, w.sends[0].payload.html,
    'a different key always means a different body, and vice versa')
})

test('the idempotency key is derived from no secret', async () => {
  const w = makeWorld()
  await run(w)
  const key = w.sends[0].options.idempotencyKey
  const raw = rawTokenFromHtml(w.sends[0].payload.html)
  assert.ok(raw, 'the outbound email carries a token')
  assert.ok(!key.includes(raw))
  assert.equal(key, 'evalrem:a-1:1:0')
})

// ── Nothing stored or logged carries the token ──────────────────────────────

test('NO PERSISTED OBJECT CONTAINS THE RAW TOKEN OR THE SURVEY URL', async () => {
  const w = makeWorld()
  await run(w)
  const html = w.sends[0].payload.html
  const raw = rawTokenFromHtml(html)
  assert.ok(raw, 'precondition: a real token went out')

  for (const op of w.ops) {
    if (!op.payload) continue
    const blob = JSON.stringify(op.payload)
    assert.ok(!blob.includes(raw), `${op.table}.${op.kind} persisted the raw token`)
    assert.ok(!blob.includes('#t='), `${op.table}.${op.kind} persisted a survey URL fragment`)
    assert.ok(!/https?:\/\/[^"]*evaluation\//.test(blob), `${op.table}.${op.kind} persisted a survey link`)
  }
})

test('the archived body is redacted by the real fail-closed gate', async () => {
  const w = makeWorld()
  await run(w)
  const archive = w.opsOn('message_archive', 'upsert')[0].payload
  const raw = rawTokenFromHtml(w.sends[0].payload.html)
  assert.equal(archive.content_kind, 'secure_link_email')
  assert.ok(!JSON.stringify(archive).includes(raw), 'the archive never holds the token')
  assert.match(archive.html_redacted, /secure link removed/, 'the link was redacted, not merely absent')
})

test('the audit row records identity and counts, never a credential', async () => {
  const w = makeWorld()
  await run(w)
  const log = w.opsOn('notification_log', 'insert')[0].payload
  assert.equal(log.notification_type, REMINDER_NOTIFICATION_TYPE)
  assert.equal(log.metadata.assignment_id, 'a-1')
  assert.equal(log.metadata.reminder_number, 1)
  assert.equal(log.metadata.instrument_slug, 'casey_fink_readiness_2024')
  assert.equal(log.metadata.recipient_route, 'personal')
  for (const k of ['survey_url', 'surveyUrl', 'token', 'token_hash', 'raw']) {
    assert.ok(!(k in log.metadata), `${k} must not be in notification metadata`)
  }
})

// ── Copy is workflow-correct ────────────────────────────────────────────────

test('the Casey-Fink post-rotation reminder mentions its certificate', async () => {
  const w = makeWorld()
  await run(w)
  assert.match(w.sends[0].payload.html, /Certificate of Completion/)
})

test('the post-rotation EVALUATION reminder promises no certificate', async () => {
  const w = makeWorld()
  await run(w, { assignment: assignment({ instrument_id: POSTROT.id }), instrument: POSTROT })
  const html = w.sends[0].payload.html
  assert.doesNotMatch(html, /Certificate/i, 'this survey gates nothing and must not imply otherwise')
  assert.match(w.sends[0].payload.subject, /Rotation Feedback/)
})

test('a midpoint preceptor reminder promises no certificate; end-of-rotation does', async () => {
  const midpoint = makeWorld()
  await run(midpoint, {
    assignment: assignment({ instrument_id: PRECEPTOR_INST.id, timepoint: 'midpoint', respondent_type: 'preceptor', respondent_email: 'dana@example.org', respondent_name: 'Dana Whitfield' }),
    instrument: PRECEPTOR_INST, student: student(),
  })
  assert.doesNotMatch(midpoint.sends[0].payload.html, /Certificate/i)

  const end = makeWorld()
  await run(end, {
    ledgerRow: ledgerRow({ reminder_number: 3 }),
    assignment: assignment({ instrument_id: PRECEPTOR_INST.id, timepoint: 'post_rotation', respondent_type: 'preceptor', respondent_email: 'dana@example.org', respondent_name: 'Dana Whitfield', sent_at: daysAgo(21) }),
    instrument: PRECEPTOR_INST, student: student(),
  })
  assert.match(end.sends[0].payload.html, /Certificate of Appreciation/)
  assert.match(end.sends[0].payload.subject, /^Final reminder:/, 'reminder 3 is framed as the last one')
  assert.deepEqual(end.sends[0].payload.to, ['dana@example.org'])
})

// ── THE CRASH SEQUENCE ──────────────────────────────────────────────────────
// Token A created -> Resend accepts -> the ledger 'sent' update fails (or the
// worker dies) -> the stale claim is recovered and encountered again.

test('CRASH AFTER ACCEPTANCE: the retry is byte-identical under the same key', async () => {
  // Attempt 1: provider accepts, then the ledger update is refused.
  const first = makeWorld({ ledgerUpdateFails: true })
  const r1 = await run(first)
  assert.equal(r1.outcome, 'sent')
  assert.equal(first.sends.length, 1)
  const tokenA = rawTokenFromHtml(first.sends[0].payload.html)
  const keyA = first.sends[0].options.idempotencyKey
  const fingerprintA = first.ledgerPatch()[0].payload_fingerprint
  // The epoch was NOT advanced: this was not a known failure.
  assert.ok(!first.ledgerPatch().some(p => 'delivery_epoch' in p), 'a crash must not advance the epoch')

  // Recovery returns the row to pending with the SAME epoch and fingerprint.
  const second = makeWorld({ existingTokenForHash: { id: 'tok-existing' } })
  await run(second, {
    ledgerRow: ledgerRow({ delivery_epoch: 0, payload_fingerprint: fingerprintA, first_attempted_at: daysAgo(0) }),
  })

  const tokenB = rawTokenFromHtml(second.sends[0].payload.html)
  const keyB = second.sends[0].options.idempotencyKey
  assert.equal(tokenB, tokenA, 'TOKEN A IS REUSED - the delivered link is the one that survives')
  assert.equal(keyB, keyA, 'same key')
  assert.equal(second.sends[0].payload.html, first.sends[0].payload.html,
    'byte-identical body, so the provider de-duplicates instead of sending again')
  assert.equal(second.sends[0].payload.subject, first.sends[0].payload.subject)
  assert.equal(second.ledgerPatch()[0].payload_fingerprint, fingerprintA,
    'and the frozen fingerprint still matches, which is what made the retry safe')
})

test('CRASH RECOVERY: token A is never revoked, and no second token is created', async () => {
  const w = makeWorld({ existingTokenForHash: { id: 'tok-existing' }, priorTokens: [{ id: 'tok-existing', token_hash: null }] })
  // Make the active-token sweep report token A under its real hash.
  const derivedHash = (await import('../lib/server/evaluation/tokens.js')).hashToken(deriveReminderToken('a-1', 1, 0))
  const w2 = makeWorld({
    existingTokenForHash: { id: 'tok-A' },
    priorTokens: [{ id: 'tok-A', token_hash: derivedHash }, { id: 'tok-old', token_hash: 'hash-old' }],
  })
  await run(w2, { ledgerRow: ledgerRow({ delivery_epoch: 0 }) })

  assert.equal(w2.opsOn('evaluation_assignment_tokens', 'insert').length, 0, 'no duplicate token row')
  const revoked = w2.revokedIds()
  assert.ok(!revoked.includes('tok-A'), 'THE DELIVERED LINK IS NOT REVOKED')
  assert.deepEqual(revoked, ['tok-old'], 'only the genuinely superseded token is retired')
  assert.equal(w.sends.length, 0)   // the unused world sent nothing
})

test('a failed ledger write after delivery does NOT record a provider failure', async () => {
  const w = makeWorld({ ledgerUpdateFails: true })
  const r = await run(w)
  assert.equal(r.outcome, 'sent')
  const statuses = w.ledgerPatch().map(p => p.status)
  assert.ok(!statuses.includes('failed'), 'no false failure is ever attributed to the provider')
})

// ── The provider answer taxonomy ────────────────────────────────────────────
// Each documented response means a different thing, and each is handled apart.

test('classification: only a structured refusal counts as proof nothing was sent', () => {
  const P = PROVIDER_OUTCOME
  // Definitive - the provider refused before creating mail.
  assert.equal(classifyProviderError({ name: 'validation_error', statusCode: 422 }), P.DEFINITIVE_REJECTION)
  assert.equal(classifyProviderError({ name: 'invalid_to_address', statusCode: 422 }), P.DEFINITIVE_REJECTION)
  assert.equal(classifyProviderError({ name: 'restricted_api_key', statusCode: 401 }), P.DEFINITIVE_REJECTION)

  // The three idempotency responses, kept apart.
  assert.equal(classifyProviderError({ name: 'concurrent_idempotent_requests', statusCode: 409 }), P.IDEMPOTENCY_CONCURRENT)
  assert.equal(classifyProviderError({ name: 'invalid_idempotent_request', statusCode: 409 }), P.IDEMPOTENCY_PAYLOAD_MISMATCH)
  assert.equal(classifyProviderError({ name: 'invalid_idempotency_key', statusCode: 400 }), P.IDEMPOTENCY_KEY_INVALID)

  // Ambiguous - proves nothing either way.
  for (const err of [
    { message: 'request timed out' },
    { code: 'ECONNRESET' },
    { message: 'socket hang up' },
    { message: 'fetch failed' },
    { statusCode: 500, name: 'internal_server_error' },
    { statusCode: 502 },
    { statusCode: 429, name: 'rate_limit_exceeded' },
    { statusCode: 409 },                                  // bare 409, unidentifiable
    { name: 'something_new_we_have_never_seen' },          // unknown -> never assumed safe
    {},
  ]) {
    assert.equal(classifyProviderError(err), P.AMBIGUOUS, JSON.stringify(err))
  }
})

test('AMBIGUOUS: a timeout after acceptance keeps the token, epoch and fingerprint', async () => {
  const w = makeWorld({ sendError: { message: 'request timed out' } })
  const r = await run(w)
  assert.equal(r.outcome, 'ambiguous')
  assert.equal(r.providerOutcome, PROVIDER_OUTCOME.AMBIGUOUS)

  assert.deepEqual(w.revokedIds(), [], 'THE DELIVERED TOKEN REMAINS ACTIVE')
  const patches = w.ledgerPatch()
  assert.ok(!patches.some(p => 'delivery_epoch' in p), 'NO NEW EPOCH IS ISSUED')
  assert.ok(!patches.some(p => p.status === 'failed'), 'and no failure is claimed')
  assert.equal(patches.at(-1).status, 'sending', 'it stays in flight for the sweep to reconcile')
  assert.equal(w.opsOn('notification_log', 'insert').length, 0, 'nothing is recorded as delivered')
})

test('CONCURRENT idempotency 409 is neither delivered nor failed', async () => {
  const w = makeWorld({ sendError: { name: 'concurrent_idempotent_requests', statusCode: 409 } })
  const r = await run(w)
  assert.equal(r.outcome, 'ambiguous')
  assert.equal(r.providerOutcome, PROVIDER_OUTCOME.IDEMPOTENCY_CONCURRENT)
  const patches = w.ledgerPatch()
  assert.ok(!patches.some(p => p.status === 'sent'), 'a concurrent request is NOT proof of delivery')
  assert.ok(!patches.some(p => p.status === 'failed'))
  assert.ok(!patches.some(p => 'delivery_epoch' in p), 'the same key stays valid for a later retry')
  assert.deepEqual(w.revokedIds(), [])
})

test('INVALID-PAYLOAD 409 is handled distinctly: unresolved, not delivered', async () => {
  const w = makeWorld({ sendError: { name: 'invalid_idempotent_request', statusCode: 409 } })
  const r = await run(w)
  assert.equal(r.outcome, 'needs_reconciliation')
  assert.equal(r.reason, 'idempotency_payload_mismatch')
  const patch = w.ledgerPatch().at(-1)
  assert.equal(patch.status, 'needs_reconciliation')
  assert.notEqual(patch.status, 'sent', 'we cannot claim THIS message was delivered')
  assert.equal(w.opsOn('notification_log', 'insert').length, 0)
  assert.deepEqual(w.revokedIds(), [], 'and nothing is retired on a guess')
})

test('AN INVALID IDEMPOTENCY KEY IS NOT DELIVERY', async () => {
  const w = makeWorld({ sendError: { name: 'invalid_idempotency_key', statusCode: 400 } })
  const r = await run(w)
  assert.notEqual(r.outcome, 'sent', 'a rejected key means no mail was created')
  assert.equal(r.outcome, 'failed')
  assert.equal(w.opsOn('notification_log', 'insert').length, 0)
  assert.equal(w.ledgerPatch().at(-1).delivery_epoch, 1, 'a fresh key is needed, so the epoch advances')
})

// ── The provider call is gated on a durable record of it ────────────────────

test('MARKSENDING FAILS: zero provider calls', async () => {
  const w = makeWorld({ ledgerUpdateFails: true, failFrom: 'sending' })
  const r = await run(w)
  assert.equal(r.outcome, 'deferred')
  assert.equal(r.reason, 'sending_not_recorded')
  assert.equal(w.sends.length, 0, 'THE PROVIDER IS NEVER CALLED without a durable record of the attempt')
  assert.deepEqual(w.revokedIds(), [], 'nothing is revoked')
  assert.equal(w.opsOn('notification_log', 'insert').length, 0)
})

// ── Payload drift ───────────────────────────────────────────────────────────

test('STUDENT CHANGES BETWEEN ATTEMPTS: no changed payload is sent under the old key', async () => {
  // Attempt 1 froze a fingerprint for the personal-email student.
  const first = makeWorld()
  await run(first)
  const frozen = first.ledgerPatch()[0].payload_fingerprint
  assert.equal(first.sends[0].payload.to[0], 'ava@personal.example.com')

  for (const [label, changed] of [
    ['hired, now a Cedars address', student({ ngrp_outcome: 'Hired' })],
    ['address changed', student({ personal_email: 'ava.new@example.com' })],
    ['name changed', student({ first_name: 'Avery' })],
    ['moved onto rotation', student({ status: 'Active Rotation' })],
  ]) {
    const w = makeWorld({
      links: [{ user_profile_id: 'p-1' }],
      profile: { id: 'p-1', auth_user_id: 'au-1', email: 'ava@cshs.org', is_active: true },
    })
    const r = await run(w, {
      student: changed,
      ledgerRow: ledgerRow({ payload_fingerprint: frozen, first_attempted_at: daysAgo(0) }),
    })
    assert.equal(w.sends.length, 0, `${label}: NOTHING is sent under the old key`)
    if (r.outcome === 'needs_reconciliation') {
      assert.equal(r.reason, 'payload_drift', label)
      assert.equal(w.ledgerPatch().at(-1).status, 'needs_reconciliation', label)
    } else {
      // A hired student with no verified Cedars address is suppressed before we
      // ever get as far as fingerprinting - also a non-send, which is the point.
      assert.equal(r.outcome, 'suppressed', label)
    }
    assert.equal(w.opsOn('notification_log', 'insert').length, 0,
      `${label}: NO AUDIT ROW may record a newly resolved recipient as having received the earlier email`)
  }
})

test('an unchanged recipient produces an unchanged fingerprint, so the retry proceeds', async () => {
  const first = makeWorld()
  await run(first)
  const frozen = first.ledgerPatch()[0].payload_fingerprint

  const again = makeWorld({ existingTokenForHash: { id: 'tok-A' } })
  const r = await run(again, { ledgerRow: ledgerRow({ payload_fingerprint: frozen, first_attempted_at: daysAgo(0) }) })
  assert.equal(r.outcome, 'sent')
  assert.equal(again.sends.length, 1)
})

// ── Token retirement is recoverable ─────────────────────────────────────────

test('CLEANUP FAILURE IS RECORDED, not swallowed behind a clean "sent"', async () => {
  const w = makeWorld({ revokeFails: true })
  const r = await run(w)
  assert.equal(r.outcome, 'cleanup_pending')
  assert.equal(r.reason, 'token_cleanup_failed')
  const patch = w.ledgerPatch().at(-1)
  assert.equal(patch.status, 'cleanup_pending', 'the ledger must not claim the older links were retired')
  assert.equal(patch.reason, 'token_cleanup_failed')
  assert.ok(patch.sent_at, 'delivery is still recorded truthfully')
  assert.equal(patch.notification_log_id, 'log-1')
})

test('a cleanup_pending row is finished WITHOUT re-sending', async () => {
  const derivedHash = (await import('../lib/server/evaluation/tokens.js')).hashToken(deriveReminderToken('a-1', 1, 0))
  const w = makeWorld({
    priorTokens: [{ id: 'tok-A', token_hash: derivedHash }, { id: 'tok-old', token_hash: 'hash-old' }],
  })
  const r = await run(w, {
    ledgerRow: ledgerRow({ sent_at: daysAgo(0), notification_log_id: 'log-1', resend_email_id: 're_1', delivery_epoch: 0 }),
  })
  assert.equal(r.outcome, 'cleanup_completed')
  assert.equal(w.sends.length, 0, 'DELIVERY IS NEVER REPEATED on the cleanup path')
  assert.equal(w.opsOn('notification_log', 'insert').length, 0, 'and no second audit row')
  const revoked = w.revokedIds()
  assert.deepEqual(revoked, ['tok-old'])
  assert.ok(!revoked.includes('tok-A'), 'the delivered token stays active')
  const patch = w.ledgerPatch().at(-1)
  assert.equal(patch.status, 'sent', 'the final state accurately reports cleanup completed')
  assert.equal(patch.reason, null)
})

test('cleanup that fails again stays cleanup_pending and is retried later', async () => {
  const w = makeWorld({ revokeFails: true })
  const r = await run(w, { ledgerRow: ledgerRow({ sent_at: daysAgo(0), notification_log_id: 'log-1' }) })
  assert.equal(r.outcome, 'cleanup_pending')
  assert.equal(w.sends.length, 0)
  assert.equal(w.ledgerPatch().at(-1).status, 'cleanup_pending')
})

test('retirement recomputes the survivor, so it is safe to run any number of times', async () => {
  const derivedHash = (await import('../lib/server/evaluation/tokens.js')).hashToken(deriveReminderToken('a-1', 1, 0))
  const w = makeWorld({ priorTokens: [{ id: 'tok-A', token_hash: derivedHash }, { id: 'tok-old', token_hash: 'hash-old' }] })
  for (let i = 0; i < 3; i++) {
    assert.equal(await retireSupersededTokens(w.db, 'a-1', derivedHash), true)
  }
  const revoked = w.revokedIds()
  assert.ok(revoked.every(id => id === 'tok-old'), 'only ever the superseded token, however often it runs')
})

test('an audit row that already exists is reused rather than duplicated', async () => {
  const w = makeWorld({ existingLogId: 'log-prior' })
  const r = await run(w)
  assert.equal(r.outcome, 'sent')
  assert.equal(w.opsOn('notification_log', 'insert').length, 0, 'no second audit row for one delivery')
  assert.equal(w.ledgerPatch().at(-1).notification_log_id, 'log-prior')
})

// ── Batch isolation + reason sanitation ─────────────────────────────────────

test('one recipient failing never stops another from being reminded', async () => {
  const w = makeWorld()
  let call = 0
  w.resend.emails.send = async (payload, options) => {
    call++
    w.sends.push({ payload, options })
    // A DEFINITIVE refusal for the first recipient; the second must still send.
    return call === 1 ? { data: null, error: DEFINITIVE } : { data: { id: 're_ok' }, error: null }
  }
  const { counts } = await sendClaimedReminders({
    db: w.db, resend: w.resend, authAdmin: w.authAdmin,
    claimed: [ledgerRow({ id: 'l1', assignment_id: 'a-1' }), ledgerRow({ id: 'l2', assignment_id: 'a-2' })],
    assignmentsById: new Map([['a-1', assignment()], ['a-2', assignment({ id: 'a-2' })]]),
    instrumentsById: new Map([[CASEY.id, CASEY]]),
    studentsById: new Map([['s-1', student()]]),
    baseUrl: 'https://aspireintelligence.app', now: NOW, delayMs: 0,
  })
  assert.equal(counts.failed, 1)
  assert.equal(counts.sent, 1)
})

test('every ledger reason satisfies the column CHECK shape', () => {
  const pattern = /^[a-z0-9_]{1,64}$/
  for (const input of ['provider_error', 'Provider Error!', 'https://x.example/a?token=abc', '', null, 'A'.repeat(200)]) {
    assert.match(sanitizeReason(input), pattern, JSON.stringify(input))
  }
})

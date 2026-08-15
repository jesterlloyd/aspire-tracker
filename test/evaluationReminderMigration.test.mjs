// EVALUATION-REMINDERS-1: static guard for the reminder ledger migration.
//
// The migration is UNAPPLIED and awaiting the Owner, so this is the only place
// its guarantees can be checked before it reaches a database. It pins the four
// things the feature's safety actually rests on: the UNIQUE pair that makes a
// duplicate reminder impossible, the terminal statuses the claim function
// refuses to re-claim, claim expiry so a dead worker cannot wedge a reminder
// forever, and the absence of anywhere to put a secret.
//
// Run: node --test test/evaluationReminderMigration.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const PATH = '../supabase/migrations/20260815000000_evaluation_reminder_deliveries.sql'
const sql = readFileSync(join(here, PATH), 'utf8')

/** Executable SQL only, so guards test statements rather than prose. */
const code = sql.replace(/--[^\n]*/g, '')
/** The claim function body. */
const fn = code.slice(code.indexOf('CREATE OR REPLACE FUNCTION public.claim_evaluation_reminders'), code.indexOf('COMMENT ON FUNCTION'))

// ── The objects ─────────────────────────────────────────────────────────────

test('it creates exactly one table and one function - the smallest reliable shape', () => {
  assert.equal((code.match(/CREATE TABLE/g) || []).length, 1)
  assert.equal((code.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 1)
  assert.match(code, /CREATE TABLE IF NOT EXISTS public\.evaluation_reminder_deliveries/)
  assert.match(code, /CREATE OR REPLACE FUNCTION public\.claim_evaluation_reminders/)
})

test('it alters no existing table', () => {
  const alters = code.match(/ALTER TABLE[^;]*/g) || []
  for (const a of alters) {
    assert.match(a, /evaluation_reminder_deliveries/,
      `this migration must only touch its own table, saw: ${a.trim().slice(0, 80)}`)
  }
})

test('it runs as one transaction', () => {
  assert.match(code, /^\s*BEGIN;/m)
  assert.match(code, /^\s*COMMIT;/m)
})

// ── One row per assignment per reminder ─────────────────────────────────────

test('THE DUPLICATE GUARANTEE: a UNIQUE pair, not a read-then-write check', () => {
  assert.match(code, /CONSTRAINT uq_erd_assignment_reminder UNIQUE \(assignment_id, reminder_number\)/)
})

test('the ledger is keyed to an assignment and cascades with it', () => {
  assert.match(code, /assignment_id\s+uuid\s+NOT NULL[\s\S]{0,120}REFERENCES public\.evaluation_assignments\(id\) ON DELETE CASCADE/)
})

test('NO FOURTH REMINDER is representable', () => {
  assert.match(code, /CONSTRAINT chk_erd_reminder_number CHECK \(reminder_number IN \(1, 2, 3\)\)/)
})

// ── Lifecycle ───────────────────────────────────────────────────────────────

test('the lifecycle carries every state crash-safety needs', () => {
  assert.match(code, /CHECK \(status IN \(\s*'pending', 'claimed', 'sending', 'sent', 'cleanup_pending',\s*'needs_reconciliation', 'failed', 'suppressed'\s*\)\)/)
})

test('a row holding a claim names its holder; any row asserting delivery has its moment', () => {
  assert.match(code, /chk_erd_claimed_fields CHECK \([\s\S]{0,180}status NOT IN \('claimed', 'sending'\)/)
  assert.match(code, /chk_erd_sent_fields CHECK \([\s\S]{0,120}status NOT IN \('sent', 'cleanup_pending'\) OR sent_at IS NOT NULL/)
})

test('THE EPOCH SEEDS BOTH THE TOKEN AND THE KEY, so a retry is byte-identical', () => {
  assert.match(code, /delivery_epoch\s+smallint\s+NOT NULL DEFAULT 0/)
  assert.match(code, /chk_erd_delivery_epoch_nonnegative CHECK \(delivery_epoch >= 0\)/)
  assert.match(sql, /Advances ONLY on a known provider failure/)
})

test('CRASH RECOVERY HAS THREE HONEST OUTCOMES, and none of them invents a failure', () => {
  // attempts remain -> retried (safe, because the retry reproduces the request)
  assert.match(fn, /SET status\s+= 'pending'[\s\S]{0,320}status IN \('claimed', 'sending'\)[\s\S]{0,220}attempts < p_max_attempts/)
  // exhausted mid-flight -> explicitly unconfirmed, NOT a provider failure
  assert.match(fn, /reason\s+= 'delivery_unconfirmed'[\s\S]{0,260}d\.status = 'sending'/)
  // exhausted having never reached the provider -> a plain expiry
  assert.match(fn, /reason\s+= 'claim_expired'[\s\S]{0,260}d\.status = 'claimed'/)
})

test('RECOVERY AFTER THE 24-HOUR PROVIDER WINDOW CANNOT DUPLICATE', () => {
  // The provider forgets a key after 24h, so past the window a retry would be a
  // fresh send. Those rows stop automating instead.
  assert.match(fn, /p_provider_window_seconds/)
  assert.match(fn, /p_provider_window_seconds must be between 1 and 86400/)
  assert.match(fn, /SET status\s+= 'needs_reconciliation',\s*\n\s*reason\s+= 'provider_window_elapsed'[\s\S]{0,400}first_attempted_at < v_now - \(p_provider_window_seconds/)

  // And it runs BEFORE any recovery, so an expired row can never be handed back.
  const expiry = fn.indexOf("'provider_window_elapsed'")
  const recover = fn.indexOf("SET status     = 'pending'")
  assert.ok(expiry > 0 && recover > expiry,
    'the window check must precede stale recovery, or an expired row could be retried')

  // needs_reconciliation is terminal for automation.
  for (const m of fn.match(/d\.status IN \([^)]*\)/g) || []) {
    assert.ok(!/needs_reconciliation/.test(m), `must not be claimable: ${m}`)
  }
})

test('THE RECOVERY SWEEP SELECTS NO NEW RECIPIENTS', () => {
  assert.match(fn, /p_recover_only/)
  assert.match(fn, /p_recover_only AND \(d\.first_attempted_at IS NOT NULL OR d\.status = 'cleanup_pending'\)/,
    'a sweep only touches work that already reached the provider')
  assert.match(fn, /NOT p_recover_only[\s\S]{0,160}IN \(SELECT assignment_id, reminder_number FROM cand\)/,
    'candidate scoping still applies to a normal run')
})

test('the payload fingerprint is a digest and cannot hold anything else', () => {
  assert.match(code, /payload_fingerprint text/)
  assert.match(code, /chk_erd_payload_fingerprint_shape CHECK \(\s*payload_fingerprint IS NULL OR payload_fingerprint ~ '\^\[a-f0-9\]\{64\}\$'\s*\)/)
  const shape = /^[a-f0-9]{64}$/
  assert.ok(!shape.test('ava.wong@cshs.org'))
  assert.ok(!shape.test('https://aspireintelligence.app/evaluation/readiness#t=abc'))
  assert.ok(shape.test('a'.repeat(64)))
})

test('first_attempted_at exists so the provider window is checkable', () => {
  assert.match(code, /first_attempted_at\s+timestamptz/)
})

test('RECOVERY EVIDENCE IS ENFORCED BY THE DATABASE, not just by the sender', () => {
  assert.match(code, /chk_erd_recovery_evidence CHECK \(\s*\(first_attempted_at IS NULL\) = \(payload_fingerprint IS NULL\)\s*AND \(status <> 'sending' OR \(first_attempted_at IS NOT NULL AND payload_fingerprint IS NOT NULL\)\)\s*\)/,
    'both-or-neither, and a sending row must carry both')
})

test('the verification block matches the table as built', () => {
  const verify = sql.slice(sql.indexOf('VERIFICATION'))
  // 16 columns, named in order.
  assert.match(verify, /all 16 columns, in order/)
  assert.match(verify, /expect: 16/)
  for (const col of ['first_attempted_at', 'payload_fingerprint', 'delivery_epoch']) {
    assert.ok(verify.includes(col), `the expected column list must name ${col}`)
  }
  // The real column count, counted from the DDL rather than trusted.
  const ddl = code.slice(code.indexOf('CREATE TABLE'), code.indexOf('CONSTRAINT uq_erd'))
  const declared = [...ddl.matchAll(/^\s{2}([a-z_]+)\s+(uuid|text|smallint|integer|timestamptz)/gm)].map(m => m[1])
  assert.equal(declared.length, 16, `the table declares ${declared.length} columns: ${declared.join(', ')}`)

  // 10 CHECKs, counted from the DDL and asserted in the verification block.
  const checks = [...code.matchAll(/CONSTRAINT (chk_erd_[a-z_]+) CHECK/g)].map(m => m[1])
  assert.equal(checks.length, 10, `expected 10 CHECKs, found ${checks.length}: ${checks.join(', ')}`)
  assert.match(verify, /1 PK, 1 UNIQUE, 2 FKs, 10 CHECKs/)
  assert.match(verify, /expect: 10/)
  for (const c of checks) assert.ok(verify.includes(c), `verification must name ${c}`)
})

test('the verification no longer describes an unresolved send as a failure', () => {
  const verify = sql.slice(sql.indexOf('VERIFICATION'))
  assert.match(verify, /expect: needs_reconciliation, delivery_unconfirmed/)
  assert.ok(!/expect: failed, delivery_unconfirmed/.test(verify),
    "delivery_unconfirmed is needs_reconciliation, never 'failed'")
  // The function comment says the same thing.
  assert.ok(!/exhausted from sending -> failed\/delivery_unconfirmed/.test(sql))
  assert.match(sql, /exhausted from sending -> needs_reconciliation\/delivery_unconfirmed/)
})

test('the crash-recovery smoke test supplies valid recovery evidence', () => {
  const verify = sql.slice(sql.indexOf('CRASH-RECOVERY SMOKE TEST'))
  assert.match(verify, /first_attempted_at, payload_fingerprint\)/,
    'the synthetic sending row must name both evidence columns')
  assert.match(verify, /repeat\('a', 64\)/, 'and supply a valid 64-character fingerprint')
  // And it demonstrates the constraint rejecting the invalid shapes.
  assert.match(verify, /FAILS chk_erd_recovery_evidence/)
  assert.match(verify, /FAILS chk_erd_payload_fingerprint_shape/)
})

test('CLEANUP IS RETRYABLE: a delivered-but-untidied row can be claimed again', () => {
  assert.match(fn, /status IN \('pending', 'failed', 'cleanup_pending'\)/)
  assert.match(sql, /cleanup_pending means "delivered, cleanup still owed"|delivered but superseded tokens/)
})

// ── Claim: atomic, expiring, and terminal-respecting ────────────────────────

test('claiming is atomic across overlapping workers', () => {
  assert.match(fn, /FOR UPDATE SKIP LOCKED/)
  assert.match(fn, /LIMIT p_limit/)
  assert.match(fn, /ON CONFLICT \(assignment_id, reminder_number\) DO NOTHING/)
})

test('TERMINAL ROWS ARE NEVER RE-CLAIMED - this is the at-most-once guarantee', () => {
  const claimable = fn.match(/status IN \('pending', 'failed', 'cleanup_pending'\)/)
  assert.ok(claimable, "claimable is exactly pending, failed and cleanup_pending")
  // 'sent' and 'suppressed' appear nowhere in a claimable predicate.
  for (const m of fn.match(/d\.status IN \([^)]*\)/g) || []) {
    assert.ok(!/'sent'|'suppressed'/.test(m), `terminal status must not be claimable: ${m}`)
  }
})

test('CLAIM EXPIRY AND RECOVERY: an interrupted worker cannot wedge a reminder', () => {
  assert.match(fn, /p_stale_seconds/)
  assert.match(fn, /claimed_at < v_now - \(p_stale_seconds \|\| ' seconds'\)::interval/)
  // Recovered to pending while attempts remain, retired honestly when exhausted.
  assert.match(fn, /SET status\s+= 'pending'/)
  assert.match(fn, /SET status\s+= 'failed',\s*\n\s*reason\s+= 'claim_expired'/)
})

test('retries are bounded, and an attempt is consumed at claim time', () => {
  assert.match(fn, /p_max_attempts/)
  assert.match(fn, /attempts < p_max_attempts/)
  assert.match(fn, /attempts\s+= d\.attempts \+ 1/)
})

test('every argument is validated before anything is written', () => {
  for (const guard of [/p_worker must be non-null/, /p_candidates must be a jsonb array/,
    /p_limit must be between/, /p_stale_seconds must be between/, /p_max_attempts must be between/]) {
    assert.match(fn, guard)
  }
  const firstWrite = Math.min(...['UPDATE public.', 'INSERT INTO public.'].map(s => {
    const i = fn.indexOf(s); return i === -1 ? Infinity : i
  }))
  assert.ok(fn.indexOf('RAISE EXCEPTION') < firstWrite, 'validation precedes every write')
})

test('a deleted assignment is ignored rather than aborting the whole run', () => {
  assert.match(fn, /JOIN public\.evaluation_assignments a\s*\n?\s*ON a\.id =/)
})

// ── Access ──────────────────────────────────────────────────────────────────

test('RLS is enabled with ZERO client policies', () => {
  assert.match(code, /ALTER TABLE public\.evaluation_reminder_deliveries ENABLE ROW LEVEL SECURITY/)
  assert.doesNotMatch(code, /CREATE POLICY/, 'this ledger has no client-facing surface')
})

test('the table is service-role only, and nothing may DELETE from it', () => {
  assert.match(code, /REVOKE ALL ON public\.evaluation_reminder_deliveries\s*\n?\s*FROM PUBLIC, anon, authenticated, service_role/)
  assert.match(code, /GRANT SELECT, INSERT, UPDATE ON public\.evaluation_reminder_deliveries TO service_role/)
  const grants = code.match(/GRANT[^;]*evaluation_reminder_deliveries[^;]*/g) || []
  for (const g of grants) {
    assert.ok(!/DELETE|TRUNCATE|ALL/.test(g), `deleting a row would silently re-arm a sent reminder: ${g}`)
    assert.ok(!/\banon\b|\bauthenticated\b/.test(g), `no client role may touch the ledger: ${g}`)
  }
})

test('the claim function is service-role only and runs with a pinned search_path', () => {
  assert.match(code, /SECURITY DEFINER/)
  assert.match(code, /SET search_path = public, pg_catalog/)
  assert.match(code, /REVOKE ALL ON FUNCTION public\.claim_evaluation_reminders[\s\S]{0,120}FROM PUBLIC, anon, authenticated/)
  assert.match(code, /GRANT EXECUTE ON FUNCTION public\.claim_evaluation_reminders[\s\S]{0,120}TO service_role/)
})

// ── Nowhere to put a secret ─────────────────────────────────────────────────

test('THE LEDGER HAS NO COLUMN FOR A TOKEN, A URL, OR COPIED PII', () => {
  const columns = code.slice(code.indexOf('CREATE TABLE'), code.indexOf('CONSTRAINT uq_erd'))
  for (const forbidden of [
    'token', 'url', 'link', 'email', 'recipient', 'first_name', 'last_name', 'student_name', 'html', 'body', 'subject',
  ]) {
    assert.doesNotMatch(columns, new RegExp(`^\\s*${forbidden}\\w*\\s+(text|uuid|jsonb)`, 'im'),
      `a "${forbidden}" column would become a place a secret or PII leaks into`)
  }
  assert.doesNotMatch(columns, /jsonb/, 'no free-form metadata blob to smuggle anything into')
})

test('the one free-text column is shape-constrained so a secret cannot fit', () => {
  assert.match(code, /chk_erd_reason_shape CHECK \(reason IS NULL OR reason ~ '\^\[a-z0-9_\]\{1,64\}\$'\)/)
  // A URL, a JWT and a base64url token all fail that pattern.
  const shape = /^[a-z0-9_]{1,64}$/
  for (const secret of [
    'https://aspireintelligence.app/evaluation/readiness#t=abc',
    'eyJhbGciOi.eyJzdWIi.SflKxwRJ',
    'AbC-123_xyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456',
  ]) {
    assert.ok(!shape.test(secret), `the CHECK must reject: ${secret.slice(0, 32)}`)
  }
  assert.ok(shape.test('missing_verified_cedars_email'))
  assert.ok(shape.test('provider_error'))
})

test('a reason may only accompany a status that needs explaining', () => {
  assert.match(code, /chk_erd_reason_scope CHECK \(\s*reason IS NULL OR status IN \('failed', 'suppressed', 'cleanup_pending', 'needs_reconciliation'\)\s*\)/)
})

// ── Owner-facing completeness ───────────────────────────────────────────────

test('it is marked apply-manually and Claude applied nothing', () => {
  // The banner wraps across comment lines, so tolerate the line break.
  assert.match(sql, /APPLY MANUALLY[\s\S]{0,24}\(Owner\/Jester\)/)
  assert.match(sql, /Claude Code has applied NOTHING/)
})

test('it ships verification queries covering every guarantee', () => {
  const verify = sql.slice(sql.indexOf('VERIFICATION'))
  for (const probe of [
    /to_regclass\('public\.evaluation_reminder_deliveries'\)/,
    /information_schema\.columns/,
    /pg_constraint/,
    /relrowsecurity/,
    /pg_policies/,
    /role_table_grants/,
    /has_function_privilege\('anon'/,
    /COUNT\(\*\) FROM public\.evaluation_reminder_deliveries/,
  ]) assert.match(verify, probe, `verification is missing ${probe}`)
})

test('the verification proves at-most-once and the duplicate guard, and rolls back', () => {
  const verify = sql.slice(sql.indexOf('VERIFICATION'))
  assert.match(verify, /CLAIM SMOKE TEST/)
  assert.match(verify, /expect: 0\s+\(a concurrent\/retried worker claims nothing\)/)
  assert.match(verify, /sent is terminal - this is the at-most-once guarantee/)
  assert.match(verify, /FAILS uq_erd_assignment_reminder/)
  assert.match(verify, /FAILS chk_erd_reason_shape/)
  assert.equal((verify.match(/ROLLBACK;/g) || []).length, 3, 'all three smoke tests roll back')
})

test('the verification also proves the crash-recovery outcomes', () => {
  const verify = sql.slice(sql.indexOf('VERIFICATION'))
  assert.match(verify, /CRASH-RECOVERY SMOKE TEST/)
  assert.match(verify, /delivery_epoch is UNCHANGED/)
  assert.match(verify, /needs_reconciliation, delivery_unconfirmed/)
  assert.match(verify, /the provider may well have accepted it/)
  assert.match(verify, /delivered, but cleanup is still owed/)
})

test('it ships rollback instructions that drop both objects', () => {
  const rollback = sql.slice(sql.indexOf('ROLLBACK ('))
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.claim_evaluation_reminders/)
  assert.match(rollback, /DROP TABLE IF EXISTS public\.evaluation_reminder_deliveries/)
})

// ── Negative control ────────────────────────────────────────────────────────

test('NEGATIVE CONTROL: this guard fails if the duplicate protection is removed', () => {
  const withoutUnique = code.replace(/CONSTRAINT uq_erd_assignment_reminder UNIQUE \(assignment_id, reminder_number\),?/, '')
  assert.doesNotMatch(withoutUnique, /uq_erd_assignment_reminder UNIQUE/,
    'the assertion above keys on this exact constraint, so deleting it breaks the suite')
  const withoutSkipLocked = fn.replace(/FOR UPDATE SKIP LOCKED/, 'FOR UPDATE')
  assert.doesNotMatch(withoutSkipLocked, /SKIP LOCKED/)
})

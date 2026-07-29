// MESSAGES-LIFECYCLE-PHASE2-PURGE-POSTURE: regression guards for the purge
// policy and Owner runbook. Documentation-only phase: these tests pin the
// runbook's safety invariants so a later edit cannot silently weaken them.
// Static-source assertions only; no database, API, or network access.
//
// Companion doc: docs/security/MESSAGES_PURGE_POSTURE.md
//
// Run: node --test test/messagesPurgePosture.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const doc = read('docs/security/MESSAGES_PURGE_POSTURE.md')
const gateDoc = read('docs/security/OWNER_SQL_GATE.md')

// Every fenced SQL block in the runbook, and the single mutating block (X1).
const sqlBlocks = [...doc.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1])
const mutatingBlocks = sqlBlocks.filter((b) => /\bDELETE\s+FROM\b/i.test(b))

test('runbook doc exists with policy, runbook, issues, and record sections', () => {
  assert.match(doc, /## 2\. Policy: archive is the lifecycle, purge is the exception/)
  assert.match(doc, /## 3\. Authorization and execution/)
  assert.match(doc, /## 5\. Owner runbook: purge of explicitly identified TEST conversations/)
  assert.match(doc, /## 6\. Issues reviewed before prescribing the runbook/)
  assert.match(doc, /## 7\. Authorization and execution records/)
})

test('doc contains no em dash', () => {
  assert.ok(!doc.includes('—'), 'em dash found in MESSAGES_PURGE_POSTURE.md')
})

test('runbook has SQL blocks and exactly one mutating block', () => {
  assert.ok(sqlBlocks.length >= 5, `expected at least 5 sql blocks, found ${sqlBlocks.length}`)
  assert.equal(mutatingBlocks.length, 1, 'exactly one block may contain DELETE FROM')
})

test('no SQL block uses TRUNCATE, DROP, UPDATE, or pattern-scoped deletes', () => {
  for (const block of sqlBlocks) {
    assert.doesNotMatch(block, /\bTRUNCATE\b/i)
    assert.doesNotMatch(block, /\bDROP\s+/i)
    assert.doesNotMatch(block, /\bUPDATE\s+public\./i)
    assert.doesNotMatch(block, /\bLIKE\b/i, 'purge scope must be pinned UUIDs, never pattern-matched')
    assert.doesNotMatch(block, /\bILIKE\b/i)
  }
})

test('every SQL block scopes through the pinned VALUES CTE', () => {
  for (const block of sqlBlocks) {
    assert.match(block, /WITH pinned\(conversation_id\) AS \(VALUES/, 'block must pin explicit conversation UUIDs')
    assert.match(block, /::uuid/, 'pinned ids must be uuid literals')
  }
})

test('the purge transaction is guarded: BEGIN present, ROLLBACK is the default, COMMIT never live', () => {
  const purge = mutatingBlocks[0]
  assert.match(purge, /^BEGIN;/m)
  // COMMIT and ROLLBACK both appear only inside comments (the decision point);
  // no live COMMIT/ROLLBACK statement may execute unconditionally with the block.
  const live = purge.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  assert.doesNotMatch(live, /\bCOMMIT\b/, 'COMMIT must be a manual decision, not part of the pasted block')
  assert.doesNotMatch(live, /\bROLLBACK\b/, 'ROLLBACK is issued manually at the decision point')
  assert.match(purge, /DECISION POINT/, 'purge block must end at an explicit decision point')
  assert.match(purge, /ROLLBACK;/, 'ROLLBACK must be documented as the default outcome')
})

test('purge deletes in dependency order and covers every RESTRICT table', () => {
  const purge = mutatingBlocks[0]
  const order = [
    'DELETE FROM public.message_creation_requests',
    'DELETE FROM public.message_notification_deliveries',
    'DELETE FROM public.conversation_events',
    'DELETE FROM public.messages m',
    'DELETE FROM public.conversation_participants',
    'DELETE FROM public.conversations c',
  ]
  let last = -1
  for (const t of order) {
    const idx = purge.indexOf(t)
    assert.ok(idx > last, `${t} missing or out of dependency order in the purge transaction`)
    last = idx
  }
  // The ledger delete must also cover message_id references, not only conversation_id.
  assert.match(purge, /r\.message_id IN \(SELECT id FROM public\.messages/)
})

test('runbook requires export before deletion and forbids committing it', () => {
  assert.match(doc, /Step 4 \(E1\): export before deletion/)
  assert.match(doc, /never commit it/)
  const exportIdx = doc.indexOf('Step 4 (E1)')
  const purgeIdx = doc.indexOf('Step 5 (X1)')
  assert.ok(exportIdx > 0 && purgeIdx > exportIdx, 'export step must precede the purge transaction')
})

test('post-commit verification covers the CASCADE tables too', () => {
  const verify = sqlBlocks[sqlBlocks.length - 1]
  assert.match(verify, /staff_conversation_reads/)
  assert.match(verify, /participant_conversation_reads/)
  assert.match(verify, /message_conversation_visibility/)
})

test('policy pins Owner-only execution and no application delete path', () => {
  assert.match(doc, /only the Owner executes/)
  assert.match(doc, /No pattern matching, no subject or category predicates, no date-range\s+deletes, no TRUNCATE, ever\./)
  assert.match(doc, /does\s+not authorize building one/, 'no general Delete button may be implied')
})

test('legal-erasure residue (notification_log, Resend) is called out as separate scope', () => {
  assert.match(doc, /notification_log/)
  assert.match(doc, /Resend/)
  assert.match(doc, /MUST be separately assessed for any legal-erasure case/)
})

test('OWNER_SQL_GATE.md registers the purge posture as documentation-only', () => {
  assert.match(gateDoc, /MESSAGES_PURGE_POSTURE\.md/)
  assert.match(gateDoc, /purge/i)
})

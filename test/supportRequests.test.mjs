// test/supportRequests.test.mjs
//
// ASPIRE-SUPPORT-REQUEST-ACTION-CENTER-1 / -2 regression harness. Standalone (no test framework in
// this repo). Run: `node test/supportRequests.test.mjs`. Deterministic, no network, no DB, no send.
//
// Exercises the EXACT production helpers (src/lib/support/supportRequests.js) that the four UI
// consumers (bell, Action Center, Rotation badge, shift dot) and the modal mark-as-read use, so the
// per-user unread read-state semantics (UX Scenarios A-E) and the SHA-256 fingerprint are verified
// without a browser. Identity is public.user_profiles.id (passed as userId here).

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  normalizeSupportText, hasSupportRequest, supportFingerprint, receiptKey,
  unreadSupportShifts, isShiftSupportUnread, unreadCountByStudent,
  unreadSupportBellCount, buildReadReceipt, supportPreview,
  supportFocusIntent, buildSupportActionItem,
} from '../src/lib/support/supportRequests.js'

let passed = 0
const ok = (name) => { console.log('  ok -', name); passed += 1 }

// Profile IDs (public.user_profiles.id), not auth.users.id.
const A = 'profile-A'
const B = 'profile-B'
const shiftS1a = { id: 'log-1', student_id: 'S1', shift_date: '2026-07-10', support_needed: 'Student anxious about IV starts, needs a check-in.' }
const shiftS1b = { id: 'log-2', student_id: 'S1', shift_date: '2026-07-11', support_needed: 'Preceptor unavailable Thursday; coverage needed.' }
const shiftS2  = { id: 'log-3', student_id: 'S2', support_needed: '   ' } // whitespace only -> no request
const logs = [shiftS1a, shiftS1b, shiftS2]
const receiptFor = (log, user = A) => ({ user_id: user, shift_log_id: log.id, support_fingerprint: supportFingerprint(log.support_needed) })

// 1. SHA-256 output is lowercase 64 hex and matches a reference implementation.
{
  const fp = supportFingerprint('Student anxious about IV starts, needs a check-in.')
  assert.match(fp, /^[0-9a-f]{64}$/)
  assert.equal(fp, createHash('sha256').update(normalizeSupportText(shiftS1a.support_needed), 'utf8').digest('hex'))
  ok('1 - SHA-256 fingerprint is lowercase 64-hex and matches reference')
}

// 2. Blank / whitespace-only support text produces no fingerprint.
{
  assert.equal(supportFingerprint(''), '')
  assert.equal(supportFingerprint('   \n\t '), '')
  assert.equal(supportFingerprint(null), '')
  ok('2 - blank support text produces no fingerprint')
}

// 3. Whitespace normalization is stable (internal runs collapse, ends trim).
{
  assert.equal(normalizeSupportText('  a   b\n\nc  '), 'a b c')
  assert.equal(supportFingerprint('  Student anxious about IV starts,\n\nneeds a   check-in.  '),
               supportFingerprint(shiftS1a.support_needed))
  ok('3 - whitespace normalization is stable')
}

// 4. A meaningful edit changes the fingerprint.
{
  const edited = 'Student anxious about IV starts AND medication passes now.'
  assert.notEqual(supportFingerprint(edited), supportFingerprint(shiftS1a.support_needed))
  ok('4 - meaningful edit changes the fingerprint')
}

// 5. A new request without a receipt is unread.
{
  assert.ok(isShiftSupportUnread(shiftS1a, A, []))
  assert.equal(unreadSupportShifts(logs, A, []).length, 2)   // S2 is whitespace-only -> not unread
  ok('5 - new request without a receipt is unread')
}

// 6. A matching receipt marks only that version read.
{
  const receipts = [receiptFor(shiftS1a)]
  assert.equal(isShiftSupportUnread(shiftS1a, A, receipts), false)
  assert.equal(isShiftSupportUnread(shiftS1b, A, receipts), true)
  ok('6 - matching receipt marks only that version read')
}

// 7. Two unread shifts count as two (bell + per-student), never collapsed by student.
{
  assert.equal(unreadSupportBellCount(logs, A, []), 2)
  assert.equal(unreadCountByStudent(logs, A, []).S1, 2)
  ok('7 - two unread shifts count as two')
}

// 8. Reading one leaves the other unread.
{
  const receipts = [receiptFor(shiftS1a)]
  assert.equal(unreadSupportBellCount(logs, A, receipts), 1)
  assert.equal(unreadCountByStudent(logs, A, receipts).S1, 1)
  ok('8 - reading one leaves the other unread')
}

// 9. Student badge clears only when all requests are read.
{
  assert.equal((unreadCountByStudent(logs, A, [receiptFor(shiftS1a)]).S1 || 0) > 0, true)
  assert.equal(unreadCountByStudent(logs, A, [receiptFor(shiftS1a), receiptFor(shiftS1b)]).S1 || 0, 0)
  ok('9 - student badge clears only when all requests are read')
}

// 10. An edited request re-arms (old receipt no longer matches the new fingerprint).
{
  const readOld = [receiptFor(shiftS1a)]
  const edited = { ...shiftS1a, support_needed: 'Student anxious about IV starts AND medication passes now.' }
  assert.equal(isShiftSupportUnread(edited, A, readOld), true)
  ok('10 - edited request re-arms')
}

// 11. Clearing support text removes the alert (and yields no receipt).
{
  const cleared = { ...shiftS1a, support_needed: '' }
  assert.equal(isShiftSupportUnread(cleared, A, []), false)
  assert.equal(unreadSupportShifts([cleared], A, []).length, 0)
  assert.equal(buildReadReceipt(A, cleared), null)
  ok('11 - clearing support text removes the alert')
}

// 12. Read state is isolated by user_profiles.id (A reading does not clear B).
{
  const aRead = [receiptFor(shiftS1a, A)]
  assert.equal(isShiftSupportUnread(shiftS1a, A, aRead), false)
  assert.equal(isShiftSupportUnread(shiftS1a, B, aRead), true)
  assert.equal(unreadSupportBellCount(logs, B, aRead), 2)
  ok('12 - read state is isolated by user_profiles.id')
}

// 13. The receipt payload uses user_profiles.id as user_id.
{
  const receipt = buildReadReceipt(A, shiftS1a)
  assert.deepEqual(receipt, { user_id: A, shift_log_id: 'log-1', support_fingerprint: supportFingerprint(shiftS1a.support_needed) })
  assert.equal(receipt.user_id, A)                 // profile id, not auth uid
  assert.match(receipt.support_fingerprint, /^[0-9a-f]{64}$/)
  ok('13 - receipt payload uses user_profiles.id')
}

// 14. Receipt creation is idempotent (stable composite key across reopens).
{
  const r1 = buildReadReceipt(A, shiftS1a)
  const r2 = buildReadReceipt(A, shiftS1a)
  assert.equal(receiptKey(r1.user_id, r1.shift_log_id, r1.support_fingerprint),
               receiptKey(r2.user_id, r2.shift_log_id, r2.support_fingerprint))
  ok('14 - receipt creation is idempotent (stable composite key)')
}

// 15. Support preview truncates safely and normalizes.
{
  const preview = supportPreview('x'.repeat(300), 90)
  assert.equal(preview.length <= 90, true)
  assert.ok(preview.endsWith('…'))
  assert.equal(supportPreview('  short   note  ', 90), 'short note')
  ok('15 - support preview truncates/normalizes safely')
}

// 16. Action Center click alone does not create a receipt: the focus intent carries only navigation
//     target (no support text, no receipt fields).
{
  const intent = supportFocusIntent(shiftS1a)
  assert.deepEqual(intent, { studentId: 'S1', shiftLogId: 'log-1' })
  assert.equal('support_fingerprint' in intent, false)  // nothing readable/sensitive in the intent
  assert.equal('support_needed' in intent, false)
  ok('16 - Action Center focus intent does not create a receipt or leak text')
}

// 17. Modal render success (nonblank text present) yields a receipt to write.
{
  const log = { id: 'log-9', student_id: 'S3', support_needed: 'Needs a debrief after a difficult code.' }
  assert.equal(hasSupportRequest(log.support_needed), true)
  const receipt = buildReadReceipt(A, log)
  assert.ok(receipt && receipt.shift_log_id === 'log-9' && /^[0-9a-f]{64}$/.test(receipt.support_fingerprint))
  ok('17 - modal render success yields a receipt to write')
}

// 18. Modal without a rendered request (blank text) does not create a receipt.
{
  const blank = { id: 'log-10', student_id: 'S4', support_needed: null }
  assert.equal(hasSupportRequest(blank.support_needed), false)   // the effect gate
  assert.equal(buildReadReceipt(A, blank), null)
  ok('18 - modal without support text does not create a receipt')
}

// 19. Bell count decreases after a successful receipt is created.
{
  let receipts = []
  assert.equal(unreadSupportBellCount(logs, A, receipts), 2)
  receipts = [...receipts, receiptFor(shiftS1a)]                 // simulate the write + refetch
  assert.equal(unreadSupportBellCount(logs, A, receipts), 1)
  ok('19 - bell count decreases after a successful receipt')
}

// 20. Refresh preserves read state derived from fetched receipts.
{
  const persisted = [receiptFor(shiftS1a), receiptFor(shiftS1b)]
  assert.equal(unreadSupportBellCount(logs, A, persisted), 0)
  assert.equal(unreadCountByStudent(logs, A, persisted).S1 || 0, 0)
  ok('20 - refresh preserves read state from fetched receipts')
}

// Bonus: the Action Center item builder carries a preview, not full text, and the right identity.
{
  const item = buildSupportActionItem({ ...shiftS1a, support_fingerprint: supportFingerprint(shiftS1a.support_needed) },
    { studentName: 'Jane Doe', unitName: '5 West', shiftDate: '2026-07-10' })
  assert.equal(item.type, 'support_request')
  assert.equal(item.shiftLogId, 'log-1')
  assert.equal(item.studentId, 'S1')
  assert.match(item.supportFingerprint, /^[0-9a-f]{64}$/)
  assert.equal(item.preview, 'Student anxious about IV starts, needs a check-in.')
  assert.equal(item.preview.length <= 90, true)
  ok('bonus - Action Center item carries preview + identity, not full text')
}

console.log(`\nALL ${passed} support-request read-state checks passed.`)

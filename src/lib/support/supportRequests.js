// src/lib/support/supportRequests.js
//
// ASPIRE-SUPPORT-REQUEST-ACTION-CENTER-1 - pure, dependency-free helpers for the per-user unread
// support-request feature. No React, no Supabase: just the read-state semantics so the behavior for
// Rotation Activity (student badge + shift-row dot), the Action Center (items + bell count), and the
// Shift Details modal (mark-as-read) is derived in ONE place and is unit-testable offline.
//
// A "support request" is the non-empty support_needed note on a student_shift_logs row. Read state
// is PER USER: user A reading a request never clears it for user B. A meaningful edit to the note
// re-arms the alert; a whitespace-only edit does not; clearing the note removes the alert entirely.

// Normalize support text for fingerprinting and previews: coerce null/undefined to '', collapse any
// run of whitespace (spaces, tabs, newlines) to a single space, and trim the ends. Two notes that
// differ only in whitespace normalize to the same string (so they share a fingerprint - no false
// re-arm); a note edited to different words normalizes differently (new fingerprint - re-arm).
export function normalizeSupportText(text) {
  return (text == null ? '' : String(text)).replace(/\s+/g, ' ').trim()
}

// True when a note carries a meaningful (non-whitespace) support request.
export function hasSupportRequest(text) {
  return normalizeSupportText(text).length > 0
}

// Compact, synchronous SHA-256 over a UTF-8 string -> lowercase 64-char hex. Self-contained (no
// dependency), identical in the browser and Node, so the client-computed fingerprint matches the
// value stored in support_request_reads.support_fingerprint. Synchronous by design: unread state is
// derived at render time across four consumers (bell, Action Center, Rotation badge, shift dot), so
// an async Web Crypto digest would have to be pre-plumbed through all of them.
function sha256Hex(str) {
  // UTF-8 encode
  const utf8 = []
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i)
    if (c < 0x80) utf8.push(c)
    else if (c < 0x800) { utf8.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)) }
    else if (c >= 0xd800 && c <= 0xdbff) { // surrogate pair
      const c2 = str.charCodeAt(++i)
      const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff)
      utf8.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
    } else { utf8.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)) }
  }
  const K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]
  let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19
  const l = utf8.length
  utf8.push(0x80)
  while (utf8.length % 64 !== 56) utf8.push(0)
  const bitLen = l * 8
  utf8.push(0,0,0,0, (bitLen>>>24)&0xff, (bitLen>>>16)&0xff, (bitLen>>>8)&0xff, bitLen&0xff)
  const rotr = (x, n) => (x >>> n) | (x << (32 - n))
  const w = new Array(64)
  for (let i = 0; i < utf8.length; i += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] = (utf8[i+t*4]<<24) | (utf8[i+t*4+1]<<16) | (utf8[i+t*4+2]<<8) | (utf8[i+t*4+3])
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t-15],7) ^ rotr(w[t-15],18) ^ (w[t-15]>>>3)
      const s1 = rotr(w[t-2],17) ^ rotr(w[t-2],19) ^ (w[t-2]>>>10)
      w[t] = (w[t-16] + s0 + w[t-7] + s1) | 0
    }
    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[t] + w[t]) | 0
      const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) | 0
      h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0
    }
    h0=(h0+a)|0; h1=(h1+b)|0; h2=(h2+c)|0; h3=(h3+d)|0; h4=(h4+e)|0; h5=(h5+f)|0; h6=(h6+g)|0; h7=(h7+h)|0
  }
  const toHex = (x) => (x >>> 0).toString(16).padStart(8, '0')
  return toHex(h0)+toHex(h1)+toHex(h2)+toHex(h3)+toHex(h4)+toHex(h5)+toHex(h6)+toHex(h7)
}

// Fingerprint of a support note = SHA-256 of the normalized text (lowercase 64-hex). Identifies an
// exact support-request VERSION for a shift. Blank/whitespace-only notes have no fingerprint (return
// ''), so a cleared note is never "readable" and never re-arms; a meaningful edit changes the hash.
export function supportFingerprint(text) {
  const norm = normalizeSupportText(text)
  if (!norm) return ''
  return sha256Hex(norm)
}

// Canonical key for "user U has read version F of shift S". Used to dedupe receipts in memory.
export function receiptKey(userId, shiftLogId, fingerprint) {
  return `${userId}::${shiftLogId}::${fingerprint}`
}

// Build a Set of receiptKey strings from either a Set (passed through) or an array of receipt rows
// ({ user_id?, shift_log_id, support_fingerprint }). Each key is stamped with the receipt's OWN
// user_id when present (falling back to the queried userId for legacy rows), so a mixed list is
// correctly partitioned per user and one user's receipt can never satisfy another user's lookup.
function toReadSet(userId, receipts) {
  if (receipts instanceof Set) return receipts
  return new Set((receipts || []).map(r =>
    receiptKey(r.user_id != null ? r.user_id : userId, r.shift_log_id, r.support_fingerprint)))
}

// Unread support-request shifts for one user. Input: the user-visible shift logs (each at least
// { id, student_id, support_needed }) and that user's read receipts. A shift is unread when it has a
// meaningful note AND there is no receipt for (user, shift, currentFingerprint). Each returned row
// carries its computed support_fingerprint for downstream receipt writes.
export function unreadSupportShifts(shiftLogs, userId, receipts) {
  const readSet = toReadSet(userId, receipts)
  const out = []
  for (const log of (shiftLogs || [])) {
    const fp = supportFingerprint(log && log.support_needed)
    if (!fp) continue                                             // cleared/blank -> nothing to read
    if (readSet.has(receiptKey(userId, log.id, fp))) continue     // this exact version already read
    out.push({ ...log, support_fingerprint: fp })
  }
  return out
}

// True when THIS exact shift is an unread support request for the user (drives the shift-row dot).
export function isShiftSupportUnread(log, userId, receipts) {
  const fp = supportFingerprint(log && log.support_needed)
  if (!fp) return false
  return !toReadSet(userId, receipts).has(receiptKey(userId, log.id, fp))
}

// Unread support-request count per student_id (drives the student-level "Support needed" badge,
// which clears only when the student's count reaches 0 - i.e. all read or cleared).
export function unreadCountByStudent(shiftLogs, userId, receipts) {
  const counts = {}
  for (const log of unreadSupportShifts(shiftLogs, userId, receipts)) {
    counts[log.student_id] = (counts[log.student_id] || 0) + 1
  }
  return counts
}

// Bell contribution: number of unread support-request SHIFTS. Each unread shift counts once, so a
// student with two unread shifts contributes two (never per-student-collapsed).
export function unreadSupportBellCount(shiftLogs, userId, receipts) {
  return unreadSupportShifts(shiftLogs, userId, receipts).length
}

// Row for an idempotent read-receipt upsert when a request is viewed. Returns null for blank/cleared
// notes so a receipt is never written for a request that has no meaningful text.
export function buildReadReceipt(userId, log) {
  const fp = supportFingerprint(log && log.support_needed)
  if (!fp || !userId || !log || !log.id) return null
  return { user_id: userId, shift_log_id: log.id, support_fingerprint: fp }
}

// Short, safe preview for the Action Center: normalized and truncated so full support text never
// appears in a compact list (or in logs/analytics). Uses a trailing ellipsis when truncated.
export function supportPreview(text, max = 90) {
  const norm = normalizeSupportText(text)
  if (norm.length <= max) return norm
  return norm.slice(0, max - 1).trimEnd() + '…'
}

// Navigation focus intent for a support item: WHERE to focus in Rotation > Activity. Contains NO
// read side effect and NO support text - clicking navigates/focuses only; the receipt is written
// solely when the shift-details modal renders the note. Nothing sensitive is placed on the URL.
export function supportFocusIntent(shift) {
  if (!shift || !shift.id || !shift.student_id) return null
  return { studentId: shift.student_id, shiftLogId: shift.id }
}

// Build the Action Center item for one unread support-request shift (pure; used by the component and
// tested directly). Carries only a truncated preview - never the full support text.
export function buildSupportActionItem(shift, opts = {}) {
  if (!shift || !shift.id) return null
  return {
    type: 'support_request',
    studentId: shift.student_id,
    shiftLogId: shift.id,
    supportFingerprint: shift.support_fingerprint || supportFingerprint(shift.support_needed),
    studentName: opts.studentName || '',
    unitName: opts.unitName || '',
    shiftDate: opts.shiftDate != null ? opts.shiftDate : (shift.shift_date || null),
    submittedAt: opts.submittedAt != null ? opts.submittedAt : (shift.submitted_at || null),
    preview: supportPreview(shift.support_needed, 90),
  }
}

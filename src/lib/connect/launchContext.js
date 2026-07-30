// Connect launch context: the return-context contract for At a Glance -> Connect send-and-confirm
// flows (capacity requests, student form invitations). See docs/product/CAPACITY_RESPONSE_OUTREACH.md.
//
// sessionStorage (never a URL): recipient data stays out of shareable/bookmarkable URLs and dies with
// the browser session. The navigation URL carries only a `?launch=1` flag. Written ONLY by the launch
// actions; unrelated Connect visits never see a context. Every return-modal decision clears it, so a
// confirmation can never reopen after the Owner has confirmed or dismissed it. No secrets are stored.

const KEY = 'aspire.connect.launchContext.v1'
const VERSION = 1

export const LAUNCH_KINDS = Object.freeze({
  CAPACITY_REQUEST: 'capacity_request',
  STUDENT_FORM: 'student_form',
  SCHOOL_FORM: 'school_form',
})
const VALID_KINDS = new Set(Object.values(LAUNCH_KINDS))

function safeStorage() {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) return window.sessionStorage
  } catch { /* storage blocked (private mode etc.) - launch flows degrade to no-op */ }
  return null
}

// Write a fresh 'launched' context. Returns the stored context or null when invalid/unavailable.
export function writeLaunchContext(ctx) {
  const store = safeStorage()
  if (!store || !ctx || !VALID_KINDS.has(ctx.kind) || !ctx.cohortId || !ctx.templateKey) return null
  const record = {
    v: VERSION,
    status: 'launched',
    kind: ctx.kind,
    cohortId: ctx.cohortId,
    cohortName: ctx.cohortName || '',
    source: ctx.source || '',
    templateKey: ctx.templateKey,
    returnPath: ctx.returnPath || '/aggregate',
    units: Array.isArray(ctx.units) ? ctx.units : [],
    studentIds: Array.isArray(ctx.studentIds) ? ctx.studentIds : [],
    school: ctx.school || null,
    // Contact recipients for contact-mediated launches (e.g. the school flow's Academic Partner
    // coordinator). Used for composer preselection and for the return gate's send-evidence check.
    contactEmails: Array.isArray(ctx.contactEmails) ? ctx.contactEmails : [],
    batchId: null,
    sentEmails: [],
    summary: null,
    createdAt: new Date().toISOString(),
  }
  try { store.setItem(KEY, JSON.stringify(record)) } catch { return null }
  return record
}

// Read the active context (or null). Tolerant of corrupt/legacy payloads: they are cleared.
export function readLaunchContext() {
  const store = safeStorage()
  if (!store) return null
  let raw
  try { raw = store.getItem(KEY) } catch { return null }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.v !== VERSION || !VALID_KINDS.has(parsed.kind) || parsed.status !== 'launched') {
      store.removeItem(KEY)
      return null
    }
    return parsed
  } catch {
    try { store.removeItem(KEY) } catch { /* ignore */ }
    return null
  }
}

// Clear on any decision (confirm, subset, not sent, close). Idempotent.
export function clearLaunchContext() {
  const store = safeStorage()
  if (!store) return
  try { store.removeItem(KEY) } catch { /* ignore */ }
}

// Record the composer's real per-recipient send outcome into the ACTIVE context, so the return
// confirmation can preselect what was actually sent. Strictly scoped: no-ops unless an active
// 'launched' context exists AND its templateKey matches the template that was just sent - an
// unrelated Connect bulk send never touches a foreign context.
export function recordLaunchSendResults(templateKey, sendResult) {
  const store = safeStorage()
  if (!store || !templateKey || !sendResult) return false
  const ctx = readLaunchContext()
  if (!ctx || ctx.templateKey !== templateKey) return false
  const sentEmails = (Array.isArray(sendResult.sent) ? sendResult.sent : [])
    .map(r => String(r?.email || r?.normEmail || '').trim().toLowerCase())
    .filter(Boolean)
  const next = {
    ...ctx,
    batchId: sendResult.batch_id || ctx.batchId || null,
    // Merge across retries within one launch: a recipient sent in ANY batch counts as sent.
    sentEmails: [...new Set([...(ctx.sentEmails || []), ...sentEmails])],
    summary: sendResult.summary || ctx.summary || null,
  }
  try { store.setItem(KEY, JSON.stringify(next)) } catch { return false }
  return true
}

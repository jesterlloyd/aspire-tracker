// COPY-FILTERED-EMAILS, shared by both Contacts layouts (CONTACTS-BOOK-1). Copies the
// valid, deduped emails of exactly the contacts a layout is showing, in the order it
// shows them, as a comma-separated list with no spaces. Read-only: no send, no
// mutation, no backend. Moved out of ContactsView unchanged, so the Classic screen's
// messages are the ones it always showed.
import { isValidEmail } from '../notifications/studentRecipient.js'
import { normalizeEmailForLookup } from '../emailUtils.js'

export function visibleContactEmails(contacts) {
  const emails = []
  const seen = new Set()
  let skipped = 0
  for (const c of contacts) {
    if (!isValidEmail(c.email)) { skipped++; continue }
    const norm = normalizeEmailForLookup(c.email)
    if (seen.has(norm)) continue   // dedupe (not counted as skipped)
    seen.add(norm)
    emails.push(c.email.trim())
  }
  return { emails, skipped }
}

export async function copyVisibleContactEmails(contacts, toast) {
  if (contacts.length === 0) {
    toast.info('No contacts found.', 'There are no visible contacts to copy.')
    return
  }
  const { emails, skipped } = visibleContactEmails(contacts)
  if (emails.length === 0) {
    toast.info('No valid emails in visible results.', 'None of the visible contacts have a valid email on file.')
    return
  }
  try {
    await navigator.clipboard.writeText(emails.join(','))
    const n = emails.length
    const base = `Copied ${n} email${n === 1 ? '' : 's'}.`
    const tail = skipped > 0 ? ` Skipped ${skipped} without valid email.` : ''
    toast.success(base + tail, 'Paste into the To/CC field of your email.')
  } catch {
    toast.error('Copy failed', 'Your browser blocked clipboard access.')
  }
}

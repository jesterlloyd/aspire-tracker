// src/lib/messages/messageDrafts.js
//
// MESSAGE-DRAFTS-1 (Owner, 2026-10-03): what someone types in Messages survives
// closing the drawer, the modal or the page. A draft is kept until it is sent,
// emptied, or discarded on purpose, and for at most seven days, the same as an
// Outreach draft (CONNECT-DRAFT-AUTOSAVE-1).
//
// Where: this browser's localStorage, under a key that holds the signed-in
// person's own profile id, so another account on the same computer cannot open
// it through the app (signOutCleanup.js classes it `keyed`, beside the Outreach
// and rubric drafts: deleting it on sign-out would lose work). Nothing is sent
// to the server until Send.
//
// A slot names one place a person writes: `reply.<conversation id>` for a
// thread's reply box, `new` for New message. The staff app and the portals use
// the same slots under different people, so they never meet.

export const DRAFT_PREFIX = 'aspire.messages.draft.v1.'
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function draftStorageKey(userId, slot) {
  return userId && slot ? `${DRAFT_PREFIX}${userId}.${slot}` : null
}

// A draft is empty when none of its typed fields holds anything but spaces. A
// chosen recipient or category alone is not worth keeping, so a composer names
// its typed fields (`textKeys`); with none named, every string counts.
export function isEmptyDraft(draft, textKeys = null) {
  if (!draft || typeof draft !== 'object') return true
  const values = textKeys ? textKeys.map((k) => draft[k]) : Object.values(draft)
  return !values.some((v) => typeof v === 'string' && v.trim() !== '')
}

function storage() {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

// The stored draft, or null when there is none, it is older than the TTL, or it
// cannot be read (a stale or damaged entry is removed, never shown).
export function loadDraft(userId, slot, now = Date.now()) {
  const key = draftStorageKey(userId, slot)
  const store = storage()
  if (!key || !store) return null
  try {
    const raw = store.getItem(key)
    if (!raw) return null
    const saved = JSON.parse(raw)
    if (!saved || typeof saved !== 'object' || typeof saved.draft !== 'object'
        || typeof saved.savedAt !== 'number' || now - saved.savedAt > DRAFT_TTL_MS) {
      store.removeItem(key)
      return null
    }
    return saved.draft
  } catch {
    try { store.removeItem(key) } catch { /* ignore */ }
    return null
  }
}

// Writes the draft, or removes the entry when the draft is empty.
export function saveDraft(userId, slot, draft, now = Date.now(), textKeys = null) {
  const store = storage()
  if (!userId || !slot || !store) return
  try {
    if (isEmptyDraft(draft, textKeys)) store.removeItem(`${DRAFT_PREFIX}${userId}.${slot}`)
    else store.setItem(`${DRAFT_PREFIX}${userId}.${slot}`, JSON.stringify({ draft, savedAt: now }))
  } catch { /* a full or blocked store keeps the draft in memory only */ }
}

export function clearDraft(userId, slot) {
  const store = storage()
  const key = draftStorageKey(userId, slot)
  if (!key || !store) return
  try { store.removeItem(key) } catch { /* ignore */ }
}

// HOME-1 (Owner, 2026-09-25): placeholders that must be filled in by hand before a message
// may be sent. They carry something the app cannot know or must not store, so the template
// holds a visible stand-in and the person types the real value over it.
//
//   [Cohort Request Password]  the password Academic Partners enter at /school-form. Since
//                              S-08 the app keeps only a bcrypt hash of it, so it can never be
//                              merged in; the Owner types it.
//
// One rule, read by the Outreach composer (Continue to final review and Send stay disabled)
// and by /api/connect-send-bulk-message (a request that still carries one is refused), so a
// message can never leave with the stand-in in it. Pure: no React, no I/O.

export const REQUIRED_PLACEHOLDERS = Object.freeze(['[Cohort Request Password]'])

/** The required placeholders still present in any of the given texts, in list order. */
export function unfilledPlaceholders(...texts) {
  const all = texts.map(t => String(t || '')).join('\n')
  return REQUIRED_PLACEHOLDERS.filter(p => all.includes(p))
}

/** A sentence for the composer and the server refusal. */
export function unfilledMessage(list) {
  if (!list.length) return ''
  const names = list.join(', ')
  return `Replace ${names} with the real value before sending.`
}

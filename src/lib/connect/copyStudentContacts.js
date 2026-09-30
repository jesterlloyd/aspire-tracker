import { resolveStudentCorrespondenceRecipient } from '../notifications/studentRecipient.js'

// Accept a single international number, or a US/Canadian number without a country
// code. Reject extensions, multiple numbers, and text rather than merging digits.
export function messagingPhone(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!/^\+?[\d\s().-]+$/.test(text)) return null
  const digits = text.replace(/\D/g, '')
  if (!text.startsWith('+')) {
    if (digits.length === 10 && /^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return `+1${digits}`
    if (digits.length === 11 && /^1[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return `+${digits}`
    return null
  }
  if (!/^[1-9]\d{6,14}$/.test(digits)) return null
  if (digits.startsWith('1') && !/^1[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null
  return `+${digits}`
}

export function visibleStudentContacts(students, kind, options = {}) {
  const values = [], seen = new Set()
  let skipped = 0, fallbacks = 0, duplicates = 0
  for (const student of students) {
    const route = kind === 'email' ? resolveStudentCorrespondenceRecipient(student, undefined, options) : null
    const value = kind === 'email' ? route.email : messagingPhone(student.phone)
    if (!value) { skipped++; continue }
    if (route?.fallbackUsed) fallbacks++
    const key = value.toLowerCase()
    if (seen.has(key)) { duplicates++; continue }
    seen.add(key)
    values.push(value)
  }
  return { values, skipped, fallbacks, duplicates }
}

export async function copyVisibleStudentContacts(students, kind, toast, options = {}) {
  const noun = kind === 'email' ? 'emails' : 'phone numbers'
  const result = visibleStudentContacts(students, kind, options)
  const { values, skipped, fallbacks, duplicates } = result
  if (!values.length) {
    toast?.info(`No ${noun} copied.`, students.length ? `No valid ${noun} in the filtered results.` : 'No students match the current filters.')
    return result
  }
  try {
    // Keep the clipboard call in the click gesture for Safari. No network work here.
    await navigator.clipboard.writeText(values.join(','))
    const notes = [
      skipped ? `${skipped} skipped without a valid ${kind === 'email' ? 'email' : 'phone number'}.` : '',
      duplicates ? `${duplicates} duplicate${duplicates === 1 ? '' : 's'} removed.` : '',
      fallbacks ? `${fallbacks} used the other email because the preferred email was missing or invalid.` : '',
    ].filter(Boolean).join(' ')
    const guidance = kind === 'email'
      ? 'Ready to paste into your email recipients.'
      : 'iPhone Messages may not separate a pasted list into recipients. Use iPhone Messages setup, then run ASPIRE Group Message in Shortcuts.'
    toast?.success(`Copied ${values.length} ${values.length === 1 ? (kind === 'email' ? 'email' : 'phone number') : noun}.`,
      [notes, guidance].filter(Boolean).join(' '))
    return { ...result, copied: true }
  } catch {
    toast?.error('Copy failed', 'Clipboard access was blocked. Try again in your browser.')
    return { ...result, copied: false }
  }
}

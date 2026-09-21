// CONTACTS-BOOK-1 (2026-09-20): what the Address book knows that the Classic screen does
// not. Pure, so it is tested without a browser. Everything the two layouts share (the
// contacts, the filter, the selection) comes from useContactsDirectory; this file only
// decides how a book files and labels what it is given.
//
// An address book files by LAST name, which is the one ordering Classic never offered:
// Classic sorts each category by its own approved canon (unit, then title tier). The book
// reads the DISPLAYED name (contactDisplayName: the preferred first name substituted in),
// so a contact is filed under the name the reader sees on the entry.
import { contactDisplayName, contactListSubline } from '../contactCategories.js'

export const BOOK_LETTERS = Object.freeze('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''))
// Anything that does not start with A-Z after accents are folded files here, after Z.
export const OTHER_LETTER = '#'

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])

// "Marissa Grafil Ramirez" -> "Ramirez"; "Jane Doe, RN" -> "Doe"; "John Smith Jr." -> "Smith".
// A credential after a comma is not a surname, and neither is a generational suffix.
export function lastNameOf(name) {
  const beforeComma = String(name || '').split(',')[0].trim()
  const words = beforeComma.split(/\s+/).filter(Boolean)
  while (words.length > 1 && SUFFIXES.has(words[words.length - 1].toLowerCase().replace(/\.$/, ''))) {
    words.pop()
  }
  return words[words.length - 1] || ''
}

export function letterOf(name) {
  const first = lastNameOf(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .charAt(0)
    .toUpperCase()
  return first >= 'A' && first <= 'Z' ? first : OTHER_LETTER
}

export const contactLetter = (contact) => letterOf(contactDisplayName(contact))

const cmp = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base', numeric: true })

// Last name, then the whole displayed name, then id so the order is total. Entries filed
// under "#" come after Z, as they do in a printed book.
export function sortForBook(contacts) {
  return [...contacts]
    .map(c => ({ c, name: contactDisplayName(c), letter: contactLetter(c) }))
    .sort((x, y) => {
      if (x.letter !== y.letter) {
        if (x.letter === OTHER_LETTER) return 1
        if (y.letter === OTHER_LETTER) return -1
      }
      return cmp(lastNameOf(x.name), lastNameOf(y.name)) || cmp(x.name, y.name) || cmp(x.c.id, y.c.id)
    })
    .map(x => x.c)
}

// Sorted entries interleaved with a letter header each time the first letter changes.
export function bookRows(sorted) {
  const rows = []
  let last = null
  for (const contact of sorted) {
    const letter = contactLetter(contact)
    if (letter !== last) { rows.push({ type: 'letter', letter }); last = letter }
    rows.push({ type: 'entry', contact })
  }
  return rows
}

export function lettersPresent(contacts) {
  return new Set(contacts.map(contactLetter))
}

// "Role · Organization" on one line. Classic's per-category subline says more than the
// bare organization (a Unit Leader's units, a school), so it is used when it has
// something; the organization is the fallback.
export function entryLine(contact) {
  const where = contactListSubline(contact) || String(contact?.organization || '').trim()
  return [String(contact?.role || '').trim(), where].filter(Boolean).join(' · ')
}

// "12 of 110 shown · 231 in the full book". The tail is dropped under All Contacts,
// where the category IS the full book and saying it twice reads as a mistake.
export function bookCountLine({ shown, inCategory, inBook, isAll }) {
  const head = `${shown} of ${inCategory} shown`
  return isAll ? head : `${head} · ${inBook} in the full book`
}

export function initialsOf(name) {
  const words = String(name || '').split(/[\s,]+/).filter(Boolean)
  return words.slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'
}

// notification_log.status -> the pill's tone and word. Delivered is green, Opened is navy
// (the mockup's two); a failure is red, so it is never mistaken for either; anything else
// is neutral and says its own word.
const COMM_TONES = {
  sent: 'ok', delivered: 'ok',
  opened: 'info', clicked: 'info',
  bounced: 'bad', failed: 'bad', complained: 'bad', rejected: 'bad', delivery_delayed: 'bad',
}
export function commStatus(status) {
  const key = String(status || '').trim().toLowerCase()
  const word = key ? key.replace(/_/g, ' ').replace(/^./, ch => ch.toUpperCase()) : 'Unknown'
  return { tone: COMM_TONES[key] || 'neutral', label: word }
}

// A linked student's ASPIRE status. Active Rotation is green, Placed amber (placed, not
// yet started), Completed grey; every other status is neutral and still says its word.
export function studentStatusTone(status) {
  if (status === 'Active Rotation') return 'ok'
  if (status === 'Placed') return 'warn'
  return 'neutral'
}

// "5 assigned · 3 on active rotation". The linked-student query is capped (15 for a
// preceptor, 12 for a school), so when the true total is larger the heading says how
// many are shown instead of counting active rotations it cannot see.
export function linkedStudentsHeading(rows, total) {
  const n = Math.max(total || 0, rows.length)
  if (n === 0) return 'none'
  if (n > rows.length) return `${n} assigned · first ${rows.length} shown`
  const active = rows.filter(s => s.status === 'Active Rotation').length
  return active > 0 ? `${n} assigned · ${active} on active rotation` : `${n} assigned`
}

// "Aug 26" in the current year, "Aug 26, 2025" before it: a log line with no year is
// only unambiguous while it is this year's.
export function shortDate(iso, now = new Date()) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const tz = 'America/Los_Angeles'
  const year = (x) => x.toLocaleDateString('en-US', { year: 'numeric', timeZone: tz })
  const opts = { month: 'short', day: 'numeric', timeZone: tz }
  if (year(d) !== year(now)) opts.year = 'numeric'
  return d.toLocaleDateString('en-US', opts)
}

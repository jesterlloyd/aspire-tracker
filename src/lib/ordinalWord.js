// src/lib/ordinalWord.js
//
// Display helper for accessible ordinal labels on the calendar chip, e.g. "fourth logged
// shift". Words for 1-10 (the common case), then a numeric ordinal suffix (11th, 23rd) so the
// label stays legible for large counts, matching the guidance to avoid Unicode circled
// characters above 20.

const WORDS = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth']

export function ordinalWord(n) {
  if (!Number.isInteger(n) || n < 1) return ''
  if (n <= 10) return WORDS[n]
  const mod100 = n % 100
  const mod10 = n % 10
  const suffix = (mod100 >= 11 && mod100 <= 13) ? 'th'
    : mod10 === 1 ? 'st' : mod10 === 2 ? 'nd' : mod10 === 3 ? 'rd' : 'th'
  return `${n}${suffix}`
}

// GREETINGS-1 (Owner, 2026-10-04): the greeting over the scenery is a small
// rotating set adapted from Claude's, by part of the day and weekday. The same
// file lives in Skyline (src/lib/greetings.js); this test is in both.
import test from 'node:test'
import assert from 'node:assert/strict'
import { greetingText, partOfDay, GREETINGS } from '../src/lib/home/greetings.js'

const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min)
const all = list => list.flatMap(e => e)

test('GREETINGS-1: evening from 5 PM, overnight before 5 AM', () => {
  assert.equal(partOfDay(at(2026, 10, 4, 4, 59)), 'overnight')
  assert.equal(partOfDay(at(2026, 10, 4, 5)), 'morning')
  assert.equal(partOfDay(at(2026, 10, 4, 12)), 'afternoon')
  assert.equal(partOfDay(at(2026, 10, 4, 16, 59)), 'afternoon')
  assert.equal(partOfDay(at(2026, 10, 4, 17)), 'evening')
})

test('GREETINGS-1: a pick holds for its part of the day and the mix favours the plain greeting', () => {
  assert.equal(greetingText(at(2026, 10, 4, 9), 'Jester'), greetingText(at(2026, 10, 4, 11, 59), 'Jester'))
  let plain = 0, n = 0
  const seen = new Set()
  for (let d = 0; d < 365; d++) for (const h of [3, 9, 14, 20]) {
    const g = greetingText(new Date(2026, 0, 1 + d, h, 10), 'Jester'); n++; seen.add(g)
    if (/^(Good (morning|afternoon|evening)|Welcome back), Jester$/.test(g)) plain++
  }
  assert.ok(plain / n > 0.4 && plain / n < 0.6, `plain share ${plain / n}`)
  // Every greeting in the set is reachable in a year.
  const every = [...all(GREETINGS.morning), ...all(GREETINGS.afternoon), ...all(GREETINGS.evening),
    ...all(GREETINGS.overnight), ...all(GREETINGS.anytime), ...GREETINGS.weekday.flatMap(all)]
    .filter((t, i) => i % 2 === 0).map(t => t.replace('{name}', 'Jester'))
  for (const g of every) assert.ok(seen.has(g), `never said: ${g}`)
})

test('GREETINGS-1: the right greeting for the hour and the day', () => {
  for (let d = 0; d < 365; d++) {
    const day = new Date(2026, 0, 1 + d)
    const wd = day.getDay()
    const night = greetingText(new Date(2026, 0, 1 + d, 2), 'Jester')
    assert.ok(['Welcome back, Jester', 'Back at it, Jester'].includes(night), `overnight said ${night}`)
    const eve = greetingText(new Date(2026, 0, 1 + d, 19), 'Jester')
    assert.doesNotMatch(eve, /morning|afternoon|Happy|Coffee|weekend|Sunday|Friday/, `evening said ${eve}`)
    for (const h of [8, 15]) {
      const g = greetingText(new Date(2026, 0, 1 + d, h), 'Jester')
      // A weekday greeting only on its own day.
      const named = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].findIndex(n => g.includes(n))
      if (named >= 0) assert.equal(named, wd, `${g} on day ${wd}`)
      if (/weekend/.test(g)) assert.equal(wd, 6)
      if (h === 15) assert.doesNotMatch(g, /morning|Coffee/)
      if (h === 8) assert.doesNotMatch(g, /afternoon/)
    }
  }
})

test('GREETINGS-1: never invents a name, never leaves the placeholder, never the left-out lines', () => {
  for (let d = 0; d < 60; d++) for (const h of [2, 8, 13, 19]) {
    const t = new Date(2026, 0, 1 + d, h)
    for (const name of ['', 'Jester']) {
      const g = greetingText(t, name)
      assert.doesNotMatch(g, /\{name\}|, there\b|incognito|whoever|night owl|Claude/i, g)
      if (!name) assert.doesNotMatch(g, /, $|Jester/)
    }
  }
})

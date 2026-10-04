// GREETINGS-1 (Owner, 2026-10-04: adapt the Claude greetings "to be the
// greeting for our skyline"). ONE rule for the greeting over the scenery. It
// has a twin: Skyline's src/lib/greetings.js and ASPIRE's
// src/lib/home/greetings.js are the same file, and a change lands in both.
//
// What it says depends on the part of the day by the VIEWER's clock, and on
// the weekday. The plain time-of-day greeting is the most common (about half
// of the picks); the rest rotate in. The pick is made from the date and the
// part of the day, so it holds through refreshes and changes with the next
// morning, afternoon, evening or day, never on every render.
//
// Left out on purpose: the incognito lines and "Greetings, whoever you are"
// (they describe features this app does not have), "Coffee and Claude time?"
// (it names Claude; it is "Coffee time?" here), and "Hello, night owl": the
// overnight window says "Welcome back" rather than remarking on the hour,
// because night-shift staff opening the app at 3 AM are at work, not up late.
//
// Each entry is [with a name, without one]; `{name}` is the first name. Without
// a name the greeting stands alone, never "Good morning, there".

export const GREETINGS = {
  // The plain greeting for each part of the day, first in its list.
  morning: [['Good morning, {name}', 'Good morning'], ['Coffee time, {name}?', 'Coffee time?']],
  afternoon: [['Good afternoon, {name}', 'Good afternoon']],
  evening: [
    ['Good evening, {name}', 'Good evening'],
    ['Evening, {name}', 'Evening'],
    ['How was your day, {name}?', 'How was your day?'],
    ['What’s on your mind tonight?', 'What’s on your mind tonight?'],
  ],
  overnight: [['Welcome back, {name}', 'Welcome back'], ['Back at it, {name}', 'Back at it!']],
  // Any part of the day except overnight.
  anytime: [
    ['Hey there, {name}', 'Hey there'],
    ['Hi {name}, how are you?', 'Hi, how are you?'],
    ['How’s it going, {name}?', 'How’s it going?'],
    ['What’s new, {name}?', 'What’s new?'],
    ['What’s on your mind, {name}?', 'What’s on your mind?'],
  ],
  // By weekday, 0 = Sunday. Morning and afternoon only.
  weekday: [
    [['Sunday session, {name}?', 'Sunday session?'], ['Happy Sunday, {name}', 'Happy Sunday']],
    [['Happy Monday, {name}', 'Happy Monday']],
    [['Happy Tuesday, {name}', 'Happy Tuesday']],
    [['Happy Wednesday, {name}', 'Happy Wednesday']],
    [['Happy Thursday, {name}', 'Happy Thursday']],
    [['Happy Friday, {name}', 'Happy Friday'], ['That Friday feeling, {name}', 'That Friday feeling']],
    [['Welcome to the weekend, {name}', 'Welcome to the weekend'], ['Happy Saturday, {name}', 'Happy Saturday!']],
  ],
}

/** The part of the day: evening from 5 PM, overnight from midnight to 5 AM. */
export function partOfDay(now = new Date()) {
  const h = now.getHours()
  if (h < 5) return 'overnight'
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

// A small, stable hash (FNV-1a), so a date and a part of the day always land
// on the same pick, in every browser.
function hash(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h
}

function fill([withName, without], name) {
  return name ? withName.replace('{name}', name) : without
}

/** The greeting for this moment: "Good morning, Jester", "Happy Friday", ... */
export function greetingText(now = new Date(), firstName = '') {
  const part = partOfDay(now)
  const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
  const h = hash(`${day}|${part}`)
  const roll = (h % 1000) / 1000
  const pick = list => list[(h >>> 10) % list.length]
  const own = GREETINGS[part]
  // About half the time, the plain greeting for the part of the day.
  if (roll < 0.5) return fill(own[0], firstName)
  if (part === 'overnight') return fill(pick(own.slice(1)), firstName)
  const weekday = part === 'evening' ? [] : GREETINGS.weekday[now.getDay()]
  // Then, on a morning or afternoon, the day's own greeting about half the time.
  if (weekday.length && roll < 0.75) return fill(pick(weekday), firstName)
  return fill(pick([...own.slice(1), ...GREETINGS.anytime]), firstName)
}

// MASTHEAD-LOCKSCREEN-1: the clock's two labels and the width match, kept pure
// so the component file exports only a component (react-refresh) and so the
// rule can be tested without a DOM.
//
// MASTHEAD-CITY-TIME-1: both labels take an optional IANA zone. A chosen
// city's masthead is a window onto that city, so its clock reads the city's
// time (New York at 06:59 while Los Angeles is at 03:59); Automatic and the
// viewer's own city read local time as before.

/** The wall-clock fields of an instant in a zone (or the browser's zone). */
function partsIn(d, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
    weekday: 'long', day: 'numeric', month: 'short',
    ...(timeZone ? { timeZone } : {}),
  })
  const out = {}
  for (const { type, value } of fmt.formatToParts(d)) out[type] = value
  return out
}

/** "07:29": twelve-hour, zero-padded, no AM/PM (the macOS lock screen's form). */
export function clockLabel(d, timeZone) {
  const p = partsIn(d, timeZone)
  return `${String(p.hour).padStart(2, '0')}:${p.minute}`
}

/** "Friday, 4 Sep": full weekday, day, three-letter month, no year. */
export function dateLabel(d, timeZone) {
  const p = partsIn(d, timeZone)
  return `${p.weekday}, ${p.day} ${p.month}`
}

/**
 * The zone the masthead clock runs in: the chosen city's, from the weather
 * payload, and only when the location IS a chosen city (Automatic keeps the
 * viewer's own clock even though its payload names a zone too). A zone the
 * runtime cannot format falls back to local rather than throwing in render.
 */
export function mastheadTimeZone(weather, location) {
  if (!location?.chosen || typeof weather?.timezone !== 'string' || !weather.timezone) return undefined
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: weather.timezone })
    return weather.timezone
  } catch {
    return undefined
  }
}

export const DATE_MAX_PX = 16
export const DATE_MIN_PX = 9

/**
 * The two lines are always the SAME WIDTH, matched two ways. When the date is
 * the wider, the clock's digits are tracked out to meet it (padding-left
 * balances the trailing spacing so the digits stay centred); when the date is
 * the narrower, it scales up to the clock, capped so it never competes with
 * it. Fitting the date DOWN to a tightened clock was tried first and drove it
 * to 9px: the lock screen gets away with a fitted date because its clock is
 * enormous, and a 150px card cannot be. Returns what it decided, for tests.
 */
export function planFit({ dateW, clockW, baseFontPx, glyphs }) {
  if (!(dateW > 0 && clockW > 0)) return { kind: 'none' }
  if (dateW > clockW) {
    const ls = (dateW - clockW) / Math.max(1, glyphs)
    return { kind: 'track', letterSpacingPx: ls, paddingLeftPx: ls }
  }
  const px = Math.min(DATE_MAX_PX, Math.max(DATE_MIN_PX, baseFontPx * clockW / dateW))
  return { kind: 'scale', fontSizePx: px }
}

/** Apply planFit to live elements. */
export function fitWidths(clockEl, dateEl) {
  if (!clockEl || !dateEl) return
  dateEl.style.fontSize = ''
  clockEl.style.letterSpacing = ''
  clockEl.style.paddingLeft = ''
  const plan = planFit({
    dateW: dateEl.getBoundingClientRect().width,
    clockW: clockEl.getBoundingClientRect().width,
    baseFontPx: parseFloat(getComputedStyle(dateEl).fontSize),
    glyphs: (clockEl.textContent || '').length,
  })
  if (plan.kind === 'track') {
    clockEl.style.letterSpacing = `${plan.letterSpacingPx.toFixed(2)}px`
    clockEl.style.paddingLeft = `${plan.paddingLeftPx.toFixed(2)}px`
  } else if (plan.kind === 'scale') {
    dateEl.style.fontSize = `${plan.fontSizePx.toFixed(2)}px`
  }
}

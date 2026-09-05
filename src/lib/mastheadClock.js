// MASTHEAD-LOCKSCREEN-1: the clock's two labels and the width match, kept pure
// so the component file exports only a component (react-refresh) and so the
// rule can be tested without a DOM.

/** "07:29": twelve-hour, zero-padded, no AM/PM (the macOS lock screen's form). */
export function clockLabel(d) {
  let h = d.getHours() % 12
  if (h === 0) h = 12
  return `${String(h).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** "Friday, 4 Sep": full weekday, day, three-letter month, no year. */
export function dateLabel(d) {
  return `${d.toLocaleDateString('en-US', { weekday: 'long' })}, ${d.getDate()} ${d.toLocaleDateString('en-US', { month: 'short' })}`
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

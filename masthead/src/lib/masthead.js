// ASPIRE-MASTHEAD: the deterministic greeting system for the At a Glance
// masthead. Four fixed windows on device-local time; the first token of the
// profile's full_name; no runtime AI, no locale branching, no repeat-visit
// variation (the "Last visit" line carries recency).
//
// The overnight window (midnight-4:59 AM) deliberately says "Welcome back"
// rather than commenting on the hour: night-shift staff opening the app at
// 3 AM are at work, not up late.

export function greetingFor(now = new Date()) {
  const h = now.getHours()
  if (h >= 5 && h < 12) return { text: 'Good morning', wash: 'morning' }
  if (h >= 12 && h < 18) return { text: 'Good afternoon', wash: 'afternoon' }
  if (h >= 18) return { text: 'Good evening', wash: 'evening' }
  return { text: 'Welcome back', wash: 'night' }
}

/** First token of a full name, or '' when absent. Never invents a name. */
export function firstNameOf(fullName) {
  return (fullName || '').trim().split(/\s+/)[0] || ''
}

/**
 * The masthead heading. With a name: "Good morning, Jester". Without one the
 * greeting stands alone - never "Good morning, there".
 */
export function greetingLine(fullName, now = new Date()) {
  const { text, wash } = greetingFor(now)
  const name = firstNameOf(fullName)
  return { heading: name ? `${text}, ${name}` : text, wash }
}

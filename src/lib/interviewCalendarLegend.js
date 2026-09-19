// src/lib/interviewCalendarLegend.js
//
// PLANNER-CALENDAR-1: what a day on the Interviews calendar can say, in one definition.
//
// The legend was written from the mockup and used four colours that appear nowhere in the
// grid: the month cell paints a capacity card whose fill and accent depend on the day's
// state, and there are FOUR states, not two. A legend that invents its own swatches is
// worse than no legend, because it teaches the reader a code the calendar does not use.
//
// So the capacity palette lives here and the month cell reads it, which is the only way
// the legend and the grid cannot drift apart.
//
// The two kinds that are NOT capacity:
//   - An ASPIRE event's colour comes from its TYPE (ASPIRE_EVENT_TYPES in lib/aspireEvents),
//     eleven of them, so the legend shows one neutral swatch and says the colour varies.
//   - A US federal holiday is the canon's amber, from CanonicalHolidayChip. It is
//     deliberately not any event colour: nobody scheduled it.

/** The month cell's capacity card, by the state of the day. */
export const CAPACITY_STATES = {
  fullyBooked: { bg: '#FEF2F2', accent: '#7F1D1D', label: 'Fully booked' },
  blocked:     { bg: '#FFF7ED', accent: '#7C2D12', label: 'Blocked time' },
  scheduled:   { bg: '#EFF6FF', accent: '#1E3A8A', label: 'Scheduled interview' },
  available:   { bg: '#F0FDF4', accent: '#065F46', label: 'Open availability' },
}

/**
 * The day's state, from the slots on it. One rule, so the card, the legend and anything
 * that later wants to describe a day all agree on what the day IS.
 */
export function capacityState({ scheduled = 0, available = 0, blocked = 0 }) {
  if (scheduled > 0 && available === 0 && blocked === 0) return 'fullyBooked'
  if (blocked > 0) return 'blocked'
  if (scheduled > 0) return 'scheduled'
  return 'available'
}

/**
 * The legend, in the order a reader meets these on a page: the busiest state first, then
 * what is still open, then the two things that are not interviews at all.
 *
 * `edge` is the chip's left rule where it has one; `note` becomes the swatch's title.
 */
export const INTERVIEW_LEGEND = [
  { fill: CAPACITY_STATES.scheduled.bg,   edge: CAPACITY_STATES.scheduled.accent,   label: CAPACITY_STATES.scheduled.label },
  { fill: CAPACITY_STATES.available.bg,   edge: CAPACITY_STATES.available.accent,   label: CAPACITY_STATES.available.label },
  { fill: CAPACITY_STATES.fullyBooked.bg, edge: CAPACITY_STATES.fullyBooked.accent, label: CAPACITY_STATES.fullyBooked.label },
  { fill: CAPACITY_STATES.blocked.bg,     edge: CAPACITY_STATES.blocked.accent,     label: CAPACITY_STATES.blocked.label },
  {
    fill: 'rgba(71,85,105,0.12)', edge: '#475569', label: 'ASPIRE event',
    note: 'An event is coloured by its type: Orientation, Town Hall, Deadline and the rest.',
  },
  // CALENDAR-HOLIDAY-CANON, from CanonicalHolidayChip. "US holiday" is what the chip's own
  // title says; "Federal holiday" was the mockup's wording and appears nowhere in the app.
  { fill: '#FEF3C7', edge: '#D97706', label: 'US holiday' },
]

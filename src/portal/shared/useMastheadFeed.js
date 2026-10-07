// EVENT-AUDIENCE-2: the masthead's event feed for a portal, one role per host.
//
// Asks the portal delivery endpoint for the next MASTHEAD_WINDOW_DAYS as the role
// the host is rendering, and turns the answer into chips with the same rule the
// staff card uses (src/lib/mastheadEvents.js), so a student and a coordinator
// looking at the same flagged event see the same chip.
//
// Its own small request rather than a lift of the calendar's month query: the
// student calendar fetches per visible month inside its own component, and
// coupling the card to that month would make the masthead change when the
// person paged the calendar. Fourteen days from today is one cheap call.
//
// Fails quiet. A 403 (no live grant, or a staff member previewing a portal), a
// network error, or an unapplied migration all read as "no events", never as an
// error the masthead would have to explain.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { toLocalDateStr } from '../../lib/designTokens'
import { MASTHEAD_WINDOW_DAYS, addDays, mastheadItems, holidayItems } from '../../lib/mastheadEvents'
import { getUsHolidaysForRange } from '../../lib/usHolidays'

/** The portal delivery endpoint for one role and one range. Fails quiet: an empty list. */
export async function fetchPortalCalendarEvents({ from, to, role }) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) return []
  const res = await fetch('/api/portal/my-calendar-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ from, to, role }),
  })
  if (!res.ok) return []
  const json = await res.json().catch(() => ({}))
  return json.events || []
}

/**
 * ONE-CALENDAR-3: the same feed for a calendar's visible range (a month or a week, well under
 * the endpoint's 120-day cap). The Unit Leader's Residency view reads it.
 */
export function usePortalCalendarEvents(role, range, { enabled = true } = {}) {
  const from = range?.[0] || null, to = range?.[1] || null
  const { data: events = [] } = useQuery({
    queryKey: ['portal_calendar_events', role, from, to],
    queryFn: () => fetchPortalCalendarEvents({ from, to, role }),
    enabled: enabled && !!role && !!from && !!to,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  return events
}

export function useMastheadFeed(role, { enabled = true } = {}) {
  const today = toLocalDateStr()
  const to = addDays(today, MASTHEAD_WINDOW_DAYS)
  const { data: events = [] } = useQuery({
    queryKey: ['portal_masthead_events', role, today, to],
    queryFn: () => fetchPortalCalendarEvents({ from: today, to, role }),
    enabled: enabled && !!role,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  return [...mastheadItems(events, today), ...holidayItems(getUsHolidaysForRange(today, today))]
}

/** Scroll a host's calendar section into view, for the Open Calendar pill. */
export function scrollToCalendar(id = 'portal-calendar') {
  const el = document.getElementById(id)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// EVENT-AUDIENCE-2: the staff masthead's event feed, for hosts other than the
// Internship At a Glance card (which keeps its own 90-day query because the
// Today digest beneath it shares the rows).
//
// Reads the SAME gated /api/aspire-events list every staff calendar reads,
// over the masthead window only, and applies the one rule in
// src/lib/mastheadEvents.js. A residency coordinator and an internship
// coordinator therefore see the same chip for the same flagged event; the
// Residency card used to invent its own from the cycle timeline, and the
// Owner retired that (2026-09-04).
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { toLocalDateStr } from '../../lib/designTokens'
import { MASTHEAD_WINDOW_DAYS, addDays, mastheadItems, holidayItems } from '../../lib/mastheadEvents'
import { getUsHolidaysForRange } from '../../lib/usHolidays'
import { portalCanSeeEvent } from '../../lib/aspireEvents'

export function useStaffMastheadEvents({ enabled = true, audience = null } = {}) {
  const today = toLocalDateStr()
  const to = addDays(today, MASTHEAD_WINDOW_DAYS)
  const { data: events = [] } = useQuery({
    queryKey: ['staff_masthead_events', today, to],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch('/api/aspire-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: 'list', from: today, to }),
      })
      if (!res.ok) return []
      const json = await res.json().catch(() => ({}))
      return json.events || []
    },
    enabled,
    staleTime: 60_000,
  })
  return useMemo(
    () => [
      // RESIDENCY-PORTAL-1: a portal host passes its audience, and gets only the events that
      // portal may see (the Residency Portal's At a Glance).
      ...mastheadItems(audience ? events.filter(ev => portalCanSeeEvent(ev, audience)) : events, today),
      ...holidayItems(getUsHolidaysForRange(today, today)),
    ],
    [events, today, audience],
  )
}

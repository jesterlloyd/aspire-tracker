// ASPIRE-MASTHEAD: the At a Glance briefing masthead. One bounded card over
// the city artwork carries the greeting (left), the date over a live clock
// (centre), the weather (right), and an events row along the bottom.
//
// MASTHEAD-LOCKSCREEN-1 (Owner, 2026-09-04): the card became a lock screen.
// The half-card fade over the artwork is gone, so the whole frame shows at
// full colour; every bare element is white and BIG (greeting, clock,
// temperature), and everything operational is a chip in the bottom row, the
// one material element that survived. The date-and-cohort line, the milestone
// block, and the weather's H/L line are retired from the card: the cohort
// lives in the scope picker, the milestone is now a chip when it is near, and
// the full weather readout is one click away on the temperature.
//
// Events come through the SAME gated /api/aspire-events list action and the
// same query key the welcome band used, so nothing new is fetched; the query
// is additionally gated to the visible route (the five workspace tabs stay
// mounted, and hidden tabs must not fetch). Which events earn a chip is the
// shared rule in src/lib/mastheadEvents.js.
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { toLocalDateStr } from '../lib/designTokens'
import { getUsHolidaysForRange } from '../lib/usHolidays'
import { greetingLine } from '../lib/masthead'
import { mastheadItems, holidayItems } from '../lib/mastheadEvents'
import { WeatherMasthead, useMastheadScene } from './WeatherScene'
import MastheadScenery from './MastheadScenery'
import MastheadClock from './masthead/MastheadClock'
import MastheadEventsRow from './masthead/MastheadEventsRow'

// cohort / onCampusCount stay in the signature for call-site stability; the
// card no longer prints either (Owner: no cohort line on the masthead).
// eslint-disable-next-line no-unused-vars
export default function TodayMasthead({ cohort, onTodayRoute, onCampusCount = 0 }) {
  const { userProfile } = useAuth()
  const navigate = useNavigate()

  const today = toLocalDateStr()
  const to = useMemo(() => {
    const d = new Date(`${today}T00:00:00`)
    d.setDate(d.getDate() + 90)
    return toLocalDateStr(d)
  }, [today])

  const { data: events = [] } = useQuery({
    queryKey: ['aggregate_welcome_events', today, to],
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
    // Hidden tabs stay mounted; only the visible At a Glance route fetches.
    enabled: onTodayRoute !== false,
  })

  const { heading, wash } = greetingLine(userProfile?.full_name)
  // MASTHEAD-SCENE-1: one unified clock drives the time-of-day artwork AND the
  // whole-card night treatment (sun-times with fixed-window fallback; never
  // the app theme, never the greeting wash).
  const { scene, night: sceneNight } = useMastheadScene()

  // The chips: flagged-or-milestone events inside the 14-day window (milestones
  // first), then today's US holidays, which are "Events Today" by definition.
  const items = useMemo(
    () => [...mastheadItems(events, today), ...holidayItems(getUsHolidaysForRange(today, today))],
    [events, today],
  )

  return (
    <div className={`mast mast-wash-${wash} mast-scenic mast-scene-${scene}${sceneNight ? ' mast-night' : ''}`}>
      <MastheadScenery />
      <div className="mast-row">
        <div className="mast-left">
          <h1 className="chart-route-title mast-greet">{heading}</h1>
        </div>
        <MastheadClock />
        <div className="mast-right">
          <WeatherMasthead />
        </div>
      </div>
      {/* Owner: the label and chips appear only when something is inside the
          window; the Open Calendar pill is the row's constant. */}
      <MastheadEventsRow items={items} calendar={{ label: 'Open Calendar', onClick: () => navigate('/interviews') }} />
    </div>
  )
}

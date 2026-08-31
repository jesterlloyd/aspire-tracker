// ASPIRE-MASTHEAD: the At a Glance briefing masthead. One bounded card
// carries every orientation element - greeting (the route's one Fraunces
// moment), date · cohort · last-visit line, the HTC-inspired weather scene
// (compact variant, preserved by owner decision), the single next milestone,
// View calendar, and a Today-in-ASPIRE chips row that renders only when
// events or holidays exist. It replaces both the old "Today" head and the
// bottom welcome band (AggregateWelcome), which greeted the user a second
// time at the footer.
//
// Events come through the SAME gated /api/aspire-events list action and the
// same query key the welcome band used, so nothing new is fetched; the query
// is additionally gated to the visible route (the five workspace tabs stay
// mounted, and hidden tabs must not fetch).
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { toLocalDateStr } from '../lib/designTokens'
import { eventOnDate, eventColor, eventTypeLabel, formatEventWhen, localDateStr } from '../lib/aspireEvents'
import { getUsHolidaysForRange } from '../lib/usHolidays'
import { greetingLine } from '../lib/masthead'
import { WeatherMasthead, useMastheadScene } from './WeatherScene'
import MastheadScenery from './MastheadScenery'

const IMPORTANT_TYPES = new Set(['deadline', 'ngrp_deadline', 'ngrp_open', 'town_hall', 'orientation'])

// Whole-day difference between two local 'YYYY-MM-DD' strings.
function daysBetween(fromStr, toStr) {
  const a = new Date(`${fromStr}T00:00:00`)
  const b = new Date(`${toStr}T00:00:00`)
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

// students/cohortId/currentUserId left the signature with the last-visit
// affordance; the host still passes them, harmlessly, for call-site stability.
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
  const dateLabel = new Date(`${today}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  // Today in ASPIRE - point / all-day / ranged events overlapping today,
  // plus US holidays (client-computed, read-only, never persisted).
  const todayEvents = useMemo(
    () => (events || []).filter(ev => eventOnDate(ev, today)).sort((a, b) => {
      if (!!a.all_day !== !!b.all_day) return a.all_day ? -1 : 1
      return String(a.start_at).localeCompare(String(b.start_at))
    }),
    [events, today],
  )
  const todayHolidays = useMemo(() => getUsHolidaysForRange(today, today), [today])

  // The single next milestone - soonest important event from today forward.
  // The full list lives one click away behind View calendar.
  const nextMilestone = useMemo(() => {
    const isImportant = ev => ev.show_on_welcome || ev.is_milestone || IMPORTANT_TYPES.has(ev.event_type)
    return (events || [])
      .filter(ev => isImportant(ev) && localDateStr(ev.start_at) >= today)
      .sort((a, b) => {
        const c = localDateStr(a.start_at).localeCompare(localDateStr(b.start_at))
        if (c) return c
        return (b.show_on_welcome ? 1 : 0) - (a.show_on_welcome ? 1 : 0)
      })[0] || null
  }, [events, today])

  const milestoneWhen = (() => {
    if (!nextMilestone) return null
    const startDay = localDateStr(nextMilestone.start_at)
    const d = daysBetween(today, startDay)
    const dateStr = new Date(`${startDay}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    if (d <= 0) return `Today · ${dateStr}`
    if (d === 1) return `Tomorrow · ${dateStr}`
    return `In ${d} days · ${dateStr}`
  })()

  const hasTodayLine = todayEvents.length > 0 || todayHolidays.length > 0

  return (
    <div className={`mast mast-wash-${wash} mast-scenic mast-scene-${scene}${sceneNight ? ' mast-night' : ''}`}>
      <MastheadScenery />
      <div className="mast-row">
        {/* MASTHEAD-SCENE-3 hero layout (Owner): the weather caption and the
            next milestone stack in the LEFT column under the greeting; the
            animated sun/moon floats in the open sky (CSS-positioned out of
            the module); View calendar stands alone top-right. */}
        <div className="mast-left">
          <h1 className="chart-route-title mast-greet">{heading}</h1>
          {/* Control-room date line (Owner: the browser-local "last visit"
              affordance retired as unhelpful): live occupancy and today's
              tempo instead, each segment omitted when zero. */}
          <div className="mast-sub">
            {dateLabel}
            {cohort?.name ? ` · ${cohort.name}` : ''}
            {onCampusCount > 0 ? ` · ${onCampusCount} on campus now` : ''}
            {todayEvents.length > 0 ? ` · ${todayEvents.length} event${todayEvents.length === 1 ? '' : 's'} today` : ''}
          </div>
          <WeatherMasthead />
          {nextMilestone && (
            <div className="mast-mile">
              <div className="mast-mile-label">Next milestone</div>
              <div className="mast-mile-name">{nextMilestone.title}</div>
              <div className="mast-mile-when">{milestoneWhen}</div>
            </div>
          )}
        </div>
        <div className="mast-right">
          <button type="button" className="mast-cal-btn" onClick={() => navigate('/interviews')}>
            View calendar
          </button>
        </div>
      </div>

      {hasTodayLine && (
        <div className="mast-today-line">
          <span className="mast-today-label">Today in ASPIRE</span>
          {todayHolidays.map(h => (
            <span key={h.name} className="mast-evchip">
              <span className="mast-evdot" style={{ background: '#D97706' }} aria-hidden />
              {h.name} · US Holiday
            </span>
          ))}
          {todayEvents.map(ev => (
            <span key={ev.id} className="mast-evchip">
              <span className="mast-evdot" style={{ background: eventColor(ev) }} aria-hidden />
              {ev.is_milestone ? '★ ' : ''}{ev.title} · {eventTypeLabel(ev.event_type)} · {formatEventWhen(ev)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

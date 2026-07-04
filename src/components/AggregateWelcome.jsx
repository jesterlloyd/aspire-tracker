// ASPIRE-WELCOME-AGGREGATE-3: a calm program-time welcome band at the top of Aggregate (OverviewTab).
// Greeting + today's date, "Today in ASPIRE" (today's events), and "Upcoming Milestones" countdown
// tiles — a welcome layer, NOT another KPI grid. Reads active ASPIRE events via the SAME gated
// /api/aspire-events list action used by the calendar (own query key; no direct Supabase writes).
// All active internal users can view. "Add Event" is deferred (would duplicate the calendar modal) —
// only "View Calendar" is offered, which routes to the Interviews tab where owner/admin author events.
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { toLocalDateStr } from '../lib/designTokens'
import { eventOnDate, eventColor, eventTypeLabel, formatEventWhen, localDateStr } from '../lib/aspireEvents'

const NAVY = '#1D2567'
const F = 'DM Sans, sans-serif'
const IMPORTANT_TYPES = new Set(['deadline', 'ngrp_deadline', 'ngrp_open', 'town_hall', 'orientation'])

function greetingWord() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

// Whole-day difference between two local 'YYYY-MM-DD' strings.
function daysBetween(fromStr, toStr) {
  const a = new Date(`${fromStr}T00:00:00`)
  const b = new Date(`${toStr}T00:00:00`)
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

export default function AggregateWelcome() {
  const { userProfile } = useAuth()
  const navigate = useNavigate()

  const today = toLocalDateStr()
  const to = useMemo(() => {
    const d = new Date(`${today}T00:00:00`)
    d.setDate(d.getDate() + 90)
    return toLocalDateStr(d)
  }, [today])

  const { data: events = [], isLoading, isError } = useQuery({
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
  })

  const firstName = (userProfile?.full_name || '').trim().split(/\s+/)[0] || 'there'
  const dateLabel = new Date(`${today}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  // Today in ASPIRE — point / all-day / ranged events overlapping today.
  const todayEvents = useMemo(
    () => (events || []).filter(ev => eventOnDate(ev, today)).sort((a, b) => {
      if (!!a.all_day !== !!b.all_day) return a.all_day ? -1 : 1
      return String(a.start_at).localeCompare(String(b.start_at))
    }),
    [events, today],
  )

  // Upcoming milestones — important events starting today-or-later, soonest first (tie-break: on-welcome).
  const upcoming = useMemo(() => {
    const isImportant = ev => ev.show_on_welcome || ev.is_milestone || IMPORTANT_TYPES.has(ev.event_type)
    return (events || [])
      .filter(ev => isImportant(ev) && localDateStr(ev.start_at) >= today)
      .sort((a, b) => {
        const c = localDateStr(a.start_at).localeCompare(localDateStr(b.start_at))
        if (c) return c
        return (b.show_on_welcome ? 1 : 0) - (a.show_on_welcome ? 1 : 0)
      })
      .slice(0, 4)
  }, [events, today])

  const countdownLabel = (startDay) => {
    const d = daysBetween(today, startDay)
    if (d <= 0) return 'Today'
    if (d === 1) return 'Tomorrow'
    return `In ${d} days`
  }

  const sectionTitle = { fontFamily: F, fontWeight: 700, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6B7280', marginBottom: 8 }

  return (
    <div style={{
      background: 'linear-gradient(160deg, #dceff8 0%, #f0f6fb 48%, #ffffff 100%)',
      border: '1px solid rgba(29,37,103,0.08)', borderRadius: 14,
      padding: '16px 20px', marginBottom: 14, fontFamily: F,
    }}>
      {/* Greeting row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 19, fontWeight: 700, color: NAVY, lineHeight: 1.2 }}>{greetingWord()}, {firstName}</div>
          <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 2 }}>{dateLabel}</div>
        </div>
        <button
          type="button"
          onClick={() => navigate('/interviews')}
          style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 7, height: 32, padding: '0 14px', background: NAVY, border: 'none', borderRadius: 9, fontFamily: F, fontWeight: 600, fontSize: 13, color: '#fff', cursor: 'pointer' }}
          onMouseEnter={e => e.currentTarget.style.background = '#141928'}
          onMouseLeave={e => e.currentTarget.style.background = NAVY}
        >
          View Calendar
        </button>
      </div>

      {/* Two-column body — Today in ASPIRE | Upcoming Milestones. Stacks on narrow. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginTop: 14 }}>

        {/* Today in ASPIRE */}
        <div>
          <div style={sectionTitle}>Today in ASPIRE</div>
          {isLoading ? (
            <div style={{ fontSize: 13, color: '#9ca3af' }}>Loading today’s events…</div>
          ) : todayEvents.length === 0 ? (
            <div style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic' }}>No events today.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {todayEvents.map(ev => {
                const color = eventColor(ev)
                return (
                  <div key={ev.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: '#fff', border: '1px solid rgba(29,37,103,0.06)', borderLeft: `3px solid ${color}`, borderRadius: 8, padding: '7px 11px' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: NAVY, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {ev.is_milestone && <span style={{ color, fontSize: 11 }}>★</span>}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.title}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>
                        {eventTypeLabel(ev.event_type)} · {formatEventWhen(ev)}{ev.location ? ` · ${ev.location}` : ''}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Upcoming Milestones */}
        <div>
          <div style={sectionTitle}>Upcoming Milestones</div>
          {isLoading ? (
            <div style={{ fontSize: 13, color: '#9ca3af' }}>Loading upcoming dates…</div>
          ) : upcoming.length === 0 ? (
            <div style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic' }}>No upcoming milestones.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
              {upcoming.map((ev, i) => {
                const color = eventColor(ev)
                const startDay = localDateStr(ev.start_at)
                const isNext = i === 0
                return (
                  <div key={ev.id} style={{
                    background: '#fff', border: `1px solid ${isNext ? color : 'rgba(29,37,103,0.08)'}`,
                    borderRadius: 10, padding: '9px 11px', display: 'flex', flexDirection: 'column', gap: 3,
                    boxShadow: isNext ? `0 2px 10px ${color}22` : '0 1px 3px rgba(0,0,0,0.04)',
                  }}>
                    {isNext && <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color }}>Next up</span>}
                    <span style={{ fontSize: 15, fontWeight: 700, color: NAVY, lineHeight: 1.1 }}>{countdownLabel(startDay)}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: '#374151', display: 'flex', alignItems: 'center', gap: 5, lineHeight: 1.25 }}>
                      {ev.is_milestone && <span style={{ color, fontSize: 10, flexShrink: 0 }}>★</span>}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{ev.title}</span>
                    </span>
                    <span style={{ fontSize: 10.5, color: '#9ca3af' }}>
                      {eventTypeLabel(ev.event_type)} · {new Date(`${startDay}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Quiet failure: sections already fall back to empty states; surface a subtle note only. */}
      {isError && (
        <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 14 }}>ASPIRE dates are unavailable right now.</div>
      )}
    </div>
  )
}

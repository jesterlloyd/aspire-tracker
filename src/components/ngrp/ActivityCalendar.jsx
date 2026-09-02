// NGRP-WORKSPACE-2 / NGRP-ACTIVITY-PARITY-1: Residency > Activity.
//
// The cohort's calendar of workshops, town halls and bootcamps, built to MATCH
// the Interviews calendar rather than to resemble it (Owner): the same mini
// calendar in the sidebar, the same hover-to-add affordance on a day, the same
// purple event action, US holidays alongside, and a day modal on click.
//
// SHARED, NOT COPIED. The month grid, weekday header, nav and day panel are the
// canonical calendar foundation that Rotation Activity and the interview
// calendar already use. MiniCalendar is imported from CalendarSidebar (it grew
// an export for this, and its interview inputs default to empty). The event
// action palette moved to lib/ngrp/ngrpActivity.js so both calendars read one
// definition. Events come through the SAME gated /api/aspire-events list and are
// written through the SAME AspireEventModal, so an NGRP workshop added here is
// an ASPIRE event like any other.
//
// SCOPED BY DISPLAY, NOT BY FETCH. There is no cycle_id on an event, and
// inventing one would fork the events model for this tab alone.
import { useState, useMemo, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { toLocalDateStr } from '../../lib/designTokens'
import { eventOnDate, eventColor, eventTypeLabel, formatEventWhen } from '../../lib/aspireEvents'
import { getUsHolidaysForRange } from '../../lib/usHolidays'
import AspireEventModal from '../AspireEventModal'
import { MiniCalendar } from '../CalendarSidebar'
import {
  CanonicalCalendarLayout, CanonicalCalendarSidebar, CanonicalCalendarTodayPanel,
  CanonicalCalendarNav, CanonicalCalendarMonthTitle, CanonicalWeekdayHeader,
  CanonicalMonthCell, CanonicalActivityChip,
} from '../shared/CanonicalCalendarFoundation'
import { F } from '../../lib/ngrp/ngrpCohortForm'
import {
  initialActivityMonth, monthRange, EVENT_ACTION, EVENT_ACTION_HOVER, HOLIDAY_COLOR,
} from '../../lib/ngrp/ngrpActivity'
import { ModalShell } from './NgrpFormUi'

const MONTH_FMT = { month: 'long', year: 'numeric' }
const longDate = d => new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

function AddEventButton({ onClick, style }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Add a custom ASPIRE event"
      style={{
        height: 32, padding: '0 14px', background: EVENT_ACTION, border: 'none', borderRadius: 9,
        cursor: 'pointer', fontFamily: 'DM Sans', fontWeight: 600, fontSize: 12, color: '#fff',
        display: 'flex', alignItems: 'center', gap: 6, transition: 'background 0.15s ease', ...style,
      }}
      onMouseEnter={e => { e.currentTarget.style.background = EVENT_ACTION_HOVER }}
      onMouseLeave={e => { e.currentTarget.style.background = EVENT_ACTION }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      Add Event
    </button>
  )
}

// One day's events and holidays, opened by clicking a date. The interview
// calendar opens its Day Manager the same way; this is the events-only version.
function DayModal({ date, events, holidays, canManage, onAdd, onEdit, onClose }) {
  return (
    <ModalShell label={`Activity on ${longDate(date)}`} onClose={onClose} width={560}>
      <div style={{ flexShrink: 0, padding: '16px 20px', borderBottom: '1px solid #F3F4F6', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#8B8F99' }}>Activity</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1D2567', marginTop: 2 }}>{longDate(date)}</div>
        </div>
        {canManage && <AddEventButton onClick={onAdd} style={{ marginLeft: 'auto' }} />}
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: '14px 20px 20px', overflowY: 'auto', fontFamily: F }}>
        {holidays.map(h => (
          <div key={h.name} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 0', borderBottom: '1px solid #F3F4F6' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: HOLIDAY_COLOR, flexShrink: 0 }} aria-hidden="true" />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{h.name}</span>
            <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#8B8F99' }}>US Holiday</span>
          </div>
        ))}
        {events.map(ev => (
          <button
            key={ev.id}
            type="button"
            onClick={() => canManage && onEdit(ev)}
            style={{
              display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
              border: 'none', borderBottom: '1px solid #F3F4F6', background: 'none',
              padding: '9px 0', cursor: canManage ? 'pointer' : 'default', fontFamily: F,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: eventColor(ev), flexShrink: 0 }} aria-hidden="true" />
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151' }}>{ev.title}</span>
              <span style={{ display: 'block', fontSize: 11.5, color: '#6B7785' }}>{eventTypeLabel(ev.event_type)} · {formatEventWhen(ev)}</span>
            </span>
          </button>
        ))}
        {!events.length && !holidays.length && (
          <p style={{ margin: '6px 0 0', fontSize: 12.5, color: '#9CA3AF' }}>Nothing scheduled.</p>
        )}
      </div>
    </ModalShell>
  )
}

export default function ActivityCalendar({ cycle, canManage }) {
  const queryClient = useQueryClient()
  const location = useLocation()
  const today = toLocalDateStr()
  const [cursor, setCursor] = useState(() => initialActivityMonth(cycle, today))
  const [selected, setSelected] = useState(today)
  const [dayOpen, setDayOpen] = useState(null)
  const [editing, setEditing] = useState(null)

  const { from, to } = monthRange(cursor)

  const { data: events = [] } = useQuery({
    queryKey: ['ngrp_activity_events', from, to],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch('/api/aspire-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: 'list', from, to }),
      })
      if (!res.ok) return []
      const json = await res.json().catch(() => ({}))
      return json.events || []
    },
    // Only the visible Activity sub-tab fetches; the workspace keeps tabs mounted.
    enabled: location.pathname.startsWith('/ngrp/residency/activity'),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  // US holidays are client-computed, read-only, and never persisted - the same
  // contract the masthead and the interview calendar use.
  const holidays = useMemo(() => getUsHolidaysForRange(from, to), [from, to])

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['ngrp_activity_events'] })
    queryClient.invalidateQueries({ queryKey: ['aggregate_welcome_events'] })
  }, [queryClient])

  const monthName = new Date(cursor.year, cursor.month, 1).toLocaleDateString('en-US', MONTH_FMT)

  const cells = useMemo(() => {
    const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate()
    const lead = new Date(cursor.year, cursor.month, 1).getDay()
    const out = Array.from({ length: lead }, () => null)
    for (let d = 1; d <= daysInMonth; d += 1) out.push(toLocalDateStr(new Date(cursor.year, cursor.month, d)))
    while (out.length % 7 !== 0) out.push(null)
    return out
  }, [cursor])

  const eventsOn = useCallback(date => events.filter(ev => eventOnDate(ev, date)), [events])
  const holidaysOn = useCallback(date => holidays.filter(h => h.date === date), [holidays])

  const step = delta => setCursor(c => {
    const d = new Date(c.year, c.month + delta, 1)
    return { year: d.getFullYear(), month: d.getMonth() }
  })

  const openDay = date => { setSelected(date); setDayOpen(date) }

  return (
    <>
      <CanonicalCalendarLayout
        title="Activity"
        description={cycle?.name ? `Workshops, town halls and bootcamps across ${cycle.name}.` : 'Workshops, town halls and bootcamps.'}
        labelledBy="ngrp-activity-title"
        toolbar={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <CanonicalCalendarNav
              onPrev={() => step(-1)}
              onNext={() => step(1)}
              onToday={() => {
                const [y, m] = today.split('-').map(Number)
                setCursor({ year: y, month: m - 1 })
                setSelected(today)
              }}
            />
            <CanonicalCalendarMonthTitle ariaLive="polite">{monthName}</CanonicalCalendarMonthTitle>
            {canManage && (
              <AddEventButton onClick={() => setEditing({ isNew: true })} style={{ marginLeft: 'auto' }} />
            )}
          </div>
        }
        sidebar={
          <CanonicalCalendarSidebar>
            {/* The same mini calendar the Interviews sidebar shows, with the
                interview half left empty. */}
            <MiniCalendar
              aspireEvents={events}
              selectedDate={selected}
              onSelectDate={date => { setSelected(date); setCursor(c => {
                const [y, m] = date.split('-').map(Number)
                return (y === c.year && m - 1 === c.month) ? c : { year: y, month: m - 1 }
              }) }}
            />
            <CanonicalCalendarTodayPanel
              dateLabel={longDate(selected)}
              summary={(() => {
                const n = eventsOn(selected).length + holidaysOn(selected).length
                return n ? `${n} item${n === 1 ? '' : 's'}` : null
              })()}
              emptyLabel="Nothing scheduled."
            >
              {holidaysOn(selected).map(h => (
                <div key={h.name} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 0', fontFamily: F }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: HOLIDAY_COLOR, flexShrink: 0 }} aria-hidden="true" />
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{h.name}</span>
                </div>
              ))}
              {eventsOn(selected).map(ev => (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => canManage && setEditing(ev)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'none',
                    padding: '6px 0', cursor: canManage ? 'pointer' : 'default', fontFamily: F,
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: '#374151' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: eventColor(ev), flexShrink: 0 }} aria-hidden="true" />
                    {ev.title}
                  </span>
                  <span style={{ display: 'block', fontSize: 11.5, color: '#6B7785', marginLeft: 15 }}>
                    {eventTypeLabel(ev.event_type)} · {formatEventWhen(ev)}
                  </span>
                </button>
              ))}
            </CanonicalCalendarTodayPanel>
          </CanonicalCalendarSidebar>
        }
      >
        <CanonicalWeekdayHeader />
        <div role="grid" aria-label={`${monthName} activity`} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {cells.map((date, i) => date === null
            ? <CanonicalMonthCell key={`pad-${i}`} isOtherMonth />
            : (
              // The pill is a SIBLING of the day button, not a child: nesting one
              // button inside another is invalid and costs the pill its keyboard
              // reachability. The wrapper positions it and drives the hover.
              <div key={date} className="ngrp-daycell">
                <CanonicalMonthCell
                  day={Number(date.slice(-2))}
                  isToday={date === today}
                  isSelected={date === selected}
                  isFuture={date > today}
                  ariaLabel={`${longDate(date)}, ${eventsOn(date).length} events`}
                  onClick={() => openDay(date)}
                >
                  {/* Holidays are AMBER, as they are on the Interviews calendar:
                      they are context nobody scheduled, and reading as another
                      event is exactly the confusion the colour prevents. */}
                  {holidaysOn(date).map(h => (
                    <span key={h.name} className="ngrp-holiday-chip" title={`${h.name} · US Holiday`}>{h.name}</span>
                  ))}
                  {eventsOn(date).slice(0, 2).map(ev => (
                    <CanonicalActivityChip key={ev.id} label={ev.title} />
                  ))}
                  {eventsOn(date).length > 2 && (
                    <CanonicalActivityChip label={`+${eventsOn(date).length - 2} more`} secondary />
                  )}
                </CanonicalMonthCell>
                {canManage && (
                  <button
                    type="button"
                    className="ngrp-dayadd"
                    aria-label={`Add an event on ${longDate(date)}`}
                    onClick={() => { setSelected(date); setEditing({ isNew: true, on: date }) }}
                  >
                    + Event
                  </button>
                )}
              </div>
            ))}
        </div>
      </CanonicalCalendarLayout>

      {dayOpen && (
        <DayModal
          date={dayOpen}
          events={eventsOn(dayOpen)}
          holidays={holidaysOn(dayOpen)}
          canManage={canManage}
          onAdd={() => { setEditing({ isNew: true, on: dayOpen }); setDayOpen(null) }}
          onEdit={ev => { setEditing(ev); setDayOpen(null) }}
          onClose={() => setDayOpen(null)}
        />
      )}

      {editing && (
        <AspireEventModal
          event={editing.isNew ? null : editing}
          canManage={canManage}
          defaultDate={editing.on || selected}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh() }}
        />
      )}
    </>
  )
}

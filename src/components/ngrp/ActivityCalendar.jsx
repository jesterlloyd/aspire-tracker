// NGRP-WORKSPACE-2: Residency > Activity - the cohort's calendar of events.
//
// Built on the SHARED canonical calendar foundation (the month grid, the
// weekday header, the nav and the day panel that Rotation Activity and the
// interview calendar already use), so this is a third caller of one calendar
// rather than a third calendar. Events come through the SAME gated
// /api/aspire-events list action every other surface uses, and are created and
// edited through the SAME AspireEventModal, so an NGRP workshop added here is
// an ASPIRE event like any other and shows up wherever events show up.
//
// SCOPED BY DISPLAY, NOT BY FETCH. There is no cycle_id on an event, and
// inventing one would fork the events model for this tab alone. The calendar
// shows the window the selected residency cohort actually spans - its
// application open date through its residency start, widened to whole months -
// which is the honest reading of "this cohort's activity" with the data that
// exists.
import { useState, useMemo, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toLocalDateStr } from '../../lib/designTokens'
import { eventOnDate, eventColor, eventTypeLabel, formatEventWhen } from '../../lib/aspireEvents'
import AspireEventModal from '../AspireEventModal'
import {
  CanonicalCalendarLayout, CanonicalCalendarSidebar, CanonicalCalendarTodayPanel,
  CanonicalCalendarNav, CanonicalCalendarMonthTitle, CanonicalWeekdayHeader,
  CanonicalMonthCell, CanonicalActivityChip,
} from '../shared/CanonicalCalendarFoundation'
import { F, btn } from '../../lib/ngrp/ngrpCohortForm'
import { initialActivityMonth } from '../../lib/ngrp/ngrpActivity'

const MONTH_FMT = { month: 'long', year: 'numeric' }

export default function ActivityCalendar({ cycle, canManage }) {
  const queryClient = useQueryClient()
  const today = toLocalDateStr()
  const [cursor, setCursor] = useState(() => initialActivityMonth(cycle, today))
  const [selected, setSelected] = useState(today)
  const [editing, setEditing] = useState(null)

  // One bounded fetch per month view, keyed by the window, so paging months
  // does not refetch the whole year.
  const from = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}-01`
  const to = (() => {
    const d = new Date(cursor.year, cursor.month + 1, 0)
    return toLocalDateStr(d)
  })()

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
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['ngrp_activity_events'] })
    queryClient.invalidateQueries({ queryKey: ['aggregate_welcome_events'] })
  }, [queryClient])

  const monthName = new Date(cursor.year, cursor.month, 1).toLocaleDateString('en-US', MONTH_FMT)

  const cells = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1)
    const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate()
    const lead = first.getDay()
    const out = []
    for (let i = 0; i < lead; i += 1) out.push(null)
    for (let d = 1; d <= daysInMonth; d += 1) {
      out.push(toLocalDateStr(new Date(cursor.year, cursor.month, d)))
    }
    while (out.length % 7 !== 0) out.push(null)
    return out
  }, [cursor])

  const eventsOn = useCallback(date => events.filter(ev => eventOnDate(ev, date)), [events])
  const selectedEvents = eventsOn(selected)

  const step = delta => setCursor(c => {
    const d = new Date(c.year, c.month + delta, 1)
    return { year: d.getFullYear(), month: d.getMonth() }
  })

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
              <button type="button" style={{ ...btn(true), marginLeft: 'auto' }} onClick={() => setEditing({ isNew: true })}>
                <Plus size={13} strokeWidth={2.2} aria-hidden="true" /> Add event
              </button>
            )}
          </div>
        }
        sidebar={
          <CanonicalCalendarSidebar>
            <CanonicalCalendarTodayPanel
              dateLabel={new Date(`${selected}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              summary={selectedEvents.length ? `${selectedEvents.length} event${selectedEvents.length === 1 ? '' : 's'}` : null}
              emptyLabel="Nothing scheduled."
            >
              {selectedEvents.map(ev => (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => canManage && setEditing(ev)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'none',
                    padding: '7px 0', cursor: canManage ? 'pointer' : 'default', fontFamily: F,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: '#374151' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: eventColor(ev), flexShrink: 0 }} aria-hidden="true" />
                    {ev.title}
                  </div>
                  <div style={{ fontSize: 11.5, color: '#6B7785', marginLeft: 15 }}>
                    {eventTypeLabel(ev.event_type)} · {formatEventWhen(ev)}
                  </div>
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
              <CanonicalMonthCell
                key={date}
                day={Number(date.slice(-2))}
                isToday={date === today}
                isSelected={date === selected}
                isFuture={date > today}
                ariaLabel={`${date}, ${eventsOn(date).length} events`}
                onClick={() => setSelected(date)}
              >
                {eventsOn(date).slice(0, 2).map(ev => (
                  <CanonicalActivityChip key={ev.id} label={ev.title} />
                ))}
                {eventsOn(date).length > 2 && (
                  <CanonicalActivityChip label={`+${eventsOn(date).length - 2} more`} secondary />
                )}
              </CanonicalMonthCell>
            ))}
        </div>
      </CanonicalCalendarLayout>

      {editing && (
        <AspireEventModal
          event={editing.isNew ? null : editing}
          canManage={canManage}
          defaultDate={selected}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh() }}
        />
      )}
    </>
  )
}

import { useMemo } from 'react'
import { ASPIRE_STATUS_CONFIG } from '../lib/constants'
import { GANTT_PHASES } from '../lib/eventTypes'

const ROW_H = 36
const LABEL_W = 130
const AXIS_H = 28

function parseDate(str) {
  if (!str) return null
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function fmtAxisDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000)
}

export default function CohortGantt({ students, events, cohort }) {
  const todayStr = (() => {
    const n = new Date()
    return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`
  })()

  // Build per-student event maps
  const eventsByStudent = useMemo(() => {
    const map = {}
    events.forEach(e => {
      if (!map[e.student_id]) map[e.student_id] = []
      map[e.student_id].push(e)
    })
    return map
  }, [events])

  // Compute global date range
  const { minDate, maxDate } = useMemo(() => {
    let min = null, max = null
    const consider = d => {
      if (!d) return
      if (!min || d < min) min = d
      if (!max || d > max) max = d
    }
    events.forEach(e => { if (e.event_date) consider(parseDate(e.event_date)) })
    if (cohort?.start_date) consider(parseDate(cohort.start_date))
    if (cohort?.end_date)   consider(parseDate(cohort.end_date))
    if (!min) min = new Date()
    if (!max) { max = new Date(min); max.setDate(max.getDate() + 90) }
    // pad 7 days each side
    const padMin = new Date(min); padMin.setDate(padMin.getDate() - 7)
    const padMax = new Date(max); padMax.setDate(padMax.getDate() + 7)
    return { minDate: padMin, maxDate: padMax }
  }, [events, cohort])

  const totalDays = daysBetween(minDate, maxDate) || 1

  // Compute axis ticks (monthly or bi-weekly depending on range)
  const ticks = useMemo(() => {
    const result = []
    const tickEvery = totalDays > 120 ? 30 : totalDays > 60 ? 14 : 7
    const cur = new Date(minDate)
    while (cur <= maxDate) {
      result.push(new Date(cur))
      cur.setDate(cur.getDate() + tickEvery)
    }
    return result
  }, [minDate, maxDate, totalDays])

  // Compute phase bars per student
  const rows = useMemo(() => {
    return students.map(s => {
      const evts = eventsByStudent[s.id] || []
      const find = type => evts.find(e => e.event_type === type)

      const formReceived  = find('form_received')
      const interview     = find('interview')
      const placement     = find('placement')
      const rotationStart = find('rotation_start')
      const rotationEnd   = find('rotation_end')

      const phases = []

      // Phase 1: Form → Interview
      if (formReceived?.event_date && interview?.event_date) {
        const start = parseDate(formReceived.event_date)
        const end   = parseDate(interview.event_date)
        if (start && end && end >= start) {
          phases.push({ phase: 'form_to_interview', start, end })
        }
      }

      // Phase 2: Interview → Placed
      if (interview?.event_date && placement?.event_date) {
        const start = parseDate(interview.event_date)
        const end   = parseDate(placement.event_date)
        if (start && end && end >= start) {
          phases.push({ phase: 'interview_to_place', start, end })
        }
      }

      // Phase 3: Rotation
      if (rotationStart?.event_date) {
        const start = parseDate(rotationStart.event_date)
        const end   = rotationEnd?.event_date ? parseDate(rotationEnd.event_date) : parseDate(todayStr)
        if (start && end && end >= start) {
          phases.push({ phase: 'rotation', start, end, isOngoing: !rotationEnd })
        }
      }

      // Placeholder if no events: use cohort dates
      const hasAnyPhase = phases.length > 0
      if (!hasAnyPhase && cohort?.start_date && cohort?.end_date) {
        const start = parseDate(cohort.start_date)
        const end   = parseDate(cohort.end_date)
        if (start && end) {
          phases.push({ phase: 'placeholder', start, end })
        }
      }

      return { student: s, phases, hasEvents: evts.length > 0 }
    })
  }, [students, eventsByStudent, cohort, todayStr])

  const pct = date => {
    const d = daysBetween(minDate, date)
    return Math.max(0, Math.min(100, (d / totalDays) * 100))
  }

  const todayPct = pct(parseDate(todayStr))

  if (rows.length === 0) return null

  return (
    <div style={{ fontFamily: 'DM Sans, sans-serif', padding: '0 0 16px' }}>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12, padding: '0 16px' }}>
        {GANTT_PHASES.map(p => (
          <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6b7280' }}>
            <div style={{ width: 20, height: 10, borderRadius: 3, background: p.color, border: `1.5px solid ${p.border}` }} />
            {p.label}
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6b7280' }}>
          <div style={{ width: 20, height: 10, borderRadius: 3, background: '#f3f4f6', border: '1.5px solid #d1d5db' }} />
          Expected (no data)
        </div>
      </div>

      {/* Scrollable chart */}
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 600, position: 'relative' }}>

          {/* Axis row */}
          <div style={{ display: 'flex', marginLeft: LABEL_W, height: AXIS_H, position: 'relative', borderBottom: '1px solid #e5e7eb' }}>
            {ticks.map((t, i) => {
              const left = pct(t)
              return (
                <div key={i} style={{
                  position: 'absolute', left: `${left}%`,
                  fontSize: 10, color: '#9ca3af',
                  transform: 'translateX(-50%)',
                  whiteSpace: 'nowrap', top: 6,
                }}>
                  {fmtAxisDate(t)}
                </div>
              )
            })}
          </div>

          {/* Student rows */}
          {rows.map(({ student: s, phases, hasEvents }, ri) => {
            const cfg = ASPIRE_STATUS_CONFIG[s.status] || ASPIRE_STATUS_CONFIG['Pending Outreach']
            const isEven = ri % 2 === 0
            return (
              <div key={s.id} style={{
                display: 'flex', alignItems: 'center',
                height: ROW_H,
                background: isEven ? '#fafafa' : '#ffffff',
                borderBottom: '1px solid #f3f4f6',
              }}>
                {/* Label */}
                <div style={{
                  width: LABEL_W, flexShrink: 0, padding: '0 8px 0 16px',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}>
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                    background: cfg.text,
                  }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#374151',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.last_name}{s.first_name ? `, ${s.first_name[0]}.` : ''}
                  </span>
                </div>

                {/* Bar area */}
                <div style={{ flex: 1, position: 'relative', height: '100%' }}>
                  {/* Tick grid lines */}
                  {ticks.map((t, i) => (
                    <div key={i} style={{
                      position: 'absolute', left: `${pct(t)}%`, top: 0, bottom: 0,
                      width: 1, background: '#f0f0f0',
                    }} />
                  ))}

                  {/* Today line */}
                  <div style={{
                    position: 'absolute', left: `${todayPct}%`, top: 4, bottom: 4,
                    width: 1.5, background: '#dc1e34', zIndex: 2,
                  }} />

                  {/* Phase bars */}
                  {phases.map((ph, pi) => {
                    const left = pct(ph.start)
                    const right = pct(ph.end)
                    const width = right - left
                    if (width <= 0) return null

                    const phaseCfg = GANTT_PHASES.find(p => p.key === ph.phase)
                    const isPlaceholder = ph.phase === 'placeholder'

                    return (
                      <div key={pi} style={{
                        position: 'absolute',
                        left: `${left}%`,
                        width: `${width}%`,
                        top: '25%', height: '50%',
                        background: isPlaceholder ? '#f3f4f6' : phaseCfg?.color || '#e5e7eb',
                        border: `1.5px solid ${isPlaceholder ? '#d1d5db' : phaseCfg?.border || '#d1d5db'}`,
                        borderRight: ph.isOngoing ? `2px dashed ${phaseCfg?.border || '#166534'}` : undefined,
                        borderRadius: 4,
                        zIndex: 1,
                        boxSizing: 'border-box',
                      }} />
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

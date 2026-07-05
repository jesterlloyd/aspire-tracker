// PreferenceMatchRing - full-circle donut chart showing preference match quality.
// Static display visualization - no hover interactions.

import { useEffect, useMemo, useState } from 'react'

const CX = 90
const CY = 90
const OUTER_R = 67
const INNER_R = 47
const MID_R   = (OUTER_R + INNER_R) / 2   // 57
const WIDTH   = OUTER_R - INNER_R         // 20
const C       = 2 * Math.PI * MID_R       // ≈ 358.14

const SEGMENTS = [
  { key: 'top',       label: 'Top choice', colorVar: 'var(--gauge-segment-placed,   #C8D5C0)', solidColor: '#C8D5C0' },
  { key: 'second',    label: 'Second',     colorVar: 'var(--gauge-segment-awaiting, #D5DCEC)', solidColor: '#D5DCEC' },
  { key: 'other',     label: 'Other',      colorVar: 'var(--color-status-warning-bg,#F4D9B6)', solidColor: '#F4D9B6' },
  { key: 'unmatched', label: 'Unmatched',  colorVar: 'var(--gauge-segment-over,     #F2D5E0)', solidColor: '#F2D5E0' },
]

const SEG_TIMINGS = {
  top:       { delay: 0,   duration: 300 },
  second:    { delay: 200, duration: 300 },
  other:     { delay: 400, duration: 300 },
  unmatched: { delay: 600, duration: 300 },
}

const SEG_GAP = 3

export default function PreferenceMatchRing({ students = [], units = [], cohort }) {
  const [elapsed, setElapsed] = useState(0)

  const reducedMotion = typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (reducedMotion) { setElapsed(9999); return }
    const start = performance.now()
    let raf
    const tick = (now) => {
      setElapsed(now - start)
      if (now - start < 1000) raf = requestAnimationFrame(tick)
      else setElapsed(9999)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [reducedMotion])

  const unitNameById = useMemo(() => {
    const m = {}
    ;(units || []).forEach(u => { if (u.id) m[u.id] = u.unit_name })
    return m
  }, [units])

  const counts = useMemo(() => {
    const matched = students.filter(s => s.matched_unit_id)
    const top = matched.filter(s => {
      const n = unitNameById[s.matched_unit_id]
      return n && s.unit_preference_1 === n
    }).length
    const second = matched.filter(s => {
      const n = unitNameById[s.matched_unit_id]
      return n && n !== s.unit_preference_1 && s.unit_preference_2 === n
    }).length
    const other     = matched.length - top - second
    const unmatched = students.length - matched.length
    return { top, second, other, unmatched }
  }, [students, unitNameById])

  const total  = students.length
  const topPct = total > 0 ? Math.round((counts.top / total) * 100) : 0
  const isEmpty = total === 0

  const segProg = (key) => {
    const { delay, duration } = SEG_TIMINGS[key]
    return Math.min(1, Math.max(0, (elapsed - delay) / duration))
  }

  const segData = useMemo(() => {
    let cumLen = 0
    return SEGMENTS.map(seg => {
      const rawLen = total > 0 ? (counts[seg.key] / total) * C : 0
      const offset = cumLen
      if (rawLen > SEG_GAP) cumLen += rawLen + SEG_GAP
      return { ...seg, rawLen, offset }
    }).filter(s => s.rawLen > SEG_GAP)
  }, [counts, total])

  const centerBig   = isEmpty ? '-' : `${topPct}%`
  const centerSub   = isEmpty ? 'no students yet' : 'got top choice'
  const centerColor = isEmpty ? 'var(--text-muted,#98A2B3)' : 'var(--color-status-success,#2D4A2B)'
  const cohortName  = cohort?.name || 'Cohort'

  return (
    <section style={{
      background: 'var(--bg-card,#fff)',
      border: '1px solid var(--border-card,rgba(29,37,103,0.08))',
      borderRadius: 14,
      boxShadow: 'var(--shadow-card)',
      overflow: 'hidden',
      fontFamily: 'DM Sans, sans-serif',
      height: '100%',
      boxSizing: 'border-box',
    }}>
      {/* Eyebrow */}
      <div style={{
        padding: '10px 20px 8px',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        borderBottom: '1px solid var(--border-card,rgba(29,37,103,0.04))',
      }}>
        <div>
          <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-caption,#475467)', fontWeight: 600 }}>
            Preference Match
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted,#98A2B3)', marginTop: 2, whiteSpace: 'nowrap' }}>
            How well students got their top choices
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted,#98A2B3)', whiteSpace: 'nowrap', marginLeft: 8 }}>
          {cohortName} · matching snapshot
        </div>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '6px 12px 10px' }}>

        <svg
          width="100%"
          viewBox="0 0 180 180"
          style={{ maxWidth: 160, display: 'block' }}
          aria-label={`Preference match: ${counts.top} top choice, ${counts.second} second choice, ${counts.other} other match, ${counts.unmatched} unmatched out of ${total} students`}
          role="img"
        >
          {/* Baseline ring */}
          <circle
            cx={CX} cy={CY} r={MID_R}
            fill="none"
            stroke="var(--gauge-segment-base,#EDEDEB)"
            strokeWidth={WIDTH}
            strokeOpacity={isEmpty ? 1 : 0.3}
          />

          {/* Animated colored segments */}
          {!isEmpty && segData.map(seg => {
            const animLen = seg.rawLen * segProg(seg.key)
            if (animLen < 0.5) return null
            return (
              <circle
                key={seg.key}
                cx={CX} cy={CY} r={MID_R}
                fill="none"
                stroke={seg.colorVar}
                strokeWidth={WIDTH}
                strokeLinecap="round"
                strokeDasharray={`${animLen} ${C}`}
                strokeDashoffset={-seg.offset}
                style={{
                  transformOrigin: `${CX}px ${CY}px`,
                  transform: 'rotate(-90deg)',
                }}
              />
            )
          })}

          {/* Center number */}
          <text x={CX} y={CY - 5} textAnchor="middle"
            fontFamily="DM Sans, sans-serif" fontSize="22" fontWeight="600" fill={centerColor}>
            {centerBig}
          </text>
          {/* Center subtitle */}
          <text x={CX} y={CY + 10} textAnchor="middle"
            fontFamily="DM Sans, sans-serif" fontSize="9.5" fontWeight="500"
            fill="var(--text-caption,#6b7280)">
            {centerSub}
          </text>
        </svg>

        {/* Legend row - static, no interaction */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 }}>
          {SEGMENTS.map(seg => (
            <div key={seg.key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: 'var(--text-caption,#6b7280)', fontFamily: 'DM Sans, sans-serif' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: seg.solidColor, display: 'inline-block', flexShrink: 0 }} />
              {seg.label} · {counts[seg.key]}
            </div>
          ))}
        </div>

      </div>
    </section>
  )
}

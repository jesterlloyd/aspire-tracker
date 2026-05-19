// PreferenceMatchRing — full-circle donut chart showing preference match quality.
// Shows how well students' placements align with their stated unit preferences.

import { useState, useEffect, useMemo } from 'react'

const CX = 110
const CY = 110
const OUTER_R = 90
const INNER_R = 60
const MID_R   = (OUTER_R + INNER_R) / 2   // 75
const WIDTH   = OUTER_R - INNER_R         // 30
const C       = 2 * Math.PI * MID_R       // ≈ 471.24

// Each segment: key, display label, CSS-variable-aware colors
const SEGMENTS = [
  {
    key:        'top',
    label:      'Top choice',
    colorVar:   'var(--gauge-segment-placed,  #C8D5C0)',
    solidColor: '#C8D5C0',
    textColor:  'var(--color-status-success, #2D4A2B)',
  },
  {
    key:        'second',
    label:      'Second',
    colorVar:   'var(--gauge-segment-awaiting, #D5DCEC)',
    solidColor: '#D5DCEC',
    textColor:  'var(--color-status-info, #4F6DA8)',
  },
  {
    key:        'other',
    label:      'Other',
    colorVar:   'var(--color-status-warning-bg, #F4D9B6)',
    solidColor: '#F4D9B6',
    textColor:  'var(--color-status-warning, #8B6914)',
  },
  {
    key:        'unmatched',
    label:      'Unmatched',
    colorVar:   'var(--gauge-segment-over, #F2D5E0)',
    solidColor: '#F2D5E0',
    textColor:  'var(--color-status-danger, #930045)',
  },
]

// Segment animation delay (ms) and duration (ms)
const SEG_TIMINGS = {
  top:       { delay: 0,   duration: 300 },
  second:    { delay: 200, duration: 300 },
  other:     { delay: 400, duration: 300 },
  unmatched: { delay: 600, duration: 300 },
}

// Small visual gap between segments (pixels along the circumference)
const SEG_GAP = 3

export default function PreferenceMatchRing({ students = [], units = [], cohort }) {
  const [hoveredKey, setHoveredKey] = useState(null)
  const [elapsed,    setElapsed]    = useState(0)

  const reducedMotion = typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  // Animate from 0 to full over ~1000ms
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

  // Build unit id → name lookup
  const unitNameById = useMemo(() => {
    const m = {}
    ;(units || []).forEach(u => { if (u.id) m[u.id] = u.unit_name })
    return m
  }, [units])

  // Compute match quality buckets
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

  const total   = students.length
  const topPct  = total > 0 ? Math.round((counts.top / total) * 100) : 0
  const isEmpty = total === 0

  // Per-segment animation progress
  const segProg = (key) => {
    const { delay, duration } = SEG_TIMINGS[key]
    return Math.min(1, Math.max(0, (elapsed - delay) / duration))
  }

  // Build segments with cumulative dash offsets
  const segData = useMemo(() => {
    let cumLen = 0
    return SEGMENTS.map(seg => {
      const rawLen  = total > 0 ? (counts[seg.key] / total) * C : 0
      const offset  = cumLen
      if (rawLen > SEG_GAP) cumLen += rawLen + SEG_GAP
      return { ...seg, rawLen, offset }
    }).filter(s => s.rawLen > SEG_GAP)
  }, [counts, total])

  // Center text
  const centerBig = isEmpty ? '—' : `${topPct}%`
  const centerSub = isEmpty ? 'no students yet' : 'got top choice'
  const centerColor = isEmpty
    ? 'var(--text-muted, #98A2B3)'
    : 'var(--color-status-success, #2D4A2B)'

  const cohortName = cohort?.name || 'Cohort'

  return (
    <section
      style={{
        background:    'var(--bg-card, #fff)',
        border:        '1px solid var(--border-card, rgba(29,37,103,0.08))',
        borderRadius:  14,
        boxShadow:     'var(--shadow-card)',
        overflow:      'hidden',
        fontFamily:    'DM Sans, sans-serif',
        height:        '100%',
        boxSizing:     'border-box',
      }}
    >
      {/* Eyebrow */}
      <div style={{
        padding: '14px 22px 12px',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        borderBottom: '1px solid var(--border-card, rgba(29,37,103,0.04))',
      }}>
        <div>
          <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-caption, #475467)', fontWeight: 600 }}>
            Preference Match
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted, #98A2B3)', marginTop: 2 }}>
            How well students got their top choices
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted, #98A2B3)', whiteSpace: 'nowrap' }}>
          {cohortName} · matching snapshot
        </div>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 16px 14px' }}>

        {/* SVG ring */}
        <svg
          width="100%"
          viewBox="0 0 220 220"
          style={{ maxWidth: 200, display: 'block' }}
          aria-label={`Preference match: ${counts.top} top choice, ${counts.second} second choice, ${counts.other} other match, ${counts.unmatched} unmatched out of ${total} students`}
          role="img"
        >
          {/* Baseline ring */}
          <circle
            cx={CX} cy={CY} r={MID_R}
            fill="none"
            stroke="var(--gauge-segment-base, #EDEDEB)"
            strokeWidth={WIDTH}
            strokeOpacity={isEmpty ? 1 : 0.3}
          />

          {/* Animated colored segments */}
          {!isEmpty && segData.map(seg => {
            const progress = segProg(seg.key)
            const animLen  = seg.rawLen * progress
            if (animLen < 0.5) return null
            const dimmed = hoveredKey && hoveredKey !== seg.key
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
                  opacity: dimmed ? 0.45 : 1,
                  transition: 'opacity 0.15s ease',
                  cursor: 'pointer',
                }}
                onMouseEnter={() => setHoveredKey(seg.key)}
                onMouseLeave={() => setHoveredKey(null)}
              />
            )
          })}

          {/* Center number */}
          <text
            x={CX} y={CY - 6}
            textAnchor="middle"
            fontFamily="DM Sans, sans-serif"
            fontSize="28"
            fontWeight="600"
            fill={centerColor}
          >
            {centerBig}
          </text>
          {/* Center subtitle */}
          <text
            x={CX} y={CY + 12}
            textAnchor="middle"
            fontFamily="DM Sans, sans-serif"
            fontSize="10"
            fontWeight="500"
            fill="var(--text-caption, #6b7280)"
          >
            {centerSub}
          </text>
        </svg>

        {/* Inline tooltip (shows below ring when a segment is hovered) */}
        {hoveredKey && (
          <div style={{
            fontSize: 11.5,
            color: 'var(--text-body, #191919)',
            background: 'var(--bg-card-elevated, #fff)',
            border: '1px solid var(--border-divider, rgba(29,37,103,0.10))',
            borderRadius: 6,
            padding: '3px 10px',
            marginTop: -4,
            marginBottom: 4,
            boxShadow: 'var(--shadow-card)',
            fontFamily: 'DM Sans, sans-serif',
          }}>
            {SEGMENTS.find(s => s.key === hoveredKey)?.label}:{' '}
            {counts[hoveredKey]} student{counts[hoveredKey] !== 1 ? 's' : ''}
            {total > 0 ? ` (${Math.round((counts[hoveredKey] / total) * 100)}%)` : ''}
          </div>
        )}

        {/* Legend row */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: hoveredKey ? 0 : 4 }}>
          {SEGMENTS.map(seg => {
            const isHov = hoveredKey === seg.key
            return (
              <button
                key={seg.key}
                tabIndex={0}
                onMouseEnter={() => setHoveredKey(seg.key)}
                onMouseLeave={() => setHoveredKey(null)}
                onFocus={() => setHoveredKey(seg.key)}
                onBlur={() => setHoveredKey(null)}
                aria-label={`${seg.label}: ${counts[seg.key]} students`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: 10.5, color: 'var(--text-caption, #6b7280)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '2px 4px', borderRadius: 4,
                  opacity: hoveredKey && !isHov ? 0.45 : 1,
                  transition: 'opacity 0.15s',
                  fontFamily: 'DM Sans, sans-serif',
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: seg.solidColor, display: 'inline-block', flexShrink: 0 }} />
                {seg.label} · {counts[seg.key]}
              </button>
            )
          })}
        </div>

      </div>
    </section>
  )
}

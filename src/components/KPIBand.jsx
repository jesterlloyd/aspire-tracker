// Shared KPI band primitives — used by Aggregate (Program at a Glance),
// Embed (Matching at a Glance), and Interview Room filter cards.
// Tokens: src/lib/designTokens.js
import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { colors, type as t, styles } from '../lib/designTokens'

export function useUpdatedLabel(cohortId) {
  const queryClient = useQueryClient()
  const [label, setLabel] = useState('just now')
  useEffect(() => {
    function compute() {
      const all = queryClient.getQueryCache().getAll()
      const relevant = all.filter(q =>
        Array.isArray(q.queryKey) &&
        q.queryKey.some(k => k === cohortId) &&
        q.state.status === 'success' &&
        q.state.dataUpdatedAt
      )
      const ts = relevant.length ? Math.max(...relevant.map(q => q.state.dataUpdatedAt)) : 0
      if (!ts) return setLabel('—')
      const s = Math.floor((Date.now() - ts) / 1000)
      if (s < 10) setLabel('just now')
      else if (s < 60) setLabel(`${s}s ago`)
      else if (s < 3600) setLabel(`${Math.floor(s / 60)}m ago`)
      else setLabel(`${Math.floor(s / 3600)}h ago`)
    }
    compute()
    const id = setInterval(compute, 5000)
    return () => clearInterval(id)
  }, [cohortId, queryClient])
  return label
}

export function KPICell({ value, label, sub, accent }) {
  const valueColor =
    accent === 'sage'    ? colors.sage :
    accent === 'warning' ? colors.dawn :
                           colors.ink2
  return (
    <div style={{ background: colors.surface, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ ...styles.bigNumber, color: valueColor }}>
        {value ?? 0}
      </div>
      <div style={{ ...styles.eyebrow, marginTop: 8 }}>
        {label}
      </div>
      {sub && <div style={{ fontSize: t.sizes.small, color: colors.ink4, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ── Clickable filter card — Interview Room (Chroma active state) ───────────────
// For Student Profiles, enhance existing cards in-place to preserve semantic colors.

export function FilterKPICard({ value, label, sub, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background:   active ? colors.tintChroma : colors.surface,
        border:       active ? `2px solid ${colors.chroma}` : `1px solid ${colors.line1}`,
        borderRadius: radii.card,
        padding:      '14px 18px',
        textAlign:    'left',
        cursor:       'pointer',
        fontFamily:   t.family,
        boxShadow:    active ? shadows.s2 : shadows.s1,
        transition:   'transform 0.18s cubic-bezier(0.2, 0.7, 0.2, 1), box-shadow 0.18s ease, border-color 0.15s ease, background 0.15s ease',
        willChange:   'transform, box-shadow',
        display:      'flex', flexDirection: 'column', gap: 4,
        position:     'relative',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform  = 'translateY(-2px)'
        e.currentTarget.style.boxShadow  = active
          ? `${shadows.s3}, 0 0 0 4px rgba(147,0,69,0.08)`
          : `${shadows.s3}, 0 0 0 4px rgba(29,37,103,0.06)`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform  = 'translateY(0)'
        e.currentTarget.style.boxShadow  = active ? shadows.s2 : shadows.s1
      }}
      onMouseDown={e => { e.currentTarget.style.transform = 'translateY(0)' }}
      onMouseUp={e => { e.currentTarget.style.transform = 'translateY(-2px)' }}
    >
      <div style={{ ...styles.bigNumber, color: active ? colors.chroma : colors.ink1 }}>
        {value ?? 0}
      </div>
      <div style={{ ...styles.eyebrow, marginTop: 8 }}>{label}</div>
      {sub && <div style={{ fontSize: t.sizes.small, color: colors.ink4, marginTop: 2 }}>{sub}</div>}
      {active && (
        <span style={{ position:'absolute', top:6, right:8, fontSize:9, color:colors.chroma, fontWeight:700, fontFamily:t.family, lineHeight:1 }}>✕</span>
      )}
    </button>
  )
}

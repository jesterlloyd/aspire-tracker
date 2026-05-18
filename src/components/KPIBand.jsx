// Shared KPI band primitives — used by Aggregate (Program at a Glance)
// and Embed (Matching at a Glance) tabs.
import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

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
  const valueColor = accent === 'sage' ? '#2F7D5C' : accent === 'warning' ? '#C08A2A' : '#1D2567'
  return (
    <div style={{ background: '#fff', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{
        fontSize: 32, fontWeight: 700, lineHeight: 1,
        letterSpacing: '-0.03em', color: valueColor,
        fontVariantNumeric: 'tabular-nums', fontFamily: 'DM Sans, sans-serif',
      }}>
        {value ?? 0}
      </div>
      <div style={{
        fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.14em',
        color: '#475467', fontWeight: 600, marginTop: 8,
      }}>
        {label}
      </div>
      {sub && <div style={{ fontSize: 11, color: '#98A2B3', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

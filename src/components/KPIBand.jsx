// Shared KPI band primitives — used by Aggregate (Program at a Glance)
// and Embed (Matching at a Glance) tabs.
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

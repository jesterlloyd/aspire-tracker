// WS2.0: extracted verbatim from App.jsx (self-contained sync pill). No behavior change.
// Left in place per WS2 plan; removal is deferred to a later phase.
import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

export default function LastSyncedIndicator() {
  const queryClient = useQueryClient()
  const [label, setLabel] = useState('Synced just now')
  useEffect(() => {
    function compute() {
      const qs = queryClient.getQueryCache().getAll()
      const ok = qs.filter(q => q.state.status === 'success' && q.state.dataUpdatedAt)
      if (!ok.length) { setLabel('Not yet synced'); return }
      const newest = Math.max(...ok.map(q => q.state.dataUpdatedAt))
      const s = Math.floor((Date.now() - newest) / 1000)
      if (s < 10) setLabel('Synced just now')
      else if (s < 60) setLabel(`Synced ${s}s ago`)
      else if (s < 3600) setLabel(`Synced ${Math.floor(s/60)}m ago`)
      else setLabel(`Synced ${Math.floor(s/3600)}h ago`)
    }
    compute(); const id = setInterval(compute, 5000); return () => clearInterval(id)
  }, [queryClient])
  return (
    <span style={{ flexShrink:0, fontSize:11.5, color:'rgba(255,255,255,0.55)', fontFamily:'DM Sans, sans-serif', display:'flex', alignItems:'center', gap:5 }}>
      <span style={{ width:6, height:6, borderRadius:'50%', background:'#5DD39E', flexShrink:0, boxShadow:'0 0 0 3px rgba(93,211,158,0.18)' }} />
      {label}
    </span>
  )
}

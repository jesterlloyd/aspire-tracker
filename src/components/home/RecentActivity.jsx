// HOME-1 (2026-09-24): Recent activity, "finished without you". Hidden when empty.

import { Check, ListChecks, MessageSquare, Send, Mail, Clock } from 'lucide-react'
import HomeCard from './HomeCard'

const ICON = { check: Check, form: ListChecks, msg: MessageSquare, rel: Send, out: Mail, clock: Clock }

export default function RecentActivity({ rows = [], order, onNavigate }) {
  if (!rows.length) return null
  return (
    <HomeCard id="hm-activity" title="Recent Activity" cap="Finished without you" material="tape" order={order}>
      <ul className="hm-feed">
        {rows.map(r => {
          const I = ICON[r.icon] || Check
          return (
            <li key={r.id}>
              <span className={`hm-fi hm-fi-${r.tone}`} aria-hidden="true"><I size={13} /></span>
              <button type="button" className="hm-feed-body" onClick={() => r.to && onNavigate?.(r.to)} disabled={!r.to}>
                <span>{r.pre}<b>{r.actor}</b>{r.post}</span>
                {r.detail ? <span className="hm-feed-m">{r.detail}</span> : null}
              </button>
              <time className="hm-feed-time">{r.time}</time>
            </li>
          )
        })}
      </ul>
    </HomeCard>
  )
}

// src/components/actionCenter/KeithCheckinPanel.jsx
//
// KEITH-CHECKIN-1 (2026-09-29): Keith's two lines at the top of the Action Center drawer.
// Reference: 1 · Check-in sorting in docs/mockups/keith-workflow.html.
//
//   KeithDailyLine   "Keith closed [N] thank-you replies today." with Review. Shown only on a day
//                    Keith closed something; the list keeps each of the last 7 days, and each reply
//                    carries the Keith mark, its text and Reopen.
//   KeithModeStrip   while the skill is in SHADOW: one line (day, agreement) that opens the Shadow
//                    Mode card with the figure that matters most, "Replies Keith would close that
//                    you kept open", and, for the Owner, Turn on auto-close (held shut by the server
//                    until 14 days have passed and that figure is 0). While ON: one line and, for the
//                    Owner, Turn off auto-close.
import { useState } from 'react'
import KeithMark from '../keith/KeithMark'
import ShadowModeCard from '../keith/ShadowModeCard'
import { agreementPercent } from '../../lib/keith/provenanceModel'
import { SHADOW_DAYS } from '../../lib/keith/checkinSortModel'

const LABELS = { thank_you: 'Thank-you replies Keith would close', needs_a_look: 'Needs a look', request: 'Requests' }
const dayText = (day) => new Date(`${day}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

export function KeithDailyLine({ daily = [], busy, onReopen }) {
  const [open, setOpen] = useState(false)
  const today = daily.find(d => d.today)
  if (!today) return null
  const n = today.items.length
  return (
    <section className="ac2-daily" aria-label="Replies Keith closed">
      <div className="ac2-daily-head">
        <KeithMark provenanceId={today.items[0]?.provenanceId} />
        <b>Keith closed {n} thank-you {n === 1 ? 'reply' : 'replies'} today.</b>
        <button type="button" className="ac2-action" aria-expanded={open} onClick={() => setOpen(v => !v)}>{open ? 'Hide' : 'Review'}</button>
      </div>
      {open && daily.map(d => (
        <div key={d.day} className="ac2-daily-day">
          {!d.today && <p className="ac2-daily-date">{dayText(d.day)}</p>}
          {d.items.map(row => (
            <div key={row.key} className="ac2-daily-row">
              <KeithMark provenanceId={row.provenanceId} />
              <span><strong>{row.title}</strong><br /><q>{row.reply}</q></span>
              <button type="button" className="ac2-action" disabled={busy === `${row.key}:reopen`} onClick={() => onReopen(row)}>
                {busy === `${row.key}:reopen` ? 'Working…' : 'Reopen'}
              </button>
            </div>
          ))}
        </div>
      ))}
    </section>
  )
}

export function KeithModeStrip({ keith, isOwner, busy, onSetMode }) {
  const [open, setOpen] = useState(false)
  if (!keith || keith.mode === 'off') return null
  const card = keith.card || {}
  const gate = card.gate || {}
  if (keith.mode === 'on') {
    return (
      <div className="ac2-keith-strip">
        <span>Auto-close is on. Keith closes plain thank-you replies; replies with a safety term are never closed.</span>
        {isOwner && <button type="button" className="ac2-action" disabled={busy === 'keith:mode'} onClick={() => onSetMode('shadow')}>Turn off auto-close</button>}
      </div>
    )
  }
  const started = !!card.firstShadowAt
  const status = !started ? 'Starting' : gate.daysLeft > 0 ? `Day ${gate.day} of ${SHADOW_DAYS}` : 'Shadow period complete'
  return (
    <div className="ac2-keith-shadow">
      <button type="button" className="ac2-keith-strip ac2-keith-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <span>Keith is sorting in shadow mode · {status} · {agreementPercent(card.agreement)} agreement</span>
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <ShadowModeCard
          agreement={card.agreement}
          status={status}
          labels={LABELS}
          lines={[['Replies Keith would close that you kept open', card.keptOpen ?? 0, true]]}
          note={gate.ok ? 'Auto-close can be turned on. Urgent replies are never closed.' : (gate.message || `Auto-close unlocks after ${SHADOW_DAYS} days if nothing you kept open would have been closed.`)}
          actions={isOwner ? (
            <button type="button" className="ac2-action primary" disabled={!gate.ok || busy === 'keith:mode'} title={gate.ok ? undefined : gate.message} onClick={() => onSetMode('on')}>
              {busy === 'keith:mode' ? 'Working…' : 'Turn on auto-close'}
            </button>
          ) : null}
        />
      )}
    </div>
  )
}

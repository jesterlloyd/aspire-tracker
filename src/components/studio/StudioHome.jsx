// src/components/studio/StudioHome.jsx
//
// STUDIO-1: the Studio home. Starting layouts (each thumbnail is the real renderer's output, so a
// layout looks exactly like the email it starts), your drafts, and what went out recently.
// Phase 2 adds Keith's "What do you want to send?" above this; it is not drawn until it works.

import { useMemo } from 'react'
import { LAYOUTS } from '../../lib/studio/studioLayouts'
import { renderStudioEmail } from '../../lib/studio/renderEmail'
import { THEMES } from '../../lib/studio/studioBlocks'
import { confirmDialog } from '../shared/confirmDialog'
import { defaultStudioBrand } from './studioBrand.js'

const fmt = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

function LayoutThumb({ layout }) {
  const html = useMemo(() => {
    const d = layout.build()
    return renderStudioEmail(d, { brand: defaultStudioBrand(), mergePreview: true, signature: { displayName: 'Your name', title: 'Your title' } }).html
  }, [layout])
  return <div className="st-thumb" aria-hidden="true"><iframe title="" srcDoc={html} tabIndex={-1} sandbox="" /></div>
}

export default function StudioHome({ mode, designs, loadError, copyOffer, onCopyLocal, onOpen, onNew, onDuplicate, onArchive }) {
  const drafts = (designs || []).filter(d => d.status !== 'sent')
  const sent = (designs || []).filter(d => d.status === 'sent')

  return (
    <>
      {mode === 'local' && (
        <div className="st-notice" role="status" style={{ marginBottom: 'var(--aspire-gap-card)' }}>
          Studio storage is not switched on yet, so designs are saved in this browser only. Everything else works,
          including sending. Once it is switched on, you will be offered a copy of these designs for the team.
        </div>
      )}
      {mode === 'server' && copyOffer > 0 && (
        <div className="st-notice st-notice-info st-row-between" role="status" style={{ marginBottom: 'var(--aspire-gap-card)' }}>
          <span>{plural(copyOffer, 'design')} from before Studio storage was switched on {copyOffer === 1 ? 'is' : 'are'} still in this browser.</span>
          <button type="button" className="st-btn st-btn-sm" onClick={onCopyLocal}>Copy to Studio</button>
        </div>
      )}

      <div className="st-grid">
        <section className="st-card" aria-labelledby="st-layouts-h">
          <div className="st-row-between">
            <div>
              <h2 id="st-layouts-h" className="st-h">Start From a Layout</h2>
              <p className="st-sub">Each layout is a draft you can restyle block by block. Themes: {Object.values(THEMES).map(t => t.label).join(', ')}.</p>
            </div>
            <button type="button" className="st-btn st-btn-sm" onClick={() => onNew('blank')}>+ Blank design</button>
          </div>
          <div className="st-layouts">
            {LAYOUTS.map(l => (
              <button key={l.key} type="button" className="st-layout" onClick={() => onNew(l.key)} aria-label={`Start a ${l.label} design`}>
                <LayoutThumb layout={l} />
                <div className="st-layout-cap"><b>{l.label}</b><span>{l.hint}</span></div>
              </button>
            ))}
          </div>
        </section>

        <aside className="st-card" aria-labelledby="st-drafts-h">
          <h2 id="st-drafts-h" className="st-h">Your Drafts</h2>
          {loadError && <p className="st-notice st-notice-bad" style={{ marginTop: 10 }}>{loadError}</p>}
          <div style={{ marginTop: 6 }}>
            {designs === null && <p className="st-empty">Loading…</p>}
            {designs !== null && drafts.length === 0 && <p className="st-empty">No drafts yet. Pick a layout to start one.</p>}
            {drafts.map(d => (
              <DesignRow key={d.id} d={d} onOpen={onOpen} onDuplicate={onDuplicate} onArchive={onArchive}
                line={`Edited ${fmt(d.updated_at)}${d.subject ? ` · ${d.subject}` : ''}`} chip="Draft" />
            ))}
          </div>
          <h2 className="st-h" style={{ marginTop: 18 }}>Recently Sent</h2>
          <div style={{ marginTop: 6 }}>
            {designs !== null && sent.length === 0 && <p className="st-empty">Nothing sent from Studio yet.</p>}
            {sent.map(d => {
              const last = d.sends?.[0]
              return (
                <DesignRow key={d.id} d={d} onOpen={onOpen} onDuplicate={onDuplicate} onArchive={onArchive}
                  line={`${fmt(d.last_sent_at)}${last ? ` · ${plural(last.sent, 'sent')}${last.failed ? ` · ${last.failed} failed` : ''}` : ''}`} chip="Sent" />
              )
            })}
          </div>
        </aside>
      </div>
    </>
  )
}

function DesignRow({ d, line, chip, onOpen, onDuplicate, onArchive }) {
  return (
    <div className="st-list-row">
      <button type="button" className="st-link" onClick={() => onOpen(d.id)}>
        <b>{d.name}</b>
        <small>{line}</small>
      </button>
      <div className="st-row">
        <span className={`st-chip ${chip === 'Sent' ? 'st-chip-sent' : 'st-chip-draft'}`}>{chip}</span>
        <button type="button" className="st-btn st-btn-sm st-btn-ghost" onClick={() => onDuplicate(d.id)} aria-label={`Duplicate ${d.name}`}>Duplicate</button>
        <button type="button" className="st-btn st-btn-sm st-btn-ghost st-btn-danger"
          onClick={async () => { if (await confirmDialog(`Archive "${d.name}"? It leaves your list. Anything already sent stays in Sent History.`, { confirmLabel: 'Archive design', danger: true })) onArchive(d.id) }}
          aria-label={`Archive ${d.name}`}>Archive</button>
      </div>
    </div>
  )
}

// INSIGHTS-KEITH-READ-1 (Owner, 2026-11-07): Keith's Read, a card on the staff ASPIRE Insights page.
//
// Keith reads the figures for the filters that are on and says what stands out. It runs only when
// someone presses Read these figures (Owner and Admin, the Skill's roles); everyone who can open the
// page (Owner, Admin, Co-Lead) sees the latest saved read. The server recomputes the figures from
// the filters and says whether the saved read still matches them (`current`); this card computes
// nothing. A finding may name the card that shows it, and "See" scrolls there.
//
// Staff app only: never on the leadership surface or in a portal (KeithMark is internal).

import { useCallback, useEffect, useState } from 'react'
import KeithMark from '../keith/KeithMark'
import { keithInsights } from '../../lib/insights/insightsClient'

const CARD_NAMES = Object.freeze({
  tiles: 'headline figures', pipeline: 'Pipeline', match: 'Placement Match', school: 'by School', trend: 'Cohort Trends',
  pathway: 'Internal vs. External', hosted: 'Students Hosted', yield: 'Unit Yield', heatmap: 'Schools and Units',
  caseyfink: 'Casey-Fink', hours: 'Clinical Hours',
})

const when = iso => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function seeCard(card) {
  const el = document.getElementById(`ins-${card}`)
  if (!el) return
  el.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  el.classList.add('ins-flash')
  window.setTimeout(() => el.classList.remove('ins-flash'), 1600)
}

function ReadBody({ read }) {
  const r = read.read || {}
  return (
    <>
      <p className="ins-kr-headline">{r.headline}</p>
      <ol className="ins-kr-findings">
        {(r.findings || []).map((f, i) => (
          <li key={i}>
            <b>{f.title}</b>
            <span>{f.text}</span>
            {f.card && CARD_NAMES[f.card] && (
              <button type="button" className="ins-kr-see" onClick={() => seeCard(f.card)}>See {CARD_NAMES[f.card]}</button>
            )}
          </li>
        ))}
      </ol>
      {(r.watch?.length > 0 || r.caveats?.length > 0) && (
        <div className="ins-kr-notes">
          {r.watch?.length > 0 && (
            <div><h3>Worth checking next</h3><ul>{r.watch.map((w, i) => <li key={i}>{w}</li>)}</ul></div>
          )}
          {r.caveats?.length > 0 && (
            <div><h3>What these figures cannot say</h3><ul>{r.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
          )}
        </div>
      )}
    </>
  )
}

/**
 * @param {object} props
 * @param {object} props.filters  the page's filters (filtersFromSearch)
 * @param {string} props.search   the page's query string, so a filter change reloads the read
 */
export default function KeithRead({ filters, search }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: '' })
  const [running, setRunning] = useState(false)

  useEffect(() => {
    let alive = true
    setState(s => ({ ...s, status: 'loading', error: '' }))
    keithInsights('latest', filters)
      .then(data => { if (alive) setState({ status: 'ready', data, error: '' }) })
      .catch(() => { if (alive) setState({ status: 'error', data: null, error: '' }) })
    return () => { alive = false }
    // `search` is the filters' identity; the object is rebuilt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const runRead = useCallback(async () => {
    setRunning(true)
    try {
      const data = await keithInsights('run', filters)
      setState({ status: 'ready', data, error: '' })
    } catch (e) {
      setState(s => ({ ...s, error: e.message || 'Keith could not read the figures just now. Try again.' }))
    } finally {
      setRunning(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const d = state.data
  if (state.status === 'error') return null
  if (d && !d.enabled && !d.read && !d.other) {
    return (
      <section className="ins-sheet ins-card ins-kr" aria-labelledby="ins-h-keith">
        <div className="ins-ch"><div className="ins-ct">
          <h2 id="ins-h-keith">Keith's Read</h2>
          <p className="ins-sub">Keith's Read is not set up yet.</p>
        </div></div>
      </section>
    )
  }

  const read = d?.read || null
  const other = !read ? d?.other || null : null
  const shown = read || other
  const canRun = Boolean(d?.canRun)

  return (
    <section className="ins-sheet ins-card ins-kr" aria-labelledby="ins-h-keith" aria-busy={state.status === 'loading' || running}>
      <div className="ins-ch">
        <div className="ins-ct">
          <h2 id="ins-h-keith">
            Keith's Read
            {shown?.provenanceId && <span className="ins-kr-mark"><KeithMark provenanceId={shown.provenanceId} /></span>}
          </h2>
          <p className="ins-sub">
            {state.status === 'loading' && !d ? 'Loading Keith\'s latest read.'
              : read ? `${read.scope}. Read ${when(read.createdAt)}${read.byName ? `, asked by ${read.byName}` : ''}.`
                : other ? `These filters have not been read. The latest read is for ${other.scope}, ${when(other.createdAt)}.`
                  : canRun ? 'Keith reads the figures on this page and says what stands out. He never changes a number.'
                    : 'Keith has not read these figures yet. The Owner or an Admin can ask him to.'}
          </p>
        </div>
        {canRun && (
          <div className="ins-acts">
            <button type="button" className="ins-act" onClick={runRead} disabled={running || state.status === 'loading'}>
              {running ? 'Reading…' : read ? 'Read again' : 'Read these figures'}
            </button>
          </div>
        )}
      </div>
      {running && <p className="ins-kr-status" role="status">Keith is reading the figures. This usually takes under a minute.</p>}
      {state.error && <p className="ins-warn" role="alert">{state.error}</p>}
      {read && read.current === false && (
        <p className="ins-kr-stale" role="note">Out of date: the figures have changed since this read.</p>
      )}
      {shown && <ReadBody read={shown} />}
      {shown && <p className="ins-kr-foot">Keith reads the figures the page shows and quotes them; he does not compute new ones. A difference between groups is not a cause.</p>}
    </section>
  )
}

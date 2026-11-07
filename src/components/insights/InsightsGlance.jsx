// ASPIRE-INSIGHTS-1, Phase 2b: the outcomes section on a portal's At a Glance page.
//
// Academic Partner, Unit Leader and Residency portals get this one section below what their page
// already shows; nothing above it changes. It is the full page's own card, tile and chart
// components (InsightsCard, insightsCards) over /api/insights with the portal's surface, so a
// figure here is the figure on the full page for the same filter. The server decides the lock
// from the caller's grant (a partner's schools, a leader's units, program level for Residency);
// this component asks for a cohort and, for a leader narrowed in the header, one unit.
//
// No cross-filtering, no chips, no Compare, no Keith summary. The measure is Hired into NGRP.

import { Fragment, useEffect, useState } from 'react'
import { useTheme } from '../../contexts/ThemeContext'
import { fetchInsights } from '../../lib/insights/insightsClient'
import { fmtRate, asOfWords } from '../../lib/insights/insightsView'
import { ChartCard, Tile } from './InsightsCard'
import {
  pipelineCard, trendCard, hoursCard, youColor,
  partnerVsProgramCard, whereRotatedCard, unitHostedCard, unitHiredBackCard, feedersCard, unitChoiceCard,
} from './insightsCards'
import './insights.css'

const hiredTile = t => (
  <Tile hero accent="chroma" k="Hired into NGRP" v={fmtRate(t.hired)}
    d={t.hired.suppressed ? `${t.hired.n} completed in finished cohorts` : `${t.hired.count} of ${t.hired.n} completed`} />
)
const placedTile = t => <Tile accent="marina" k="Placed" v={t.placed.count} d="Matched to a unit" />
const completedTile = t => <Tile accent="sage" k="Completed" v={t.completed.count} d="Finished the rotation" />
const rotationTile = t => (
  <Tile accent="dawn" k="In rotation now" v={t.inRotation.count} d={t.inRotation.count ? 'Not counted in the hire rate' : 'No cohort in rotation'} />
)

/** What each portal's section shows, in the build prompt's order (section 6). */
const SURFACES = {
  partner: {
    title: 'Your Students’ Outcomes',
    sub: ({ scopeName }) => `${scopeName ? `${scopeName} students` : 'Your students'} in ASPIRE, next to the program average.`,
    tiles: [placedTile, completedTile, hiredTile, rotationTile],
    cards: data => [
      ['pipeline', 'Pipeline', 'Your students, from application to NGRP hire.', 7, pipelineCard(data)],
      ['vs', 'Hired into NGRP: You vs. the Program', 'Completed students in finished cohorts.', 5, partnerVsProgramCard(data)],
      ['rotated', 'Where Your Students Rotated', 'Your placed students, by unit.', 6, whereRotatedCard(data)],
      ['trend', 'Your Cohort Trends', 'Your students, per finished cohort.', 6, trendCard(data)],
      ['hours', 'Clinical Hours', 'Approved hours as a share of each student’s requirement.', 12, hoursCard({ hoursBySchool: data.hoursBySchool }, youColor)],
    ],
  },
  unit: {
    title: 'ASPIRE Students on Your Unit',
    sub: ({ scopeName }) => `Students hosted on ${scopeName || 'your unit'}, and how many were hired back.`,
    tiles: [placedTile, completedTile, hiredTile, rotationTile],
    cards: data => [
      ['hosted', 'Students You Host', 'Placed students on your unit, next to the average unit.', 6, unitHostedCard(data)],
      ['hiredback', 'Hired Back onto Your Unit', 'Hired into NGRP on the unit where they rotated.', 6, unitHiredBackCard(data)],
      ['feeders', 'Schools Feeding Your Unit', 'Placed students on your unit, by school.', 6, feedersCard(data)],
      ['choice', 'Did Students Pick Your Unit?', 'How your students ranked your unit when they applied.', 6, unitChoiceCard(data)],
    ],
  },
  residency: {
    // RESIDENCY-INSIGHTS-TITLE-1 (Owner, 2026-11-07): the staff page's own name.
    title: 'ASPIRE Insights',
    sub: () => 'How ASPIRE students move into NGRP, program-wide.',
    tiles: [placedTile, hiredTile, rotationTile],
    cards: data => [
      ['trend', 'Cohort Trends', 'Applied, offered and hired rates per finished cohort.', 7, trendCard(data)],
      ['pipeline', 'Pipeline', 'From application to NGRP hire. Finished cohorts only.', 5, pipelineCard(data)],
    ],
  },
}

/**
 * @param {'partner'|'unit'|'residency'} surface
 * @param {string} [scopeName]  the school or unit named in the subtitle (the caller's own)
 * @param {string} [unit]       a Unit Leader narrowed to one of their units; the server checks it
 * @param {string} [school]     an Academic Partner's header school; the server checks it
 */
export default function InsightsGlance({ surface, scopeName = '', unit = '', school = '' }) {
  const cfg = SURFACES[surface]
  const { style } = useTheme()
  const classic = style !== 'modern'
  const [cohort, setCohort] = useState('')
  const [attempt, setAttempt] = useState(0)
  const requestKey = `${surface}|${cohort}|${unit}|${school}|${attempt}`
  const [state, setState] = useState({ key: null, data: null, error: null })

  useEffect(() => {
    let live = true
    fetchInsights(surface, cohort ? `?cohort=${encodeURIComponent(cohort)}` : '', { unit, school })
      .then(data => { if (live) setState({ key: requestKey, data, error: null }) })
      .catch(error => { if (live) setState(s => ({ key: requestKey, data: s.data, error })) })
    return () => { live = false }
  }, [surface, cohort, unit, school, requestKey])

  if (!cfg) return null
  const data = state.data
  const pending = state.key !== requestKey
  const id = `ins-glance-${surface}`

  let body
  if (!data && pending) {
    body = <div className="ins-sheet ins-state" role="status">Loading outcomes…</div>
  } else if (!data) {
    body = (
      <div className="ins-sheet ins-state" role="alert">
        Couldn{'’'}t load the outcomes.
        <button type="button" className="ins-act" onClick={() => setAttempt(a => a + 1)}>Retry</button>
      </div>
    )
  } else {
    const t = data.tiles
    body = (
      <>
        <div className={`ins-tiles ins-tiles-${cfg.tiles.length}`} aria-label="Headline figures" role="group">
          {cfg.tiles.map((tile, i) => <Fragment key={i}>{tile(t)}</Fragment>)}
        </div>
        <div className="ins-grid">
          {cfg.cards(data).map(([cid, title, sub, span, c]) => (
            <ChartCard key={cid} id={`${surface}-${cid}`} title={title} sub={sub} span={span} table={c.table} note={c.note} legend={c.legend} nat={c.nat}>
              {(w, h) => c.draw(w, h)}
            </ChartCard>
          ))}
        </div>
        {state.error && <p className="ins-warn" role="alert">Couldn{'’'}t refresh. These are the last figures loaded.</p>}
      </>
    )
  }

  return (
    <section className={`ins ins-glance${classic ? ' ins-classic' : ''}`} aria-labelledby={id} aria-busy={pending}>
      <header className="ins-glance-head">
        <div>
          <h2 id={id}>{cfg.title}</h2>
          <p>{cfg.sub({ scopeName })}</p>
        </div>
        <div className="ins-glance-tools">
          <div className="ins-f">
            <label htmlFor={`${id}-cohort`}>Cohort</label>
            <select id={`${id}-cohort`} value={cohort} onChange={e => setCohort(e.target.value)}>
              <option value="">All cohorts</option>
              {(data?.cohorts || []).map(c => <option key={c.id} value={c.id}>{c.name}{c.finished ? '' : ' (in rotation)'}</option>)}
            </select>
          </div>
          {data && <span className="ins-asof">{asOfWords(data.asOf)}</span>}
        </div>
      </header>
      {body}
    </section>
  )
}

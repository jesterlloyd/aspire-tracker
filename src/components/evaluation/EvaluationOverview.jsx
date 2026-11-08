// EVAL-OVERVIEW-1 (Owner, 2026-11-07): Evaluation > Overview. The four surveys, read the way
// ASPIRE Insights reads the pipeline, built from Insights' own parts: the filter bar's markup and
// More filters, and ChartCard
// (Table view, CSV, hover tips). Reference: docs/mockups/evaluation-overview.html.
//
// Program-wide: it loads every cohort's assignments (the same columns Responses reads, less every
// name), so the Cohort filter is its own and the app's scope picker does not narrow it. Every
// figure comes from src/lib/evaluation/evaluationOverviewModel.js, which scores nothing itself.
// A bar opens Responses on that survey (`onOpenResponses`). Keith's Read is Phase 2.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useTheme } from '../../contexts/ThemeContext'
import { ChartCard } from '../insights/InsightsCard'
import { HBar } from '../insights/InsightsCharts'
import { hbarHeight } from '../../lib/insights/chartGeometry'
import { fmtRate } from '../../lib/insights/insightsView'
import {
  annotate, filterOptions, buildOverview, chipsFor, likertBand,
  EMPTY_FILTERS, MORE_FILTER_KEYS, MIN_N,
} from '../../lib/evaluation/evaluationOverviewModel'
import { CASEY_FINK_SLUG } from '../../lib/evaluation/responsesPacketModel'
import { EVAL_CARD_NAMES } from '../../lib/evaluation/evaluationReadModel'
import { keithEvaluation } from '../../lib/insights/insightsClient'
import KeithRead from '../insights/KeithRead'
import '../insights/insights.css'
import './evaluationOverview.css'

const PAGE = 1000
const SURVEY_COLORS = {
  [CASEY_FINK_SLUG]: 'var(--ins-c1)', preceptor_progress: 'var(--ins-c3)',
  student_preceptor_eval: 'var(--ins-c7)', post_rotation_evaluation: 'var(--ins-c2)',
}

/** Every row of a select, a page at a time (PostgREST answers at most 1,000 rows a request). */
async function selectAll(build) {
  const out = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < PAGE) return out
  }
}

async function loadOverview() {
  const [assignments, units, cohorts] = await Promise.all([
    selectAll(() => supabase.from('evaluation_assignments').select(`
      id, cohort_id, timepoint, status, expires_at, revoked_at,
      students!inner ( id, school, matched_unit_id ),
      evaluation_instruments!inner ( slug ),
      evaluation_responses ( submitted_at, responses, score_s1_clinical_problem_solving, score_s1_learning_activities, score_s1_practice_readiness )
    `).order('id')),
    selectAll(() => supabase.from('units').select('id, unit_name').order('id')),
    selectAll(() => supabase.from('cohorts').select('id, name').order('id')),
  ])
  return { rows: annotate(assignments, units), cohorts }
}

const evoCardId = card => `ins-evo-${card}`
const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0)
const mean2 = v => (v == null ? '–' : v.toFixed(2))

function Select({ id, label, value, onChange, options }) {
  return (
    <div className="ins-f">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

/** Stacked shares on a survey's own bands: up, same, down (down amber and textured, never red).
 *  The neutral segment prints no figure: no ink reaches 4.5:1 on it; its tooltip and Table view do. */
function Bands({ rows, heads, onOpen }) {
  return (
    <div className="evo-bands">
      {rows.map(r => {
        const parts = [['up', r.up], ['same', r.same], ['down', r.down]]
        const words = parts.map(([k, v]) => `${heads[k]} ${pct(v, r.total)}% (${v})`).join(', ')
        return (
          <div className="evo-band-row" key={r.key}>
            <span className="evo-band-lab" title={r.label}>{r.label}</span>
            {r.total
              ? (
                <button type="button" className="evo-band-bar" data-tip={`${r.label}: ${words}, n = ${r.total}`}
                  aria-label={`${r.label}: ${words}. Open in Responses.`} onClick={onOpen}>
                  {parts.map(([k, v]) => v > 0 && (
                    <span key={k} className={`evo-seg evo-seg-${k}`} style={{ flexGrow: v }}>{k !== 'same' && pct(v, r.total) >= 12 ? `${pct(v, r.total)}%` : ''}</span>
                  ))}
                </button>
              )
              : <span className="evo-none">No answers</span>}
            <span className="evo-band-n">n = {r.total}</span>
          </div>
        )
      })}
    </div>
  )
}

/** Casey-Fink pre against post, one line per section, on the 1 to 4 scale. */
function Dumbbell({ sections, onOpen }) {
  const x = v => `${((v - 1) / 3) * 100}%`
  return (
    <div className="evo-db">
      {sections.map(s => (
        <div className="evo-db-row" key={s.key}>
          <span className="evo-band-lab" title={s.label}>{s.label}</span>
          <button type="button" className="evo-db-line" onClick={onOpen}
            data-tip={`${s.label}: pre ${mean2(s.preMean)}, post ${mean2(s.postMean)}. ${s.higher} higher, ${s.same} the same, ${s.lower} lower.`}
            aria-label={`${s.label}: pre ${mean2(s.preMean)}, post ${mean2(s.postMean)}. Open in Responses.`}>
            <span className="evo-db-axis" />
            {s.preMean != null && s.postMean != null && (
              <span className="evo-db-span" style={{ left: x(Math.min(s.preMean, s.postMean)), width: `${(Math.abs(s.postMean - s.preMean) / 3) * 100}%` }} />
            )}
            {s.preMean != null && <span className="evo-db-dot evo-db-pre" style={{ left: x(s.preMean) }} />}
            {s.postMean != null && <span className="evo-db-dot evo-db-post" style={{ left: x(s.postMean) }} />}
          </button>
          <span className="evo-db-chg">{s.delta == null ? '–' : `${s.delta >= 0 ? '+' : '−'}${Math.abs(s.delta).toFixed(2)}`}</span>
        </div>
      ))}
      <div className="evo-db-row evo-db-scale" aria-hidden="true">
        <span />
        <span className="evo-db-ticks"><i>1</i><i>2</i><i>3</i><i>4</i></span>
        <span />
      </div>
    </div>
  )
}

/** Domain means per unit. The number is always printed; the shade only repeats the ASPIRE rule. */
function UnitGrid({ domains, units, onOpen }) {
  // A withheld unit gets no row of its own: a wall of "Too few" hides the units that can be read.
  const shown = units.filter(u => !u.suppressed)
  const withheld = units.length - shown.length
  return (
    <div className="evo-grid-wrap">
      {shown.length === 0 && (
        <p className="evo-none">
          No unit has {MIN_N} completed responses yet, so none is shown. {units.length} {units.length === 1 ? 'unit has' : 'units have'} at least one.
        </p>
      )}
      {shown.length > 0 && (
      <>
      <table className="evo-grid">
        <thead>
          <tr><th className="aspire-th">Unit</th><th className="aspire-th aspire-th-right">n</th>{domains.map(d => <th key={d.key} className="aspire-th aspire-th-center">{d.label}</th>)}</tr>
        </thead>
        <tbody>
          {shown.map(u => (
            <tr key={u.key}>
              <td className="evo-grid-unit">{u.name}</td>
              <td className="evo-grid-n">{u.n}</td>
              {domains.map(d => {
                  const v = u.means[d.key]
                  return (
                    <td key={d.key} className={`evo-cell evo-cell-${likertBand(v) || 'none'}`}>
                      <button type="button" onClick={onOpen} data-tip={`${u.name}, ${d.label}: ${mean2(v)} (n = ${u.n})`}
                        aria-label={`${u.name}, ${d.label}: ${mean2(v)}. Open in Responses.`}>{v == null ? '–' : v.toFixed(1)}</button>
                    </td>
                  )
                })}
            </tr>
          ))}
        </tbody>
      </table>
      {withheld > 0 && <p className="evo-grid-few">{withheld} more {withheld === 1 ? 'unit has' : 'units have'} fewer than {MIN_N} responses and {withheld === 1 ? 'is' : 'are'} withheld.</p>}
      </>
      )}
    </div>
  )
}

export default function EvaluationOverview({ onOpenResponses, responsesCohort = '' }) {
  const { style } = useTheme()
  const classic = style !== 'modern'
  const [state, setState] = useState({ status: 'loading', rows: [], cohorts: [], error: null })
  const [attempt, setAttempt] = useState(0)
  const [f, setF] = useState(EMPTY_FILTERS)
  const folded = MORE_FILTER_KEYS.filter(k => f[k]).length
  const [more, setMore] = useState(false)
  const showMore = more || folded > 0

  useEffect(() => {
    let live = true
    loadOverview()
      .then(d => { if (live) setState({ status: 'ready', rows: d.rows, cohorts: d.cohorts, error: null }) })
      .catch(error => { if (live) setState(s => ({ ...s, status: 'error', error })) })
    return () => { live = false }
  }, [attempt])

  const options = useMemo(() => filterOptions(state.rows, state.cohorts), [state.rows, state.cohorts])
  const o = useMemo(() => buildOverview(state.rows, f), [state.rows, f])
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }))
  const readKey = JSON.stringify(f)
  const chips = chipsFor(f, options).filter(c => c.key !== 'status')
  const open = useCallback(slug => () => onOpenResponses?.(slug), [onOpenResponses])
  // Responses shows the cohort chosen in the header, not this page's Cohort filter, so say which.
  const jumpWord = responsesCohort ? `Open in Responses for ${responsesCohort}` : 'Open in Responses'

  if (state.status === 'loading') return <div className="ins evo"><div className="ins-sheet ins-state" role="status">Loading the surveys…</div></div>
  if (state.status === 'error' && !state.rows.length) {
    return (
      <div className="ins evo">
        <div className="ins-sheet ins-state" role="alert">
          Couldn't load the surveys.
          <button type="button" className="ins-act" onClick={() => { setState(s => ({ ...s, status: 'loading' })); setAttempt(a => a + 1) }}>Retry</button>
        </div>
      </div>
    )
  }

  const t = o.tiles
  // EVAL-OVERVIEW-2 (Owner): no KPI cards. The figures are one line under the filters, and what the
  // two rate cards measure is chosen on the Response Rate card itself.
  const MEASURES = [['', 'Completed'], ['awaiting', 'Awaiting'], ['closed', 'Expired']]
  const measureOn = key => (key === '' ? !f.status || f.status === 'completed' : f.status === key)
  const measureActs = (
    <span className="evo-measure" role="group" aria-label="What the rate shows">
      {MEASURES.map(([key, label]) => (
        <button key={label} type="button" className="ins-act" aria-pressed={measureOn(key)}
          onClick={() => setF(prev => ({ ...prev, status: key }))}>{label}</button>
      ))}
    </span>
  )
  const measureWord = o.measure.measureWord
  const rateItems = (list, colorOf) => list.map(r => ({
    id: r.id, label: r.label, value: r.rate ?? 0, display: fmtRate(r), n: r.n, suppressed: r.suppressed,
    color: colorOf?.(r), tip: r.suppressed ? `${r.label}: too few to rate (n = ${r.n})` : `${r.label}: ${r.count} of ${r.n} ${measureWord}`,
    pickValue: r.slug || null,
  }))
  const surveyItems = rateItems(o.bySurvey, r => SURVEY_COLORS[r.slug])
  const schoolItems = rateItems(o.bySchool)
  const rateTable = list => ({
    columns: [{ key: 'label', label: 'Group' }, { key: 'count', label: 'Count' }, { key: 'n', label: 'Sent' }, { key: 'rate', label: 'Rate' }],
    rows: list.map(r => ({ id: r.id, label: r.label, count: r.count, n: r.n, rate: fmtRate(r), rate__sort: r.rate ?? -1 })),
  })
  const bandTable = (list, heads) => ({
    columns: [{ key: 'label', label: 'Item' }, { key: 'up', label: heads.up }, { key: 'same', label: heads.same }, { key: 'down', label: heads.down }, { key: 'total', label: 'Responses' }],
    rows: list.map(r => ({ id: r.key, label: r.label, up: r.up, same: r.same, down: r.down, total: r.total })),
  })
  const legendFor = heads => [[heads.up, 'var(--up)'], [heads.same, 'var(--same)'], [heads.down, 'var(--down)']]
  const r = o.readiness
  const p = o.preceptor
  const a = o.aspire

  return (
    <div className={`ins evo${classic ? ' ins-classic' : ''}`} aria-busy={state.status === 'refreshing'}>
      <div className={classic ? 'ins-binder' : undefined}>
        <section className="ins-sheet ins-filters" aria-label="Filters">
          <Select id="evo-cohort" label="Cohort" value={f.cohort} onChange={v => set('cohort', v)}
            options={[{ value: '', label: 'All cohorts' }, ...options.cohorts.map(c => ({ value: c.id, label: c.name }))]} />
          <Select id="evo-school" label="School" value={f.school} onChange={v => set('school', v)}
            options={[{ value: '', label: 'All schools' }, ...options.schools.map(s => ({ value: s, label: s }))]} />
          <Select id="evo-unit" label="Unit" value={f.unit} onChange={v => set('unit', v)}
            options={[{ value: '', label: 'All units' }, ...options.units.map(u => ({ value: u.key, label: u.name }))]} />
          <button type="button" className="ins-act ins-more-btn" aria-expanded={showMore} aria-controls="evo-more"
            disabled={folded > 0} onClick={() => setMore(m => !m)}>
            {showMore ? 'Fewer filters' : 'More filters'}{folded ? ` (${folded})` : ''}
          </button>
          {showMore && (
            <div className="ins-more" id="evo-more">
              <Select id="evo-survey" label="Survey" value={f.survey} onChange={v => set('survey', v)}
                options={[{ value: '', label: 'All four surveys' }, ...options.surveys]} />
              <Select id="evo-tp" label="Timepoint" value={f.timepoint} onChange={v => set('timepoint', v)}
                options={[{ value: '', label: 'Every timepoint' }, ...options.timepoints]} />
            </div>
          )}
        </section>
        <p className="evo-figs" role="status">
          <b>{t.sent}</b> surveys sent {'·'} <b>{t.completed}</b> completed{t.responseRate.suppressed ? '' : ` (${fmtRate(t.responseRate)})`} {'·'}{' '}
          <b>{t.awaiting}</b> awaiting an answer {'·'} <b>{t.closed}</b> expired or revoked{t.reissuable ? `, ${t.reissuable} can be sent again` : ''} {'·'}{' '}
          <b>{t.pairs}</b> matched Casey-Fink {t.pairs === 1 ? 'pair' : 'pairs'}
        </p>
        {(chips.length > 0 || state.status === 'error') && (
        <div className="ins-chips" aria-live="polite">
          {chips.map(c => (
            <span key={c.key} className="ins-chip">
              {c.label}
              <button type="button" aria-label={`Remove filter ${c.label}`} onClick={() => set(c.key, '')}>×</button>
            </span>
          ))}
          {chips.length > 1 && <button type="button" className="ins-clear" onClick={() => setF(EMPTY_FILTERS)}>Clear all</button>}
          {state.status === 'error' && <span className="ins-warn" role="alert">Couldn't refresh. These are the last figures loaded.</span>}
        </div>
        )}

        {/* EVAL-KEITH-READ-1: Keith reads these figures when asked; the server recomputes them from f. */}
        <KeithRead filters={f} search={readKey} request={keithEvaluation} cardNames={EVAL_CARD_NAMES} idOf={evoCardId} />

        {o.scoped === 0
          ? <div className="ins-sheet ins-state" role="status">No surveys match these filters.</div>
          : (
            <div className="ins-grid">
              <ChartCard id="evo-rate" span={6} title="Response Rate by Survey"
                sub={`Share of surveys sent that are ${measureWord}, each survey and timepoint`}
                table={rateTable(o.bySurvey)} nat={() => hbarHeight(surveyItems)}
                acts={measureActs}
                note={`Response Rate by School shows the same measure. A bar opens that survey in Responses${responsesCohort ? `, which shows ${responsesCohort}` : ''}.`}>
                {(w, h) => <HBar items={surveyItems} width={w} height={h} cap={100} onPick={slug => onOpenResponses?.(slug)} pickLabel={jumpWord} />}
              </ChartCard>

              <ChartCard id="evo-cf" span={6} title="Readiness Change, Casey-Fink"
                sub={`Section I means, pre and post, ${r.pairs} matched ${r.pairs === 1 ? 'pair' : 'pairs'}. 1 Strongly Disagree to 4 Strongly Agree`}
                table={{
                  columns: [{ key: 'label', label: 'Section' }, { key: 'pre', label: 'Pre' }, { key: 'post', label: 'Post' }, { key: 'delta', label: 'Change' }, { key: 'higher', label: 'Higher' }, { key: 'lower', label: 'Lower' }],
                  rows: r.suppressed ? [] : r.sections.map(s => ({ id: s.key, label: s.label, pre: mean2(s.preMean), post: mean2(s.postMean), delta: s.delta == null ? '–' : s.delta.toFixed(2), higher: s.higher, lower: s.lower })),
                }}
                legend={r.suppressed ? null : [['Pre-Rotation', 'var(--ins-other)'], ['Post-Rotation', 'var(--ins-c1)']]}
                note="Observed change in student-reported readiness. It does not measure competence, retention or savings. Item wording is licensed and not shown.">
                {() => (r.suppressed
                  ? <p className="evo-none">Too few matched pairs to show (under {MIN_N}).</p>
                  : <Dumbbell sections={r.sections} onOpen={open(CASEY_FINK_SLUG)} />)}
              </ChartCard>

              <ChartCard id="evo-prec" span={7} title="Preceptor Ratings by Competency"
                sub={p.timepoint ? `${p.timepointLabel}, ${p.responses} ${p.responses === 1 ? 'assessment' : 'assessments'}. Not Observed is left out.` : 'No completed assessments in view.'}
                table={bandTable(p.competencies, p.heads)} legend={p.suppressed ? null : legendFor(p.heads)}
                note="Read on the instrument's own scale: 4 and 5 meeting or exceeding, 3 developing, 2 needing close support. Choose Midpoint under More filters to see the midpoint.">
                {() => (p.suppressed
                  ? <p className="evo-none">{p.responses ? `Too few assessments to show (under ${MIN_N}).` : 'No completed assessments in view.'}</p>
                  : <Bands rows={p.competencies} heads={p.heads} onOpen={open('preceptor_progress')} />)}
              </ChartCard>

              <ChartCard id="evo-school" span={5} title="Response Rate by School"
                sub={`Share of each school's surveys that are ${measureWord}`}
                table={rateTable(o.bySchool)} nat={() => hbarHeight(schoolItems)}
                note={`A school with fewer than ${MIN_N} surveys is withheld, never shown as zero.`}>
                {(w, h) => <HBar items={schoolItems} width={w} height={h} cap={100} />}
              </ChartCard>

              <ChartCard id="evo-unit" span={12} title="Student's Feedback on Unit and Preceptor, by Unit"
                sub={`Domain means (1 to 5), each unit's completed responses. Units with fewer than ${MIN_N} are withheld.`}
                table={{
                  columns: [{ key: 'name', label: 'Unit' }, { key: 'n', label: 'Responses' }, ...o.units.domains.map(d => ({ key: d.key, label: d.label }))],
                  rows: o.units.units.map(u => ({ id: u.key, name: u.name, n: u.n, ...Object.fromEntries(o.units.domains.map(d => [d.key, u.suppressed ? 'Too few' : mean2(u.means[d.key])])) })),
                }}
                note="ASPIRE rule: a mean of 4.0 or above reads as agreed, 3.0 to 3.9 neutral, below 3.0 disagreed. Unit leaders see these only after Review & Release.">
                {() => (o.units.units.length
                  ? <UnitGrid domains={o.units.domains} units={o.units.units} onOpen={open('student_preceptor_eval')} />
                  : <p className="evo-none">No completed responses with a unit in view.</p>)}
              </ChartCard>

              <ChartCard id="evo-aspire" span={12} title="Student's Feedback on ASPIRE"
                sub={`${a.responses} ${a.responses === 1 ? 'response' : 'responses'}, each section's mean on the ASPIRE rule`}
                table={bandTable(a.sections, a.heads)} legend={a.suppressed ? null : legendFor(a.heads)}
                note="Program-level feedback. It gates no certificate.">
                {() => (a.suppressed
                  ? <p className="evo-none">{a.responses ? `Too few responses to show (under ${MIN_N}).` : 'No responses yet in view.'}</p>
                  : <Bands rows={a.sections} heads={a.heads} onOpen={open('post_rotation_evaluation')} />)}
              </ChartCard>
            </div>
          )}
      </div>
    </div>
  )
}

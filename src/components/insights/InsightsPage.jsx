// ASPIRE-INSIGHTS-1, Phase 2: ASPIRE Insights, one page of program outcomes.
// Reference: docs/mockups/aspire-insights.html. Staff app at /insights (Owner, Admin, Co-Lead,
// decided by the server's insights_view); the NE&L Portal's Data tab renders the same component
// with surface="leadership" and no back link.
//
// Nothing is computed here. Figures come from /api/insights (src/lib/insights/insightsModel.js);
// filters live in the URL under the API's own names (src/lib/insights/insightsView.js), so a
// filtered page is a link. Every chart has a Table view (the DataSheet, plain level) and a CSV,
// and a withheld rate reads "Too few to rate (n = 3)" everywhere, never a number.
//
// Style decides the drawing, never the data: Classic is a bound program report (a navy spine,
// gridded report sheets, small-caps titles); Modern is plain cards. One component tree.
//
// Colour (INSIGHTS-COLOR-1, Owner, 2026-11-06: "colorful and consistent across the board"): the
// tiles wear the app's KPI card accents; a school keeps one validated slot on every card
// (slotsFor); Internal and External are the first two slots; ranks read the blue ramp.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTheme } from '../../contexts/ThemeContext'
import WorkspaceBackLink from '../ui/WorkspaceBackLink'
import SegmentedPicker from '../shared/SegmentedPicker'
import { fetchInsights } from '../../lib/insights/insightsClient'
import {
  filtersFromSearch, searchFromFilters, withFilter, toggleFilter, chipsFor, clearFilters,
  moreFiltersSet, tileActive, pickTile,
  measureLabel, fmtRate, fmtChange, deltaWords, rateText, asOfWords,
  RESIDENCY_STATUS_LABELS, COMPARE_LABELS, PATHWAY_LABELS,
} from '../../lib/insights/insightsView'
import { HBar, Heat } from './InsightsCharts'
import { hbarHeight } from '../../lib/insights/chartGeometry'
import { ChartCard, Tile } from './InsightsCard'
import { slotsFor, PATHWAY_COLORS, CHOICE_COLORS, rateItem, pipelineCard, trendCard, hoursCard } from './insightsCards'
import { orderCohortsNewestFirst } from '../../lib/derivations/cohortOrder'
import KeithRead from './KeithRead'
import './insights.css'

const MEASURE_OPTIONS = [
  { value: 'applied', label: 'Applied' },
  { value: 'offered', label: 'Offered' },
  { value: 'hired', label: 'Hired' },
]
const PATHWAY_OPTIONS = Object.entries(PATHWAY_LABELS).map(([value, label]) => ({ value, label }))
// ── Pieces of the page ───────────────────────────────────────────────────────

function Select({ id, label, value, onChange, options, disabled }) {
  return (
    <div className="ins-f">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
      </select>
    </div>
  )
}

function FilterBar({ f, data, set }) {
  const cohorts = data?.cohorts || []
  const units = (data?.units || []).filter(u => !f.serviceLine || u.serviceLine === f.serviceLine)
  // INSIGHTS-LAYOUT-1 (Owner, 2026-11-07): the tiles are the first filter, so the bar keeps the three
  // questions asked most and folds the rest. It opens itself when a folded filter is on, so a
  // filter that narrows the page is never hidden.
  const folded = moreFiltersSet(f)
  const [more, setMore] = useState(folded > 0)
  const showMore = more || folded > 0
  return (
    <section className="ins-sheet ins-filters" aria-label="Filters">
      <Select id="ins-cohort" label="Cohort" value={f.cohort} onChange={v => set('cohort', v)}
        options={[{ value: '', label: 'All cohorts' }, ...orderCohortsNewestFirst(cohorts).map(c => ({ value: c.id, label: `${c.name}${c.finished ? '' : ' (in rotation)'}` }))]} />
      <Select id="ins-school" label="School" value={f.school} onChange={v => set('school', v)}
        options={[{ value: '', label: 'All schools' }, ...(data?.schools || []).map(s => ({ value: s, label: s }))]} />
      <Select id="ins-unit" label="Unit" value={f.unit} onChange={v => set('unit', v)}
        options={[{ value: '', label: 'All units' }, ...units.map(u => ({ value: u.key, label: u.name }))]} />
      <button type="button" className="ins-act ins-more-btn" aria-expanded={showMore} aria-controls="ins-more"
        disabled={folded > 0} onClick={() => setMore(m => !m)}>
        {showMore ? 'Fewer filters' : 'More filters'}{folded ? ` (${folded})` : ''}
      </button>
      {showMore && (
        <div className="ins-more" id="ins-more">
          <div className="ins-f">
            <span className="ins-flabel" id="ins-pathway-l">Pathway</span>
            <SegmentedPicker ariaLabel="Pathway" size="sm" value={f.pathway} onChange={v => set('pathway', v)} options={PATHWAY_OPTIONS} />
          </div>
          <Select id="ins-line" label="Service line" value={f.serviceLine} onChange={v => set('serviceLine', v)}
            options={[{ value: '', label: 'All service lines' }, ...(data?.serviceLines || []).map(s => ({ value: s, label: s }))]} />
          <Select id="ins-shift" label="Shift" value={f.shift} onChange={v => set('shift', v)}
            options={[{ value: '', label: 'Every shift' }, { value: 'Day', label: 'Day' }, { value: 'Night', label: 'Night' }, { value: 'Mid', label: 'Mid' }]} />
          <Select id="ins-status" label="Residency status" value={f.residencyStatus} onChange={v => set('residencyStatus', v)}
            options={Object.entries(RESIDENCY_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
          <span className="ins-fdiv" aria-hidden="true" />
          <div className="ins-f">
            <span className="ins-flabel">Residency measure</span>
            <SegmentedPicker ariaLabel="Residency measure" size="sm" value={f.measure} onChange={v => set('measure', v)} options={MEASURE_OPTIONS} />
          </div>
          <Select id="ins-compare" label="Compare" value={f.compare} onChange={v => set('compare', v)}
            options={Object.entries(COMPARE_LABELS).map(([value, label]) => ({ value, label, disabled: value === 'previous' && !f.cohort }))} />
        </div>
      )}
    </section>
  )
}

function Tiles({ data, f, pick }) {
  const t = data.tiles
  const cmp = data.compare
  const label = cmp?.label
  const m = t.measure
  const completedRate = t.completed.rate
  // INSIGHTS-KPI-FILTER-1 (Owner, 2026-11-07): each tile filters the cards below, one at a time.
  // Applicants is everyone; Retention is not connected yet, so it is a figure, not a filter.
  const on = tile => ({ active: tileActive(f, tile), onPick: () => pick(tile) })
  return (
    <section className="ins-tiles" id="ins-tiles" aria-label="Headline figures. Choose one to filter the page.">
      <Tile accent="nightfall" k="Applicants" v={t.applicants.na ? 'n/a' : t.applicants.count} {...on('all')}
        d={t.applicants.na ? 'Applicants have no unit yet' : (f.cohort ? '' : `${data.cohorts.filter(c => !c.partial).length} cohorts with a placement record`)} />
      <Tile accent="marina" k="Placed" v={t.placed.count} {...on('placed')}
        d={!t.applicants.na && t.applicants.count ? `${Math.round((t.placed.count / t.applicants.count) * 100)}% of applicants` : ''} />
      <Tile accent="sage" k="Completed" v={t.completed.count} {...on('completed')}
        d={(cmp?.delta && deltaWords(cmp.delta.completed, label)) || (completedRate.suppressed ? '' : `${fmtRate(completedRate)} of placed`)} />
      <Tile hero accent="chroma" k={measureLabel(f.measure)} v={fmtRate(m)} {...on('measure')}
        d={(cmp?.delta && deltaWords(cmp.delta.measure, label)) || (cmp?.unavailable) || `${m.count} of ${m.n} completed`} />
      <Tile accent="dawn" k="In rotation now" v={t.inRotation.count} {...on('in_rotation')}
        d={t.inRotation.count ? 'Counted in Applicants and Placed only' : 'No cohort in rotation'} />
      <Tile empty accent="periwinkle" k="12-month retention" v="Not connected" d="Fills in after an HR import" />
    </section>
  )
}

// ── Each chart's figures, shaped for its marks and its table ─────────────────

function choiceCard(data, f) {
  const { buckets, notRecorded, association } = data.choice
  const items = buckets.map(b => rateItem(b.key, b.label, b, { other: b.key === 'other', color: CHOICE_COLORS[b.key], tip: `${b.label}: ${b.count} of ${b.n} placed` }))
  const a = association
  const note = `${measureLabel(f.measure)}: ${fmtRate(a.top)} for 1st-choice matches vs ${fmtRate(a.others)} for everyone else. An association, not a cause.`
    + (notRecorded ? ` ${notRecorded} placed ${notRecorded === 1 ? 'student has' : 'students have'} no match rank recorded.` : '')
  return {
    table: {
      columns: [{ key: 'match', label: 'Match' }, { key: 'count', label: 'Students' }, { key: 'share', label: 'Share' }],
      rows: buckets.map(b => ({ id: b.key, match: b.label, count: b.count, share: rateText(b), share__sort: b.rate ?? -1 })),
    },
    note,
    nat: () => hbarHeight(items),
    draw: (w, h) => <HBar items={items} width={w} height={h} cap={100} />,
  }
}

function bySchoolCard(data, f, pickSchool, colorOf) {
  const program = data.bySchool.program
  const items = data.bySchool.schools.map(s => rateItem(s.school, s.school, s, {
    pickValue: s.school, other: Boolean(f.school && f.school !== s.school), color: colorOf(s.school),
    tip: `${s.school}\n${measureLabel(f.measure)}: ${s.suppressed ? 'too few to rate' : fmtRate(s)}\n${s.count} of ${s.n} completed`,
  }))
  return {
    table: {
      columns: [{ key: 'school', label: 'School' }, { key: 'rate', label: measureLabel(f.measure) }, { key: 'count', label: 'Students' }, { key: 'n', label: 'Completed' }],
      rows: data.bySchool.schools.map(s => ({ id: s.school, school: s.school, rate: rateText(s), rate__sort: s.rate ?? -1, count: s.count, n: s.n })),
    },
    nat: () => hbarHeight(items, program.suppressed ? null : program.rate),
    draw: (w, h) => <HBar items={items} width={w} height={h} cap={100} onPick={pickSchool} refValue={program.suppressed ? null : program.rate}
      refLabel={`Program ${fmtRate(program)}`} pickLabel="Filter to this school" />,
  }
}

const PATHWAY_METRICS = [
  { key: 'measure', name: null, fmt: fmtRate, max: 100, val: x => x.rate },
  { key: 'completion', name: 'Completion rate', fmt: fmtRate, max: 100, val: x => x.rate },
  { key: 'firstChoice', name: 'Placed in 1st choice', fmt: fmtRate, max: 100, val: x => x.rate },
  { key: 'caseyFink', name: 'Casey-Fink change', fmt: fmtChange, max: null, val: x => x.mean },
]

function pathwayCard(data, f, pickPathway) {
  const groups = [['internal', 'Internal'], ['external', 'External']]
  const rows = []
  for (const m of PATHWAY_METRICS) {
    for (const [k, l] of groups) {
      const x = data.pathway[k][m.key]
      rows.push({ id: `${m.key}-${k}`, measure: m.name || measureLabel(f.measure), pathway: l, value: m.key === 'caseyFink' ? fmtChange(x) : rateText(x), value__sort: m.val(x) ?? -99, n: x.n })
    }
  }
  return {
    table: { columns: [{ key: 'measure', label: 'Measure' }, { key: 'pathway', label: 'Pathway', align: 'left' }, { key: 'value', label: 'Value' }, { key: 'n', label: 'Students' }], rows },
    note: `${data.pathway.internal.count} internal and ${data.pathway.external.count} external students in view.`,
    legend: [['Internal', PATHWAY_COLORS.internal], ['External', PATHWAY_COLORS.external]],
    draw: w => {
      // The SVG is drawn at its column's width, so the grid's columns are decided here too.
      const cols = Math.max(1, Math.min(PATHWAY_METRICS.length, Math.floor((w + 20) / 260)))
      const cw = Math.floor((w - 20 * (cols - 1)) / cols)
      return (
      <div className="ins-multiples" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {PATHWAY_METRICS.map(m => {
          const vals = groups.map(([k]) => data.pathway[k][m.key])
          const max = m.max || Math.max(0.5, ...vals.map(v => Math.abs(v?.mean || 0)))
          const items = groups.map(([k, l]) => {
            const x = data.pathway[k][m.key]
            return {
              id: k, label: l, value: Math.max(0, m.val(x) || 0), display: m.fmt(x), n: x.n, suppressed: x.suppressed, color: PATHWAY_COLORS[k],
              pickValue: k, other: Boolean(f.pathway !== 'all' && f.pathway !== k),
            }
          })
          return (
            <div key={m.key}>
              <p className="ins-minihead">{m.name || measureLabel(f.measure)}</p>
              <HBar items={items} width={cw} max={m.max ? null : max} cap={m.max} labelWidth={80} onPick={pickPathway} pickLabel="Filter to this pathway" />
            </div>
          )
        })}
      </div>
      )
    },
  }
}

function hostedCard(data, f, pickUnit, colorOf) {
  const hosted = data.hostedByUnit
  // Each bar is stacked by school, in the school list's order, so the colours stack the same way
  // on every unit and match the school bars on the cards above.
  const order = new Map((data.schools || []).map((s, i) => [s, i]))
  const rank = s => (order.has(s) ? order.get(s) : 999)
  const present = [...new Set(hosted.flatMap(h => h.bySchool.map(b => b.school)))].sort((a, b) => rank(a) - rank(b))
  const items = hosted.map(h => ({
    id: h.unitKey, label: h.unit, value: h.total, display: String(h.total), pickValue: h.unitKey,
    other: Boolean(f.unit && f.unit !== h.unitKey),
    segments: [...h.bySchool].sort((a, b) => rank(a.school) - rank(b.school)).map(b => ({ key: b.school, value: b.count, color: colorOf(b.school) })),
    tip: `${h.unit}: ${h.total} ${h.total === 1 ? 'student' : 'students'}\n${h.bySchool.slice(0, 4).map(b => `${b.school}: ${b.count}`).join('\n')}`,
  }))
  return {
    table: {
      columns: [{ key: 'unit', label: 'Unit' }, { key: 'line', label: 'Service line', align: 'left' }, { key: 'total', label: 'Students' }],
      rows: hosted.map(h => ({ id: h.unitKey, unit: h.unit, line: h.serviceLine || '–', total: h.total })),
    },
    note: hosted.length ? 'A student placed on two units counts on each. Each bar is split by school; the grid below gives the counts.' : '',
    legend: present.length > 1 ? present.map(s => [s, colorOf(s)]) : null,
    nat: () => (hosted.length ? hbarHeight(items) : 40),
    draw: (w, h) => hosted.length ? <HBar items={items} width={w} height={h} onPick={pickUnit} pickLabel="Filter to this unit" /> : <p className="ins-emptyline">No placed students in this view.</p>,
  }
}

function yieldCard(data, f, pickUnit) {
  const { units, program } = data.unitYield
  const items = units.map(u => rateItem(u.unitKey, u.unit, u, {
    pickValue: u.unitKey, other: Boolean(f.unit && f.unit !== u.unitKey),
    tip: `${u.unit}: hired back ${u.count} of ${u.n} hosted`,
  }))
  return {
    table: {
      columns: [{ key: 'unit', label: 'Unit' }, { key: 'yield', label: 'Yield' }, { key: 'count', label: 'Hired back' }, { key: 'n', label: 'Hosted' }],
      rows: units.map(u => ({ id: u.unitKey, unit: u.unit, yield: rateText(u), yield__sort: u.rate ?? -1, count: u.count, n: u.n })),
    },
    nat: () => (units.length ? hbarHeight(items, program.suppressed ? null : program.rate) : 40),
    draw: (w, h) => units.length
      ? <HBar items={items} width={w} height={h} cap={100} onPick={pickUnit} refValue={program.suppressed ? null : program.rate} refLabel={`Program ${fmtRate(program)}`} pickLabel="Filter to this unit" />
      : <p className="ins-emptyline">No finished cohort with placements in this view.</p>,
  }
}

function heatCard(data, pickSchool, pickUnitByName) {
  const { schools, units, cells } = data.heatmap
  return {
    table: {
      columns: [{ key: 'school', label: 'School' }, ...units.map((u, j) => ({ key: `u${j}`, label: u }))],
      rows: schools.map((s, i) => ({ id: s, school: s, ...Object.fromEntries(units.map((_, j) => [`u${j}`, cells[i][j]])) })),
    },
    draw: w => schools.length
      ? <div className="ins-scroll-x"><Heat rows={schools} cols={units} cells={cells} width={w} onPickRow={pickSchool} onPickCol={pickUnitByName} /></div>
      : <p className="ins-emptyline">No placed students in this view.</p>,
  }
}

function caseyFinkCard(data, colorOf) {
  const list = data.caseyFinkBySchool
  const items = list.map(s => ({ id: s.school, label: s.school, value: Math.max(0, s.mean || 0), display: fmtChange(s), n: s.n, suppressed: s.suppressed, color: colorOf(s.school) }))
  return {
    table: {
      columns: [{ key: 'school', label: 'School' }, { key: 'change', label: 'Mean change' }, { key: 'n', label: 'Students' }],
      rows: list.map(s => ({ id: s.school, school: s.school, change: s.suppressed ? `Too few to rate (n = ${s.n})` : fmtChange(s), change__sort: s.mean ?? -99, n: s.n })),
    },
    note: 'Post-rotation Section I mean minus pre-rotation, on the 1 to 4 scale, for students with both. A negative change draws no bar; the figure still shows its sign.',
    nat: () => (list.length ? hbarHeight(items) : 40),
    draw: (w, h) => list.length ? <HBar items={items} width={w} height={h} /> : <p className="ins-emptyline">No paired Casey-Fink responses in this view.</p>,
  }
}

// ── The page ─────────────────────────────────────────────────────────────────

export default function InsightsPage({ surface = 'staff', backPath, backLabel, title = 'ASPIRE Insights', readOnlyNote = '' }) {
  const { style } = useTheme()
  const classic = style !== 'modern'
  const location = useLocation()
  const navigate = useNavigate()
  const f = useMemo(() => filtersFromSearch(location.search), [location.search])
  const search = searchFromFilters(f)
  // `key` is the request the state answers; while it differs from the one asked, the page is
  // loading (or refreshing over the last figures). Retry asks again under a new attempt.
  const [attempt, setAttempt] = useState(0)
  const requestKey = `${surface}|${search}|${attempt}`
  const [state, setState] = useState({ key: null, data: null, error: null })

  useEffect(() => {
    let live = true
    fetchInsights(surface, search)
      .then(data => { if (live) setState({ key: requestKey, data, error: null }) })
      .catch(error => { if (live) setState(s => ({ key: requestKey, data: s.data, error })) })
    return () => { live = false }
  }, [surface, search, requestKey])

  const pending = state.key !== requestKey
  const status = pending ? (state.data ? 'refreshing' : 'loading') : (state.error ? 'error' : 'ready')
  const data = state.data
  const units = data?.units || []
  const go = useCallback(next => navigate({ pathname: location.pathname, search: searchFromFilters(next) }, { replace: true }), [navigate, location.pathname])
  const set = (k, v) => go(withFilter(f, k, v, units))
  const pickSchool = v => go(toggleFilter(f, 'school', v, units))
  const pickUnit = v => go(toggleFilter(f, 'unit', v, units))
  const pickUnitByName = name => { const u = units.find(x => x.name === name); if (u) pickUnit(u.key) }
  const pickPathway = v => go(toggleFilter(f, 'pathway', v, units))
  const pickTileFilter = tile => go(pickTile(f, tile))

  const chips = chipsFor(f, { cohorts: data?.cohorts || [], units })

  let body
  if (status === 'loading' && !data) {
    body = <div className="ins-sheet ins-state" role="status">Loading the figures…</div>
  } else if (!data) {
    const denied = state.error?.status === 403 || state.error?.status === 401
    body = (
      <div className="ins-sheet ins-state" role="alert">
        {denied ? 'Insights is for the Owner, Admins and Co-Leads.' : 'Couldn\'t load the figures.'}
        {!denied && <button type="button" className="ins-act" onClick={() => setAttempt(a => a + 1)}>Retry</button>}
      </div>
    )
  } else {
    const colorOf = slotsFor(data.schools)
    const cards = [
      ['pipeline', 'Pipeline', 'From application to NGRP hire. Finished cohorts only.', 7, pipelineCard(data)],
      ['match', 'Placement Match', 'Share of placed students who got their 1st, 2nd or 3rd choice unit.', 5, choiceCard(data, f)],
      ['school', `${measureLabel(f.measure)} by School`, 'Completed students in finished cohorts. Choose a school to filter.', 6, bySchoolCard(data, f, pickSchool, colorOf)],
      ['trend', 'Cohort Trends', 'Applied, offered and hired rates per finished cohort.', 6, trendCard(data)],
      ['pathway', 'Internal vs. External', 'Internal means a Cedars-Sinai employee when they applied to ASPIRE.', 12, pathwayCard(data, f, pickPathway)],
      ['hosted', 'Students Hosted by Unit', 'Placed students in the current filters. Choose a unit to filter.', 7, hostedCard(data, f, pickUnit, colorOf)],
      ['yield', 'Unit Yield', 'Students hired into NGRP on the unit where they rotated.', 5, yieldCard(data, f, pickUnit)],
      ['heatmap', 'Which Schools Feed Which Units', 'Placed students in the current filters. Darker means more students.', 12, heatCard(data, pickSchool, pickUnitByName)],
      ['caseyfink', 'Casey-Fink Change by School', 'Mean post minus pre, 1 to 4 scale.', 6, caseyFinkCard(data, colorOf)],
      ['hours', 'Clinical Hours by School', 'Approved hours as a share of each student\'s requirement.', 6, hoursCard(data, colorOf)],
    ]
    body = (
      <>
        <div className="ins-grid">
          {cards.map(([id, t, sub, span, c]) => (
            <ChartCard key={id} id={id} title={t} sub={sub} span={span} table={c.table} note={c.note} legend={c.legend} nat={c.nat}>
              {(w, h) => c.draw(w, h)}
            </ChartCard>
          ))}
          <section className="ins-sheet ins-card ins-c12" aria-labelledby="ins-h-retention">
            <div className="ins-ch"><div className="ins-ct">
              <h2 id="ins-h-retention">Retention</h2>
              <p className="ins-sub">NGRP hires still employed at 6 and 12 months.</p>
            </div></div>
            <div className="ins-retention">
              <b>Retention data isn't connected yet.</b>
              <span>It fills in after the first import from HR: employee ID, NGRP start date, and status at 6 and 12 months.</span>
            </div>
          </section>
        </div>
      </>
    )
  }

  return (
    <div className={`ins${classic ? ' ins-classic' : ''}`} aria-busy={status === 'loading' || status === 'refreshing'}>
      {backPath && <div className="ins-topline"><WorkspaceBackLink path={backPath} label={backLabel} /></div>}
      <div className="ins-binder">
        <header className="ins-head">
          <div>
            <span className="ins-tag" aria-hidden="true">Program report</span>
            <h1>{title}</h1>
            <p>Outcomes across every cohort, school, unit and pathway.{readOnlyNote ? ` ${readOnlyNote}` : ''}</p>
          </div>
          {data && (
            <div className="ins-asof">
              {asOfWords(data.asOf)}
              <br />
              {data.inView.applicants != null ? `${data.inView.applicants} applicants · ` : ''}{data.inView.placed} placed in view
            </div>
          )}
        </header>
        {data?.tiles && <Tiles data={data} f={f} pick={pickTileFilter} />}
        <FilterBar f={f} data={data} set={set} />
        <div className="ins-chips" aria-live="polite">
          {chips.length === 0 && <span>No filters. Showing every cohort, school and unit.</span>}
          {chips.map(c => (
            <span key={c.key} className="ins-chip">
              {c.label}
              <button type="button" aria-label={`Remove filter ${c.label}`} onClick={() => set(c.key, '')}>×</button>
            </span>
          ))}
          {chips.length > 1 && <button type="button" className="ins-clear" onClick={() => go(clearFilters(f))}>Clear all</button>}
          {status === 'error' && data && <span className="ins-warn" role="alert">Couldn't refresh. These are the last figures loaded.</span>}
        </div>
        {surface === 'staff' && data?.tiles && <KeithRead filters={f} search={search} />}
        {body}
        {data && (
          <details className="ins-sheet ins-defs">
            <summary>Definitions</summary>
            <dl>
              {data.definitions.map(d => (
                <div key={d.term}><dt>{d.term}</dt><dd>{d.text}</dd></div>
              ))}
            </dl>
          </details>
        )}
      </div>
    </div>
  )
}

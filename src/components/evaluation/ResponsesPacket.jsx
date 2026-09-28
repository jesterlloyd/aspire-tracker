// src/components/evaluation/ResponsesPacket.jsx
//
// RESPONSES-PACKET-1 (2026-09-19): Evaluation > Responses as a results packet.
// The Modern theme uses horizontal instrument navigation. The Classic theme presents the
// same controls as a booklet's right-edge index and replaces graph paper with report stock.
// The roster below is the shared DataSheet, and the bubble sheet a row opens into is
// BubbleSheet.jsx. Source values come from src/lib/evaluation/responsesPacketModel.js;
// this component derives only display percentages and chart positions.
//
// The sheet states what the numbers rest on before it states the finding: the specimen
// block names the instrument, its timepoints and the cohort; the basis line gives the
// denominators; only then does a subscale row show its distribution. The distribution is
// the primary mark (up / same / down as a stacked bar with a count line beneath it) and
// the means are secondary text to the right. A +0.12 and a +0.51 must not look alike, so
// the delta is an outline chip, never a filled pill.

import { ExternalLink } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import { segmentText } from '../../lib/evaluation/responsesPacketModel'
import './responsesPacket.css'

const fmt2 = v => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(2))
const signed = v => (v == null || !Number.isFinite(v) ? '–' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}`)
const signedInt = v => (v == null ? '–' : `${v >= 0 ? '+' : ''}${v}`)

// ── Instrument tabs ───────────────────────────────────────────────────────────

const CLASSIC_TAB_LABELS = Object.freeze({
  casey_fink_readiness_2024: 'Casey-Fink',
  preceptor_progress: 'Preceptor',
  student_preceptor_eval: 'Unit + P',
  post_rotation_evaluation: 'ASPIRE',
})

function handleTabKeyDown(event, slug, tabs, onSelect) {
  const index = tabs.findIndex(tab => tab.slug === slug)
  if (index < 0) return
  let next = null
  if (event.key === 'Home') next = 0
  if (event.key === 'End') next = tabs.length - 1
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length
  if (next == null) return
  event.preventDefault()
  onSelect(tabs[next].slug)
  event.currentTarget.closest('[role="group"]')
    ?.querySelector(`[data-instrument-tab="${tabs[next].slug}"]`)
    ?.focus()
}

// The same tab state powers two presentations. Modern keeps the horizontal instrument
// selector. Classic uses short labels on the booklet's right edge. The square-arrow opens
// the same read-only sample Review & Release uses.
export function InstrumentTabs({ tabs, selected, onSelect, onPreview }) {
  return (
    <div className="rp-tabs" role="group" aria-label="Evaluation instruments">
      {tabs.map(tab => (
        <div key={tab.slug} className="rp-tab" data-selected={tab.slug === selected}>
          <button
            type="button"
            className="rp-tab-main"
            data-instrument-tab={tab.slug}
            aria-label={tab.name}
            aria-pressed={tab.slug === selected}
            onClick={() => onSelect(tab.slug)}
            onKeyDown={event => handleTabKeyDown(event, tab.slug, tabs, onSelect)}
          >
            <b>
              <span className="rp-tab-label-full">{tab.name}</span>
              <span className="rp-tab-label-short">{CLASSIC_TAB_LABELS[tab.slug] || tab.name}</span>
            </b>
            <span className="rp-n">{tab.completed} of {tab.assigned} · {tab.pct}%</span>
            <span className="rp-meter" aria-hidden="true"><i style={{ width: `${tab.pct}%` }} /></span>
          </button>
          {onPreview && (
            <Tooltip label="Open a sample of the survey" placement="bottom" tone="contrast">
              <button
                type="button"
                className="rp-tab-preview"
                aria-label={`Open a sample of ${tab.name}`}
                onClick={() => onPreview(tab.slug)}
              >
                <ExternalLink size={14} aria-hidden="true" />
              </button>
            </Tooltip>
          )}
        </div>
      ))}
    </div>
  )
}

// ── The finding ───────────────────────────────────────────────────────────────

function Segment({ kind, count, total, label }) {
  if (!count) return null
  const w = total > 0 ? (count / total) * 100 : 0
  const text = segmentText(count, total, label)
  return (
    <span
      className={`rp-seg rp-seg-${kind}`}
      style={{ width: `${w}%` }}
      data-narrow={w < 9 ? 1 : 0}
      data-tip={text}
      tabIndex={0}
      role="img"
      aria-label={text}
    >
      <b aria-hidden="true">{count}</b>
    </span>
  )
}

function ComparisonPlot({ s, scaleMax, labels }) {
  const position = value => {
    if (value == null || !Number.isFinite(value) || scaleMax <= 1) return 0
    return Math.max(0, Math.min(100, ((value - 1) / (scaleMax - 1)) * 100))
  }
  const pre = position(s.preMean)
  const post = position(s.postMean)
  const left = Math.min(pre, post)
  const width = Math.abs(post - pre)
  const interpretation = Number.isFinite(s.delta) && Number.isFinite(s.preMean) && Number.isFinite(s.postMean)
    ? `Average agreement ${s.delta >= 0 ? 'increased' : 'decreased'} ${Math.abs(s.delta).toFixed(2)} points, from ${fmt2(s.preMean)} before rotation to ${fmt2(s.postMean)} after rotation on the 1 to ${scaleMax} agreement scale. This reflects student-reported agreement with the ${s.itemCount}-item ${s.label} subscale.`
    : null
  return (
    <div className="rp-comparison-wrap">
      <div
        className="rp-classic-comparison"
        role="img"
        aria-label={`${s.label}: ${fmt2(s.preMean)} before, ${fmt2(s.postMean)} after, ${signed(s.delta)} change. ${s.up} ${labels.up}, ${s.same} ${labels.same}, ${s.down} ${labels.down}.`}
      >
        <div className="rp-comparison-track" aria-hidden="true">
          <i className="rp-comparison-connector" style={{ left: `${left}%`, width: `${width}%` }} />
          <i className="rp-comparison-dot rp-comparison-dot-pre" style={{ left: `${pre}%` }} />
          <i className="rp-comparison-dot rp-comparison-dot-post" style={{ left: `${post}%` }} />
        </div>
        <div className="rp-comparison-values" aria-hidden="true">
          <span className="rp-comparison-value-pre" style={{ left: `${pre}%` }}>{fmt2(s.preMean)}</span>
          <span className="rp-comparison-value-post" style={{ left: `${post}%` }}>{fmt2(s.postMean)}</span>
        </div>
        <div className="rp-counts" aria-hidden="true">
          <span><b>{s.up}</b> higher</span>
          <span><b>{s.same}</b> same</span>
          <span><b>{s.down}</b> lower</span>
        </div>
      </div>
      {interpretation && <p className="rp-comparison-interpretation">{interpretation}</p>}
    </div>
  )
}

function SubscaleRow({ s, paired, labels, scaleMax, highlight = false }) {
  const hasBar = s.total > 0
  return (
    <div className="rp-sub" data-paired={paired ? 1 : 0} data-highlight={highlight ? 1 : 0}>
      <div className="rp-name">
        {s.label}
        <small>
          {s.itemCount}-item {s.itemCount === 1 ? 'rating' : 'subscale'}
          {highlight && <span className="rp-highlight-label"> · largest change</span>}
        </small>
      </div>
      {paired && <ComparisonPlot s={s} scaleMax={scaleMax} labels={labels} />}
      <div className={`rp-barwrap${paired ? ' rp-legacy-distribution' : ''}`}>
        <div className={`rp-bar${hasBar ? '' : ' rp-bar-empty'}`} role="group" aria-label={`${s.label} distribution`}>
          {hasBar && (
            <>
              <Segment kind="up"   count={s.up}   total={s.total} label={labels.up} />
              <Segment kind="same" count={s.same} total={s.total} label={labels.same} />
              <Segment kind="down" count={s.down} total={s.total} label={labels.down} />
            </>
          )}
        </div>
        <div className="rp-counts">
          <span><i className="rp-sw rp-sw-up" aria-hidden="true" />{s.up} {labels.up}</span>
          <span><i className="rp-sw rp-sw-same" aria-hidden="true" />{s.same} {labels.same}</span>
          <span><i className="rp-sw rp-sw-down" aria-hidden="true" />{s.down} {labels.down}</span>
          {paired && <span className="rp-net">net {signedInt(s.net)} of {s.total}</span>}
        </div>
      </div>
      <div className="rp-means">
        {paired ? (
          <>
            <span className="rp-means-values"><b>{fmt2(s.preMean)}</b> → <b>{fmt2(s.postMean)}</b></span>
            <Tooltip
              label={Number.isFinite(s.delta) ? `Average agreement: ${signed(s.delta)} points, ${fmt2(s.preMean)} before, ${fmt2(s.postMean)} after.` : 'Change is unavailable.'}
              placement="top"
            >
              <span className="rp-delta" tabIndex={0}>{signed(s.delta)}</span>
            </Tooltip>
          </>
        ) : (
          <>mean <b>{fmt2(s.mean)}</b></>
        )}
      </div>
    </div>
  )
}

// The same figures as a real table, with a caption a screen reader gets. Required, not
// optional: the neutral segment sits below 3:1 against the sheet.
export function TableView({ distribution, id }) {
  const { paired, subscales, title, heads } = distribution
  return (
    <table className="rp-tv" id={id}>
      <caption className="sr-only">{title} as a table</caption>
      <thead>
        <tr>
          <th className="aspire-th" scope="col">Subscale</th>
          <th className="aspire-th" scope="col">Items</th>
          {paired ? (
            <>
              <th className="aspire-th" scope="col">Pre</th>
              <th className="aspire-th" scope="col">Post</th>
              <th className="aspire-th" scope="col">Change</th>
            </>
          ) : (
            <th className="aspire-th" scope="col">Mean</th>
          )}
          <th className="aspire-th" scope="col">{heads.up}</th>
          <th className="aspire-th" scope="col">{heads.same}</th>
          <th className="aspire-th" scope="col">{heads.down}</th>
          {paired && <th className="aspire-th" scope="col">Net</th>}
        </tr>
      </thead>
      <tbody>
        {subscales.map(s => (
          <tr key={s.key}>
            <td>{s.label}</td>
            <td>{s.itemCount}</td>
            {paired ? (
              <>
                <td>{fmt2(s.preMean)}</td>
                <td>{fmt2(s.postMean)}</td>
                <td>{signed(s.delta)}</td>
              </>
            ) : (
              <td>{fmt2(s.mean)}</td>
            )}
            <td>{s.up}</td>
            <td>{s.same}</td>
            <td>{s.down}</td>
            {paired && <td>{signedInt(s.net)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── The sheet ─────────────────────────────────────────────────────────────────

const RUN_DATE = () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export function AnalysisSheet({
  packet,
  cohortLabel,
  tableView = false,
  onToggleTableView,
  onFollowUp,
}) {
  const { instrument, rows, basis, distribution, followUp } = packet
  const hasRows = rows.length > 0
  const tableId = `evaluation-analysis-table-${instrument.slug}`
  const emptyFinding = distribution.paired
    ? 'The pre-to-post comparison will appear after at least one student completes both a pre-rotation and a post-rotation survey.'
    : 'The distribution will appear after the first response is submitted.'
  const showRows = hasRows && distribution.total > 0
  const basisByKey = Object.fromEntries(basis.map(entry => [entry.key, entry.value]))
  const assigned = basisByKey.assigned || 0
  const completed = basisByKey.completed || 0
  const remaining = Math.max(0, assigned - completed)
  const completionPct = assigned > 0 ? Math.round((completed / assigned) * 100) : 0
  const largestDelta = distribution.paired
    ? Math.max(...distribution.subscales.map(s => Number.isFinite(s.delta) ? Math.abs(s.delta) : -Infinity))
    : null

  return (
      <section
        className="rp-sheet"
        id="evaluation-analysis-panel"
        aria-label={`${instrument.name} analysis sheet`}
      >
        <div className="rp-sheethead">
          <div className="rp-specimen">
            <div className="rp-spec"><span className="rp-k">Instrument</span><span className="rp-v">{instrument.name}</span></div>
            <div className="rp-spec"><span className="rp-k">Timepoints</span><span className="rp-v">{instrument.timepointsLabel}</span></div>
            <div className="rp-spec"><span className="rp-k">Cohort</span><span className="rp-v">{cohortLabel || '–'}</span></div>
          </div>
          <div className="rp-stamp">RUN {RUN_DATE()}<br />ASPIRE INTELLIGENCE</div>
        </div>

        <div className="rp-completion" aria-label="Instrument completion">
          <div className="rp-completion-head">
            <div>
              <span className="rp-k">Completion</span>
              <strong>{assigned > 0 ? `${completed} of ${assigned} completed` : 'No assignments'}</strong>
            </div>
            <b>{assigned > 0 ? `${completionPct}%` : '–'}</b>
          </div>
          <span
            className="rp-completion-meter"
            role="progressbar"
            aria-label={assigned > 0 ? `${completed} of ${assigned} completed` : 'No assignments'}
            aria-valuemin={0}
            aria-valuemax={assigned || 1}
            aria-valuenow={completed}
            aria-valuetext={assigned > 0 ? `${completionPct}% complete` : 'No assignments'}
          >
            <i style={{ width: `${completionPct}%` }} />
          </span>
          <small>{assigned > 0 ? `${remaining} not completed` : 'No responses to analyze in this cohort'}</small>
        </div>

        <div className="rp-basis" aria-label="Basis">
          {basis.map(b => (
            <div key={b.key} className={`rp-b${b.tone ? ` rp-b-${b.tone}` : ''}`} data-basis-key={b.key}>
              <b>{b.value}</b>
              <span>{b.label}</span>
            </div>
          ))}
        </div>

        <h3 className="rp-findtitle">{distribution.title}</h3>
        <p className="rp-findsub">{distribution.subtitle}</p>

        {!hasRows && <p className="rp-empty">No assignments for this instrument in this cohort yet.</p>}
        {hasRows && !showRows && <p className="rp-empty">{emptyFinding}</p>}
        {showRows && distribution.subscales.map(s => (
          <SubscaleRow
            key={s.key}
            s={s}
            paired={distribution.paired}
            labels={distribution.labels}
            scaleMax={instrument.scaleMax}
            highlight={distribution.paired && Number.isFinite(s.delta) && Math.abs(s.delta) === largestDelta}
          />
        ))}
        {showRows && <p className="rp-scale">{distribution.scaleLabel}</p>}
        {showRows && distribution.scoringNote && <p className="rp-scoring">{distribution.scoringNote}</p>}
        {showRows && tableView && <TableView distribution={distribution} id={tableId} />}

        <div className="rp-sheetfoot">
          <div className="rp-footleft">
            {followUp && (
              <span className="rp-followup">
                {followUp.text}
                <button type="button" onClick={() => onFollowUp?.(followUp)}>{followUp.action}</button>
              </span>
            )}
            <p className="rp-caveat">{instrument.caveat}</p>
          </div>
          <div className="rp-acts">
            <button
              type="button"
              className="ds-btn"
              aria-expanded={tableView}
              aria-controls={tableId}
              disabled={!showRows}
              onClick={() => onToggleTableView?.(!tableView)}
            >
              {tableView ? 'Hide table' : 'View table'}
            </button>
          </div>
        </div>
      </section>
  )
}

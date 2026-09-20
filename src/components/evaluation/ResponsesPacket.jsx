// src/components/evaluation/ResponsesPacket.jsx
//
// RESPONSES-PACKET-1 (2026-09-19): Evaluation > Responses as a printed results packet.
// Two pieces live here: the instrument file tabs and the gridded analysis sheet. The
// roster below them is the shared DataSheet, and the bubble sheet a row opens into is
// BubbleSheet.jsx. Every number these components print comes from
// src/lib/evaluation/responsesPacketModel.js; nothing is computed in JSX.
//
// The sheet states what the numbers rest on before it states the finding: the specimen
// block names the instrument, its timepoints and the cohort; the basis line gives the
// denominators; only then does a subscale row show its distribution. The distribution is
// the primary mark (up / same / down as a stacked bar with a count line beneath it) and
// the means are secondary text to the right. A +0.12 and a +0.51 must not look alike, so
// the delta is an outline chip, never a filled pill.

import { segmentText } from '../../lib/evaluation/responsesPacketModel'
import './responsesPacket.css'

const fmt2 = v => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(2))
const signed = v => (v == null || !Number.isFinite(v) ? '–' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}`)
const signedInt = v => (v == null ? '–' : `${v >= 0 ? '+' : ''}${v}`)

// ── Instrument tabs ───────────────────────────────────────────────────────────

export function InstrumentTabs({ tabs, selected, onSelect }) {
  return (
    <div className="rp-tabs" role="group" aria-label="Instrument">
      {tabs.map(tab => (
        <button
          key={tab.slug}
          type="button"
          className="rp-tab"
          aria-pressed={tab.slug === selected}
          onClick={() => onSelect(tab.slug)}
        >
          <b>{tab.name}</b>
          <span className="rp-n">{tab.completed} of {tab.assigned} · {tab.pct}%</span>
          <span className="rp-meter" aria-hidden="true"><i style={{ width: `${tab.pct}%` }} /></span>
        </button>
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

function SubscaleRow({ s, paired, labels }) {
  const hasBar = s.total > 0
  return (
    <div className="rp-sub">
      <div className="rp-name">
        {s.label}
        <small>{s.itemCount}-item {s.itemCount === 1 ? 'rating' : 'subscale'}</small>
      </div>
      <div className="rp-barwrap">
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
            <b>{fmt2(s.preMean)}</b> → <b>{fmt2(s.postMean)}</b>
            <span className="rp-delta">{signed(s.delta)}</span>
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
export function TableView({ distribution }) {
  const { paired, subscales, title, heads } = distribution
  return (
    <table className="rp-tv">
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
  onPairedScores,
}) {
  const { instrument, rows, basis, distribution, followUp } = packet
  const hasRows = rows.length > 0
  const emptyFinding = distribution.paired
    ? 'The pre-to-post comparison will appear after at least one student completes both a pre-rotation and a post-rotation survey.'
    : 'The distribution will appear after the first response is submitted.'
  const showRows = hasRows && distribution.total > 0

  return (
    <div className="rp-sheetwrap">
      <section className="rp-sheet" aria-label={`${instrument.name} analysis sheet`}>
        <div className="rp-sheethead">
          <div className="rp-specimen">
            <div className="rp-spec"><span className="rp-k">Instrument</span><span className="rp-v">{instrument.name}</span></div>
            <div className="rp-spec"><span className="rp-k">Timepoints</span><span className="rp-v">{instrument.timepointsLabel}</span></div>
            <div className="rp-spec"><span className="rp-k">Cohort</span><span className="rp-v">{cohortLabel || '–'}</span></div>
          </div>
          <div className="rp-stamp">RUN {RUN_DATE()}<br />ASPIRE INTELLIGENCE</div>
        </div>

        <div className="rp-basis" aria-label="Basis">
          {basis.map(b => (
            <div key={b.key} className={`rp-b${b.tone ? ` rp-b-${b.tone}` : ''}`}>
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
          <SubscaleRow key={s.key} s={s} paired={distribution.paired} labels={distribution.labels} />
        ))}
        {showRows && <p className="rp-scale">{distribution.scaleLabel}</p>}
        {showRows && distribution.scoringNote && <p className="rp-scoring">{distribution.scoringNote}</p>}
        {showRows && tableView && <TableView distribution={distribution} />}

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
              aria-pressed={tableView}
              disabled={!showRows}
              onClick={() => onToggleTableView?.(!tableView)}
            >
              Table view
            </button>
            {distribution.paired && (
              <button type="button" className="ds-btn" disabled={distribution.total === 0} onClick={() => onPairedScores?.()}>
                Paired scores
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

// src/components/forms/FormSummary.jsx
//
// FORM-SUMMARY-1 (2026-09-24, Owner): Responses > Summary, like Microsoft Forms. One card per
// question, built by summaryFor in formModel from the same answers the Sheet reads.
//
// The chart is one form everywhere: horizontal bars, one hue (the Catalog navy), each bar's
// count and share written at its tip in text ink, so there is no legend and colour carries no
// meaning of its own (dataviz skill: magnitude of one series, value at the tip, bars at most
// 24px thick with a 4px rounded end, square at the baseline). Every number is also written
// out, so the text IS the table view. Numbers and dates are stat tiles, not charts.
import { useEffect, useState } from 'react'
import { formatDate } from '../../lib/forms/formModel'
import { formStaff } from './formsApi'

const pct = (n, of) => (of ? Math.round((n / of) * 100) : 0)
const num = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1))

export default function FormSummary({ formId, onSheet }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    let live = true
    formStaff('sheet', { id: formId }).then(r => { if (live) setData(r) }).catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [formId])

  if (error) return <p className="fm-err" role="alert">{error}</p>
  if (!data) return <p className="fm-hint">Loading the summary…</p>
  if (!data.rows.length) return <div className="fm-card fs-empty"><p className="fm-hint">No one has submitted this form yet. The summary fills in as answers come in.</p></div>

  return (
    <div className="fsum">
      <p className="fm-hint">{data.rows.length} {data.rows.length === 1 ? 'response' : 'responses'}. Every count below is out of the people who answered that question.</p>
      {data.summary.map(q => <Card key={q.key} q={q} onSheet={onSheet} />)}
    </div>
  )
}

function Card({ q, onSheet }) {
  return (
    <section className="fm-card fsum-card" aria-labelledby={`fsum-${q.key}`}>
      <header className="fsum-head">
        <h3 id={`fsum-${q.key}`}>{q.label}</h3>
        <span>{q.answered} of {q.respondents} answered{q.multi ? ' · people could choose more than one' : ''}</span>
      </header>
      {q.kind === 'options' && <Bars q={q} />}
      {q.kind === 'number' && (q.answered
        ? <Tiles items={[['Average', num(q.mean)], ['Median', num(q.median)], ['Lowest', num(q.min)], ['Highest', num(q.max)]]} />
        : <p className="fm-hint">No answers yet.</p>)}
      {q.kind === 'date' && (q.answered
        ? <Tiles items={[['Earliest', formatDate(q.earliest)], ['Latest', formatDate(q.latest)]]} />
        : <p className="fm-hint">No answers yet.</p>)}
      {q.kind === 'file' && <p className="fm-hint">{q.answered} {q.answered === 1 ? 'file' : 'files'} uploaded. Open them from each person's answers.</p>}
      {q.kind === 'grouped' && (q.groups.length
        ? (<>
            <ul className="fsum-texts fsum-groups">{q.groups.map((g, i) => <li key={i}><span>{g.text}</span>{g.count > 1 && <b>× {g.count}</b>}</li>)}</ul>
            {q.distinct > q.groups.length && <p className="fm-hint">Showing the {q.groups.length} most common of {q.distinct} different answers. <button type="button" className="fm-link" onClick={onSheet}>See them all in Sheet</button></p>}
          </>)
        : <p className="fm-hint">No answers yet.</p>)}
      {q.kind === 'text' && (q.samples.length
        ? (<>
            <ul className="fsum-texts">{q.samples.map((x, i) => <li key={i}><b>{x.name}</b><span>{x.text}</span></li>)}</ul>
            {q.answered > q.samples.length && <p className="fm-hint">Showing the latest {q.samples.length} of {q.answered}. <button type="button" className="fm-link" onClick={onSheet}>See them all in Sheet</button></p>}
          </>)
        : <p className="fm-hint">No answers yet.</p>)}
    </section>
  )
}

function Bars({ q }) {
  const top = Math.max(1, ...q.options.map(o => o.count))
  return (
    <>
      <ul className="fsum-bars" aria-label={`${q.label}: answers by option`}>
        {q.options.map(o => {
          const share = pct(o.count, q.answered)
          const say = `${o.label}: ${o.count} of ${q.answered} (${share}%)`
          return (
            <li key={o.label} className="fsum-bar" title={say} aria-label={say}>
              <span className="fsum-opt">{o.label}</span>
              <span className="fsum-track" aria-hidden="true"><i style={{ width: `${(o.count / top) * 100}%` }} className={o.count ? '' : 'fsum-zero'} /></span>
              <span className="fsum-val" aria-hidden="true"><b>{o.count}</b> {share}%</span>
            </li>
          )
        })}
      </ul>
      {q.otherAnswers?.length > 0 && (
        <details className="fsum-other">
          <summary>What people wrote for Other ({q.otherAnswers.length})</summary>
          <ul>{q.otherAnswers.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </details>
      )}
    </>
  )
}

function Tiles({ items }) {
  return (
    <dl className="fsum-tiles">
      {items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  )
}

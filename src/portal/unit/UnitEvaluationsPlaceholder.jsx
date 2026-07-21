// src/portal/unit/UnitEvaluationsPlaceholder.jsx
//
// UL-PHASE1: the Evaluations tab, before any results exist.
//
// This screen deliberately shows NOTHING derived from evaluation data. No counts, no
// ratings, no sample, no "3 responses pending" teaser. A number here would be a result,
// and at the cohort sizes a unit actually sees, a count IS often identifying: a unit with
// one student who is told "1 response received" has learned exactly who responded.
//
// It also avoids the worse failure mode of a placeholder that looks like a loading state.
// A spinner or a greyed-out chart implies data is coming imminently and that something is
// broken when it does not arrive. This says plainly what the area will do, what has to be
// true first, and that ASPIRE will say when it is ready.
//
// It reads no endpoint. There is nothing to fetch.

import { ClipboardCheck, ShieldCheck } from 'lucide-react'
import { SectionHeading } from './UnitLeaderChrome'

const NAVY = '#1d2567'

// What this area is FOR. Written as the decisions a Unit Leader is trying to make,
// because that is what makes the wait worth explaining.
const PURPOSE = [
  'How students experienced working with each preceptor on your unit',
  'How students experienced the unit as a learning environment',
  'Whether a preceptor is a good fit to precept again in a future cohort',
  'How your unit trends across cohorts rather than a single rotation',
]

// What has to be true first. These are real engineering and policy prerequisites, not
// filler: each one is a thing ASPIRE genuinely does not have yet.
const SAFEGUARDS = [
  ['Consent and policy alignment', 'Confirming what students were told about who would see their responses.'],
  ['Moderation', 'An ASPIRE review step before any feedback reaches a unit.'],
  ['Delayed release', 'Nothing appears while a student is still on your unit, so feedback stays honest.'],
  ['Stable attribution', 'Recording the unit and preceptor at the time of submission, so past feedback cannot be re-attributed later.'],
  ['Small-cohort safeguards', 'With one or two students, an average is not anonymous. Thresholds have to come first.'],
  ['Free-text protection', 'Written comments identify their author by content, so they need separate handling.'],
]

export default function UnitEvaluationsPlaceholder() {
  return (
    <>
      <SectionHeading focusKey="evaluations">Evaluations</SectionHeading>

      <div className="ptl-card">
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <ClipboardCheck size={20} color={NAVY} aria-hidden="true" style={{ flex: 'none', marginTop: 2 }} />
          <div style={{ minWidth: 0 }}>
            <h3 className="ptl-card-title" style={{ margin: '0 0 6px' }}>
              Student feedback is not available here yet
            </h3>
            <p className="ptl-muted" style={{ margin: 0 }}>
              This is where you will be able to see what students said about precepting and
              about your unit. ASPIRE is still putting the safeguards in place, and we will
              tell you directly when it opens.
            </p>
          </div>
        </div>
      </div>

      <section className="ptl-card" aria-labelledby="ul-eval-purpose">
        <h3 id="ul-eval-purpose" className="ptl-card-title">What this will show you</h3>
        <ul className="ptl-list">
          {PURPOSE.map(p => <li key={p}>{p}</li>)}
        </ul>
      </section>

      <section className="ptl-card" aria-labelledby="ul-eval-safeguards">
        <h3 id="ul-eval-safeguards" className="ptl-card-title">
          <ShieldCheck size={15} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />
          Why it is not open yet
        </h3>
        <p className="ptl-muted" style={{ margin: '0 0 12px' }}>
          Students answer these surveys honestly because they trust how their answers are
          handled. Opening this area before the following are in place would put that at
          risk, so each one comes first.
        </p>
        <dl style={{ margin: 0, display: 'grid', gap: 10 }}>
          {SAFEGUARDS.map(([term, detail]) => (
            <div key={term}>
              <dt style={{ fontSize: 13, fontWeight: 700, color: '#191919' }}>{term}</dt>
              <dd style={{ margin: '2px 0 0', fontSize: 12.5, color: '#5b6472', lineHeight: 1.55 }}>{detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="ptl-muted" style={{ marginTop: 4 }}>
        If you need to discuss a preceptor before this opens, message the ASPIRE team.
      </p>
    </>
  )
}

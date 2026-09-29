// src/components/keith/ShadowModeCard.jsx
//
// KEITH-FOUNDATION-1: the small Shadow mode card every Keith feature shows while its Skill runs in
// shadow (reference: the Check-in sorting view of docs/mockups/keith-workflow.html). In shadow mode
// Keith labels without acting, the feature records what the person actually did, and this card
// shows how often the two agreed (computeAgreement, over keith_provenance).
//
// Presentational: the caller fetches the agreement (/api/keith-provenance `agreement`) and passes it,
// with `labels` naming each of Keith's labels in words and `actions` for the card's own buttons.
import { agreementPercent } from '../../lib/keith/provenanceModel'
import './shadowModeCard.css'

export default function ShadowModeCard({ agreement, labels = {}, status = null, note = null, actions = null, title = 'Shadow Mode' }) {
  const a = agreement || { total: 0, agreed: 0, rate: null, byLabel: {} }
  const pct = a.rate == null ? 0 : Math.round(a.rate * 100)
  const rows = Object.entries(a.byLabel || {})
  return (
    <section className="ksm-card" aria-label={title}>
      <div className="ksm-head">
        <h3>{title}</h3>
        {status && <span className="ksm-pill">{status}</span>}
      </div>
      <p className="ksm-sub">Keith labels without acting. The app compares Keith’s label with what you did.</p>
      <div className="ksm-figure">
        <span className="ksm-big">{agreementPercent(a)}</span>
        <span className="ksm-hint">{a.total ? `Agreed with you on ${a.agreed} of ${a.total}` : 'Nothing to compare yet'}</span>
      </div>
      <div className="ksm-meter" role="img" aria-label={a.total ? `${pct} percent agreement` : 'No agreement figure yet'}><i style={{ width: `${pct}%` }} /></div>
      {rows.length > 0 && (
        <dl className="ksm-rows">
          {rows.map(([k, v]) => <div key={k}><dt>{labels[k] || k}</dt><dd>{v.agreed} of {v.total} agreed</dd></div>)}
        </dl>
      )}
      {(note || actions) && <div className="ksm-foot">{note && <span className="ksm-hint">{note}</span>}{actions}</div>}
    </section>
  )
}

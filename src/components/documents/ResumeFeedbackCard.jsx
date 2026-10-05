// src/components/documents/ResumeFeedbackCard.jsx
//
// RESUME-FEEDBACK-1: Keith's résumé review as an ASPIRE alumnus sees it, in words, never the
// number. ONE component for two places, so they cannot drift:
//   - the Student Portal's Residency tab, once the review was sent to them;
//   - the staff review drawer's "Preview what [name] sees" (RESUME-FEEDBACK-PREVIEW-1).
// It takes the words-only shape from studentFeedback (src/lib/documents/studentFeedbackModel.js)
// and nothing else. Its styles are its own (resumeFeedbackCard.css): white paper with dark ink
// pinned beside it, the same in both apps and both themes (a colour pair travels together).
import { shortDay } from '../../lib/documents/documentChecklist'
import './resumeFeedbackCard.css'

const LEVEL_TONE = { strong: 'ok', solid: 'ok', developing: 'warn', needs_work: 'warn' }
const READINESS_TONE = { 'Highly Competitive': 'ok', Competitive: 'soft', 'Needs Improvement': 'warn' }
const CHECKLIST = [['before_submitting', 'Before you apply'], ['consider_adding', 'Consider adding'], ['do_not_include', 'Leave out'], ['interview_prep', 'For your interview']]

const Chip = ({ tone = 'soft', children }) => <span className={`rfc-chip rfc-chip-${tone}`}>{children}</span>

export default function ResumeFeedbackCard({ fb, headingLevel = 3 }) {
  if (!fb) return null
  const H = `h${headingLevel}`
  const H2 = `h${Math.min(6, headingLevel + 1)}`
  return (
    <section className="rfc" aria-labelledby="rfc-title">
      <H id="rfc-title" className="rfc-title">Résumé Feedback</H>
      <p className="rfc-muted rfc-when">
        Shared {shortDay(fb.shared_at) || 'when sent'}{fb.previous_shared_at ? ` · changes are since ${shortDay(fb.previous_shared_at)}` : ''}
      </p>

      <div className="rfc-ready">
        <Chip tone={READINESS_TONE[fb.readiness] || 'soft'}>{fb.readiness}</Chip>
        {fb.readiness_was && <span className="rfc-muted">was {fb.readiness_was}</span>}
        {fb.meaning && <p>{fb.meaning}</p>}
        {fb.next && <p className="rfc-muted">{fb.next}</p>}
      </div>

      {fb.strengths.length > 0 && (
        <>
          <H2 className="rfc-h">What is working</H2>
          <ul className="rfc-list">{fb.strengths.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </>
      )}

      <H2 className="rfc-h">Your six areas</H2>
      <ul className="rfc-areas">
        {fb.areas.map(a => (
          <li key={a.key}>
            <div className="rfc-area-head">
              <b>{a.label}</b>
              <span className="rfc-level">
                {a.was && <span className={`rfc-was rfc-${a.direction}`}>{a.was} →</span>}
                <Chip tone={LEVEL_TONE[a.levelKey] || 'soft'}>{a.level}</Chip>
              </span>
            </div>
            {a.note && <p className="rfc-muted">{a.note}</p>}
          </li>
        ))}
      </ul>

      {fb.priorities.length > 0 && (
        <>
          <H2 className="rfc-h">Start here</H2>
          <ol className="rfc-list">{fb.priorities.map((t, i) => <li key={i}>{t}</li>)}</ol>
        </>
      )}
      {fb.missing.length > 0 && (
        <p className="rfc-notice">Please add to your résumé: {fb.missing.join(', ')}. Your ASPIRE team will never fill these in for you.</p>
      )}

      {fb.bullets.length > 0 && (
        <details className="rfc-more">
          <summary>Rewritten bullets you can adapt ({fb.bullets.length})</summary>
          <ul className="rfc-bullets">
            {fb.bullets.map((b, i) => (
              <li key={i}>
                {b.original && <span className="rfc-orig"><span className="rfc-sr">Your line: </span>{b.original}</span>}
                <span><span className="rfc-sr">Try: </span>{b.rewrite}</span>
              </li>
            ))}
          </ul>
          <p className="rfc-muted">Anything in [brackets] is a detail only you can fill in, such as your unit or hours.</p>
        </details>
      )}
      {fb.sections.length > 0 && (
        <details className="rfc-more">
          <summary>Section by section</summary>
          <ul className="rfc-list">{fb.sections.map((x, i) => <li key={i}><b>{x.section}.</b> {x.comment}</li>)}</ul>
        </details>
      )}
      {fb.keywords.length > 0 && (
        <details className="rfc-more">
          <summary>Words to weave in</summary>
          <p className="rfc-keys">{fb.keywords.map(k => <Chip key={k}>{k}</Chip>)}</p>
        </details>
      )}
      {fb.recruiter && (
        <details className="rfc-more">
          <summary>What a recruiter notices first</summary>
          <p>{fb.recruiter}</p>
        </details>
      )}
      {CHECKLIST.some(([k]) => fb.checklist[k].length) && (
        <details className="rfc-more">
          <summary>Checklist</summary>
          {CHECKLIST.filter(([k]) => fb.checklist[k].length).map(([k, label]) => (
            <div key={k}><p className="rfc-h5">{label}</p><ul className="rfc-list">{fb.checklist[k].map((t, i) => <li key={i}>{t}</li>)}</ul></div>
          ))}
        </details>
      )}
      <p className="rfc-muted rfc-foot">Upload your next version under Application Documents whenever it is ready, and your ASPIRE team will review it again.</p>
    </section>
  )
}

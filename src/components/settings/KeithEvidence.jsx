// KEITH-KNOWLEDGE-SELFCHECK-1 Phase 2: why Keith suggested this. Shown on a revision Keith proposed
// (KnowledgeRevisionPanel) and on a Draft he wrote (KnowledgeEntryDrawer), from the evidence the
// check stored with it: the reason, how sure he was, the app changes (each linked to its commit on
// GitHub) and the unanswered questions behind it. The Keith mark opens the provenance card, as it does
// on every other Keith output.
import KeithMark from '../keith/KeithMark'
import { fmtDate } from './knowledgeCategories'

const COMMIT_URL = 'https://github.com/jesterlloyd/aspire-tracker/commit/'
const CONFIDENCE_LABEL = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' }

const label = {
  fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4,
  color: 'var(--text-caption, #6b7280)', margin: '10px 0 4px',
}

export default function KeithEvidence({ evidence, kind = 'edit' }) {
  if (!evidence || typeof evidence !== 'object') return null
  const changes = Array.isArray(evidence.changes) ? evidence.changes : []
  const questions = Array.isArray(evidence.questions) ? evidence.questions : []
  return (
    <div
      data-testid="keith-evidence"
      style={{
        border: '1px solid var(--color-border-default, #e5e7eb)', borderRadius: 'var(--aspire-radius-control)',
        padding: '12px 14px', margin: '0 0 14px', background: 'var(--color-bg-surface, #ffffff)',
        fontSize: 13, lineHeight: 1.5, color: 'var(--text-heading, #1f2937)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong>{kind === 'draft' ? 'Keith wrote this Draft' : 'Keith suggested this edit'}</strong>
        {evidence.provenance_id ? <KeithMark provenanceId={evidence.provenance_id} /> : null}
        {CONFIDENCE_LABEL[evidence.confidence] ? (
          <span style={{ fontSize: 12, color: 'var(--text-caption, #6b7280)' }}>{CONFIDENCE_LABEL[evidence.confidence]}</span>
        ) : null}
      </div>
      {evidence.reason ? <div style={{ marginTop: 6 }}>{evidence.reason}</div> : null}

      {changes.length > 0 && (
        <>
          <div style={label}>App changes</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {changes.map(c => (
              <li key={c.sha}>
                <a href={`${COMMIT_URL}${c.sha}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent-primary, #1D2567)' }}>
                  {c.sha}
                </a>
                {c.date ? ` · ${fmtDate(c.date)}` : ''} · {c.subject}
              </li>
            ))}
          </ul>
        </>
      )}

      {questions.length > 0 && (
        <>
          <div style={label}>Questions Keith could not answer</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {questions.map((q, i) => <li key={i}>“{q.text}”{q.asked ? ` · ${fmtDate(q.asked)}` : ''}</li>)}
          </ul>
        </>
      )}

      <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-caption, #6b7280)' }}>
        {kind === 'draft'
          ? 'Nothing here is live. Edit it, fill any “Owner to confirm” notes, then activate it, or archive it.'
          : 'Nothing here is live. Apply it, edit it first, or discard it.'}
      </div>
    </div>
  )
}

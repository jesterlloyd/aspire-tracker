// RESIDENCY-PORTAL-2b: the roster's preceptor feedback indicator. It says only
// that feedback is on file (or, for the ASPIRE team, that someone asked to see
// it). Reading it happens in the applicant drawer, by request.
import { MessageSquareText } from 'lucide-react'

function feedbackIndicator(entry) {
  if (!entry) return null
  if ((entry.requests || []).some(r => r.status === 'pending')) return 'requested'
  if (entry.available || entry.count > 0) return 'available'
  return null
}

export default function PreceptorFeedbackChip({ entry }) {
  const kind = feedbackIndicator(entry)
  if (!kind) return null
  const requested = kind === 'requested'
  return (
    <span
      title={requested ? 'Talent Acquisition asked to view the preceptor feedback' : 'Preceptor feedback is on file'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3, verticalAlign: 'top',
        fontSize: 9, fontWeight: 700, borderRadius: 999, padding: '1px 6px', marginTop: 2, marginLeft: 4,
        color: requested ? '#8A5A00' : '#1D2567',
        background: requested ? '#FFF4DB' : '#E8EAF4',
      }}
    >
      <MessageSquareText size={10} aria-hidden="true" />
      {requested ? 'Feedback requested' : 'Preceptor feedback'}
    </span>
  )
}

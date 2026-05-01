const fmt = ts => {
  try {
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })
  } catch { return ts }
}

export default function PendingSubmissions({ submissions, onApprove, onReject }) {
  if (!submissions.length) return null

  return (
    <div className="pending-submissions">
      <div className="ps-header">
        <span className="ps-title">Pending Unit Submissions</span>
        <span className="ps-count">{submissions.length} awaiting review</span>
      </div>

      <div className="ps-list">
        {submissions.map(sub => (
          <div key={sub.id} className="ps-item">
            <div className="ps-item-top">
              <span className="ps-unit-name">{sub.unit_name}</span>
              <span className="ps-timestamp">{fmt(sub.submitted_at)}</span>
            </div>

            <div className="ps-contact">
              <span>{sub.contact_person}</span>
              <span className="ps-dot">·</span>
              <a href={`mailto:${sub.contact_email}`}>{sub.contact_email}</a>
            </div>

            <div className="ps-details">
              {sub.is_participating ? (
                <>
                  <span className="ps-chip ps-chip-yes">Participating</span>
                  <span className="ps-chip">{sub.total_slots} slot{sub.total_slots !== 1 ? 's' : ''}</span>
                  {sub.shift_preference && <span className="ps-chip">{sub.shift_preference}</span>}
                  {sub.preceptors && (
                    <div className="ps-detail-row">
                      <strong>Preceptors:</strong> {sub.preceptors}
                    </div>
                  )}
                  {sub.considerations && (
                    <div className="ps-detail-row">
                      <strong>Considerations:</strong> {sub.considerations}
                    </div>
                  )}
                </>
              ) : (
                <span className="ps-chip ps-chip-no">Not participating this cycle</span>
              )}
            </div>

            <div className="ps-actions">
              {sub.is_participating && (
                <button className="ps-btn ps-btn-approve" onClick={() => onApprove(sub)}>
                  ✓ Approve &amp; Add to Board
                </button>
              )}
              <button className="ps-btn ps-btn-reject" onClick={() => onReject(sub)}>
                ✕ Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

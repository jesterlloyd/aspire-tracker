const fmt = ts => {
  try {
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })
  } catch { return ts }
}

export default function PendingStudentSubmissions({ submissions, onApprove, onReject }) {
  if (!submissions.length) return null

  return (
    <div className="pending-submissions" style={{ marginBottom: 20 }}>
      <div className="ps-header">
        <span className="ps-title">Pending Student Submissions</span>
        <span className="ps-count">{submissions.length} awaiting review</span>
      </div>

      <div className="ps-list">
        {submissions.map(sub => (
          <div key={sub.id} className="ps-item">
            <div className="ps-item-top">
              <span className="ps-unit-name">{sub.student_name}</span>
              <span className="ps-timestamp">{fmt(sub.submitted_at)}</span>
            </div>

            <div className="ps-contact">
              <span>{sub.student_email}</span>
              {sub.student_phone && <><span className="ps-dot">·</span><span>{sub.student_phone}</span></>}
            </div>

            <div className="ps-details">
              <span className="ps-chip">{sub.school}</span>
              {sub.program_type && <span className="ps-chip">{sub.program_type}</span>}
              {sub.term_dates   && <span className="ps-chip">{sub.term_dates}</span>}
              {sub.hours_required > 0 && <span className="ps-chip">{sub.hours_required} hrs</span>}
              <div className="ps-detail-row">
                <strong>Coordinator:</strong> {sub.coordinator_name}
                {sub.coordinator_email && ` · ${sub.coordinator_email}`}
              </div>
              {sub.notes && (
                <div className="ps-detail-row"><strong>Notes:</strong> {sub.notes}</div>
              )}
            </div>

            <div className="ps-actions">
              <button className="ps-btn ps-btn-approve" onClick={() => onApprove(sub)}>
                ✓ Approve &amp; Add Student
              </button>
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

import { useState } from 'react'

const fmt = ts => {
  try {
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })
  } catch { return ts }
}

function IntakeCard({ sub, onApprove, onReject }) {
  const [showSSN, setShowSSN] = useState(false)

  return (
    <div className="ps-item">
      <div className="ps-item-top">
        <span className="ps-unit-name">{sub.first_name} {sub.last_name}</span>
        <span className="ps-timestamp">{fmt(sub.submitted_at)}</span>
      </div>

      <div className="ps-contact">
        <span>{sub.personal_email}</span>
        {sub.phone && <><span className="ps-dot">·</span><span>{sub.phone}</span></>}
      </div>

      <div className="ps-details">
        {sub.gender       && <span className="ps-chip">{sub.gender}</span>}
        {sub.date_of_birth && <span className="ps-chip">DOB: {sub.date_of_birth}</span>}

        <span className="ps-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          SSN Last 4: {showSSN ? sub.ssn_last4 : '••••'}
          <button
            type="button"
            onClick={() => setShowSSN(p => !p)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 11, color: 'var(--nightfall)', fontWeight: 700, padding: 0,
            }}
          >
            {showSSN ? 'Hide' : 'Show'}
          </button>
        </span>

        {sub.prior_healthcare_experience && (
          <div className="ps-detail-row">
            <strong>Healthcare Experience:</strong> {sub.prior_healthcare_experience}
          </div>
        )}
        {sub.cs_affiliation && (
          <div className="ps-detail-row">
            <strong>CS Affiliation:</strong> {sub.cs_affiliation}
            {sub.cs_department && ` — ${sub.cs_department}`}
            {sub.cs_role && ` (${sub.cs_role})`}
          </div>
        )}
        {(sub.unit_preference_1 || sub.unit_preference_2 || sub.unit_preference_3) && (
          <div className="ps-detail-row">
            <strong>Unit Preferences:</strong>{' '}
            {[sub.unit_preference_1, sub.unit_preference_2, sub.unit_preference_3]
              .filter(Boolean).join(' › ')}
          </div>
        )}
        {sub.additional_notes && (
          <div className="ps-detail-row">
            <strong>Notes:</strong> {sub.additional_notes}
          </div>
        )}
      </div>

      <div className="ps-actions">
        <button className="ps-btn ps-btn-approve" onClick={() => onApprove(sub)}>
          ✓ Approve &amp; Add to Student List
        </button>
        <button className="ps-btn ps-btn-reject" onClick={() => onReject(sub)}>
          ✕ Reject
        </button>
      </div>
    </div>
  )
}

export default function PendingIntakeSubmissions({ submissions, onApprove, onReject }) {
  const [collapsed, setCollapsed] = useState(false)
  if (!submissions.length) return null

  return (
    <div className="pending-submissions" style={{ marginBottom: 20 }}>
      <div className="ps-header"
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setCollapsed(p => !p)}
      >
        <span className="ps-title">Pending Student Intake Submissions</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="ps-count">{submissions.length} awaiting review</span>
          <span style={{ color: 'var(--nightfall)', fontSize: 13, fontWeight: 700 }}>
            {collapsed ? '▸' : '▾'}
          </span>
        </div>
      </div>

      {!collapsed && (
        <div className="ps-list">
          {submissions.map(sub => (
            <IntakeCard key={sub.id} sub={sub} onApprove={onApprove} onReject={onReject} />
          ))}
        </div>
      )}
    </div>
  )
}

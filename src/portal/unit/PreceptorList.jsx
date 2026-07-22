// src/portal/unit/PreceptorList.jsx
//
// UL-PORTAL: renders every ACTIVE preceptor assignment for a student, stacked compactly.
//
// One source of truth for how Primary, Secondary, and Coverage assignments are shown, so
// the roster table and the detail drawer cannot drift. The data is the canonical
// student_preceptor_assignments set (already ordered Primary, Secondary, Coverage server
// side, ended assignments excluded). Each entry shows the preceptor name, a role pill, and
// the assignment dates when present. Falls back to the single legacy preceptor name, then
// the caller's empty marker.
//
// Kept dense on purpose: multiple entries must never make a table row tall.

const ROLE_LABELS = { primary: 'Primary', secondary: 'Secondary', coverage: 'Coverage' }

export default function PreceptorList({ assignments, fallbackName, formatDate, empty = '-' }) {
  const list = Array.isArray(assignments) ? assignments : []
  if (list.length === 0) return <>{fallbackName || empty}</>
  return (
    <span className="ptl-prec-list">
      {list.map((a, i) => (
        <span className="ptl-prec-item" key={`${a.role}:${a.name}:${i}`}>
          <span className="ptl-prec-line">
            <span className="ptl-prec-name">{a.name}</span>
            <span className={`ptl-prec-pill ptl-prec-${a.role}`}>
              {ROLE_LABELS[a.role] || a.role}
            </span>
          </span>
          {a.start_date && (
            <span className="ptl-prec-dates">
              {formatDate ? formatDate(a.start_date) : a.start_date}
              {a.end_date ? ` to ${formatDate ? formatDate(a.end_date) : a.end_date}` : ''}
            </span>
          )}
        </span>
      ))}
    </span>
  )
}

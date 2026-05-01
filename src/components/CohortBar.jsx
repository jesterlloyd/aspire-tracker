const STATUS_CLASS = {
  Planning:  'cs-planning',
  Active:    'cs-active',
  Completed: 'cs-completed',
  Archived:  'cs-archived',
}

export default function CohortBar({
  cohorts,
  activeCohortId,
  onSelect,
  onNew,
  onManage,
}) {
  const active = cohorts.find(c => c.id === activeCohortId)

  return (
    <div className="cohort-bar">
      <div className="cohort-bar-inner">
        <div className="cohort-select-group">
          <span className="cohort-bar-label">Cohort</span>
          <select
            className="cohort-select"
            value={activeCohortId || ''}
            onChange={e => onSelect(e.target.value)}
          >
            {cohorts.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {active && (
            <span className={`cohort-status-badge ${STATUS_CLASS[active.status] || 'cs-archived'}`}>
              {active.status}
            </span>
          )}
          {active?.start_date && active?.end_date && (
            <span className="cohort-dates">
              {active.start_date} – {active.end_date}
            </span>
          )}
        </div>
        <div className="cohort-bar-actions">
          {active && (
            <button className="btn-cohort-outline" onClick={onManage}>
              ⚙ Edit Cohort
            </button>
          )}
          <button className="btn-cohort-primary" onClick={onNew}>
            + New Cohort
          </button>
        </div>
      </div>
    </div>
  )
}

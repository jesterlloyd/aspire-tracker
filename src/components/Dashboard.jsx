export default function Dashboard({ students }) {
  const total        = students.length
  const placedInUnit = students.filter(s => s.matched_unit_id).length
  const accepted     = students.filter(s => s.interview_outcome === 'Accepted').length
  const ngrpHired    = students.filter(s => s.ngrp_outcome === 'Hired').length

  const stats = [
    { label: 'Total Students', value: total,        bg: '#ffffff', color: '#1d2567', border: '#d1d5db', barColor: '#9faff8', leftBorder: '4px solid #1d2567', pct: 100 },
    { label: 'Placed in Unit', value: placedInUnit, bg: '#dceff8', color: '#1d2567', border: '#b8d8eb', barColor: '#1d2567', pct: total ? (placedInUnit / total) * 100 : 0 },
    { label: 'Accepted',       value: accepted,     bg: '#dcfce7', color: '#166534', border: '#a7f3d0', barColor: '#166534', pct: total ? (accepted     / total) * 100 : 0 },
    { label: 'NGRP Hired',     value: ngrpHired,    bg: '#ede9fe', color: '#5b21b6', border: '#ddd6fe', barColor: '#5b21b6', pct: total ? (ngrpHired    / total) * 100 : 0 },
  ]

  const interviewStats = [
    {
      label: 'Pending Interview',
      value: students.filter(s => !s.interview_outcome || s.interview_outcome === 'Pending Interview').length,
      color: '#191919', bg: '#f4f1ec', border: '#d4cfc8',
    },
    {
      label: 'Accepted',
      value: students.filter(s => s.interview_outcome === 'Accepted').length,
      color: '#166534', bg: '#dcfce7', border: '#a7f3d0',
    },
    {
      label: 'Accepted w/ Reservations',
      value: students.filter(s => s.interview_outcome === 'Accepted with Reservations').length,
      color: '#92400e', bg: '#fef3c7', border: '#fde68a',
    },
    {
      label: 'Declined',
      value: students.filter(s => s.interview_outcome === 'Declined').length,
      color: '#991b1b', bg: '#fee2e2', border: '#fecaca',
    },
  ]

  return (
    <>
      <div className="dashboard">
        {stats.map(stat => (
          <div key={stat.label} className="stat-card" style={{
            background: stat.bg,
            borderColor: stat.border,
            ...(stat.leftBorder ? { borderLeft: stat.leftBorder } : {}),
          }}>
            <div className="stat-value" style={{ color: stat.color }}>{stat.value}</div>
            <div className="stat-label" style={{ color: stat.color }}>{stat.label}</div>
            <div className="stat-bar">
              <div className="stat-bar-fill" style={{ width: `${stat.pct}%`, background: stat.barColor }} />
            </div>
            <div className="stat-pct" style={{ color: stat.color, opacity: 0.7 }}>
              {total ? Math.round(stat.pct) : 0}% of total
            </div>
          </div>
        ))}
      </div>

      <div className="interview-breakdown">
        <div className="breakdown-label">Interview Outcomes</div>
        <div className="breakdown-pills">
          {interviewStats.map(s => (
            <div key={s.label} className="breakdown-pill"
              style={{ background: s.bg, borderColor: s.border }}>
              <span className="bp-value" style={{ color: s.color }}>{s.value}</span>
              <span className="bp-label" style={{ color: s.color }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

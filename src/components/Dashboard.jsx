export default function Dashboard({ students }) {
  const total        = students.length
  const placedInUnit = students.filter(s => s.matched_unit_id).length
  const accepted     = students.filter(s => s.interview_outcome === 'Accepted').length
  const ngrpHired    = students.filter(s => s.ngrp_outcome === 'Hired').length

  const stats = [
    { label: 'Total Students', value: total,        cardClass: 'card-pearl',   color: '#1d2567', barColor: '#9faff8', pct: 100 },
    { label: 'Placed in Unit', value: placedInUnit, cardClass: 'card-marina',  color: '#1d2567', barColor: '#1d2567', pct: total ? (placedInUnit / total) * 100 : 0 },
    { label: 'Accepted',       value: accepted,     cardClass: 'card-green',   color: '#166534', barColor: '#166534', pct: total ? (accepted     / total) * 100 : 0 },
    { label: 'NGRP Hired',     value: ngrpHired,    cardClass: 'card-purple',  color: '#5b21b6', barColor: '#5b21b6', pct: total ? (ngrpHired    / total) * 100 : 0 },
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
    <div className="dashboard">
      {stats.map(stat => (
        <div key={stat.label} className={`summary-card ${stat.cardClass}`}>
          <div className="summary-card-value" style={{ color: stat.color }}>{stat.value}</div>
          <div className="summary-card-label" style={{ color: stat.color }}>{stat.label}</div>
          <div className="stat-bar">
            <div className="stat-bar-fill" style={{ width: `${stat.pct}%`, background: stat.barColor }} />
          </div>
          <div className="summary-card-sub" style={{ color: stat.color }}>
            {total ? Math.round(stat.pct) : 0}% of total
          </div>
        </div>
      ))}
    </div>
  )
}

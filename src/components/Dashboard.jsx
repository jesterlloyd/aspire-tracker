export default function Dashboard({ students }) {
  const total = students.length
  const placedInUnit = students.filter(s => s.unit && s.unit.trim() !== '').length
  const accepted = students.filter(s => s.status === 'Accepted').length
  const ngrpHired = students.filter(s => s.ngrp_outcome === 'Hired').length

  const stats = [
    { label: 'Total Students', value: total, color: '#1a3a6b', pct: 100 },
    { label: 'Placed in Unit', value: placedInUnit, color: '#0d9488', pct: total ? (placedInUnit / total) * 100 : 0 },
    { label: 'Accepted', value: accepted, color: '#16a34a', pct: total ? (accepted / total) * 100 : 0 },
    { label: 'NGRP Hired', value: ngrpHired, color: '#7c3aed', pct: total ? (ngrpHired / total) * 100 : 0 },
  ]

  return (
    <div className="dashboard">
      {stats.map(stat => (
        <div key={stat.label} className="stat-card">
          <div className="stat-value" style={{ color: stat.color }}>{stat.value}</div>
          <div className="stat-label">{stat.label}</div>
          <div className="stat-bar">
            <div
              className="stat-bar-fill"
              style={{ width: `${stat.pct}%`, background: stat.color }}
            />
          </div>
          <div className="stat-pct">{total ? Math.round(stat.pct) : 0}% of total</div>
        </div>
      ))}
    </div>
  )
}

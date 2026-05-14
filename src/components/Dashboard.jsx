import StatCard from './StatCard'
import { Users, MapPin, CheckCircle, Briefcase } from 'lucide-react'

export default function Dashboard({ students, activeFilter, onFilterChange }) {
  const totalStudents  = students.length
  const placedCount    = students.filter(s => s.matched_unit_id).length
  const acceptedCount  = students.filter(s => s.status === 'Placed').length
  const ngrpHiredCount = students.filter(s => s.ngrp_outcome === 'Hired').length

  const cards = [
    { key: null,          value: totalStudents,  label: 'Total Students', sublabel: 'all enrolled students',                                                             icon: Users,         colorScheme: 'nightfall' },
    { key: 'matched',     value: placedCount,    label: 'Students Placed', sublabel: `${Math.round((placedCount / totalStudents) * 100) || 0}% of total`,               icon: MapPin,        colorScheme: 'marina'    },
    { key: 'Placed',      value: acceptedCount,  label: 'Placed',          sublabel: `${Math.round((acceptedCount / totalStudents) * 100) || 0}% of total`,             icon: CheckCircle,   colorScheme: 'green'     },
    { key: 'ngrp_hired',  value: ngrpHiredCount, label: 'NGRP Hired',      sublabel: ngrpHiredCount === 0 ? 'no hires recorded' : `${Math.round((ngrpHiredCount / totalStudents) * 100)}% of total`, icon: Briefcase, colorScheme: 'purple' },
  ]

  return (
    <div className="stat-cards-row" style={{ padding: '12px 16px' }}>
      {cards.map(({ key, value, label, sublabel, icon, colorScheme }) => {
        const isActive = activeFilter === key && key !== null
        return (
          <div
            key={String(key)}
            onClick={() => onFilterChange?.(key)}
            style={{
              cursor: 'pointer', position: 'relative',
              outline: isActive ? '2px solid #1D2567' : '2px solid transparent',
              borderRadius: '12px',
              transform: isActive ? 'translateY(-2px)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            <StatCard value={value} label={label} sublabel={sublabel} icon={icon} colorScheme={colorScheme} />
            {isActive && (
              <div style={{ position:'absolute', top:'5px', right:'8px', fontFamily:'DM Sans', fontSize:'9px', color:'#1D2567', fontWeight:700 }}>
                ✕ CLEAR
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

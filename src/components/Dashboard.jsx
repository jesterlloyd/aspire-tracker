import StatCard from './StatCard'
import { Users, MapPin, CheckCircle, Briefcase } from 'lucide-react'

export default function Dashboard({ students }) {
  const totalStudents  = students.length
  const placedCount    = students.filter(s => s.matched_unit_id).length
  const acceptedCount  = students.filter(s => s.interview_outcome === 'Accepted').length
  const ngrpHiredCount = students.filter(s => s.ngrp_outcome === 'Hired').length

  return (
    <div className="stat-cards-row" style={{ padding:'12px 16px' }}>
      <StatCard
        value={totalStudents}
        label="Total Students"
        sublabel="100% of total"
        icon={Users}
        colorScheme="nightfall"
      />
      <StatCard
        value={placedCount}
        label="Placed in Unit"
        sublabel={`${Math.round((placedCount / totalStudents) * 100) || 0}% of total`}
        icon={MapPin}
        colorScheme="marina"
      />
      <StatCard
        value={acceptedCount}
        label="Accepted"
        sublabel={`${Math.round((acceptedCount / totalStudents) * 100) || 0}% of total`}
        icon={CheckCircle}
        colorScheme="green"
      />
      <StatCard
        value={ngrpHiredCount}
        label="NGRP Hired"
        sublabel={`${Math.round((ngrpHiredCount / totalStudents) * 100) || 0}% of total`}
        icon={Briefcase}
        colorScheme="purple"
      />
    </div>
  )
}

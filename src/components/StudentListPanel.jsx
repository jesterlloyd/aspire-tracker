// StudentListPanel — renders either a 4-column row list or a photo tile grid.
// Controls (search, sort, import, etc.) live in the parent StudentProfilesTab.

import { useState } from 'react'
import StudentAvatar from './StudentAvatar'
import ImportStudentsCSV from './ImportStudentsCSV'
import { getCsLinkStatus, CS_LINK_STATUS_CONFIG } from '../lib/utils'
import { ASPIRE_STATUS_CONFIG } from '../lib/constants'
import EmptyState from './EmptyState'
import { Users, Eye } from 'lucide-react'
import { calculateProfileCompletion } from '../lib/profileCompletion'
import { useAuth } from '../contexts/AuthContext'
import { useUnreadStudents } from '../hooks/useUnreadStudents'
import { Copy, Check } from 'lucide-react'

// ── Small chip ────────────────────────────────────────────────────────────────
function Chip({ label, bg, color, border }) {
  return (
    <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:10, whiteSpace:'nowrap',
      background:bg, color, border:border?`1px solid ${border}`:'none' }}>{label}</span>
  )
}

// ── Email copy button ─────────────────────────────────────────────────────────
function EmailCopyBtn({ email }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(email).then(()=>{ setCopied(true); setTimeout(()=>setCopied(false),2000) }) }}
      title={copied?'Copied!':'Copy email'}
      style={{ background:copied?'#EEF7F0':'none', border:'none', cursor:'pointer', padding:'1px 3px', borderRadius:3, color:copied?'#2F7D5C':'var(--text-muted,#9ca3af)', display:'inline-flex', alignItems:'center', transition:'all 0.15s', flexShrink:0 }}>
      {copied ? <Check size={10} /> : <Copy size={10} />}
    </button>
  )
}

// ── Progress bar color ────────────────────────────────────────────────────────
function barColor(pct) {
  if (pct >= 100) return 'var(--color-status-success,#166534)'
  if (pct >= 67)  return 'var(--color-status-warning,#f59e0b)'
  return '#E2569C'
}

// ── School shorthand ──────────────────────────────────────────────────────────
const SCHOOL_SHORT = {
  'Cal State Long Beach': 'Cal State LB',
  'California State University Long Beach': 'Cal State LB',
  'California State University, Long Beach': 'Cal State LB',
  'Cal State Northridge': 'Cal State NR',
  'California State University Northridge': 'Cal State NR',
  'West Coast University Anaheim': 'WCU Anaheim',
  'West Coast University North Hollywood': 'WCU NoHo',
  'Azusa Pacific University': 'APU',
}
function shortSchool(school) {
  if (!school) return '—'
  return SCHOOL_SHORT[school] || (school.length > 18 ? school.slice(0,16) + '…' : school)
}

// ── Status short labels ───────────────────────────────────────────────────────
const STATUS_SHORT = {
  'Pending Outreach': 'Outreach',
  'Form Sent': 'Form Sent',
  'Form Received': 'Form Received',
  'Interview Scheduled': 'Interview',
  'Interviewed': 'Interviewed',
  'Placed': 'Placed',
  'Active Rotation': 'In Rotation',
  'Completed': 'Completed',
  'Declined': 'Declined',
}

// ── Grid tile ─────────────────────────────────────────────────────────────────
function GridTile({ student, isSelected, onSelect, units }) {
  const [hovered, setHovered] = useState(false)
  const completion = calculateProfileCompletion(student)
  const pct = completion.percentage
  const badgeBg = pct >= 100 ? '#16a34a' : pct >= 67 ? '#f59e0b' : '#E2569C'
  const shortName = `${student.first_name || ''} ${(student.last_name||'')[0] || ''}.`.trim()
  const sChip = student.status ? (ASPIRE_STATUS_CONFIG[student.status] || ASPIRE_STATUS_CONFIG['Pending Outreach']) : null

  return (
    <div
      onClick={() => onSelect(student.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display:'flex', flexDirection:'column', alignItems:'center', padding:'16px 10px 12px',
        borderRadius:12, background:'var(--bg-card,#fff)',
        border: isSelected ? '2px solid var(--color-accent-primary,#1D2567)' : '1px solid var(--border-card,rgba(29,37,103,0.08))',
        cursor:'pointer', transition:'all 0.15s ease',
        transform: isSelected ? 'scale(1.04)' : hovered ? 'translateY(-3px)' : 'none',
        boxShadow: isSelected ? '0 4px 16px rgba(29,37,103,0.18)' : hovered ? '0 4px 12px rgba(0,0,0,0.10)' : '0 1px 3px rgba(0,0,0,0.05)',
      }}
    >
      {/* Avatar with completion badge */}
      <div style={{ position:'relative', marginBottom:8 }}>
        <StudentAvatar student={student} size={72}
          style={{
            border: isSelected ? '3px solid var(--color-accent-primary,#1D2567)' : '3px solid var(--pearl,#fff)',
            boxShadow: '0 2px 8px rgba(29,37,103,0.12)',
          }} />
        <span style={{
          position:'absolute', bottom:-2, right:-2,
          background:badgeBg, color:'#fff',
          fontSize:9, fontWeight:800, padding:'1px 5px', borderRadius:8, lineHeight:1.4,
          boxShadow:'0 1px 3px rgba(0,0,0,0.2)',
        }}>{pct}%</span>
      </div>
      {/* Short name */}
      <div style={{ fontSize:12, fontWeight:700, color:'var(--text-heading,#191919)', textAlign:'center', maxWidth:128, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', lineHeight:1.3, marginBottom:2 }}>
        {shortName}
      </div>
      {/* School */}
      <div style={{ fontSize:10.5, color:'var(--text-muted,#9ca3af)', textAlign:'center', maxWidth:128, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:5 }}>
        {shortSchool(student.school)}
      </div>
      {/* Status pill */}
      {sChip && (
        <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:10, background:sChip.bg, color:sChip.text, border:`1px solid ${sChip.border}`, whiteSpace:'nowrap' }}>
          {STATUS_SHORT[student.status] || student.status}
        </span>
      )}
    </div>
  )
}

export default function StudentListPanel({
  students, allStudents, selectedStudentId, onSelect,
  cohortId, onRefresh, onExportCSV, onAddStudent,
  units = [],
  viewMode = 'list', // 'list' | 'grid'
  showImportButton = false,
}) {
  const { canEdit } = useAuth()
  const [showImport, setShowImport] = useState(false)
  const { data: unreadData } = useUnreadStudents(cohortId)
  const unreadIds = unreadData?.unreadStudentIds || new Set()

  if (students.length === 0) {
    return (
      <EmptyState compact icon={<Users />}
        heading={allStudents.length === 0 ? 'No students in this cohort' : 'No students match the current filters'}
        subtext={allStudents.length === 0
          ? 'Students are added when school coordinators submit the school form.'
          : 'Try a different search term or clear the active filter.'} />
    )
  }

  // ── Grid View ──────────────────────────────────────────────────────────────
  if (viewMode === 'grid') {
    return (
      <>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(140px, 1fr))', gap:'16px 12px', padding:'16px 16px 8px' }}>
          {students.map(s => (
            <GridTile key={s.id} student={s} isSelected={s.id === selectedStudentId} onSelect={onSelect} units={units} />
          ))}
        </div>
        {showImport && <ImportStudentsCSV cohortId={cohortId} onImported={onRefresh} onClose={() => setShowImport(false)} />}
      </>
    )
  }

  // ── List View (always 4-column — always in split/compressed mode) ──────────
  return (
    <>
      <div className="pl-list">
        {students.map(s => {
          const name     = `${s.last_name||''}${s.last_name&&s.first_name?', ':''}${s.first_name||''}` || s.name || '—'
          const csKey    = getCsLinkStatus(s)
          const acc      = CS_LINK_STATUS_CONFIG[csKey]
          const sel      = s.id === selectedStudentId
          const isUnread = unreadIds.has(s.id)
          const email    = s.personal_email || s.school_email || null

          const gpaVal   = parseFloat(s.cumulative_gpa)
          const gpaOk    = !isNaN(gpaVal) && gpaVal > 0
          const gpaBg    = gpaOk && gpaVal >= 3.5 ? '#dcfce7' : gpaOk && gpaVal >= 3.0 ? '#fef3c7' : 'var(--color-bg-elevated,#f3f4f6)'
          const gpaColor = gpaOk && gpaVal >= 3.5 ? '#166534' : gpaOk && gpaVal >= 3.0 ? '#92400e' : 'var(--text-muted,#6b7280)'

          const sChip = s.status ? (ASPIRE_STATUS_CONFIG[s.status] || ASPIRE_STATUS_CONFIG['Pending Outreach']) : null

          const matchedUnit = s.matched_unit_id ? units.find(u => u.id === s.matched_unit_id) : null
          const isPlaced    = !!matchedUnit
          const mqLabel     = s.match_quality === '1st' ? '1st choice' : s.match_quality === '2nd' ? '2nd choice' : s.match_quality === '3rd' ? '3rd choice' : s.match_quality ? 'Other unit' : null
          const mqBg    = s.match_quality === '1st' ? '#dcfce7' : s.match_quality === '2nd' ? '#fef3c7' : '#f3f4f6'
          const mqColor = s.match_quality === '1st' ? '#166534' : s.match_quality === '2nd' ? '#92400e' : '#6b7280'
          const prefs   = [s.unit_preference_1, s.unit_preference_2, s.unit_preference_3].filter(Boolean)

          return (
            <div key={s.id}
              className={`pl-row${sel ? ' pl-selected' : ''}`}
              style={{ alignItems:'flex-start', padding:'11px 14px', display:'grid', gridTemplateColumns:'38% 24% 28% 10%', gap:6 }}
              onClick={() => onSelect(s.id)}>

              {/* COL 1: identity (48px avatar) */}
              <div style={{ display:'flex', gap:9, minWidth:0, alignItems:'flex-start' }}>
                <StudentAvatar student={s} size={48} style={{ flexShrink:0, marginTop:1 }} />
                <div style={{ minWidth:0, flex:1 }}>
                  <div style={{ fontWeight:isUnread?800:700, fontSize:13, color:'var(--text-heading,#191919)', display:'flex', alignItems:'center', gap:4, lineHeight:1.2 }}>
                    <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={name}>{name}</span>
                    {isUnread && <span style={{ width:6, height:6, borderRadius:'50%', flexShrink:0, background:'var(--cs-red,#DC1E34)', display:'inline-block' }} />}
                  </div>
                  <div style={{ fontSize:10.5, color:'var(--text-caption,#6b7280)', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {s.school || '—'}{s.program_type ? ` · ${s.program_type}` : ''}
                  </div>
                  {email && (
                    <div style={{ display:'flex', alignItems:'center', gap:3, marginTop:2 }}>
                      <span style={{ fontSize:10, color:'var(--text-muted,#9ca3af)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', minWidth:0 }}>{email}</span>
                      <EmailCopyBtn email={email} />
                    </div>
                  )}
                </div>
              </div>

              {/* COL 3: preferences or placement */}
              <div style={{ minWidth:0, paddingTop:3 }}>
                {isPlaced ? (
                  <>
                    <div style={{ fontSize:11, fontWeight:700, color:'var(--text-heading,#191919)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {matchedUnit.unit_name}
                    </div>
                    {mqLabel && <Chip label={mqLabel} bg={mqBg} color={mqColor} />}
                  </>
                ) : prefs.length > 0 ? (
                  <div style={{ display:'flex', flexDirection:'column', gap:1 }}>
                    {prefs.slice(0,3).map((p, i) => (
                      <div key={i} style={{ display:'flex', gap:3, alignItems:'baseline' }}>
                        <span style={{ fontSize:8, fontWeight:700, color:'var(--text-muted,#9ca3af)', width:16, flexShrink:0 }}>{['1st','2nd','3rd'][i]}</span>
                        <span style={{ fontSize:10.5, fontWeight:600, color:'var(--text-heading,#191919)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span style={{ fontSize:9.5, color:'var(--text-muted,#9ca3af)', fontStyle:'italic' }}>No preferences</span>
                )}
              </div>

              {/* COL 4: chips */}
              <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:3, paddingTop:3, minWidth:0 }}>
                {gpaOk && <Chip label={`GPA ${gpaVal.toFixed(2)}`} bg={gpaBg} color={gpaColor} />}
                {sChip && <Chip label={s.status} bg={sChip.bg} color={sChip.text} border={sChip.border} />}
                <Chip label={acc.label} bg={acc.bg} color={acc.text} />
              </div>

              {/* COL 5: eye */}
              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'center', paddingTop:3 }}>
                <button onClick={e => { e.stopPropagation(); onSelect(s.id) }} title="View profile"
                  style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted,#9ca3af)', display:'flex', alignItems:'center', padding:2 }}
                  onMouseEnter={e => e.currentTarget.style.color='var(--color-accent-primary,#1D2567)'}
                  onMouseLeave={e => e.currentTarget.style.color='var(--text-muted,#9ca3af)'}>
                  <Eye size={14} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
      {showImport && <ImportStudentsCSV cohortId={cohortId} onImported={onRefresh} onClose={() => setShowImport(false)} />}
    </>
  )
}

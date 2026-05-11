import { useState, useRef, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { displayName } from '../lib/utils'
import { ASPIRE_STATUS_CONFIG } from '../lib/constants'
import { TAB_BADGES } from '../lib/brand'

const COHORT_STATUS_COLORS = {
  Planning:  { bg:'#dbeafe', color:'#1d4ed8' },
  Active:    { bg:'#dcfce7', color:'#166534' },
  Completed: { bg:'#f3f4f6', color:'#6b7280' },
  Archived:  { bg:'#f3f4f6', color:'#9ca3af' },
}

function formatCohortDateShort(dateInput) {
  if (!dateInput) return ''
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateInput)) {
    const [y, m, d] = dateInput.split('T')[0].split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month:'short', day:'numeric' })
  }
  if (typeof dateInput === 'string') {
    const parsed = new Date(dateInput)
    if (!isNaN(parsed.getTime())) return parsed.toLocaleDateString('en-US', { month:'short', day:'numeric' })
    return dateInput.replace(/,?\s*\d{4}/, '').trim()
  }
  return ''
}
function formatCohortDateRange(startDate, endDate) {
  if (!startDate && !endDate) return ''
  if (!endDate) return formatCohortDateShort(startDate)
  return `${formatCohortDateShort(startDate)} – ${formatCohortDateShort(endDate)}`
}

// Inline SVG tab icons (no external dependency)
function IconBarChart() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
}
function IconUsers() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
}
function IconCalendar() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><polyline points="9 16 11 18 15 14"/></svg>
}
function IconNetwork() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><line x1="12" y1="7" x2="5" y2="17"/><line x1="12" y1="7" x2="19" y2="17"/></svg>
}
function ChevronDown() {
  return <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
}
function SearchIcon({ opacity = 0.5 }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={`rgba(255,255,255,${opacity})`} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
}

const TABS = [
  { id:'overview',   label:'Aggregate',       badge:'#1d2567', Icon:IconBarChart },
  { id:'profiles',   label:'Student Profiles',badge:'#7c3aed', Icon:IconUsers },
  { id:'interviews', label:'Interview Rubric', badge:'#0d9488', Icon:IconCalendar },
  { id:'matching',   label:'Embed',            badge:'#ea6c1a', Icon:IconNetwork },
]

export default function UnifiedNav({
  cohorts, activeCohortId, activeCohort, activeTab, ivSessions = [],
  onSelectCohort, onNewCohort, onEditCohort, onSwitchTab,
  students = [], units = [], matches = [], cohortId,
  onSelectStudent, onSelectUnit,
}) {
  const [cohortOpen,   setCohortOpen]   = useState(false)
  const [query,        setQuery]        = useState('')
  const [results,      setResults]      = useState({ students:[], units:[], placements:[] })
  const [searching,    setSearching]    = useState(false)
  const [searchOpen,   setSearchOpen]   = useState(false)
  const [activeIdx,    setActiveIdx]    = useState(-1)
  const [inputFocused, setInputFocused] = useState(false)
  const [isNarrow,     setIsNarrow]     = useState(window.innerWidth < 1024)
  const cohortRef  = useRef(null)
  const searchRef  = useRef(null)
  const inputRef   = useRef(null)
  const searchTimer = useRef(null)

  useEffect(() => {
    const handler = e => {
      if (cohortRef.current && !cohortRef.current.contains(e.target)) setCohortOpen(false)
      if (searchRef.current && !searchRef.current.contains(e.target)) { setSearchOpen(false); setActiveIdx(-1) }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    const handler = () => setIsNarrow(window.innerWidth < 1024)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  const sortedCohorts = [...cohorts].sort((a, b) => {
    const da = a.start_date || null, db = b.start_date || null
    if (!da && !db) return (a.created_at||'').localeCompare(b.created_at||'')
    if (!da) return 1; if (!db) return -1
    return da.localeCompare(db)
  })

  const irBadge = ivSessions.filter(s => s.self_scheduled && !s.teams_meeting_booked).length

  const runSearch = useCallback(async q => {
    if (!cohortId || q.length < 2) { setResults({ students:[], units:[], placements:[] }); setSearchOpen(false); return }
    setSearching(true); setSearchOpen(true)
    const [stuRes, unitRes] = await Promise.all([
      supabase.from('students').select('id, first_name, last_name, school, school_email, status, headshot_url')
        .eq('cohort_id', cohortId).or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,school_email.ilike.%${q}%,personal_email.ilike.%${q}%,phone.ilike.%${q}%,school.ilike.%${q}%`).limit(6),
      supabase.from('units').select('id, unit_name, division, contact_person, slots_remaining, total_slots')
        .eq('cohort_id', cohortId).or(`unit_name.ilike.%${q}%,contact_person.ilike.%${q}%`).limit(6),
    ])
    const ql = q.toLowerCase()
    const placements = students.filter(s => {
      if (!s.matched_unit_id) return false
      const u = units.find(u => u.id === s.matched_unit_id)
      return `${s.last_name} ${s.first_name}`.toLowerCase().includes(ql) || (u?.unit_name||'').toLowerCase().includes(ql)
    }).map(s => ({ student: s, unit: units.find(u => u.id === s.matched_unit_id) })).slice(0, 5)
    setResults({ students: stuRes.data||[], units: unitRes.data||[], placements })
    setSearching(false); setActiveIdx(-1)
  }, [cohortId, students, units])

  const handleQueryChange = e => {
    const q = e.target.value; setQuery(q)
    clearTimeout(searchTimer.current)
    if (q.length < 2) { setResults({ students:[], units:[], placements:[] }); setSearchOpen(false); return }
    searchTimer.current = setTimeout(() => runSearch(q), 300)
  }

  const flatResults = [
    ...results.students.map(s => ({ type:'student', data:s })),
    ...results.units.map(u => ({ type:'unit', data:u })),
    ...results.placements.map(p => ({ type:'placement', data:p })),
  ]

  const handleResultClick = item => {
    setSearchOpen(false); setQuery(''); setActiveIdx(-1)
    if (item.type === 'student')   { onSwitchTab('profiles'); onSelectStudent?.(item.data.id) }
    else if (item.type === 'unit') { onSwitchTab('matching'); onSelectUnit?.(item.data.id) }
    else if (item.type === 'placement') { onSwitchTab('matching'); onSelectUnit?.(item.data.unit?.id) }
  }

  const handleKeyDown = e => {
    if (!searchOpen) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i+1, flatResults.length-1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i-1, 0)) }
    else if (e.key === 'Enter' && activeIdx >= 0) { handleResultClick(flatResults[activeIdx]) }
    else if (e.key === 'Escape') { setSearchOpen(false); setQuery(''); inputRef.current?.blur() }
  }

  const CMD_BG = '#191919'

  return (
    <nav style={{
      height:52, background:CMD_BG, borderBottom:'1px solid rgba(255,255,255,0.06)',
      padding:'0 16px', display:'flex', alignItems:'center', gap:8,
    }}>

      {/* ── Pill tabs ── */}
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        {TABS.map(({ id, label, badge, Icon }) => {
          const isActive = activeTab === id
          return (
            <button key={id} onClick={() => onSwitchTab(id)}
              aria-label={`${label} tab`}
              style={{
                position:'relative', height:36, padding:'0 12px',
                border:'none', cursor:'pointer',
                display:'flex', alignItems:'center', gap:6,
                borderRadius:8,
                background: isActive ? '#fff' : 'transparent',
                color: isActive ? '#1d2567' : 'rgba(255,255,255,0.75)',
                boxShadow: isActive ? '0 2px 8px rgba(0,0,0,0.15)' : 'none',
                transition:'background 0.15s, color 0.15s, box-shadow 0.15s',
                fontFamily:'DM Sans,sans-serif', fontSize:13, fontWeight:600,
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background='rgba(255,255,255,0.08)' }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background='transparent' }}>
              {/* Acronym badge — CS brand palette per tab */}
              {(() => {
                const badgeKey = id === 'overview' ? 'aggregate' : id === 'profiles' ? 'studentProfiles' : id === 'interviews' ? 'interviewRubric' : 'embed'
                const b = TAB_BADGES[badgeKey]
                return (
                  <span style={{
                    width:24, height:24, borderRadius:6, flexShrink:0,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:11, fontWeight:700,
                    background: b.bg,
                    color: b.color,
                    border: `1px solid ${b.border}`,
                  }}>
                    {id === 'overview' ? 'A' : id === 'profiles' ? 'SP' : id === 'interviews' ? 'IR' : 'E'}
                  </span>
                )
              })()}
              {/* Line icon */}
              <span style={{ lineHeight:0, opacity: isActive ? 0.7 : 0.65 }}>
                <Icon />
              </span>
              {/* Label */}
              <span>{label}</span>
              {/* IR notification badge */}
              {id === 'interviews' && irBadge > 0 && (
                <span className="ir-tab-badge">{irBadge >= 10 ? '9+' : irBadge}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Spacer ── */}
      <div style={{ flex:1 }} />

      {/* ── Cohort picker pill ── */}
      <div ref={cohortRef} style={{ position:'relative', flexShrink:0 }}>
        <div style={{
          display:'flex', alignItems:'center', gap:6,
          border:'1px solid rgba(255,255,255,0.20)', borderRadius:20,
          background:'rgba(255,255,255,0.06)', cursor:'pointer',
          padding:'6px 12px 6px 12px',
        }}
          onClick={() => setCohortOpen(p => !p)}>
          {/* Status dot + label + name block */}
          <div style={{ display:'flex', flexDirection:'column', justifyContent:'center' }}>
            <span style={{ fontSize:10, color:'rgba(255,255,255,0.5)', fontWeight:400, lineHeight:1.2 }}>Active Cohort</span>
            <div style={{ display:'flex', alignItems:'center', gap:5, marginTop:1 }}>
              <span style={{ width:7, height:7, borderRadius:'50%', flexShrink:0,
                background: activeCohort?.accepting_submissions ? '#4ade80' : '#9ca3af' }} />
              <span style={{ fontSize:14, fontWeight:600, color:'#fff', lineHeight:1 }}>
                {activeCohort?.name || 'Select Cohort'}
              </span>
            </div>
          </div>
          <span style={{ color:'rgba(255,255,255,0.6)', flexShrink:0, lineHeight:0 }}><ChevronDown /></span>
          {/* Thin divider + edit/new icons inside pill */}
          <div style={{ width:1, height:20, background:'rgba(255,255,255,0.15)', margin:'0 2px', flexShrink:0 }} />
          {activeCohort && (
            <button title="Edit Cohort" onClick={e => { e.stopPropagation(); onEditCohort() }}
              style={{ background:'none', border:'none', cursor:'pointer', padding:'2px 4px',
                color:'rgba(255,255,255,0.7)', lineHeight:1, fontSize:13 }}
              onMouseEnter={e => e.currentTarget.style.color='#fff'}
              onMouseLeave={e => e.currentTarget.style.color='rgba(255,255,255,0.7)'}>✏</button>
          )}
          <button title="New Cohort" onClick={e => { e.stopPropagation(); onNewCohort() }}
            style={{ background:'none', border:'none', cursor:'pointer', padding:'2px 4px',
              color:'rgba(255,255,255,0.7)', lineHeight:1, fontSize:15, fontWeight:300 }}
            onMouseEnter={e => e.currentTarget.style.color='#fff'}
            onMouseLeave={e => e.currentTarget.style.color='rgba(255,255,255,0.7)'}>+</button>
        </div>

        {/* Cohort dropdown */}
        {cohortOpen && (
          <div style={{
            position:'absolute', top:'calc(100% + 6px)', right:0, width:380,
            background:'var(--pearl)', border:'1px solid #e5e7eb', borderRadius:12,
            boxShadow:'0 8px 24px rgba(0,0,0,0.12)', zIndex:300, overflow:'hidden',
          }}>
            <div style={{ padding:'10px 14px 6px', fontSize:11, fontWeight:600,
              color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.05em',
              background:'var(--sand)' }}>Select Cohort</div>
            {sortedCohorts.map(c => {
              const isSelected = c.id === activeCohortId
              const sc = COHORT_STATUS_COLORS[c.status] || { bg:'#f3f4f6', color:'#6b7280' }
              return (
                <div key={c.id}
                  onClick={() => { onSelectCohort(c.id); setCohortOpen(false) }}
                  style={{
                    padding:'14px 16px', cursor:'pointer',
                    background: isSelected ? '#e8edf8' : 'transparent',
                    borderLeft: isSelected ? '3px solid #1d2567' : '3px solid transparent',
                    transition:'background 0.1s',
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background='var(--sand)' }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background='transparent' }}>
                  <div style={{ fontSize:15, fontWeight:600, color:'#374151' }}>{c.name}</div>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:3 }}>
                    <span style={{ fontSize:12, color:'#6b7280' }}>
                      {formatCohortDateRange(c.start_date, c.end_date) || ' '}
                    </span>
                    <div style={{ display:'flex', gap:4, flexShrink:0, marginLeft:8 }}>
                      {c.status && (
                        <span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:20,
                          background:sc.bg, color:sc.color, border:`1px solid ${sc.bg}` }}>
                          {c.status}
                        </span>
                      )}
                      {c.accepting_submissions && (
                        <span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:20,
                          background:'#dbeafe', color:'#1e40af', border:'1px solid #bfdbfe' }}>
                          Accepting Submissions
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Search bar ── */}
      <div ref={searchRef} style={{ position:'relative', flexShrink:0 }}>
        <div style={{ position:'relative', display:'flex', alignItems:'center' }}>
          <span style={{ position:'absolute', left:12, pointerEvents:'none', lineHeight:0, zIndex:1 }}>
            <SearchIcon opacity={inputFocused ? 0.7 : 0.5} />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            onFocus={() => { setInputFocused(true); if (query.length >= 2) setSearchOpen(true) }}
            onBlur={() => setInputFocused(false)}
            style={{
              height:34, paddingLeft:36,
              paddingRight: isNarrow ? 12 : 48,
              width: isNarrow ? (inputFocused ? 220 : 36) : (inputFocused ? 320 : 220),
              transition:'width 200ms ease, border-color 150ms ease, background 150ms ease',
              background: inputFocused ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.08)',
              border:`1px solid ${inputFocused ? 'rgba(255,255,255,0.40)' : 'rgba(255,255,255,0.15)'}`,
              borderRadius:20, color:'#fff', fontSize:13, fontFamily:'DM Sans',
              outline:'none',
            }}
            placeholder={isNarrow ? '' : 'Search students, units, schools...'}
          />
          {!isNarrow && (
            <span style={{ position:'absolute', right:12, pointerEvents:'none',
              fontSize:11, fontWeight:500, color:'rgba(255,255,255,0.35)',
              fontFamily:'DM Sans', letterSpacing:'0.02em' }}>⌘K</span>
          )}
        </div>

        {/* Search dropdown */}
        {searchOpen && (
          <div style={{
            position:'absolute', top:'calc(100% + 8px)', right:0, width:360,
            maxHeight:480, overflowY:'auto',
            background:'var(--pearl)', border:'1px solid #e5e7eb',
            borderRadius:12, boxShadow:'0 8px 24px rgba(0,0,0,0.12)', zIndex:300,
          }}>
            {searching ? (
              <div style={{ padding:'20px', display:'flex', flexDirection:'column', gap:8 }}>
                {[80,60,70].map((w,i) => (
                  <div key={i} style={{ height:12, borderRadius:6, background:'#f3f4f6', width:`${w}%`, animation:'shimmer 1.4s infinite' }} />
                ))}
              </div>
            ) : flatResults.length === 0 ? (
              <div style={{ padding:'20px', textAlign:'center', fontSize:13, color:'#9ca3af' }}>No results found</div>
            ) : (
              <>
                {results.students.length > 0 && (
                  <>
                    <div style={{ padding:'8px 12px', fontSize:11, fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.05em', background:'var(--sand)' }}>Students</div>
                    {results.students.map((s, i) => {
                      const flatIdx = i, isActive = activeIdx === flatIdx
                      const cfg = ASPIRE_STATUS_CONFIG[s.status] || { bg:'#f3f4f6', text:'#6b7280', border:'#d1d5db' }
                      const initials = `${(s.first_name||'')[0]||''}${(s.last_name||'')[0]||''}`.toUpperCase()||'?'
                      return (
                        <div key={s.id} onClick={() => handleResultClick({ type:'student', data:s })}
                          style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', cursor:'pointer', background: isActive ? 'var(--sand)' : 'transparent' }}
                          onMouseEnter={() => setActiveIdx(flatIdx)} onMouseLeave={() => setActiveIdx(-1)}>
                          {s.headshot_url
                            ? <img src={s.headshot_url} alt="" style={{ width:28,height:28,borderRadius:'50%',objectFit:'cover',flexShrink:0 }} />
                            : <div style={{ width:28,height:28,borderRadius:'50%',background:'var(--nightfall)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,flexShrink:0 }}>{initials}</div>
                          }
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:13, fontWeight:600, color:'var(--raven)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                              {s.last_name}{s.last_name&&s.first_name?', ':''}{s.first_name}
                            </div>
                            <div style={{ fontSize:12, color:'#6b7280', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{s.school}</div>
                          </div>
                          {s.status && <span style={{ fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:10, background:cfg.bg, color:cfg.text, border:`1px solid ${cfg.border}`, flexShrink:0 }}>{s.status}</span>}
                        </div>
                      )
                    })}
                  </>
                )}
                {results.units.length > 0 && (
                  <>
                    <div style={{ padding:'8px 12px', fontSize:11, fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.05em', background:'var(--sand)' }}>Units</div>
                    {results.units.map((u, i) => {
                      const flatIdx = results.students.length + i, isActive = activeIdx === flatIdx
                      return (
                        <div key={u.id} onClick={() => handleResultClick({ type:'unit', data:u })}
                          style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', cursor:'pointer', background: isActive ? 'var(--sand)' : 'transparent' }}
                          onMouseEnter={() => setActiveIdx(flatIdx)} onMouseLeave={() => setActiveIdx(-1)}>
                          <span style={{ color:'#6b7280', fontSize:16, flexShrink:0 }}>🏥</span>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:13, fontWeight:600, color:'var(--raven)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{u.unit_name}</div>
                            <div style={{ fontSize:12, color:'#6b7280' }}>{u.division}{u.division?' · ':''}{u.slots_remaining ?? u.total_slots} of {u.total_slots} slots open</div>
                          </div>
                        </div>
                      )
                    })}
                  </>
                )}
                {results.placements.length > 0 && (
                  <>
                    <div style={{ padding:'8px 12px', fontSize:11, fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.05em', background:'var(--sand)' }}>Placements</div>
                    {results.placements.map(({ student: s, unit: u }, i) => {
                      const flatIdx = results.students.length + results.units.length + i, isActive = activeIdx === flatIdx
                      return (
                        <div key={s.id} onClick={() => handleResultClick({ type:'placement', data:{ student:s, unit:u } })}
                          style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', cursor:'pointer', background: isActive ? 'var(--sand)' : 'transparent' }}
                          onMouseEnter={() => setActiveIdx(flatIdx)} onMouseLeave={() => setActiveIdx(-1)}>
                          <span style={{ color:'#6b7280', fontSize:14, flexShrink:0 }}>🔗</span>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:13, fontWeight:600, color:'var(--raven)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{displayName(s)} → {u?.unit_name||'—'}</div>
                            <div style={{ fontSize:12, color:'#6b7280' }}>{s.status === 'Completed' ? 'Completed' : 'Active Placement'}</div>
                          </div>
                        </div>
                      )
                    })}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </nav>
  )
}

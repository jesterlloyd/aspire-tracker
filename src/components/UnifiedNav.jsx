import { useState, useRef, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { displayName } from '../lib/utils'
import { ASPIRE_STATUS_CONFIG } from '../lib/constants'

const COHORT_STATUS_COLORS = {
  Planning:  { bg:'#dbeafe', color:'#1d4ed8' },
  Active:    { bg:'#dcfce7', color:'#166534' },
  Completed: { bg:'#f3f4f6', color:'#6b7280' },
  Archived:  { bg:'#f3f4f6', color:'#9ca3af' },
}

function formatCohortDateShort(dateInput) {
  if (!dateInput) return ''
  // ISO format: "2026-05-04" — parse as local time to avoid UTC-offset day shift
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateInput)) {
    const [y, m, d] = dateInput.split('T')[0].split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month:'short', day:'numeric' })
  }
  // Any other parseable string: try native parsing
  if (typeof dateInput === 'string') {
    const parsed = new Date(dateInput)
    if (!isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString('en-US', { month:'short', day:'numeric' })
    }
    // Fallback: strip the 4-digit year from whatever text was stored
    return dateInput.replace(/,?\s*\d{4}/, '').trim()
  }
  return ''
}
function formatCohortDateRange(startDate, endDate) {
  if (!startDate && !endDate) return ''
  if (!endDate) return formatCohortDateShort(startDate)
  return `${formatCohortDateShort(startDate)} – ${formatCohortDateShort(endDate)}`
}

function ChevronDown() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}
function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  )
}

export default function UnifiedNav({
  cohorts, activeCohortId, activeCohort, activeTab, ivSessions = [],
  onSelectCohort, onNewCohort, onEditCohort, onSwitchTab,
  students = [], units = [], matches = [], cohortId,
  onSelectStudent, onSelectUnit,
}) {
  // ── Cohort dropdown ────────────────────────────────────────
  const [cohortOpen, setCohortOpen]   = useState(false)
  const cohortRef                      = useRef(null)

  // ── Search ─────────────────────────────────────────────────
  const [query,       setQuery]       = useState('')
  const [results,     setResults]     = useState({ students:[], units:[], placements:[] })
  const [searching,   setSearching]   = useState(false)
  const [searchOpen,  setSearchOpen]  = useState(false)
  const [activeIdx,   setActiveIdx]   = useState(-1)
  const [inputFocused,setInputFocused]= useState(false)
  const searchRef   = useRef(null)
  const inputRef    = useRef(null)
  const searchTimer = useRef(null)

  // ── Close dropdowns on outside click ──────────────────────
  useEffect(() => {
    const handler = e => {
      if (cohortRef.current && !cohortRef.current.contains(e.target)) setCohortOpen(false)
      if (searchRef.current && !searchRef.current.contains(e.target)) { setSearchOpen(false); setActiveIdx(-1) }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Sorted cohorts (start_date ASC, null last) ─────────────
  const sortedCohorts = [...cohorts].sort((a, b) => {
    const da = a.start_date || null
    const db = b.start_date || null
    if (!da && !db) return (a.created_at||'').localeCompare(b.created_at||'')
    if (!da) return 1
    if (!db) return -1
    return da.localeCompare(db)
  })

  // ── IR notification badge ──────────────────────────────────
  const irBadge = ivSessions.filter(s => s.self_scheduled && !s.teams_meeting_booked).length

  // ── Search logic ───────────────────────────────────────────
  const runSearch = useCallback(async q => {
    if (!cohortId || q.length < 2) { setResults({ students:[], units:[], placements:[] }); setSearchOpen(false); return }
    setSearching(true); setSearchOpen(true)
    const [stuRes, unitRes] = await Promise.all([
      supabase.from('students')
        .select('id, first_name, last_name, school, school_email, status, headshot_url')
        .eq('cohort_id', cohortId)
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,school_email.ilike.%${q}%,personal_email.ilike.%${q}%,phone.ilike.%${q}%,school.ilike.%${q}%`)
        .limit(6),
      supabase.from('units')
        .select('id, unit_name, division, contact_person, slots_remaining, total_slots')
        .eq('cohort_id', cohortId)
        .or(`unit_name.ilike.%${q}%,contact_person.ilike.%${q}%`)
        .limit(6),
    ])
    const ql = q.toLowerCase()
    const placements = students.filter(s => {
      if (!s.matched_unit_id) return false
      const u = units.find(u => u.id === s.matched_unit_id)
      return `${s.last_name} ${s.first_name}`.toLowerCase().includes(ql) ||
             (u?.unit_name||'').toLowerCase().includes(ql)
    }).map(s => ({ student: s, unit: units.find(u => u.id === s.matched_unit_id) })).slice(0, 5)

    setResults({ students: stuRes.data||[], units: unitRes.data||[], placements })
    setSearching(false)
    setActiveIdx(-1)
  }, [cohortId, students, units])

  const handleQueryChange = e => {
    const q = e.target.value
    setQuery(q)
    clearTimeout(searchTimer.current)
    if (q.length < 2) { setResults({ students:[], units:[], placements:[] }); setSearchOpen(false); return }
    searchTimer.current = setTimeout(() => runSearch(q), 300)
  }

  // Flat list for keyboard navigation
  const flatResults = [
    ...results.students.map(s   => ({ type:'student',   data:s })),
    ...results.units.map(u      => ({ type:'unit',       data:u })),
    ...results.placements.map(p => ({ type:'placement',  data:p })),
  ]

  const handleResultClick = item => {
    setSearchOpen(false); setQuery(''); setActiveIdx(-1)
    if (item.type === 'student') {
      onSwitchTab('profiles')
      onSelectStudent?.(item.data.id)
    } else if (item.type === 'unit') {
      onSwitchTab('matching')
      onSelectUnit?.(item.data.id)
    } else if (item.type === 'placement') {
      onSwitchTab('matching')
      onSelectUnit?.(item.data.unit?.id)
    }
  }

  const handleKeyDown = e => {
    if (!searchOpen) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i+1, flatResults.length-1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i-1, 0)) }
    else if (e.key === 'Enter' && activeIdx >= 0) { handleResultClick(flatResults[activeIdx]) }
    else if (e.key === 'Escape') { setSearchOpen(false); setQuery(''); inputRef.current?.blur() }
  }

  const NAV_BG   = '#1a2260'
  const DIVIDER  = 'rgba(255,255,255,0.2)'
  const tabs = [
    { id:'overview',   label:'Aggregate',       hint:'A' },
    { id:'profiles',   label:'Student Profiles',hint:'S · P' },
    { id:'interviews', label:'Interview Rubric', hint:'I · R' },
    { id:'matching',   label:'Embed',            hint:'E' },
  ]

  return (
    <nav style={{
      height:48, background:NAV_BG, borderBottom:'1px solid rgba(255,255,255,0.08)',
      padding:'0 24px', display:'flex', alignItems:'center', gap:8,
    }}>
      {/* ── Left: Tabs ── */}
      <div style={{ display:'flex', alignItems:'stretch', height:48, gap:0 }}>
        {tabs.map(t => {
          const isActive = activeTab === t.id
          return (
            <button key={t.id} onClick={() => onSwitchTab(t.id)}
              aria-label={`${t.label} tab`}
              style={{
                position:'relative', height:48, padding:'0 16px', border:'none', background:'none',
                cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center',
                justifyContent:'center', gap:2,
                color: isActive ? '#fff' : 'rgba(255,255,255,0.7)',
                borderBottom: isActive ? '2px solid #fff' : '2px solid transparent',
                transition:'color 0.15s, border-color 0.15s',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.color='rgba(255,255,255,0.9)' }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.color='rgba(255,255,255,0.7)' }}>
              <span style={{ fontSize:13, fontWeight:600, lineHeight:1 }}>{t.label}</span>
              <span style={{ fontSize:10, fontWeight:700, lineHeight:1,
                color: isActive ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.45)',
                letterSpacing:'0.06em' }}>{t.hint}</span>
              {/* IR badge */}
              {t.id === 'interviews' && irBadge > 0 && (
                <span className="ir-tab-badge">{irBadge >= 10 ? '9+' : irBadge}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Divider ── */}
      <div style={{ width:1, height:24, background:DIVIDER, flexShrink:0, margin:'0 8px' }} />

      {/* ── Center-right: Cohort cluster ── */}
      <div ref={cohortRef} style={{ position:'relative', flexShrink:0 }}>
        <div style={{
          display:'flex', alignItems:'center', gap:8,
          border:'1px solid rgba(255,255,255,0.15)', borderRadius:6, padding:'0 10px',
          height:34, cursor:'pointer',
        }}
          onClick={() => setCohortOpen(p => !p)}>
          {/* Status dot — green if accepting submissions, gray otherwise */}
          <span style={{ width:7, height:7, borderRadius:'50%', flexShrink:0,
            background: activeCohort?.accepting_submissions ? '#4ade80' : '#9ca3af' }} />
          {/* Cohort name — no truncation */}
          <span style={{ fontSize:14, fontWeight:600, color:'#fff', whiteSpace:'nowrap' }}>
            {activeCohort?.name || 'Select Cohort'}
          </span>
          <span style={{ color:'rgba(255,255,255,0.7)', flexShrink:0 }}><ChevronDown /></span>
        </div>

        {/* Cohort dropdown */}
        {cohortOpen && (
          <div style={{
            position:'absolute', top:'calc(100% + 6px)', left:0, width:320,
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
                    height:44, padding:'0 16px', display:'flex', alignItems:'center',
                    justifyContent:'space-between', cursor:'pointer',
                    background: isSelected ? 'var(--nightfall)' : 'transparent',
                    transition:'background 0.1s',
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background='var(--sand)' }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background='transparent' }}>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:14, fontWeight:600,
                      color: isSelected ? '#fff' : 'var(--raven)',
                      whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                      {c.name}
                    </div>
                    {(c.start_date || c.end_date) && (
                      <div style={{ fontSize:12, color: isSelected ? 'rgba(255,255,255,0.7)' : '#6b7280' }}>
                        {formatCohortDateRange(c.start_date, c.end_date)}
                      </div>
                    )}
                  </div>
                  <div style={{ display:'flex', gap:4, flexShrink:0, marginLeft:8, flexWrap:'wrap', justifyContent:'flex-end' }}>
                    {c.status && (
                      <span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:20,
                        background: isSelected ? 'rgba(255,255,255,0.15)' : sc.bg,
                        color: isSelected ? '#fff' : sc.color,
                        border: `1px solid ${isSelected ? 'rgba(255,255,255,0.2)' : sc.bg}` }}>
                        {c.status}
                      </span>
                    )}
                    {c.accepting_submissions && (
                      <span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:20,
                        background: isSelected ? 'rgba(191,219,254,0.25)' : '#dbeafe',
                        color: isSelected ? '#fff' : '#1e40af',
                        border: `1px solid ${isSelected ? 'rgba(191,219,254,0.4)' : '#bfdbfe'}` }}>
                        Accepting Submissions
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Cohort action icons */}
      <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
        <div style={{ width:1, height:20, background:DIVIDER, margin:'0 4px' }} />
        {activeCohort && (
          <button title="Edit Cohort" onClick={onEditCohort}
            style={{ background:'none', border:'none', cursor:'pointer', padding:'4px 6px',
              color:'rgba(255,255,255,0.7)', lineHeight:1, fontSize:14 }}
            onMouseEnter={e => e.currentTarget.style.color='#fff'}
            onMouseLeave={e => e.currentTarget.style.color='rgba(255,255,255,0.7)'}>
            ✏
          </button>
        )}
        <button title="New Cohort" onClick={onNewCohort}
          style={{ background:'none', border:'none', cursor:'pointer', padding:'4px 6px',
            color:'rgba(255,255,255,0.7)', lineHeight:1, fontSize:16, fontWeight:300 }}
          onMouseEnter={e => e.currentTarget.style.color='#fff'}
          onMouseLeave={e => e.currentTarget.style.color='rgba(255,255,255,0.7)'}>
          +
        </button>
      </div>

      {/* ── Spacer ── */}
      <div style={{ flex:1 }} />

      {/* ── Right: Search ── */}
      <div ref={searchRef} style={{ position:'relative', flexShrink:0 }}>
        <div style={{ position:'relative', display:'flex', alignItems:'center' }}>
          <span style={{ position:'absolute', left:12, pointerEvents:'none', lineHeight:0 }}>
            <SearchIcon />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            onFocus={() => { setInputFocused(true); if (query.length >= 2) setSearchOpen(true) }}
            onBlur={() => setInputFocused(false)}
            style={{
              height:32, paddingLeft:36, paddingRight:12,
              width: inputFocused ? 320 : 200,
              transition:'width 200ms ease',
              background:'rgba(255,255,255,0.10)',
              border:'1px solid rgba(255,255,255,0.15)', borderRadius:20,
              color:'#fff', fontSize:13, fontFamily:'DM Sans',
              outline:'none',
            }}
            placeholder=""
          />
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
                  <div key={i} style={{ height:12, borderRadius:6, background:'#f3f4f6',
                    width:`${w}%`, animation:'shimmer 1.4s infinite' }} />
                ))}
              </div>
            ) : flatResults.length === 0 ? (
              <div style={{ padding:'20px', textAlign:'center', fontSize:13, color:'#9ca3af' }}>
                No results found
              </div>
            ) : (
              <>
                {/* Students section */}
                {results.students.length > 0 && (
                  <>
                    <div style={{ padding:'8px 12px', fontSize:11, fontWeight:600, color:'#9ca3af',
                      textTransform:'uppercase', letterSpacing:'0.05em', background:'var(--sand)' }}>
                      Students
                    </div>
                    {results.students.map((s, i) => {
                      const flatIdx = i
                      const isActive = activeIdx === flatIdx
                      const cfg = ASPIRE_STATUS_CONFIG[s.status] || { bg:'#f3f4f6', text:'#6b7280', border:'#d1d5db' }
                      const initials = `${(s.first_name||'')[0]||''}${(s.last_name||'')[0]||''}`.toUpperCase()||'?'
                      return (
                        <div key={s.id}
                          onClick={() => handleResultClick({ type:'student', data:s })}
                          style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px',
                            cursor:'pointer', background: isActive ? 'var(--sand)' : 'transparent' }}
                          onMouseEnter={() => setActiveIdx(flatIdx)}
                          onMouseLeave={() => setActiveIdx(-1)}>
                          {s.headshot_url
                            ? <img src={s.headshot_url} alt="" style={{ width:28,height:28,borderRadius:'50%',objectFit:'cover',flexShrink:0 }} />
                            : <div style={{ width:28,height:28,borderRadius:'50%',background:'var(--nightfall)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,flexShrink:0 }}>{initials}</div>
                          }
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:13, fontWeight:600, color:'var(--raven)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                              {s.last_name}{s.last_name&&s.first_name?', ':''}{s.first_name}
                            </div>
                            <div style={{ fontSize:12, color:'#6b7280', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                              {s.school}
                            </div>
                          </div>
                          {s.status && <span style={{ fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:10, background:cfg.bg, color:cfg.text, border:`1px solid ${cfg.border}`, flexShrink:0 }}>{s.status}</span>}
                        </div>
                      )
                    })}
                  </>
                )}

                {/* Units section */}
                {results.units.length > 0 && (
                  <>
                    <div style={{ padding:'8px 12px', fontSize:11, fontWeight:600, color:'#9ca3af',
                      textTransform:'uppercase', letterSpacing:'0.05em', background:'var(--sand)' }}>
                      Units
                    </div>
                    {results.units.map((u, i) => {
                      const flatIdx = results.students.length + i
                      const isActive = activeIdx === flatIdx
                      return (
                        <div key={u.id}
                          onClick={() => handleResultClick({ type:'unit', data:u })}
                          style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px',
                            cursor:'pointer', background: isActive ? 'var(--sand)' : 'transparent' }}
                          onMouseEnter={() => setActiveIdx(flatIdx)}
                          onMouseLeave={() => setActiveIdx(-1)}>
                          <span style={{ color:'#6b7280', fontSize:16, flexShrink:0 }}>🏥</span>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:13, fontWeight:600, color:'var(--raven)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                              {u.unit_name}
                            </div>
                            <div style={{ fontSize:12, color:'#6b7280' }}>
                              {u.division}{u.division?' · ':''}
                              {u.slots_remaining ?? u.total_slots} of {u.total_slots} slots open
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </>
                )}

                {/* Placements section */}
                {results.placements.length > 0 && (
                  <>
                    <div style={{ padding:'8px 12px', fontSize:11, fontWeight:600, color:'#9ca3af',
                      textTransform:'uppercase', letterSpacing:'0.05em', background:'var(--sand)' }}>
                      Placements
                    </div>
                    {results.placements.map(({ student: s, unit: u }, i) => {
                      const flatIdx = results.students.length + results.units.length + i
                      const isActive = activeIdx === flatIdx
                      return (
                        <div key={s.id}
                          onClick={() => handleResultClick({ type:'placement', data:{ student:s, unit:u } })}
                          style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px',
                            cursor:'pointer', background: isActive ? 'var(--sand)' : 'transparent' }}
                          onMouseEnter={() => setActiveIdx(flatIdx)}
                          onMouseLeave={() => setActiveIdx(-1)}>
                          <span style={{ color:'#6b7280', fontSize:14, flexShrink:0 }}>🔗</span>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:13, fontWeight:600, color:'var(--raven)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                              {displayName(s)} → {u?.unit_name||'—'}
                            </div>
                            <div style={{ fontSize:12, color:'#6b7280' }}>
                              {s.status === 'Completed' ? 'Completed' : 'Active Placement'}
                            </div>
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

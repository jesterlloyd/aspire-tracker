// WS2.0: extracted verbatim from App.jsx header (Zone 3 - universal search). No behavior
// change. State/handlers/refs remain owned by App.jsx and arrive as props. Header-only
// helpers (search icon, contact category colors) moved here with the JSX.
import StudentAvatar from '../StudentAvatar'
import { displayName } from '../../lib/utils'
import { ASPIRE_STATUS_CONFIG } from '../../lib/constants'

function HeaderSearchIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
}

// Contact category badge colors for universal search results
// Matches CATEGORY_CHIP_STYLES in ContactsView.jsx
const CONTACT_CAT_COLORS = {
  'Academic Partners':  { bg:'#EEF2FB', text:'#1D2567',  border:'#c3cdf0' },
  'Unit Leadership':    { bg:'#E0F7FA', text:'#0d7a8a',  border:'#9dd6f2' },
  'Preceptors':         { bg:'#E1F3FB', text:'#0e4e6e',  border:'#89CEEA' },
  'BNI Team':           { bg:'#EDE9FE', text:'#5B21B6',  border:'#C4B5FD' },
  'Nursing Executives': { bg:'#FEF3C7', text:'#92400e',  border:'#fde68a' },
}
const getContactCatStyle = cat => CONTACT_CAT_COLORS[cat] || { bg:'#f3f4f6', text:'#6b7280', border:'#e5e7eb' }

export default function UniversalSearch({
  searchAreaRef, searchInputRef, searchQuery, searchFocused, searchOpen, searchLoading,
  searchFlat, searchResults, searchActiveIdx, setSearchActiveIdx,
  setSearchOpen, setSearchFocused, handleSearchChange, handleSearchKey, handleSearchResult,
}) {
  return (
    <div ref={searchAreaRef} className="chart-search-area">
      <div style={{ position:'relative', display:'flex', alignItems:'center' }}>
        <span style={{ position:'absolute', left:11, pointerEvents:'none', lineHeight:0, zIndex:1, color:'#fff', opacity: searchFocused ? 1 : 0.95 }}>
          <HeaderSearchIcon />
        </span>
        <input
          ref={searchInputRef}
          data-tour="global-search"
          value={searchQuery}
          onChange={handleSearchChange}
          onKeyDown={handleSearchKey}
          onFocus={() => { setSearchFocused(true); if (searchQuery.length >= 2) setSearchOpen(true) }}
          onBlur={() => setSearchFocused(false)}
          className="header-search-input"
          /* ASPIRE-CHART: width lives in .chart-search-area CSS so the box can
             go full-width on narrow screens (focus growth kept on desktop). */
          style={{
            height:34, paddingLeft:32, paddingRight:44,
            transition:'width 200ms ease, border-color 150ms ease',
            background: searchFocused ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.07)',
            border:`1px solid ${searchFocused ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.10)'}`,
            borderRadius:8, color:'#fff', fontSize:12.5, fontFamily:'DM Sans',
          }}
          placeholder="Search students, units, contacts…"
        />
        <span style={{ position:'absolute', right:10, pointerEvents:'none', fontSize:10, fontWeight:500, color:'rgba(255,255,255,0.70)', fontFamily:'ui-monospace, monospace', background:'rgba(255,255,255,0.10)', border:'1px solid rgba(255,255,255,0.15)', padding:'1px 5px', borderRadius:3 }}>⌘K</span>
      </div>

      {/* Search dropdown */}
      {searchOpen && (
        <div className="chart-search-dropdown">
          {searchLoading ? (
            <div style={{ padding:20, display:'flex', flexDirection:'column', gap:8 }}>
              {[80,60,70].map((w,i) => <div key={i} style={{ height:12, borderRadius:6, background:'#f3f4f6', width:`${w}%` }} />)}
            </div>
          ) : searchFlat.length === 0 ? (
            <div style={{ padding:20, textAlign:'center', fontSize:13, color:'#9ca3af' }}>No results found</div>
          ) : (
            <>
              {searchResults.students.length > 0 && (
                <>
                  <div style={{ padding:'8px 12px', fontSize:11, fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.05em', background:'var(--sand)' }}>Students</div>
                  {searchResults.students.map((s, i) => {
                    const isAct = searchActiveIdx === i
                    const cfg = ASPIRE_STATUS_CONFIG[s.status] || { bg:'#f3f4f6', text:'#6b7280', border:'#d1d5db' }
                    return (
                      <div key={s.id} onClick={() => handleSearchResult({ type:'student', data:s })}
                        style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', cursor:'pointer', background: isAct ? 'var(--sand)' : 'transparent' }}
                        onMouseEnter={() => setSearchActiveIdx(i)} onMouseLeave={() => setSearchActiveIdx(-1)}>
                        <StudentAvatar student={s} size={28} />
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:600, color:'var(--raven)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{s.last_name}{s.last_name&&s.first_name?', ':''}{s.first_name}</div>
                          <div style={{ fontSize:12, color:'#6b7280' }}>{s.school}</div>
                        </div>
                        {s.status && <span style={{ fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:10, background:cfg.bg, color:cfg.text, border:`1px solid ${cfg.border}`, flexShrink:0 }}>{s.status}</span>}
                      </div>
                    )
                  })}
                </>
              )}
              {searchResults.units.length > 0 && (
                <>
                  <div style={{ padding:'8px 12px', fontSize:11, fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.05em', background:'var(--sand)' }}>Units</div>
                  {searchResults.units.map((u, i) => {
                    const fi = searchResults.students.length + i
                    const isAct = searchActiveIdx === fi
                    return (
                      <div key={u.id} onClick={() => handleSearchResult({ type:'unit', data:u })}
                        style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', cursor:'pointer', background: isAct ? 'var(--sand)' : 'transparent' }}
                        onMouseEnter={() => setSearchActiveIdx(fi)} onMouseLeave={() => setSearchActiveIdx(-1)}>
                        <span style={{ color:'#6b7280', fontSize:16, flexShrink:0 }}>🏥</span>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:600, color:'var(--raven)' }}>{u.unit_name}</div>
                          <div style={{ fontSize:12, color:'#6b7280' }}>{u.division}{u.division?' · ':''}{u.slots_remaining ?? u.total_slots} of {u.total_slots} slots open</div>
                        </div>
                      </div>
                    )
                  })}
                </>
              )}
              {searchResults.placements.length > 0 && (
                <>
                  <div style={{ padding:'8px 12px', fontSize:11, fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.05em', background:'var(--sand)' }}>Placements</div>
                  {searchResults.placements.map(({ student: s, unit: u }, i) => {
                    const fi = searchResults.students.length + searchResults.units.length + i
                    const isAct = searchActiveIdx === fi
                    return (
                      <div key={s.id} onClick={() => handleSearchResult({ type:'placement', data:{ student:s, unit:u } })}
                        style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', cursor:'pointer', background: isAct ? 'var(--sand)' : 'transparent' }}
                        onMouseEnter={() => setSearchActiveIdx(fi)} onMouseLeave={() => setSearchActiveIdx(-1)}>
                        <span style={{ color:'#6b7280', fontSize:14, flexShrink:0 }}>🔗</span>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:600, color:'var(--raven)' }}>{displayName(s)} → {u?.unit_name||'-'}</div>
                          <div style={{ fontSize:12, color:'#6b7280' }}>{s.status === 'Completed' ? 'Completed' : 'Active Placement'}</div>
                        </div>
                      </div>
                    )
                  })}
                </>
              )}
              {searchResults.contacts.length > 0 && (
                <>
                  <div style={{ padding:'8px 12px', fontSize:11, fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.05em', background:'var(--sand)' }}>Contacts</div>
                  {searchResults.contacts.map((c, i) => {
                    const fi = searchResults.students.length + searchResults.units.length + searchResults.placements.length + i
                    const isAct = searchActiveIdx === fi
                    const catStyle = getContactCatStyle(c.category)
                    return (
                      <div key={c.id} onClick={() => handleSearchResult({ type:'contact', data:c })}
                        style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', cursor:'pointer', background: isAct ? 'var(--sand)' : 'transparent' }}
                        onMouseEnter={() => setSearchActiveIdx(fi)} onMouseLeave={() => setSearchActiveIdx(-1)}>
                        {/* Avatar: image with initials fallback */}
                        <div style={{ width:28, height:28, borderRadius:'50%', background:'#1D2567', flexShrink:0, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:700, color:'#fff', position:'relative' }}>
                          {c.avatar_url && <img src={c.avatar_url} alt="" style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }} onError={e => { e.currentTarget.style.display = 'none' }} />}
                          {(c.full_name||'?').split(' ').slice(0,2).map(w => w[0]?.toUpperCase()||'').join('')}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:600, color:'var(--raven)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.full_name}</div>
                          <div style={{ fontSize:12, color:'#6b7280', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.role}{c.email ? ` · ${c.email}` : ''}</div>
                        </div>
                        {c.category && <span style={{ fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:10, background:catStyle.bg, color:catStyle.text, border:`1px solid ${catStyle.border}`, flexShrink:0, whiteSpace:'nowrap' }}>{c.category}</span>}
                      </div>
                    )
                  })}
                </>
              )}
              {searchResults.preceptors.length > 0 && (
                <>
                  <div style={{ padding:'8px 12px', fontSize:11, fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.05em', background:'var(--sand)' }}>Preceptors</div>
                  {searchResults.preceptors.map((p, i) => {
                    const fi = searchResults.students.length + searchResults.units.length + searchResults.placements.length + searchResults.contacts.length + i
                    const isAct = searchActiveIdx === fi
                    return (
                      <div key={p.id} onClick={() => handleSearchResult({ type:'preceptor', data:p })}
                        style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', cursor:'pointer', background: isAct ? 'var(--sand)' : 'transparent' }}
                        onMouseEnter={() => setSearchActiveIdx(fi)} onMouseLeave={() => setSearchActiveIdx(-1)}>
                        <span style={{ color:'#6b7280', fontSize:15, flexShrink:0 }}>🩺</span>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:600, color:'var(--raven)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.full_name}</div>
                          <div style={{ fontSize:12, color:'#6b7280', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.unit_name||''}{p.unit_name&&p.email?' · ':''}{p.email||''}</div>
                        </div>
                        {p.shift_type && <span style={{ fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:10, background:'#E1F3FB', color:'#0e4e6e', border:'1px solid #89CEEA', flexShrink:0 }}>{p.shift_type}</span>}
                      </div>
                    )
                  })}
                </>
              )}
              {searchResults.cohorts.length > 0 && (
                <>
                  <div style={{ padding:'8px 12px', fontSize:11, fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.05em', background:'var(--sand)' }}>Cohorts</div>
                  {searchResults.cohorts.map((c, i) => {
                    const fi = searchResults.students.length + searchResults.units.length + searchResults.placements.length + searchResults.contacts.length + searchResults.preceptors.length + i
                    const isAct = searchActiveIdx === fi
                    return (
                      <div key={c.id} onClick={() => handleSearchResult({ type:'cohort', data:c })}
                        style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', cursor:'pointer', background: isAct ? 'var(--sand)' : 'transparent' }}
                        onMouseEnter={() => setSearchActiveIdx(fi)} onMouseLeave={() => setSearchActiveIdx(-1)}>
                        <span style={{ color:'#6b7280', fontSize:15, flexShrink:0 }}>📅</span>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:600, color:'var(--raven)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.name}</div>
                        </div>
                      </div>
                    )
                  })}
                </>
              )}
              {searchResults.catalog.length > 0 && (
                <>
                  <div style={{ padding:'8px 12px', fontSize:11, fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.05em', background:'var(--sand)' }}>Catalog</div>
                  {searchResults.catalog.map((r, i) => {
                    const fi = searchResults.students.length + searchResults.units.length + searchResults.placements.length + searchResults.contacts.length + searchResults.preceptors.length + searchResults.cohorts.length + i
                    const isAct = searchActiveIdx === fi
                    return (
                      <div key={r.id} onClick={() => handleSearchResult({ type:'catalog', data:r })}
                        style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', cursor:'pointer', background: isAct ? 'var(--sand)' : 'transparent' }}
                        onMouseEnter={() => setSearchActiveIdx(fi)} onMouseLeave={() => setSearchActiveIdx(-1)}>
                        <span style={{ color:'#6b7280', fontSize:15, flexShrink:0 }}>📄</span>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:600, color:'var(--raven)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.title}</div>
                          <div style={{ fontSize:12, color:'#6b7280', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.category||''}{r.category&&r.description?' · ':''}{r.description||''}</div>
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
  )
}

// src/portal/ap/SchoolChecklistDrawer.jsx
//
// AP-CLEARANCE-2 (Owner, 2026-11-08): a school's clearance checklist. AP-DOCUMENTS-TAB-1 (2026-11-17):
// renamed Document List and opened from the Documents tab, where its items are the sheet's columns;
// nothing on it is called required any more. AP-DOCUMENT-LAYOUT-1: one ordered list; ASPIRE's
// items are hidden from a school's sheet (never deleted), a school's own items are removed (retired),
// and every row moves. Files already uploaded stay on each record either way.
// The same drawer shell as the student record (ptl-drawer, apr-*). An Owner/Admin preview reads.
import { useCallback, useEffect, useRef, useState } from 'react'
import { X, ChevronUp, ChevronDown, GripVertical, EyeOff, Eye } from 'lucide-react'
import { getSchoolStudentRecord, postSchoolStudentRecord } from './academicPartnerApi'
import { LoadingState, ErrorState } from '../unit/UnitLeaderChrome'
import { confirmDialog } from '../../components/shared/confirmDialog'
import { applyLayout, moveKey, dropKey } from '../../lib/ap/documentSheet'
import './schoolStudentDrawer.css'

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const ADD_ERRORS = {
  label_required: 'Give the item a name.',
  label_too_long: 'Keep the name to 80 characters.',
  qualifier_too_long: 'Keep the note to 80 characters.',
  forbidden: 'You can add items only for your own school.',
  not_enabled: 'Documents are not set up yet.',
}

function AddItem({ schools, defaultSchool, onAdded }) {
  const [school, setSchool] = useState(schools.includes(defaultSchool) ? defaultSchool : schools[0])
  const [label, setLabel] = useState('')
  const [qualifier, setQualifier] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    const r = await postSchoolStudentRecord({ action: 'item_add', school_key: school, label, qualifier })
    setBusy(false)
    if (!r.ok) { setErr(ADD_ERRORS[r.error] || 'That item could not be added.'); return }
    setLabel(''); setQualifier('')
    onAdded(r.data?.item?.label || label)
  }
  return (
    <form className="apr-add" onSubmit={submit}>
      {schools.length > 1 && (
        <label className="apr-field">
          <span>School</span>
          <select className="apr-input" value={school} onChange={e => setSchool(e.target.value)}>
            {schools.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      )}
      <label className="apr-field">
        <span>Item name</span>
        <input className="apr-input" value={label} maxLength={80} onChange={e => setLabel(e.target.value)} placeholder="Hepatitis B titer" />
      </label>
      <label className="apr-field">
        <span>Note (optional)</span>
        <input className="apr-input" value={qualifier} maxLength={80} onChange={e => setQualifier(e.target.value)} placeholder="Upload the lab report" />
      </label>
      <div className="apr-add-acts">
        <button type="submit" className="ptl-btn ptl-btn-small" disabled={busy || !label.trim()}>{busy ? 'Adding' : 'Add item'}</button>
      </div>
      {err && <span className="apr-error" role="alert">{err}</span>}
    </form>
  )
}

export default function SchoolChecklistDrawer({ schoolKey, onClose, onChanged, returnFocusRef }) {
  const panelRef = useRef(null)
  const closeRef = useRef(null)
  const [state, setState] = useState({ status: 'loading', base: [], items: [], schools: [], layouts: {}, layoutEnabled: false, enabled: true, readOnly: true })
  const [notice, setNotice] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey(k => k + 1), [])

  useEffect(() => {
    let live = true
    getSchoolStudentRecord('items').then(r => {
      if (!live) return
      if (!r.ok) setState(s => ({ ...s, status: 'error' }))
      else setState({ status: 'ready', base: r.data.base || [], items: r.data.items || [], schools: r.data.schools || [], layouts: r.data.layouts || {}, layoutEnabled: r.data.layoutEnabled === true, enabled: r.data.enabled !== false, readOnly: r.data.readOnly === true })
    })
    return () => { live = false }
  }, [reloadKey])

  useEffect(() => {
    const prev = returnFocusRef?.current || null
    const t = setTimeout(() => closeRef.current?.focus?.(), 20)
    return () => { clearTimeout(t); if (prev?.focus) prev.focus() }
  }, [returnFocusRef])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); return }
      if (e.key !== 'Tab' || !panelRef.current) return
      const els = Array.from(panelRef.current.querySelectorAll(FOCUSABLE)).filter(el => el.offsetParent !== null)
      if (!els.length) return
      const first = els[0], last = els[els.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const remove = async (item) => {
    const ok = await confirmDialog(`Remove ${item.label} from your document list? Files already uploaded for it stay on each student's record.`, { confirmLabel: 'Remove item', danger: true })
    if (!ok) return
    const r = await postSchoolStudentRecord({ action: 'item_retire', key: item.key })
    if (!r.ok) { setNotice({ tone: 'err', text: 'That item could not be removed.' }); return }
    setNotice({ tone: 'ok', text: `${item.label} removed.` })
    reload(); onChanged?.()
  }

  // AP-DOCUMENT-LAYOUT-1 (Owner, 2026-11-17): one ordered list, the sheet's columns. Every row moves up
  // or down (or is dragged); ASPIRE's items are hidden from this school's sheet, never deleted, because
  // every school shares that list; a school's own items are removed. Each change saves at once.
  const school = state.schools.includes(schoolKey) ? schoolKey : state.schools[0]
  const types = [
    ...state.base.map(b => ({ ...b, school_key: null })),
    ...state.items.filter(i => i.school_key === school),
  ]
  const rows = applyLayout(types, state.layouts[school])
  const canArrange = !state.readOnly && state.layoutEnabled && Boolean(school)
  const [dragKey, setDragKey] = useState(null)

  const save = async (next, message) => {
    const prev = state.layouts[school]
    setState(st => ({ ...st, layouts: { ...st.layouts, [school]: next } }))
    const r = await postSchoolStudentRecord({ action: 'layout_set', school_key: school, order: next.map(n => n.key), hidden: next.filter(n => n.hidden).map(n => n.key) })
    if (!r.ok) {
      setState(st => ({ ...st, layouts: { ...st.layouts, [school]: prev } }))
      setNotice({ tone: 'err', text: r.error === 'not_enabled' ? 'Arranging columns is not set up yet.' : 'That change could not be saved.' })
      return
    }
    if (message) setNotice({ tone: 'ok', text: message })
    onChanged?.()
  }
  const asLayout = (keys, list = rows) => keys.map(k => ({ key: k, hidden: list.find(x => x.key === k)?.hidden === true }))
  const keys = rows.map(r => r.key)
  const move = (key, by) => { const next = moveKey(keys, key, by); if (next !== keys) save(asLayout(next)) }
  const drop = (onto) => { if (!dragKey) return; const next = dropKey(keys, dragKey, onto); setDragKey(null); if (next !== keys) save(asLayout(next)) }
  const toggleHidden = (row) => save(rows.map(r => ({ key: r.key, hidden: r.key === row.key ? !row.hidden : r.hidden === true })),
    row.hidden ? `${row.label} shows on your sheet again.` : `${row.label} is hidden from your sheet. Files already on a record stay there.`)

  return (
    <>
      <div className="ptl-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside ref={panelRef} className="ptl-drawer ptl-detail-drawer apr-drawer" role="dialog" aria-modal="true" aria-label="Document list">
        <button ref={closeRef} type="button" className="ptl-icon-btn ptl-detail-close" aria-label="Close document list" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
        <div className="ptl-detail-hero">
          <h2 className="ptl-detail-heroname">Document List</h2>
          <p className="ptl-detail-heroschool">The columns on your Documents sheet{state.schools.length > 1 && school ? `, for ${school}` : ''}</p>
        </div>
        <div className="ptl-drawer-body">
          {state.status === 'loading' && <LoadingState label="Loading the document list" />}
          {state.status === 'error' && <ErrorState detail="The document list could not be loaded just now." onRetry={reload} />}
          {state.status === 'ready' && !state.enabled && <p className="ptl-muted">Documents are not set up yet.</p>}
          {state.status === 'ready' && state.enabled && (
            <>
              {state.readOnly && <p className="apr-preview">Staff preview: read-only.</p>}
              {notice && <p className={notice.tone === 'err' ? 'apr-error' : 'apr-note'} role="status">{notice.text}</p>}
              <section className="apr-section" aria-labelledby="apr-cols-h">
                <h3 id="apr-cols-h" className="ptl-detail-heading">Columns</h3>
                <p className="apr-lede">
                  In the order they appear on your sheet. ASPIRE&apos;s items are documents Cedars-Sinai may ask for; the ASPIRE
                  team keeps them for every school, so you can hide one your program does not collect but not delete it.
                  Items your school added can be removed.
                </p>
                {!state.readOnly && !state.layoutEnabled && <p className="apr-note">Reordering and hiding columns is being set up and will be available soon.</p>}
                <ul className="apr-clr apr-cols">
                  {rows.map((row, i) => {
                    const own = row.school_key != null
                    return (
                      <li key={row.key}
                        className={`apr-clr-row apr-col${row.hidden ? ' apr-col-hidden' : ''}${dragKey === row.key ? ' apr-col-dragging' : ''}`}
                        draggable={canArrange}
                        onDragStart={canArrange ? (e) => { setDragKey(row.key); e.dataTransfer.effectAllowed = 'move' } : undefined}
                        onDragOver={canArrange ? (e) => e.preventDefault() : undefined}
                        onDrop={canArrange ? (e) => { e.preventDefault(); drop(row.key) } : undefined}
                        onDragEnd={() => setDragKey(null)}>
                        {canArrange && <GripVertical size={16} className="apr-grip" aria-hidden="true" />}
                        <div className="apr-clr-main">
                          <span className="apr-clr-name">
                            {row.label}
                            <span className={own ? 'apr-own' : 'apr-aspire'}>{own ? 'Your school' : 'ASPIRE'}</span>
                            {row.hidden && <span className="apr-pill apr-pill-mute apr-hidden-tag">Hidden</span>}
                          </span>
                          {row.qualifier && <span className="apr-clr-qual">{row.qualifier}</span>}
                        </div>
                        {!state.readOnly && (
                          <div className="apr-col-acts">
                            {canArrange && (
                              <>
                                <button type="button" className="apr-icon" disabled={i === 0} onClick={() => move(row.key, -1)} aria-label={`Move ${row.label} up`}><ChevronUp size={16} aria-hidden="true" /></button>
                                <button type="button" className="apr-icon" disabled={i === rows.length - 1} onClick={() => move(row.key, 1)} aria-label={`Move ${row.label} down`}><ChevronDown size={16} aria-hidden="true" /></button>
                              </>
                            )}
                            {own
                              ? <button type="button" className="apr-link apr-danger" onClick={() => remove(row)}>Remove</button>
                              : canArrange && (
                                <button type="button" className="apr-link apr-hide" onClick={() => toggleHidden(row)} aria-label={`${row.hidden ? 'Show' : 'Hide'} ${row.label}`}>
                                  {row.hidden ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
                                  {row.hidden ? 'Show' : 'Hide'}
                                </button>
                              )}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
              {!state.readOnly && state.schools.length > 0 && (
                <section className="apr-section" aria-labelledby="apr-add-h">
                  <h3 id="apr-add-h" className="ptl-detail-heading">Add a Column</h3>
                  <p className="apr-lede">Anything else your own program collects. It becomes a column on your sheet and shows on each student&apos;s record.</p>
                  <AddItem schools={state.schools} defaultSchool={schoolKey}
                    onAdded={(label) => { setNotice({ tone: 'ok', text: `${label} added. It is now a column on your Documents sheet.` }); reload(); onChanged?.() }} />
                </section>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  )
}

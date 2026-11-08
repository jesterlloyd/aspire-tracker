// src/portal/ap/SchoolChecklistDrawer.jsx
//
// AP-CLEARANCE-2 (Owner, 2026-11-08): a school's clearance checklist. ASPIRE's base list is shown
// as required and cannot be changed here; a school adds its own optional items and removes them.
// Removing an item hides it from the checklist; files already uploaded stay on each record.
// The same drawer shell as the student record (ptl-drawer, apr-*). An Owner/Admin preview reads.
import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { getSchoolStudentRecord, postSchoolStudentRecord } from './academicPartnerApi'
import { LoadingState, ErrorState } from '../unit/UnitLeaderChrome'
import { confirmDialog } from '../../components/shared/confirmDialog'
import './schoolStudentDrawer.css'

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const ADD_ERRORS = {
  label_required: 'Give the item a name.',
  label_too_long: 'Keep the name to 80 characters.',
  qualifier_too_long: 'Keep the note to 80 characters.',
  forbidden: 'You can add items only for your own school.',
  not_enabled: 'Clearance documents are not set up yet.',
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
  const [state, setState] = useState({ status: 'loading', base: [], items: [], schools: [], enabled: true, readOnly: true })
  const [notice, setNotice] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey(k => k + 1), [])

  useEffect(() => {
    let live = true
    getSchoolStudentRecord('items').then(r => {
      if (!live) return
      if (!r.ok) setState(s => ({ ...s, status: 'error' }))
      else setState({ status: 'ready', base: r.data.base || [], items: r.data.items || [], schools: r.data.schools || [], enabled: r.data.enabled !== false, readOnly: r.data.readOnly === true })
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
    const ok = await confirmDialog(`Remove ${item.label} from your checklist? Files already uploaded for it stay on each student's record.`, { confirmLabel: 'Remove item', danger: true })
    if (!ok) return
    const r = await postSchoolStudentRecord({ action: 'item_retire', key: item.key })
    if (!r.ok) { setNotice({ tone: 'err', text: 'That item could not be removed.' }); return }
    setNotice({ tone: 'ok', text: `${item.label} removed.` })
    reload(); onChanged?.()
  }

  const showSchool = state.schools.length > 1
  const ownItems = state.items

  return (
    <>
      <div className="ptl-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside ref={panelRef} className="ptl-drawer ptl-detail-drawer apr-drawer" role="dialog" aria-modal="true" aria-label="Clearance checklist">
        <button ref={closeRef} type="button" className="ptl-icon-btn ptl-detail-close" aria-label="Close clearance checklist" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
        <div className="ptl-detail-hero">
          <h2 className="ptl-detail-heroname">Clearance Checklist</h2>
          <p className="ptl-detail-heroschool">What every student from your school files before rotation</p>
        </div>
        <div className="ptl-drawer-body">
          {state.status === 'loading' && <LoadingState label="Loading the checklist" />}
          {state.status === 'error' && <ErrorState detail="The checklist could not be loaded just now." onRetry={reload} />}
          {state.status === 'ready' && !state.enabled && <p className="ptl-muted">Clearance documents are not set up yet.</p>}
          {state.status === 'ready' && state.enabled && (
            <>
              {state.readOnly && <p className="apr-preview">Staff preview: read-only.</p>}
              {notice && <p className={notice.tone === 'err' ? 'apr-error' : 'apr-note'} role="status">{notice.text}</p>}
              <section className="apr-section" aria-labelledby="apr-base-h">
                <h3 id="apr-base-h" className="ptl-detail-heading">Required by ASPIRE</h3>
                <p className="apr-lede">Every student needs these on file. The ASPIRE team sets this list.</p>
                <ul className="apr-clr">
                  {state.base.map(b => (
                    <li key={b.key} className="apr-clr-row">
                      <div className="apr-clr-main">
                        <span className="apr-clr-name">{b.label}</span>
                        {b.qualifier && <span className="apr-clr-qual">{b.qualifier}</span>}
                      </div>
                      <span className="apr-pill apr-pill-mute">Required</span>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="apr-section" aria-labelledby="apr-own-h">
                <h3 id="apr-own-h" className="ptl-detail-heading">Your School&apos;s Items</h3>
                <p className="apr-lede">Optional items you collect for your own program. They appear on each student&apos;s record and never mark a student incomplete.</p>
                {ownItems.length === 0
                  ? <p className="ptl-muted">No items of your own yet.</p>
                  : (
                    <ul className="apr-clr">
                      {ownItems.map(i => (
                        <li key={i.key} className="apr-clr-row">
                          <div className="apr-clr-main">
                            <span className="apr-clr-name">{i.label}{showSchool && <span className="apr-own">{i.school_key}</span>}</span>
                            {i.qualifier && <span className="apr-clr-qual">{i.qualifier}</span>}
                          </div>
                          {state.readOnly
                            ? <span className="apr-pill apr-pill-mute">Optional</span>
                            : <button type="button" className="apr-link" onClick={() => remove(i)}>Remove</button>}
                        </li>
                      ))}
                    </ul>
                  )}
                {!state.readOnly && state.schools.length > 0 && (
                  <AddItem schools={state.schools} defaultSchool={schoolKey}
                    onAdded={(label) => { setNotice({ tone: 'ok', text: `${label} added. It now shows on each student's record.` }); reload(); onChanged?.() }} />
                )}
              </section>
            </>
          )}
        </div>
      </aside>
    </>
  )
}

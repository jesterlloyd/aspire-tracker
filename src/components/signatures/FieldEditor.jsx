// src/components/signatures/FieldEditor.jsx
//
// SIGNATURES-PHASE2: step 3 of Prepare and send, "Place fields" (brief section 4). Fields
// live in page percent, so they survive zoom and screen size. Every geometry rule
// (snapping, nudging, radio groups, Line up) is a pure function in sigModel; this file only
// wires pointers and keys to them.
//
// Keys (only when focus is not in a text box): Delete/Backspace removes the selected field,
// Ctrl+Z or Cmd+Z restores the last deleted, arrows nudge 0.5% (Shift: 2%), Esc cancels
// placing. Holding Alt while dragging places the field freely.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FIELD_TYPES, fieldType, fieldLabel, SENDER_ROLE, RULE_OPTIONS, GROUP_RULES, clampField, snapField, nudge,
  placeRadioGroup, lineUpGroup, addGroupOption, nextGroupName,
} from '../../lib/signatures/sigModel'
import PdfPages from './PdfPages'

const GLYPH = { sig: '✍', ini: 'AB', date: '31', time: '◷', name: 'Aa', email: '@', phone: '☏', title: 'T', org: '⌂', addr: '⌖', text: 'Tx', check: '☑', drop: '▾', radio: '◉' }
const PREFILLABLE = new Set(['name', 'email', 'title', 'org', 'phone', 'addr'])
let seq = 0
const newId = () => `f${Date.now().toString(36)}${(seq++).toString(36)}`
const isTyping = (el) => el && (el.matches?.('input, textarea, select, [contenteditable="true"]'))

export default function FieldEditor({ fields, setFields, signers, pageSizes, source, notify }) {
  const [role, setRole] = useState(signers[0]?.roleKey || SENDER_ROLE)
  const [armed, setArmed] = useState(null)
  const [selId, setSelId] = useState(null)
  const [page, setPage] = useState(1)
  const [guides, setGuides] = useState({ x: [], y: [] })
  const lastDeleted = useRef(null)
  const drag = useRef(null)
  const pageCount = Math.max(1, pageSizes.length)
  const selected = fields.find(f => f.id === selId) || null
  const colorOf = useCallback((r) => r === SENDER_ROLE ? 'slate' : (signers.find(s => s.roleKey === r)?.color || 'navy'), [signers])
  const nameOf = (r) => {
    if (r === SENDER_ROLE) return 'You'
    const i = signers.findIndex(s => s.roleKey === r)
    return signers[i]?.name || (i >= 0 ? `Signer ${i + 1}` : 'Signer')
  }

  useEffect(() => { if (!signers.some(s => s.roleKey === role) && role !== SENDER_ROLE) setRole(signers[0]?.roleKey || SENDER_ROLE) }, [signers, role])

  const update = useCallback((id, patch) => setFields(fs => fs.map(f => f.id === id ? clampField({ ...f, ...patch }) : f)), [setFields])
  const remove = useCallback(() => {
    if (!selected) return
    lastDeleted.current = { field: selected, index: fields.findIndex(f => f.id === selected.id) }
    setFields(fs => fs.filter(f => f.id !== selected.id)); setSelId(null)
    notify?.('Field deleted. Press Ctrl+Z or ⌘Z to undo.')
  }, [selected, fields, setFields, notify])

  // Keys, only when not typing.
  useEffect(() => {
    const onKey = (e) => {
      if (isTyping(e.target)) return
      if (e.key === 'Escape' && armed) { setArmed(null); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && lastDeleted.current) {
        e.preventDefault()
        const { field, index } = lastDeleted.current; lastDeleted.current = null
        setFields(fs => { const n = [...fs]; n.splice(Math.min(index, n.length), 0, field); return n })
        setSelId(field.id); notify?.('Field restored.'); return
      }
      if (!selected) return
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); return }
      if (e.key.startsWith('Arrow')) { e.preventDefault(); setFields(fs => fs.map(f => f.id === selected.id ? nudge(f, e.key, e.shiftKey) : f)) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [armed, selected, remove, setFields, notify])

  const pageRect = () => document.querySelector(`.sg-editor .sg-page[data-page="${page}"]`)?.getBoundingClientRect()

  const onPageDown = (e) => {
    if (!armed || e.target.closest('.sg-fld')) return
    const r = pageRect(); if (!r) return
    const t = fieldType(armed)
    const px = ((e.clientX - r.left) / r.width) * 100, py = ((e.clientY - r.top) / r.height) * 100
    const x = Math.max(0, Math.min(100 - t.w, px - t.w / 2)), y = Math.max(0, Math.min(100 - t.h, py - t.h / 2))
    if (armed === 'radio') {
      const group = nextGroupName(fields, 'radio')
      const placed = placeRadioGroup({ x, y, page, role, groupName: group, nextId: newId })
      setFields(fs => [...fs, ...placed]); setSelId(placed[2].id)
      notify?.('Radio group placed: 3 options, lined up.')
    } else {
      const f = clampField({
        id: newId(), type: armed, page, role, x, y, w: t.w, h: t.h, required: role === SENDER_ROLE ? true : t.required,
        ...(t.rule ? { rule: t.rule } : {}), ...(PREFILLABLE.has(armed) ? { prefill: true } : {}),
        ...(armed === 'drop' ? { options: ['Option 1', 'Option 2'] } : {}),
      })
      setFields(fs => [...fs, f]); setSelId(f.id)
      notify?.(`${t.label} placed for ${nameOf(role)}.`)
    }
    setArmed(null)
  }

  const onFieldDown = (e, f, mode) => {
    e.stopPropagation(); e.preventDefault()
    setSelId(f.id)
    const r = pageRect(); if (!r) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { id: f.id, mode, sx: e.clientX, sy: e.clientY, o: { ...f }, r }
  }
  const onMove = (e) => {
    const d = drag.current; if (!d) return
    const dx = ((e.clientX - d.sx) / d.r.width) * 100, dy = ((e.clientY - d.sy) / d.r.height) * 100
    if (d.mode === 'move') {
      let next = clampField({ ...d.o, x: d.o.x + dx, y: d.o.y + dy })
      if (!e.altKey) {
        const s = snapField(next, fields)
        next = clampField({ ...next, x: next.x + s.dx, y: next.y + s.dy })
        setGuides({ x: s.guidesX, y: s.guidesY })
      } else setGuides({ x: [], y: [] })
      update(d.id, { x: next.x, y: next.y })
    } else {
      update(d.id, { w: d.o.w + dx, h: d.o.type === 'radio' ? d.o.h : d.o.h + dy })
    }
  }
  const onUp = () => { drag.current = null; setGuides({ x: [], y: [] }) }

  const counts = useMemo(() => {
    const c = {}; for (const f of fields) c[f.role] = (c[f.role] || 0) + 1; return c
  }, [fields])
  const perPage = (n) => fields.filter(f => (f.page || 1) === n).length
  const missing = signers.filter(s => s.type === 'signer' && !fields.some(f => f.role === s.roleKey && f.type === 'sig'))
  const groupSize = selected?.group ? fields.filter(f => f.group === selected.group).length : 0

  return (
    <div className="sg-pgrid sg-editor" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <div className="sg-card sg-panel">
        <p className="sg-h3">Placing fields for</p>
        <div className="sg-rsel">
          {signers.filter(s => s.type === 'signer').map((s, i) => (
            <button key={s.roleKey} type="button" className={`sg-rbtn sg-c-${s.color}`} aria-pressed={role === s.roleKey} onClick={() => setRole(s.roleKey)}>
              <span className="sg-ord">{i + 1}</span><span><b>{s.name || `Signer ${i + 1}`}</b><small>{counts[s.roleKey] || 0} fields</small></span>
            </button>
          ))}
          <button type="button" className="sg-rbtn sg-c-slate" aria-pressed={role === SENDER_ROLE} onClick={() => setRole(SENDER_ROLE)}>
            <span className="sg-ord">·</span><span><b>You, before sending</b><small>{counts[SENDER_ROLE] || 0} fields</small></span>
          </button>
        </div>
        <p className="sg-h3">Add a field</p>
        <div className={`sg-pal sg-c-${colorOf(role)}`}>
          {FIELD_TYPES.map(t => (
            <button key={t.key} type="button" aria-pressed={armed === t.key} onClick={() => setArmed(a => a === t.key ? null : t.key)}>
              <span className="sg-pi" aria-hidden="true">{GLYPH[t.key]}</span>{t.label}
            </button>
          ))}
        </div>
        <p className="sg-hint">{armed ? <><b>Click the page</b> to place {fieldType(armed).label}. Esc cancels.</> : 'Pick a field, then click the page. Drag to move; guides snap it to other fields and the page center (hold Alt to place freely). Arrow keys nudge. Delete removes; Ctrl+Z or ⌘Z undoes.'}</p>
      </div>

      <div className="sg-stage">
        <div className="sg-thumbs" role="group" aria-label="Pages">
          {Array.from({ length: pageCount }, (_, i) => i + 1).map(n => (
            <button key={n} type="button" className="sg-thumb" aria-pressed={page === n} onClick={() => { setPage(n); setSelId(null) }}>
              <i aria-hidden="true" /><span>Page {n}<small>{perPage(n)} fields</small></span>
            </button>
          ))}
        </div>
        <div className="sg-pagebar"><span>Page {page} of {pageCount}</span><span>{fields.length} fields in all</span></div>
        <PdfPages source={source} pageSizes={pageSizes} pages={[page]} className="sg-editpages" pageClassName={armed ? 'sg-arming' : ''}
          pageProps={() => ({ onPointerDown: onPageDown, 'aria-label': `Document page ${page}. Fields can be placed here.` })}
          overlay={(n) => (
            <>
              {fields.filter(f => (f.page || 1) === n).map(f => (
                <div key={f.id} role="button" tabIndex={0} data-fid={f.id}
                  className={`sg-fld sg-c-${colorOf(f.role)}${f.type === 'radio' ? ' sg-fld-radio' : ''}${f.required && !f.group ? ' sg-fld-req' : ''}`}
                  aria-selected={selId === f.id} aria-label={`${fieldLabel(f)} for ${nameOf(f.role)}`}
                  style={{ left: `${f.x}%`, top: `${f.y}%`, width: `${f.w}%`, height: `${f.h}%` }}
                  onPointerDown={(e) => onFieldDown(e, f, 'move')}
                  onFocus={() => setSelId(f.id)}>
                  {f.type === 'check' || f.type === 'radio'
                    ? (f.group ? <small className="sg-grp">{f.type === 'radio' ? (f.option || '') : f.group}</small> : null)
                    : <><span>{fieldLabel(f)}</span><small>{f.role === SENDER_ROLE ? 'You' : (nameOf(f.role).split(' ').slice(-1)[0])}</small></>}
                  {f.type !== 'radio' && <span className="sg-rs" aria-hidden="true" onPointerDown={(e) => onFieldDown(e, f, 'resize')} />}
                </div>
              ))}
              {guides.x.map(x => <div key={`gx${x}`} className={`sg-guide sg-guide-v${x === 50 ? ' sg-guide-mid' : ''}`} style={{ left: `${x}%` }} />)}
              {guides.y.map(y => <div key={`gy${y}`} className="sg-guide sg-guide-h" style={{ top: `${y}%` }} />)}
            </>
          )} />
        {missing.length > 0 && <div className="sg-note" role="status">{andList(missing.map(m => nameOf(m.roleKey)))} {missing.length === 1 ? 'has' : 'have'} no signature field yet.</div>}
      </div>

      <div className="sg-card sg-props">
        {!selected ? (
          <><p className="sg-h3">Field</p><div className="sg-empty">Select a field on the page to change who fills it, whether it is required, and its label.</div></>
        ) : (
          <>
            <p className="sg-h3">{fieldType(selected.type)?.label} field</p>
            <div className="sg-field"><label htmlFor="sg-fr">Filled by</label>
              <select id="sg-fr" value={selected.role} onChange={e => {
                const r = e.target.value
                setFields(fs => fs.map(f => (f.id === selected.id || (selected.group && f.group === selected.group)) ? { ...f, role: r } : f))
              }}>
                {signers.filter(s => s.type === 'signer').map(s => <option key={s.roleKey} value={s.roleKey}>{s.name || s.roleKey}</option>)}
                <option value={SENDER_ROLE}>You, before sending</option>
              </select>
              {selected.role === SENDER_ROLE && <p className="sg-hint">You fill this in at Review and send. It is locked for signers.</p>}
            </div>
            {!selected.group && selected.type !== 'radio' && (
              <label className="sg-tg"><span>Required</span><input type="checkbox" checked={!!selected.required} onChange={e => update(selected.id, { required: e.target.checked })} /></label>
            )}
            {selected.type === 'radio' && (
              <>
                <div className="sg-field"><label htmlFor="sg-opt">This option's label</label><input id="sg-opt" value={selected.option || ''} onChange={e => update(selected.id, { option: e.target.value })} /></div>
                <p className="sg-hint">{selected.group} has {groupSize} options. The signer must pick exactly one.</p>
                <div className="sg-two">
                  <button type="button" className="sg-btn sg-sm" onClick={() => { setFields(fs => addGroupOption(fs, selected.group, newId)) }}>+ Add option</button>
                  <button type="button" className="sg-btn sg-sm" onClick={() => { setFields(fs => lineUpGroup(fs, selected.group)); notify?.('Options centered on one line and evenly spaced.') }}>Line up</button>
                </div>
              </>
            )}
            {selected.type === 'check' && (
              <>
                <div className="sg-field"><label htmlFor="sg-grp">Checkbox group</label>
                  <input id="sg-grp" value={selected.group || ''} placeholder="None" onChange={e => update(selected.id, { group: e.target.value.trim() || null, groupRule: selected.groupRule || 'at_least_1' })} /></div>
                {selected.group && (
                  <div className="sg-field"><label htmlFor="sg-grule">Group rule</label>
                    <select id="sg-grule" value={selected.groupRule || 'at_least_1'} onChange={e => setFields(fs => fs.map(f => f.group === selected.group ? { ...f, groupRule: e.target.value } : f))}>
                      {GROUP_RULES.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
                    </select>
                    <p className="sg-hint">{groupSize} checkboxes share this group. The group rule replaces Required.</p>
                  </div>
                )}
              </>
            )}
            {RULE_OPTIONS[selected.type] && (
              <div className="sg-field"><label htmlFor="sg-rule">Format check</label>
                <select id="sg-rule" value={selected.rule || 'none'} onChange={e => update(selected.id, { rule: e.target.value })}>
                  {RULE_OPTIONS[selected.type].map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
                <p className="sg-hint">The signer sees a clear message and cannot finish until it matches.</p>
              </div>
            )}
            {['text', 'check', 'drop'].includes(selected.type) && (
              <div className="sg-field"><label htmlFor="sg-lab">{selected.type === 'drop' ? 'Options, one per line' : 'Label shown to the signer'}</label>
                {selected.type === 'drop'
                  ? <textarea id="sg-lab" value={(selected.options || []).join('\n')} onChange={e => update(selected.id, { options: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })} />
                  : <input id="sg-lab" value={selected.label || ''} placeholder="For example: Roster is complete" onChange={e => update(selected.id, { label: e.target.value })} />}
              </div>
            )}
            {PREFILLABLE.has(selected.type) && (
              <><label className="sg-tg"><span>Fill from ASPIRE record</span><input type="checkbox" checked={selected.prefill !== false} onChange={e => update(selected.id, { prefill: e.target.checked })} /></label>
                <p className="sg-hint">The signer can still edit it.</p></>
            )}
            {selected.type === 'date' && <p className="sg-hint">Filled automatically with the date the signer signs. It cannot be edited.</p>}
            {selected.type === 'time' && <p className="sg-hint">Filled automatically with the time the signer signs, in ASPIRE's time zone. It cannot be edited.</p>}
            {(selected.type === 'sig' || selected.type === 'ini') && <p className="sg-hint">The signer types or draws it. The audit trail records which.</p>}
            <div className="sg-two">
              <button type="button" className="sg-btn sg-sm" onClick={() => { const n = clampField({ ...selected, id: newId(), y: selected.y + selected.h + 1.5 }); setFields(fs => [...fs, n]); setSelId(n.id) }}>Duplicate</button>
              <button type="button" className="sg-btn sg-sm sg-danger" onClick={remove}>Delete</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

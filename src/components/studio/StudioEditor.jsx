// src/components/studio/StudioEditor.jsx
//
// STUDIO-1: one design open on the canvas. Left: the block library (drag or click to add). Centre:
// the email, drawn block by block by the same renderer the send uses, at Desktop (600px) or Phone
// (375px). Right: the selected block's Content and Style. The design saves itself; Send me a test
// mails it to you alone; Review & send opens the audience drawer.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PanelTop, Sparkles, Heading, AlignLeft, Image as ImageIcon, Columns2, ListOrdered, Quote, MousePointerClick, CalendarDays, ClipboardList, Minus, MoveVertical, PenLine, PanelBottom, Bookmark, Plus, Undo2, Redo2, AlertTriangle } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import StudioInspector from './StudioInspector'
import StudioSendDrawer from './StudioSendDrawer'
import StudioPreviewModal from './StudioPreviewModal'
import { BLOCKS, BLOCK_GROUPS, THEMES, makeBlock, sanitizeDesign, designProblems, blockIssues, newBlockId, MAX_BLOCKS } from '../../lib/studio/studioBlocks'
import { renderBlockRows } from '../../lib/studio/renderEmail'
import { studioSend } from '../../lib/studio/studioClient'
import { useAuth } from '../../contexts/AuthContext'
import { useStudioBrand, signatureFromProfile } from './studioBrand'

const HISTORY_MAX = 60
const SAVE_DELAY_MS = 1000

// The library's icons, one per block type. Decoration only: each row's name says what it is.
const BLOCK_ICONS = {
  header: PanelTop, hero: Sparkles, heading: Heading, text: AlignLeft, image: ImageIcon, columns: Columns2,
  steps: ListOrdered, quote: Quote, button: MousePointerClick, event: CalendarDays, form: ClipboardList,
  divider: Minus, spacer: MoveVertical, signature: PenLine, footer: PanelBottom,
}

export default function StudioEditor({ store, designId, initialDesign, initialName, onCreated, onClose, imagesEnabled, cohortId, toast }) {
  const { userProfile } = useAuth()
  const brand = useStudioBrand()
  const signature = useMemo(() => signatureFromProfile(userProfile), [userProfile])

  const [id, setId] = useState(designId)
  const [name, setName] = useState(initialName || '')
  const [design, setDesign] = useState(initialDesign ? sanitizeDesign(initialDesign) : null)
  const [loadError, setLoadError] = useState('')
  const [selected, setSelected] = useState(null)
  const [device, setDevice] = useState('desktop')
  const [saveState, setSaveState] = useState(initialDesign ? 'unsaved' : 'saved')
  const [past, setPast] = useState([])
  const [future, setFuture] = useState([])
  const [saved, setSaved] = useState([])
  const [dropAt, setDropAt] = useState(null)
  const [dragId, setDragId] = useState(null)
  const [sendOpen, setSendOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [testing, setTesting] = useState(false)

  // Load an existing design.
  useEffect(() => {
    if (!designId || initialDesign) return
    let off = false
    store.get(designId)
      .then(row => { if (!off) { setDesign(row.design); setName(row.name); setSaveState('saved') } })
      .catch(e => { if (!off) setLoadError(e?.message || 'This design could not be opened.') })
    return () => { off = true }
  }, [designId, initialDesign, store])

  useEffect(() => { store.blocks().then(setSaved).catch(() => setSaved([])) }, [store])

  // ── Edits, with undo ───────────────────────────────────────────────────────
  // The design is read through a ref so that two edits in one tick each build on the last, and so
  // history is written outside a state updater (React may run an updater twice).
  const designRef = useRef(design)
  designRef.current = design
  const commit = useCallback((next) => { designRef.current = next; setDesign(next); setSaveState('unsaved') }, [])
  const apply = useCallback((fn) => {
    const prev = designRef.current
    if (!prev) return
    const next = sanitizeDesign(fn(prev))
    setPast(p => [...p.slice(-(HISTORY_MAX - 1)), prev])
    setFuture([])
    commit(next)
  }, [commit])
  const undo = useCallback(() => {
    if (!past.length) return
    const prev = past[past.length - 1]
    setPast(past.slice(0, -1))
    setFuture(f => [designRef.current, ...f])
    commit(prev)
  }, [past, commit])
  const redo = useCallback(() => {
    if (!future.length) return
    const next = future[0]
    setFuture(future.slice(1))
    setPast(p => [...p, designRef.current])
    commit(next)
  }, [future, commit])

  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo() }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); removeBlock(selected) }
      if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ── Autosave ───────────────────────────────────────────────────────────────
  const saveTimer = useRef(null)
  const savingRef = useRef(false)
  const latest = useRef({ id, name, design })
  latest.current = { id, name, design }
  const saveNow = useCallback(async () => {
    const cur = latest.current
    if (!cur.design || savingRef.current) return
    savingRef.current = true
    setSaveState('saving')
    try {
      const row = await store.save({ id: cur.id, name: cur.name || 'Untitled design', design: cur.design })
      if (!cur.id && row?.id) { setId(row.id); onCreated?.(row.id) }
      setSaveState(latest.current.design === cur.design && latest.current.name === cur.name ? 'saved' : 'unsaved')
    } catch (e) {
      setSaveState('error')
      toast?.error?.('Not saved', e?.message || 'The design could not be saved.')
    } finally {
      savingRef.current = false
    }
  }, [store, onCreated, toast])
  useEffect(() => {
    if (saveState !== 'unsaved') return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(saveNow, SAVE_DELAY_MS)
    return () => clearTimeout(saveTimer.current)
  }, [saveState, design, name, saveNow])
  useEffect(() => {
    const warn = (e) => { if (saveState === 'unsaved' || saveState === 'saving') { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [saveState])

  // ── Block operations ───────────────────────────────────────────────────────
  const insertBlock = useCallback((block, at) => {
    apply(d => {
      const blocks = [...d.blocks]
      if (blocks.length >= MAX_BLOCKS) return d
      const index = at == null ? (selected ? blocks.findIndex(b => b.id === selected) + 1 : blocks.length) : at
      blocks.splice(Math.max(0, Math.min(blocks.length, index)), 0, block)
      return { ...d, blocks }
    })
    setSelected(block.id)
  }, [apply, selected])
  const addType = (type, at) => insertBlock(makeBlock(type), at)
  const addSaved = (row, at) => insertBlock({ ...JSON.parse(JSON.stringify(row.block)), id: newBlockId() }, at)
  const updateBlock = useCallback((bid, patch) => {
    apply(d => ({ ...d, blocks: d.blocks.map(b => b.id === bid ? { ...b, props: { ...b.props, ...(patch.props || {}) }, style: { ...b.style, ...(patch.style || {}) } } : b) }))
  }, [apply])
  const moveBlock = useCallback((bid, delta) => {
    apply(d => {
      const blocks = [...d.blocks]
      const i = blocks.findIndex(b => b.id === bid)
      const j = i + delta
      if (i < 0 || j < 0 || j >= blocks.length) return d
      ;[blocks[i], blocks[j]] = [blocks[j], blocks[i]]
      return { ...d, blocks }
    })
  }, [apply])
  const moveTo = useCallback((bid, at) => {
    apply(d => {
      const blocks = [...d.blocks]
      const i = blocks.findIndex(b => b.id === bid)
      if (i < 0) return d
      const [b] = blocks.splice(i, 1)
      blocks.splice(at > i ? at - 1 : at, 0, b)
      return { ...d, blocks }
    })
  }, [apply])
  const duplicateBlock = (bid) => apply(d => {
    const i = d.blocks.findIndex(b => b.id === bid)
    if (i < 0 || d.blocks.length >= MAX_BLOCKS) return d
    const copy = { ...JSON.parse(JSON.stringify(d.blocks[i])), id: newBlockId() }
    const blocks = [...d.blocks]; blocks.splice(i + 1, 0, copy)
    return { ...d, blocks }
  })
  function removeBlock(bid) {
    apply(d => ({ ...d, blocks: d.blocks.filter(b => b.id !== bid) }))
    setSelected(null)
  }

  // ── Drag and drop ──────────────────────────────────────────────────────────
  const onDragOverBlock = (e, index) => {
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    setDropAt(e.clientY < r.top + r.height / 2 ? index : index + 1)
  }
  const onDrop = (e) => {
    e.preventDefault()
    const at = dropAt ?? design.blocks.length
    const type = e.dataTransfer.getData('application/x-studio-type')
    const savedId = e.dataTransfer.getData('application/x-studio-saved')
    const moving = e.dataTransfer.getData('application/x-studio-move')
    if (type && BLOCKS[type]) addType(type, at)
    else if (savedId) { const row = saved.find(s => s.id === savedId); if (row) addSaved(row, at) }
    else if (moving) moveTo(moving, at)
    setDropAt(null); setDragId(null)
  }

  const problems = useMemo(() => design ? designProblems(design) : { blocking: [], warnings: [], items: [] }, [design])
  // A problem in the list jumps to what it names: the block, or the email's own field.
  const [focusField, setFocusField] = useState(null)
  const jumpTo = (item) => {
    if (item.blockId) {
      setSelected(item.blockId)
      requestAnimationFrame(() => document.querySelector(`[data-block-id="${item.blockId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
    } else if (item.field) {
      setSelected(null)
      setFocusField({ name: item.field, at: Date.now() })
    }
  }
  const selectedBlock = design?.blocks.find(b => b.id === selected) || null
  const renderOpts = useMemo(() => ({ brand, signature, mergePreview: true, formMode: 'link', formUrl: () => '#' }), [brand, signature])

  const sendTest = async () => {
    if (!design.subject.trim()) { toast?.error?.('Add a subject first', 'A test needs a subject line.'); return }
    setTesting(true)
    try {
      const r = await studioSend({ test: true, subject: design.subject, body: JSON.stringify(design) })
      toast?.success?.('Test sent', `Check ${r.to}. Personal form links are left out of a test.`)
    } catch (e) {
      toast?.error?.('Test not sent', e.message)
    } finally { setTesting(false) }
  }

  if (loadError) return <div className="st-card"><p className="st-notice st-notice-bad">{loadError}</p><button type="button" className="st-btn" style={{ marginTop: 12 }} onClick={onClose}>‹ Back to Studio</button></div>
  if (!design) return <div className="st-card"><p className="st-sub">Opening the design…</p></div>

  const saveLabel = { saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved changes', error: 'Not saved' }[saveState]
  const libraryByGroup = BLOCK_GROUPS.map(g => [g, Object.entries(BLOCKS).filter(([, def]) => def.group === g)])

  return (
    <div className="st-editor" style={{ minHeight: 'calc(100dvh - 220px)' }}>
      <div className="st-bar">
        <button type="button" className="st-btn st-btn-sm" onClick={async () => { if (saveState === 'unsaved') await saveNow(); onClose() }}>‹ Studio</button>
        <input className="st-name" aria-label="Design name" value={name} placeholder="Name this design"
          maxLength={120} onChange={e => { setName(e.target.value); setSaveState('unsaved') }} />
        <span className="st-saved" aria-live="polite">{saveLabel}{store.mode === 'local' ? ' in this browser' : ''}</span>
        <div className="st-grow" />
        <div className="st-bar-grp" role="group" aria-label="Edit">
          <Tooltip label={`Undo (${MOD}Z)`}>
            <button type="button" className="st-iconbtn" onClick={undo} disabled={!past.length} aria-label="Undo"><Undo2 size={17} strokeWidth={2.2} /></button>
          </Tooltip>
          <Tooltip label={`Redo (${MOD}${SHIFT}Z)`}>
            <button type="button" className="st-iconbtn" onClick={redo} disabled={!future.length} aria-label="Redo"><Redo2 size={17} strokeWidth={2.2} /></button>
          </Tooltip>
        </div>
        <span className="st-bar-sep" aria-hidden="true" />
        <div className="st-bar-grp" role="group" aria-label="View">
          <div className="st-seg" role="group" aria-label="Preview width">
            <button type="button" aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')}>Desktop</button>
            <button type="button" aria-pressed={device === 'phone'} onClick={() => setDevice('phone')}>Phone</button>
          </div>
          <button type="button" className="st-btn st-btn-sm" onClick={() => setPreviewOpen(true)}>Preview as sent</button>
        </div>
        <span className="st-bar-sep" aria-hidden="true" />
        <div className="st-bar-grp" role="group" aria-label="Send">
          <button type="button" className="st-btn st-btn-sm" onClick={sendTest} disabled={testing}>{testing ? 'Sending…' : 'Send me a test'}</button>
          <button type="button" className="st-btn st-btn-sm st-btn-primary" onClick={async () => { if (saveState === 'unsaved') await saveNow(); setSendOpen(true) }}>
            Review &amp; send →
            {problems.blocking.length > 0 && <span className="st-fixcount">{problems.blocking.length} to fix</span>}
          </button>
        </div>
      </div>

      {problems.items.length > 0 && (
        <div className="st-problems" role="region" aria-label="Before you send">
          <span className="st-problems-h">Before you send</span>
          {problems.items.map(p => {
            const bad = p.level === 'blocking'
            const body = <><i className={`st-dot ${bad ? 'st-dot-bad' : 'st-dot-warn'}`} aria-hidden="true">!</i><span>{p.text}</span></>
            return (p.blockId || p.field)
              ? <button key={p.text} type="button" className="st-check st-problem-jump" onClick={() => jumpTo(p)}>{body}</button>
              : <span key={p.text} className="st-check">{body}</span>
          })}
        </div>
      )}

      <div className="st-body">
        <nav className="st-lib" aria-label="Blocks">
          {libraryByGroup.map(([group, items]) => (
            <div key={group}>
              <div className="st-lib-grp">{group}</div>
              {items.map(([type, def]) => (
                <button key={type} type="button" className="st-lib-item" draggable
                  onDragStart={e => { e.dataTransfer.setData('application/x-studio-type', type); e.dataTransfer.effectAllowed = 'copy' }}
                  onClick={() => addType(type)} aria-label={`Add ${def.label}: ${def.hint}`}>
                  <LibIcon type={type} group={group} />
                  <span className="st-lib-text">{def.label}<small>{def.hint}</small></span>
                  <span className="st-lib-add" aria-hidden="true"><Plus size={14} strokeWidth={2.4} /></span>
                </button>
              ))}
            </div>
          ))}
          <div className="st-lib-grp">Saved</div>
          {saved.length === 0 && <p className="st-hint" style={{ margin: '0 2px' }}>Save any block from its panel to reuse it here.</p>}
          {saved.map(row => (
            <div key={row.id} className="st-lib-item st-lib-item-saved" role="group" aria-label={row.name}>
              <button type="button" className="st-lib-saved" draggable
                onDragStart={e => { e.dataTransfer.setData('application/x-studio-saved', row.id); e.dataTransfer.effectAllowed = 'copy' }}
                onClick={() => addSaved(row)}>
                <span className="st-lib-ico st-lib-ico-saved" aria-hidden="true"><Bookmark size={16} strokeWidth={2} /></span>
                <span className="st-lib-text">{row.name}<small>{BLOCKS[row.block.type]?.label}</small></span>
              </button>
              <button type="button" className="st-x" aria-label={`Remove saved block ${row.name}`}
                onClick={async () => { await store.deleteBlock(row.id).catch(() => null); setSaved(s => s.filter(x => x.id !== row.id)) }}>×</button>
            </div>
          ))}
        </nav>

        <div className="st-board" onDragOver={e => { e.preventDefault(); if (!design.blocks.length) setDropAt(0) }} onDrop={onDrop}
          onClick={e => { if (e.target === e.currentTarget) setSelected(null) }}>
          <div className={`st-email${device === 'phone' ? ' st-phone' : ''}`} style={{ background: THEMES[design.theme]?.page }}>
            {design.blocks.length === 0 && <div className="st-canvas-empty">Drag a block here, or click one on the left.</div>}
            {design.blocks.map((b, i) => (
              <div key={b.id}>
                <div className={`st-drop${dropAt === i ? ' is-on' : ''}`} />
                <div
                  data-block-id={b.id}
                  className={`st-block${selected === b.id ? ' is-selected' : ''}${dragId === b.id ? ' is-dragging' : ''}${issueOf(b) ? ` has-issue is-${issueOf(b).level}` : ''}`}
                  style={{ background: THEMES[design.theme]?.surface }}
                  role="button" tabIndex={0} aria-label={`${BLOCKS[b.type].label} block ${i + 1}`} aria-pressed={selected === b.id}
                  draggable
                  onDragStart={e => { e.dataTransfer.setData('application/x-studio-move', b.id); e.dataTransfer.effectAllowed = 'move'; setDragId(b.id) }}
                  onDragEnd={() => { setDragId(null); setDropAt(null) }}
                  onDragOver={e => onDragOverBlock(e, i)}
                  onClick={(e) => { e.preventDefault(); setSelected(b.id) }}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(b.id) } }}
                >
                  {selected === b.id && <span className="st-tag">{BLOCKS[b.type].label}</span>}
                  {issueOf(b) && (
                    <span className={`st-issue st-issue-${issueOf(b).level}`}>
                      <AlertTriangle size={12} strokeWidth={2.4} aria-hidden="true" />{issueOf(b).short}
                    </span>
                  )}
                  {selected === b.id && (
                    <div className="st-blockctl" onClick={e => e.stopPropagation()}>
                      <button type="button" onClick={() => moveBlock(b.id, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                      <button type="button" onClick={() => moveBlock(b.id, 1)} disabled={i === design.blocks.length - 1} aria-label="Move down">↓</button>
                      <button type="button" onClick={() => duplicateBlock(b.id)} aria-label="Duplicate block">⧉</button>
                      <button type="button" onClick={() => removeBlock(b.id)} aria-label="Remove block">✕</button>
                    </div>
                  )}
                  <table role="presentation" cellPadding="0" cellSpacing="0" border="0">
                    <tbody dangerouslySetInnerHTML={{ __html: renderBlockRows(b, design.theme, renderOpts) }} />
                  </table>
                </div>
              </div>
            ))}
            <div className={`st-drop${dropAt === design.blocks.length ? ' is-on' : ''}`} onDragOver={e => { e.preventDefault(); setDropAt(design.blocks.length) }} style={{ height: 24 }} />
          </div>
        </div>

        <aside className="st-props" aria-label={selectedBlock ? 'Block settings' : 'Email settings'}>
          <StudioInspector
            block={selectedBlock}
            themeId={design.theme}
            design={design}
            onDesign={apply}
            focusField={focusField}
            onShowEmail={() => setSelected(null)}
            onChange={(patch) => selectedBlock && updateBlock(selectedBlock.id, patch)}
            onSaveBlock={async (nm) => {
              try { const row = await store.saveBlock(nm, selectedBlock); setSaved(s => [...s, row]); toast?.success?.('Block saved', `"${nm}" is under Saved in the block list.`) }
              catch (e) { toast?.error?.('Not saved', e.message) }
            }}
            imagesEnabled={imagesEnabled}
            toast={toast}
          />
        </aside>
      </div>

      {previewOpen && <StudioPreviewModal design={design} onClose={() => setPreviewOpen(false)} />}
      {sendOpen && (
        <StudioSendDrawer
          design={design} name={name || 'Untitled design'} designId={id} store={store}
          problems={problems} cohortId={cohortId} toast={toast}
          onClose={() => setSendOpen(false)}
        />
      )}
    </div>
  )
}

function LibIcon({ type, group }) {
  const Icon = BLOCK_ICONS[type] || AlignLeft
  return <span className={`st-lib-ico st-lib-ico-${String(group).toLowerCase()}`} aria-hidden="true"><Icon size={16} strokeWidth={2} /></span>
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')
const MOD = IS_MAC ? '⌘' : 'Ctrl+'
const SHIFT = IS_MAC ? '⇧' : 'Shift+'

/** The most serious thing a block still needs, for the canvas marker. */
function issueOf(block) {
  const all = blockIssues(block)
  return all.find(x => x.level === 'blocking') || all[0] || null
}

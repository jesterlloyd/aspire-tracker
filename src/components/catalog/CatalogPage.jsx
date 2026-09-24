// src/components/catalog/CatalogPage.jsx
//
// CATALOG-REVAMP-1 (Phase 1, 2026-09-23). The ASPIRE Catalog: find a resource, then send
// it (and, from Phase 2 on, collect it or get it signed). Reference:
// docs/mockups/catalog-mockup.html with its build prompt.
//
// ONE component tree, two drawings. Style decides the drawing (APPEARANCE-STYLE-1):
// Classic is an iBooks-style bookcase with covers on shelves, a torn sheet for details, a
// library checkout card for the send history; Modern is the plain list and panel. The
// data, the actions, the keyboard and every count are the same in both, because both
// read src/lib/catalog/catalogModel.js and nothing is computed here.
//
// Who can do what (unchanged, Owner 2026-09-23): Owner and Admin browse, send and
// manage, the same roles Outreach allows; an Interviewer browses and opens files only.
// Send goes out through Outreach (/api/connect-send-bulk-message), never Messages.
//
// Every read here works on both sides of the Phase 1 migration: a column or table that
// is not there yet (42703 / 42P01) reads as "not enabled", never as an error.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Search, FileText, ListChecks, Signature, Send as SendIcon, Clock, ArrowRightFromLine, Pin, Paperclip,
  X, Upload, LayoutGrid, List as ListIcon, UserRound, Tag,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useTheme } from '../../contexts/ThemeContext'
import WorkspaceBackLink from '../ui/WorkspaceBackLink'
import RowActionsMenu from '../shared/RowActionsMenu'
import {
  CATALOG_FEATURES, KIND_LABEL, SORTS, audienceOf, audienceLabel, kindOf, fileBadge, fmtShortDate, fmtBytes,
  catalogSummary, railCounts, isLongCoverTitle, isPdfFile, completionStats, filterItems, sortItems, listSections, shelfOrder, viewTitle, sendButtonLabel,
} from '../../lib/catalog/catalogModel'
import CatalogSendModal from './CatalogSendModal'
import {
  AddResourceModal, NewVersionModal, EditResourceModal, RemoveConfirmDialog, ManageCategoriesModal,
  PersonalFilesModal,
} from './CatalogModals'
import { authedPost } from './catalogApi'
import { useSignaturesFlag } from '../signatures/sigApi'
import { useFormsStatus, formStaff } from '../forms/formsApi'
import { lazyReload } from '../../lib/lazyReload'
import '../../styles/selectionRail.css'
import './catalog.css'

// SIGNATURES-PHASE2: the signature screens load only for a caller the flag admits.
const SignaturesPage = lazyReload(() => import('../signatures/SignaturesPage'), 'SignaturesPage')
// FORMS-PHASE3: the form builder and its responses load only when opened.
const FormsScreen = lazyReload(() => import('../forms/FormsScreen'), 'FormsScreen')

const BASE_COLS = 'id, slug, title, description, category, resource_type, external_url, file_type_label, tags, audience, is_featured, is_pinned, is_active, updated_at, created_at, storage_path'
const PHASE1_COLS = 'kind, version, version_updated_at, file_size_bytes, moved_to_record_document_id'
const notEnabled = (e) => e && (e.code === '42703' || e.code === '42P01' || e.code === 'PGRST204' || e.code === 'PGRST205')
const MOVED_DISMISS_KEY = 'aspire-catalog-moved-dismissed'
const MOVED_NOTICE_DAYS = 14

function readDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(MOVED_DISMISS_KEY) || '[]')) } catch { return new Set() }
}
function writeDismissed(set) {
  try { localStorage.setItem(MOVED_DISMISS_KEY, JSON.stringify([...set].slice(-50))) } catch { /* per-browser convenience only */ }
}

export default function CatalogPage({
  backPath = '/aggregate', backLabel = 'At a Glance',
  students = [], units = [], matches = [], cohortName = '', toast,
}) {
  const { isOwner, isAdmin, isInterviewer } = useAuth()
  const { style } = useTheme()
  const classic = style !== 'modern'
  const canView = canViewCatalog(isOwner, isAdmin, isInterviewer)
  const canManage = isOwner || isAdmin   // browse + send + manage; Interviewers read only
  const location = useLocation()
  const navigate = useNavigate()
  // catalog.signatures is decided by the SERVER (organization flag + caller role). Until it
  // answers, and whenever it says no, no signature entry point renders.
  const sigFlag = useSignaturesFlag(canManage)
  // FORMS-PHASE3: Forms is built (CATALOG_FEATURES.forms) and switched on once the server
  // says its tables exist; before the migration every forms entry point stays hidden.
  const formsStatus = useFormsStatus(canManage)
  const features = useMemo(() => ({ ...CATALOG_FEATURES, signatures: sigFlag.allowed, forms: CATALOG_FEATURES.forms && formsStatus.enabled }),
    [sigFlag.allowed, formsStatus.enabled])
  const onSignatures = location.pathname.startsWith('/catalog/signatures')
  const formRoute = /^\/catalog\/forms\/([^/]+)\/(edit|responses)\/?$/.exec(location.pathname)

  // ── Data ──
  const [allRows, setRows] = useState([])
  // A signature document is shown only while the flag admits the caller.
  const rows = useMemo(() => (features.signatures ? allRows : allRows.filter(r => kindOf(r) !== 'signature')), [allRows, features.signatures])
  const [phase1, setPhase1] = useState(true)      // the Phase 1 columns exist
  const [loading, setLoading] = useState(canViewCatalog(isOwner, isAdmin, isInterviewer))
  const [error, setError] = useState(null)
  const [cats, setCats] = useState([])
  const [sends, setSends] = useState([])
  const [sendsEnabled, setSendsEnabled] = useState(true)
  const [contacts, setContacts] = useState(null)
  const [personal, setPersonal] = useState({ candidates: 0, moved: [] })

  // ── View state ──
  const [view, setView] = useState({ type: 'all', category: null, track: null })
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('recent')
  const [showRemoved, setShowRemoved] = useState(false)
  // null: nothing chosen yet, so a /catalog?resource=<slug> deep link decides; '' after ✕.
  const [selectedId, setSelectedId] = useState(null)
  const [deepSlug] = useState(() => new URLSearchParams(window.location.search).get('resource'))
  const [shelfMode, setShelfMode] = useState('shelf')   // Classic only: 'shelf' | 'list'
  const [menuFor, setMenuFor] = useState(null)
  const [newOpen, setNewOpen] = useState(false)
  const [caseNewOpen, setCaseNewOpen] = useState(false)   // the bookcase bar's + New: the same menu
  const [dismissed, setDismissed] = useState(readDismissed)

  // ── Dialogs ──
  const [dialog, setDialog] = useState(null)   // { type, row? }
  const [msg, setMsg] = useState(null)         // { tone: 'ok' | 'err', text }

  const say = useCallback((tone, text) => {
    if (toast?.success && tone === 'ok') toast.success(text)
    else if (toast?.error && tone === 'err') toast.error(text)
    else setMsg({ tone, text })
  }, [toast])

  const notify = useCallback((text, tone = 'ok') => say(tone, text), [say])

  // A reload after an action keeps the list on screen; only the first load shows the state line.
  const load = useCallback(async () => {
    try {
      let res = await supabase.from('catalog_resources').select(`${BASE_COLS}, ${PHASE1_COLS}`)
      if (notEnabled(res.error)) {
        setPhase1(false)
        res = await supabase.from('catalog_resources').select(BASE_COLS)
      } else setPhase1(true)
      if (res.error) throw res.error
      setRows(res.data || []); setError(null)
    } catch (e) { setError(e) } finally { setLoading(false) }
  }, [])

  const loadCats = useCallback(async () => {
    let res = await supabase.from('catalog_categories').select('slug, display_name, description, sort_order, retired_at').order('sort_order')
    if (notEnabled(res.error)) res = await supabase.from('catalog_categories').select('slug, display_name, description, sort_order').order('sort_order')
    setCats(res.data || [])
  }, [])

  const loadSends = useCallback(async () => {
    if (!canManage) return
    const res = await supabase.from('catalog_sends')
      .select('id, resource_id, resource_version, sent_at, audience_labels, sent_count, failed_count, skipped_count, channel')
      .order('sent_at', { ascending: false }).limit(1000)
    if (notEnabled(res.error)) { setSendsEnabled(false); setSends([]); return }
    setSendsEnabled(true)
    setSends(res.data || [])
  }, [canManage])

  const loadPersonal = useCallback(async () => {
    if (!canManage) return
    try {
      const data = await authedPost('/api/catalog-personal-files')
      const cutoff = Date.now() - MOVED_NOTICE_DAYS * 86400000
      setPersonal({
        candidates: (data.candidates || []).length,
        moved: (data.moved || []).filter(m => new Date(m.moved_at).getTime() >= cutoff),
      })
    } catch { /* the review is reachable from the + New menu either way */ }
  }, [canManage])

  useEffect(() => { if (canView) { load(); loadCats() } }, [canView, load, loadCats])
  useEffect(() => { loadSends(); loadPersonal() }, [loadSends, loadPersonal])

  // Contacts are the school, preceptor and staff recipients. Loaded once, before any Send
  // opens, so a Send's default recipients are never computed from a half-loaded list.
  useEffect(() => {
    if (!canManage || contacts) return
    supabase.from('contacts').select('id, full_name, preferred_name, email, category, school_name, is_active')
      .then(({ data }) => setContacts(data || []))
  }, [canManage, contacts])

  // ── Derived (all from the model) ──
  const assignableCats = useMemo(() => cats.filter(c => !c.retired_at).map(c => ({ key: c.slug, label: c.display_name })), [cats])
  const catLabel = useCallback((slug) => cats.find(c => c.slug === slug)?.display_name || slug, [cats])
  const activeRows = useMemo(() => rows.filter(r => r.is_active !== false), [rows])
  // One completion row per person, for forms and signature requests (form-staff tracker).
  const [trackRows, setTrackRows] = useState([])
  useEffect(() => {
    if (!canManage || !(features.forms || features.signatures)) return
    formStaff('tracker').then(r => setTrackRows(r.rows || [])).catch(() => setTrackRows([]))
  }, [canManage, features.forms, features.signatures])
  const statsById = useMemo(() => {
    const by = {}
    for (const r of trackRows) (by[r.id] ||= []).push(r)
    return Object.fromEntries(Object.entries(by).map(([id, list]) => [id, completionStats(list)]))
  }, [trackRows])
  const summary = useMemo(() => catalogSummary(activeRows, statsById), [activeRows, statsById])
  const counts = useMemo(() => railCounts(activeRows, statsById, assignableCats), [activeRows, statsById, assignableCats])
  const usage = useMemo(() => {
    const u = {}
    for (const s of sends) u[s.resource_id] = (u[s.resource_id] || 0) + 1
    return u
  }, [sends])
  const sendsById = useMemo(() => {
    const m = {}
    for (const s of sends) (m[s.resource_id] ||= []).push(s)
    return m
  }, [sends])
  const visible = useMemo(() => sortItems(filterItems(rows, { view, q: query, showRemoved, catLabel, statsById }), sort, usage),
    [rows, view, query, showRemoved, catLabel, statsById, sort, usage])
  const sections = useMemo(() => listSections(visible, { view, q: query }), [visible, view, query])
  const title = viewTitle(view, catLabel)
  // The open item: the one chosen, else a deep-linked one. A selection the current view
  // hides closes the panel rather than pointing at nothing.
  const chosenId = selectedId ?? (deepSlug ? rows.find(r => r.slug === deepSlug)?.id : null)
  const selected = (chosenId && visible.find(r => r.id === chosenId)) || null
  const sendCtx = useMemo(() => ({ students, units, matches, contacts: contacts || [], cohortName }),
    [students, units, matches, contacts, cohortName])

  const movedNotice = useMemo(() => personal.moved.filter(m => !dismissed.has(m.record_document_id)), [personal.moved, dismissed])


  // ── Actions ──
  const accessResource = useCallback(async (r, mode = 'open') => {
    if (r.resource_type === 'external_link') {
      if (r.external_url) window.open(r.external_url, '_blank', 'noopener,noreferrer')
      return
    }
    const pending = mode === 'open' ? window.open('', '_blank') : null
    if (pending) pending.opener = null
    try {
      const body = await authedPost('/api/catalog-resource-open', { slug: r.slug, mode })
      if (mode === 'download') {
        const a = document.createElement('a')
        a.href = body.signedUrl; a.rel = 'noopener'; a.download = ''
        document.body.appendChild(a); a.click(); a.remove()
      } else if (pending) pending.location = body.signedUrl
      else window.open(body.signedUrl, '_blank', 'noopener,noreferrer')
    } catch (e) {
      if (pending) pending.close()
      say('err', `Could not ${mode === 'download' ? 'download' : 'open'} "${r.title}": ${e.message}`)
    }
  }, [say])

  const runUpdate = useCallback(async (id, patch, okText) => {
    try {
      await authedPost('/api/catalog-resource-update', { id, ...patch })
      say('ok', okText); await load(); return true
    } catch (e) { say('err', e.message); return false }
  }, [load, say])

  const copyLink = useCallback(async (r) => {
    const link = `${window.location.origin}/catalog?resource=${encodeURIComponent(r.slug)}`
    try { await navigator.clipboard.writeText(link); say('ok', 'Catalog link copied.') }
    catch { say('err', `Copy failed. Link: ${link}`) }
  }, [say])

  const sigLink = useCallback((qs = '') => navigate(`/catalog/signatures${qs}`), [navigate])
  // FORMS-PHASE3: the brief's starter forms, added once (the server skips what exists).
  const installStarters = useCallback(async () => {
    try {
      const { results } = await formStaff('starters')
      const name = (r) => r.key === 'scrubex-request-form' ? 'ScrubEx Request Form' : 'Student Parking Request'
      const added = results.filter(r => r.added)
      const refreshed = results.filter(r => r.refreshed)
      const refused = results.filter(r => !r.added && !r.refreshed && r.reason)
      const parts = [
        added.length ? `Added ${added.map(name).join(' and ')}.` : '',
        ...refused.map(r => `${name(r)} was not added: ${r.reason}`),
        refreshed.length ? `Updated ${refreshed.map(name).join(' and ')} to Parking Services' form and published it.` : '',
      ].filter(Boolean)
      say('ok', parts.length ? parts.join(' ') : 'The starter forms are already in the Catalog.')
      await load()
    } catch (e) { say('err', e.message) }
  }, [say, load])

  const menuItems = useCallback((r) => {
    const ext = r.resource_type === 'external_link'
    const sig = kindOf(r) === 'signature' || kindOf(r) === 'form'   // neither is a file to open or download
    // A removed file cannot be opened, downloaded or linked to (the server refuses an
    // inactive row), so its menu offers only Restore; a file moved to a record, nothing.
    if (r.is_active === false) {
      return canManage && !r.moved_to_record_document_id
        ? [{ key: 'restore', label: 'Restore', onSelect: () => runUpdate(r.id, { is_active: true }, 'Restored to the Catalog.') }]
        : []
    }
    const items = [
      ...(sig ? [] : [{ key: 'open', label: ext ? 'Open link' : 'Open', onSelect: () => accessResource(r, 'open') }]),
      ...(ext || sig ? [] : [{ key: 'dl', label: 'Download', onSelect: () => accessResource(r, 'download') }]),
      { key: 'copy', label: 'Copy link', onSelect: () => copyLink(r) },
    ]
    if (!canManage) return items
    return [
      ...items,
      { key: 'edit', label: 'Edit details', onSelect: () => setDialog({ type: 'edit', row: r }) },
      // A PDF can become a signature template without being uploaded again.
      ...(features.signatures && !sig && !ext && isPdfFile(r) ? [{ key: 'sigtpl', label: 'Make a signature template', onSelect: () => sigLink(`?tab=prepare&from=${encodeURIComponent(r.id)}`) }] : []),
      ...(ext || sig ? [] : [{ key: 'ver', label: 'Upload new version', disabled: !phase1, onSelect: () => setDialog({ type: 'version', row: r }) }]),
      { key: 'pin', label: r.is_pinned ? 'Unpin' : 'Pin to top', onSelect: () => runUpdate(r.id, { is_pinned: !r.is_pinned }, r.is_pinned ? 'Unpinned.' : 'Pinned to the top.') },
      { key: 'remove', label: 'Remove', danger: true, onSelect: () => setDialog({ type: 'remove', row: r }) },
    ]
  }, [accessResource, copyLink, canManage, runUpdate, phase1, features.signatures, sigLink])

  const openSend = useCallback((r) => { if (canManage) setDialog({ type: 'send', row: r }) }, [canManage])

  const pickView = (next) => {
    setView({ type: 'all', category: null, track: null, ...next })
    setMenuFor(null)
  }
  if (!canView) {
    return <div className="ctl ctl-denied">The ASPIRE Catalog is available to Owner, Admin, and Interviewer accounts.</div>
  }

  if (formRoute) {
    return (
      <div className={`ctl${classic ? ' ctl-classic' : ''}`}>
        {!canManage || (formsStatus.ready && !formsStatus.enabled)
          ? <div className="ctl-state">Forms are not available yet.</div>
          : !formsStatus.ready ? <div className="ctl-state">Loading the form…</div>
          : (
            <Suspense fallback={<div className="ctl-state">Loading the form…</div>}>
              {msg && (
                <div className={`ctl-msg ctl-msg-${msg.tone}`} role={msg.tone === 'err' ? 'alert' : 'status'}>
                  {msg.text}<button type="button" aria-label="Dismiss message" onClick={() => setMsg(null)}><X size={14} /></button>
                </div>
              )}
              <FormsScreen formId={formRoute[1]} view={formRoute[2]} notify={notify} navigate={navigate} />
            </Suspense>
          )}
      </div>
    )
  }

  if (onSignatures) {
    return (
      <div className={`ctl${classic ? ' ctl-classic' : ''}`}>
        {!canManage || (sigFlag.ready && !sigFlag.allowed)
          ? <div className="ctl-state">Signatures are not available.</div>
          : !sigFlag.ready ? <div className="ctl-state">Loading Signatures…</div>
          : (
            <Suspense fallback={<div className="ctl-state">Loading Signatures…</div>}>
              {msg && (
                <div className={`ctl-msg ctl-msg-${msg.tone}`} role={msg.tone === 'err' ? 'alert' : 'status'}>
                  {msg.text}<button type="button" aria-label="Dismiss message" onClick={() => setMsg(null)}><X size={14} /></button>
                </div>
              )}
              <SignaturesPage key={location.search} flagState={sigFlag.state} notify={notify}
                people={{ students, contacts: contacts || [] }} backPath="/catalog" />
            </Suspense>
          )}
      </div>
    )
  }

  const isCur = (k, v) => (k === 'type' ? view.type === v && !view.category && !view.track : view[k] === v)
  const railRow = (key, k, v, label, icon, count, warn = false) => (
    <button key={key} type="button" className={`rr-row-select ctl-rail-row${isCur(k, v) ? ' sel' : ''}`}
      aria-current={isCur(k, v) ? 'true' : undefined}
      onClick={() => pickView(k === 'type' ? { type: v } : { [k]: v })}>
      <span className="ctl-rail-ico" aria-hidden="true">{icon}</span>
      <span className="rr-row-label">{label}</span>
      <span className={`ctl-rail-n${warn && count > 0 ? ' ctl-rail-warn' : ''}`}>{count}</span>
    </button>
  )

  const listProps = {
    sections, title, count: visible.length, selectedId: selected?.id || null, onSelect: setSelectedId, onSend: openSend,
    canManage, catLabel, usage, menuFor, setMenuFor, menuItems, emptyText: emptyTextFor(view, rows.length, query),
  }

  return (
    <div className={`ctl${classic ? ' ctl-classic' : ''}`}>
      <div className="ctl-back"><WorkspaceBackLink path={backPath} label={backLabel} /></div>

      <header className="ctl-head">
        <div>
          <h1>ASPIRE Catalog</h1>
          <p>Find a resource, then send it, collect it or get it signed.</p>
          <p className="ctl-summary">
            <b>{summary.items}</b> {summary.items === 1 ? 'item' : 'items'} · <b>{summary.out}</b> out for completion · <span className="ctl-summary-warn"><b>{summary.overduePeople}</b> people overdue</span>
          </p>
        </div>
        {/* Classic carries + New on the bookcase bar (the same menu), so the header holds none. */}
        {canManage && !classic && <NewMenu open={newOpen} setOpen={setNewOpen} features={features} onUpload={() => setDialog({ type: 'upload' })}
          onPrepare={() => sigLink('?tab=prepare')} onFromCatalog={() => sigLink('?tab=prepare&source=catalog')} onBuildForm={() => setDialog({ type: 'newform' })} onStarters={installStarters} onReview={() => setDialog({ type: 'personal' })} />}
      </header>

      {canManage && movedNotice.length > 0 && (
        <div className="ctl-notice" role="status">
          <UserRound size={16} aria-hidden="true" />
          <span>
            <b>{movedNotice.length} personal {movedNotice.length === 1 ? 'file' : 'files'} moved.</b>{' '}
            {movedNotice.length === 1
              ? <>{movedNotice[0].title} now lives on {movedNotice[0].student.name}'s record.</>
              : <>They now live on each student's record.</>}{' '}
            The Catalog holds shared resources only.
          </span>
          <button type="button" onClick={() => {
            const next = new Set(dismissed); movedNotice.forEach(m => next.add(m.record_document_id))
            setDismissed(next); writeDismissed(next)
          }}>Dismiss</button>
        </div>
      )}
      {canManage && personal.candidates > 0 && (
        <div className="ctl-notice ctl-notice-warn" role="status">
          <UserRound size={16} aria-hidden="true" />
          <span><b>{personal.candidates} {personal.candidates === 1 ? 'file looks' : 'files look'} personal.</b> {personal.candidates === 1 ? 'Its name matches' : 'Their names match'} a student. Review before moving anything.</span>
          <button type="button" onClick={() => setDialog({ type: 'personal' })}>Review</button>
        </div>
      )}
      {msg && (
        <div className={`ctl-msg ctl-msg-${msg.tone}`} role={msg.tone === 'err' ? 'alert' : 'status'}>
          {msg.text}<button type="button" aria-label="Dismiss message" onClick={() => setMsg(null)}><X size={14} /></button>
        </div>
      )}

      <div className={`ctl-grid${selected ? '' : ' ctl-nodetail'}`}>
        <nav className="rr-nav ctl-rail" aria-label="Catalog sections">
          <p className="rr-nav-group">Library</p>
          {railRow('all', 'type', 'all', 'All items', <ListIcon size={16} />, counts.byKind.all)}
          {railRow('file', 'type', 'file', 'Files', <FileText size={16} />, counts.byKind.file)}
          {features.forms && railRow('form', 'type', 'form', 'Forms', <ListChecks size={16} />, counts.byKind.form)}
          {features.signatures && railRow('sig', 'type', 'signature', 'Signature templates', <Signature size={16} />, counts.byKind.signature)}
          <p className="rr-nav-group">Tracking</p>
          {railRow('out', 'track', 'out', 'Out for completion', <ArrowRightFromLine size={16} />, counts.out)}
          {railRow('late', 'track', 'overdue', 'Overdue people', <Clock size={16} />, counts.overduePeople, true)}
          {features.signatures && (
            <button type="button" className="rr-row-select ctl-rail-row" onClick={() => sigLink()}>
              <span className="ctl-rail-ico" aria-hidden="true"><Signature size={16} /></span>
              <span className="rr-row-label">Signature requests</span>
              <span className="ctl-rail-n" aria-hidden="true">›</span>
            </button>
          )}
          <p className="rr-nav-group ctl-rail-grouphead">
            Categories
            {canManage && <button type="button" className="ctl-rail-manage" onClick={() => setDialog({ type: 'cats' })}>Manage</button>}
          </p>
          {assignableCats.map(c => railRow(`c:${c.key}`, 'category', c.key, c.label, <Tag size={14} />, counts.byCategory[c.key] || 0))}
        </nav>

        <section className="ctl-main" aria-label={title}>
          <div className="ctl-tools">
            <div className="ctl-search">
              <Search size={16} aria-hidden="true" />
              <input type="search" value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Search titles, descriptions and categories" aria-label="Search the Catalog" />
            </div>
            <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort">
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            {canManage && (
              <label className="ctl-check"><input type="checkbox" checked={showRemoved} onChange={e => setShowRemoved(e.target.checked)} /> Show removed</label>
            )}
          </div>

          {loading ? <div className="ctl-state">Loading the Catalog…</div>
            : error ? <div className="ctl-state ctl-state-err">Could not load the Catalog: {error.message}</div>
            : classic ? (
              <Bookcase {...listProps} mode={shelfMode} setMode={setShelfMode}
                newMenu={canManage ? <NewMenu inCase open={caseNewOpen} setOpen={setCaseNewOpen} features={features} onUpload={() => setDialog({ type: 'upload' })}
                  onPrepare={() => sigLink('?tab=prepare')} onFromCatalog={() => sigLink('?tab=prepare&source=catalog')} onBuildForm={() => setDialog({ type: 'newform' })} onStarters={installStarters} onReview={() => setDialog({ type: 'personal' })} /> : null} items={visible} />
            ) : (
              <ItemList {...listProps} />
            )}
        </section>

        {selected && (
          <div className="ctl-detail-wrap">
            <DetailPanel row={selected} catLabel={catLabel} sends={sendsById[selected.id] || []} sendsEnabled={sendsEnabled}
              canManage={canManage} onClose={() => setSelectedId('')} onSend={openSend} onAccess={accessResource}
              menuItems={menuItems} sigAllowed={features.signatures} onSigLink={sigLink} formsAllowed={features.forms} onFormLink={(id, v) => navigate(`/catalog/forms/${id}/${v}`)} stats={statsById[selected.id]} />
          </div>
        )}
      </div>

      {dialog?.type === 'send' && contacts && (
        <CatalogSendModal item={dialog.row} ctx={sendCtx} onClose={() => setDialog(null)}
          onSent={({ sent, log, keepOpen, signature, requests, form, failed }) => {
            if (form) {
              say(failed?.length ? 'err' : 'ok', `Form sent to ${sent} ${sent === 1 ? 'person' : 'people'}.${failed?.length ? ` The mail service did not accept ${failed.length}: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}.` : ''} Track them on its Responses.`)
              formStaff('tracker').then(r => setTrackRows(r.rows || [])).catch(() => {})
              setDialog(null); return
            }
            if (signature) {
              say('ok', `Sent for signature: ${requests} ${requests === 1 ? 'request' : 'requests'} to ${sent} ${sent === 1 ? 'person' : 'people'}. Track them in Signature requests.`)
              setDialog(null); return
            }
            const note = log.includes('not_enabled') ? ' The send log starts once the Catalog update is applied.' : ' Logged on the item.'
            say('ok', `Sent to ${sent} ${sent === 1 ? 'person' : 'people'}.${note}`)
            loadSends()
            if (!keepOpen) setDialog(null)
          }} />
      )}
      {dialog?.type === 'newform' && (
        <NewFormDialog categories={assignableCats} onClose={() => setDialog(null)}
          onCreated={(form) => { setDialog(null); navigate(`/catalog/forms/${form.id}/edit`) }} />
      )}
      {dialog?.type === 'send' && !contacts && <div className="modal-overlay"><div className="modal ctl-modal ctl-state" role="status">Loading recipients…</div></div>}
      {dialog?.type === 'upload' && (
        <AddResourceModal categories={assignableCats} onClose={() => setDialog(null)}
          onCreated={() => { setDialog(null); say('ok', 'File uploaded.'); load() }} />
      )}
      {dialog?.type === 'version' && (
        <NewVersionModal resource={dialog.row} onClose={() => setDialog(null)}
          onSaved={(v) => { setDialog(null); say('ok', `Version ${v} uploaded.`); load() }} />
      )}
      {dialog?.type === 'edit' && (
        <EditResourceModal resource={dialog.row} categories={assignableCats} onClose={() => setDialog(null)}
          onSaved={async (patch) => { const ok = await runUpdate(dialog.row.id, patch, 'Details saved.'); if (ok) setDialog(null); return ok }} />
      )}
      {dialog?.type === 'remove' && (
        <RemoveConfirmDialog resource={dialog.row} onCancel={() => setDialog(null)}
          onConfirm={async () => { const ok = await runUpdate(dialog.row.id, { is_active: false }, 'Removed. Turn on Show removed to restore it.'); if (ok) { setDialog(null); setSelectedId('') } }} />
      )}
      {dialog?.type === 'cats' && (
        <ManageCategoriesModal cats={cats} rows={rows} assignable={assignableCats} onClose={() => setDialog(null)}
          onSaved={() => { loadCats(); say('ok', 'Categories saved.') }}
          onReassign={(r, slug) => runUpdate(r.id, { category: slug }, `${r.title} moved to ${catLabel(slug)}.`)} />
      )}
      {dialog?.type === 'personal' && (
        <PersonalFilesModal onClose={() => { setDialog(null); loadPersonal() }}
          onMoved={(m) => { say('ok', `${m.title} now lives on ${m.student.name}'s record.`); load(); loadPersonal() }} />
      )}
    </div>
  )
}

function canViewCatalog(isOwner, isAdmin, isInterviewer) {
  return !!(isOwner || isAdmin || isInterviewer)
}

function emptyTextFor(view, total, q) {
  if (!total) return 'Nothing in the Catalog yet.'
  // A signature document is a reusable template; one-off sends live in Signature requests.
  if (view.type === 'signature' && !q) return 'No signature templates yet. Make one from + New: "Make a template from a Catalog file", or "Prepare a document for signature" and Save template. Documents already sent are in Tracking, Signature requests.'
  if (view.track) return 'Nothing is out for completion. Forms and signature requests show here once they are sent.'
  if (q) return 'No items match. Clear the search or pick another section.'
  return 'Nothing here yet.'
}

// ── + New ─────────────────────────────────────────────────────────────────────────
function NewMenu({ open, setOpen, features, onUpload, onPrepare, onFromCatalog, onBuildForm, onStarters, onReview, inCase = false }) {
  const wrap = useRef(null)
  useEffect(() => {
    if (!open) return
    const down = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false) }
    const key = (e) => { if (e.key === 'Escape') { setOpen(false); wrap.current?.querySelector('button')?.focus() } }
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key)
    wrap.current?.querySelector('[role="menuitem"]')?.focus()
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open, setOpen])
  const pick = (fn) => { setOpen(false); fn() }
  return (
    <div className={`ctl-new${inCase ? ' ctl-new-case' : ''}`} ref={wrap}>
      <button type="button" className={inCase ? 'ctl-wbtn' : 'ctl-btn ctl-btn-pri'} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>+ New</button>
      {open && (
        <div className="ctl-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => pick(onUpload)}>
            <span className="ctl-mi ctl-mi-file"><Upload size={16} /></span>
            <span><b>Upload a file</b><small>PDF, Word, Excel or image</small></span>
          </button>
          {features.forms && (
            <button type="button" role="menuitem" onClick={() => pick(onBuildForm)}><span className="ctl-mi ctl-mi-form"><ListChecks size={16} /></span>
              <span><b>Build a form</b><small>Collect answers. Prefill from the student record.</small></span></button>
          )}
          {features.forms && (
            <button type="button" role="menuitem" onClick={() => pick(onStarters)}><span className="ctl-mi ctl-mi-form"><ListChecks size={16} /></span>
              <span><b>Add the starter forms</b><small>ScrubEx Request and Student Parking Request. Adds only what is missing.</small></span></button>
          )}
          {features.signatures && (
            <button type="button" role="menuitem" onClick={() => pick(onPrepare)}><span className="ctl-mi ctl-mi-sign"><Signature size={16} /></span>
              <span><b>Prepare a document for signature</b><small>Upload a PDF, place fields, set signers.</small></span></button>
          )}
          {features.signatures && (
            <button type="button" role="menuitem" onClick={() => pick(onFromCatalog)}><span className="ctl-mi ctl-mi-sign"><Signature size={16} /></span>
              <span><b>Make a template from a Catalog file</b><small>Start from a PDF already in the Catalog. The file stays as it is.</small></span></button>
          )}
          <hr />
          <button type="button" role="menuitem" onClick={() => pick(onReview)}>
            <span className="ctl-mi ctl-mi-file"><UserRound size={16} /></span>
            <span><b>Review personal files</b><small>Move a file that belongs to one student onto their record.</small></span>
          </button>
        </div>
      )}
    </div>
  )
}

// ── Shared pieces of a row and a cover ─────────────────────────────────────────────
function TypeIcon({ row }) {
  const k = kindOf(row)
  if (k === 'form') return <span className="ctl-ft ctl-ft-form" aria-hidden="true"><ListChecks size={19} /></span>
  if (k === 'signature') return <span className="ctl-ft ctl-ft-sign" aria-hidden="true"><Signature size={19} /></span>
  const b = fileBadge(row)
  return <span className={`ctl-ft ctl-ft-${b.tone}`} aria-hidden="true">{b.label}</span>
}

function PinMark() {
  return (
    <span className="ctl-pin" title="Pinned">
      <Pin className="ctl-pin-star" size={13} aria-hidden="true" />
      <Paperclip className="ctl-pin-clip" size={15} aria-hidden="true" />
      <span className="ctl-sr">Pinned. </span>
    </span>
  )
}

function StatusCell({ row, usage }) {
  if (row.is_active === false) {
    return <div className="ctl-st"><span className="ctl-removed">{row.moved_to_record_document_id ? 'Moved to a record' : 'Removed'}</span></div>
  }
  const n = usage[row.id] || 0
  return (
    <div className="ctl-st">
      <span>Sent {n} {n === 1 ? 'time' : 'times'}</span>
      <span className="ctl-when">Updated {fmtShortDate(row.version_updated_at || row.updated_at)}</span>
    </div>
  )
}

// Arrow keys move between the options of one listbox; Enter and Space select.
function listKeys(e, onSelect, id) {
  if (e.key === 'Enter' || e.key === ' ') {
    if (e.target !== e.currentTarget) return
    e.preventDefault(); onSelect(id); return
  }
  const dir = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key]
  if (!dir && e.key !== 'Home' && e.key !== 'End') return
  const box = e.currentTarget.closest('[role="listbox"]')
  const opts = [...(box?.querySelectorAll('[role="option"]') || [])]
  const i = opts.indexOf(e.currentTarget)
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? opts.length - 1 : i + dir
  if (opts[next]) { e.preventDefault(); opts[next].focus() }
}

// ── Modern list (and Classic's list view, on paper) ─────────────────────────────────
function ItemList({ sections, title, count, selectedId, onSelect, onSend, canManage, catLabel, usage, menuFor, setMenuFor, menuItems, emptyText }) {
  return (
    <div className="ctl-listcard">
      <div className="ctl-lh" aria-hidden="true"><span /><span>{title} · {count}</span><span>Status</span><span /></div>
      <div role="listbox" aria-label={`${title}, ${count} items`}>
        {count === 0 && <div className="ctl-empty">{emptyText}</div>}
        {sections.map(sec => (
          <div key={sec.key} role="presentation">
            {sec.label && <div className="ctl-sect" role="presentation">{sec.label}</div>}
            {sec.rows.map(r => {
              const aud = audienceOf(r)
              return (
                <div key={r.id} id={`catalog-res-${r.slug}`} className={`ctl-it${r.is_active === false ? ' ctl-it-off' : ''}`}
                  role="option" tabIndex={0} aria-selected={r.id === selectedId}
                  onClick={(e) => { if (!e.target.closest('button')) onSelect(r.id) }}
                  onKeyDown={(e) => listKeys(e, onSelect, r.id)}>
                  <TypeIcon row={r} />
                  <div className="ctl-nm">
                    <b>{r.is_pinned && <PinMark />}<span>{r.title}</span></b>
                    {r.description && <small>{r.description}</small>}
                    <div className="ctl-meta">
                      <span className="ctl-tag">{catLabel(r.category)}</span>
                      <span className={`ctl-aud${aud === 'staff' ? ' ctl-aud-staff' : ''}`}>{audienceLabel(aud)}</span>
                    </div>
                  </div>
                  <StatusCell row={r} usage={usage} />
                  <div className="ctl-acts">
                    {canManage && r.is_active !== false && (
                      <button type="button" className="ctl-btn ctl-btn-sm" onClick={() => onSend(r)}><SendIcon size={14} /> {sendButtonLabel(r)}</button>
                    )}
                    {menuItems(r).length > 0 && (
                      <RowActionsMenu label={`More actions for ${r.title}`} open={menuFor === r.id}
                        onToggle={() => setMenuFor(menuFor === r.id ? null : r.id)} onClose={() => setMenuFor(null)} items={menuItems(r)} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Classic: the bookcase ─────────────────────────────────────────────────────────
function Bookcase({ mode, setMode, newMenu, items, ...listProps }) {
  const { title, count, selectedId, onSelect, onSend, canManage, catLabel, usage, emptyText } = listProps
  const bar = (
    <div className="ctl-casebar">
      <span className="ctl-wseg" role="group" aria-label="View">
        <button type="button" className="ctl-wbtn" aria-pressed={mode === 'shelf'} aria-label="Shelf view" onClick={() => setMode('shelf')}><LayoutGrid size={15} /></button>
        <button type="button" className="ctl-wbtn" aria-pressed={mode === 'list'} aria-label="List view" onClick={() => setMode('list')}><ListIcon size={15} /></button>
      </span>
      <b className="ctl-engr">{title}<small>{count}</small></b>
      {newMenu || <span className="ctl-wbtn-space" />}
    </div>
  )
  if (mode === 'list') {
    return <div className="ctl-case">{bar}<div className="ctl-caselist"><ItemList {...listProps} /></div></div>
  }
  const ordered = shelfOrder(items)
  return (
    <>
      <div className="ctl-case">
        {bar}
        <div className="ctl-shelves" role="listbox" aria-label={`${title}, ${count} items`}>
          {ordered.map(r => (
            <div key={r.id} className="ctl-slot">
              <Cover row={r} selected={r.id === selectedId} onSelect={onSelect} catLabel={catLabel} usage={usage} />
              {canManage && r.is_active !== false && (
                <button type="button" className="ctl-qs" onClick={() => onSend(r)} aria-label={`${sendButtonLabel(r)}: ${r.title}`}>
                  <SendIcon size={12} aria-hidden="true" /> Send
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      {count === 0
        ? <p className="ctl-shelfnote">{emptyText}</p>
        : <p className="ctl-shelfnote">Pinned items stand first on the top shelf.</p>}
    </>
  )
}

function Cover({ row, selected, onSelect, catLabel, usage }) {
  const k = kindOf(row)
  const badge = fileBadge(row)
  const n = usage[row.id] || 0
  const label = k === 'file' ? catLabel(row.category) : k === 'form' ? 'Form' : 'Signature'
  return (
    <button type="button" role="option" aria-selected={selected}
      className={`ctl-cover ctl-cover-${k} ctl-cover-${badge.tone}${row.is_pinned ? ' ctl-cover-pinned' : ''}${row.is_active === false ? ' ctl-cover-off' : ''}`}
      aria-label={`${row.title}${row.is_pinned ? ', pinned' : ''}`}
      onClick={() => onSelect(row.id)} onKeyDown={(e) => listKeys(e, onSelect, row.id)}>
      <span className="ctl-pg">
        <span className="ctl-band" />
        <span><span className="ctl-kind">{label}</span><span className={`ctl-ttl${isLongCoverTitle(row.title) ? ' ctl-ttl-long' : ''}`}>{row.title}</span></span>
        <span className="ctl-lines" aria-hidden="true">
          {k === 'form' ? <><i className="ctl-box" /><i className="ctl-box" /><i className="ctl-box" /></> : <><i /><i /><i className="ctl-short" /></>}
        </span>
        <span className="ctl-ft2">
          <span>{badge.label}{row.version ? ` · v${row.version}` : ''}</span>
          <span>{row.is_active === false ? (row.moved_to_record_document_id ? 'Moved' : 'Removed') : `Sent ${n} ${n === 1 ? 'time' : 'times'}`}</span>
        </span>
      </span>
      {k === 'signature' && <span className="ctl-flag" aria-hidden="true">SIGN HERE</span>}
      {row.is_pinned && <span className="ctl-sash" aria-hidden="true"><span>PINNED</span></span>}
    </button>
  )
}

// ── Detail panel ──────────────────────────────────────────────────────────────────
// The panel carries the item's ⋯ menu too (Owner, 2026-09-23): the bookcase has no row to
// hang one on, and a hover-only control on a cover is lost to touch and keyboard. So every
// action a list row offers is reachable from the panel in both styles. Open and Download
// are already buttons here, so the menu leaves them out while the item is active.
function DetailPanel({ row, catLabel, sends, sendsEnabled, canManage, onClose, onSend, onAccess, menuItems, sigAllowed, onSigLink, formsAllowed, onFormLink, stats }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const panelItems = menuItems(row).filter(i => i.key !== 'open' && i.key !== 'dl')
  const k = kindOf(row)
  const badge = fileBadge(row)
  const ext = row.resource_type === 'external_link'
  const off = row.is_active === false
  const kindLine = k === 'file' ? `${KIND_LABEL.file} · ${badge.label}` : KIND_LABEL[k]
  // A signature document is a template: it is sent, edited and previewed in Signatures,
  // never opened as a file (its storage_path names the template, not an object).
  const tplId = k === 'signature' ? String(row.storage_path || '').replace(/^sig-template:/, '') : null
  // A form is edited and tracked on its own screens; its storage_path names the form.
  const formId = k === 'form' ? String(row.storage_path || '').replace(/^form:/, '') : null
  const virtual = k === 'signature' || k === 'form'
  return (
    <aside className="ctl-detail" aria-label="Item details">
      <div className="ctl-dh">
        <div className={`ctl-k ctl-k-${k}`}>
          <span>{kindLine}</span>
          <button type="button" className="ctl-icon-btn" onClick={onClose} aria-label="Close details"><X size={16} /></button>
        </div>
        <h2>{row.title}</h2>
        {row.description && <p>{row.description}</p>}
        <div className="ctl-row">
          {canManage && !off && (k !== 'signature' || sigAllowed) && (k !== 'form' || formsAllowed) && <button type="button" className="ctl-btn ctl-btn-pri ctl-btn-sm" onClick={() => onSend(row)}><SendIcon size={14} /> {sendButtonLabel(row)}</button>}
          {k === 'signature' && sigAllowed && !off && tplId && <>
            <button type="button" className="ctl-btn ctl-btn-sm" onClick={() => onSigLink(`?tab=prepare&template=${encodeURIComponent(tplId)}&step=2`)}>Edit fields</button>
            <button type="button" className="ctl-btn ctl-btn-sm" onClick={() => onSigLink(`?tab=preview&template=${encodeURIComponent(tplId)}`)}>Preview as signer</button>
          </>}
          {k === 'form' && formsAllowed && canManage && !off && formId && <>
            <button type="button" className="ctl-btn ctl-btn-sm" onClick={() => onFormLink(formId, 'edit')}>Edit form</button>
            <button type="button" className="ctl-btn ctl-btn-sm" onClick={() => onFormLink(formId, 'responses')}>Responses{stats?.total ? ` (${stats.done} of ${stats.total})` : ''}</button>
          </>}
          {!off && !virtual && <button type="button" className="ctl-btn ctl-btn-sm" onClick={() => onAccess(row, 'open')}>{ext ? 'Open link' : 'Open'}</button>}
          {!off && !ext && !virtual && <button type="button" className="ctl-btn ctl-btn-sm" onClick={() => onAccess(row, 'download')}>Download</button>}
          {panelItems.length > 0 && (
            <span className="ctl-row-more">
              <RowActionsMenu label={`More actions for ${row.title}`} open={menuOpen}
                onToggle={() => setMenuOpen(o => !o)} onClose={() => setMenuOpen(false)} items={panelItems} />
            </span>
          )}
        </div>
        {off && <p className="ctl-removed">{row.moved_to_record_document_id ? 'This file moved to a student record and is no longer in the Catalog.' : 'Removed from the Catalog. Restore it from the ⋯ menu above.'}</p>}
      </div>
      <div className="ctl-db">
        <div className="ctl-preview" aria-hidden="true"><div className="ctl-preview-pg"><i className="h" /><i /><i /><i className="s" /><i /><i /><i className="s" /></div></div>
        <dl className="ctl-kv">
          <dt>Category</dt><dd>{catLabel(row.category)}</dd>
          <dt>Audience</dt><dd>{audienceLabel(audienceOf(row))}</dd>
          {!ext && <><dt>Version</dt><dd>v{row.version || 1} · {fmtShortDate(row.version_updated_at || row.created_at || row.updated_at)}</dd></>}
          {!ext && row.file_size_bytes ? <><dt>Size</dt><dd>{fmtBytes(row.file_size_bytes)}</dd></> : null}
        </dl>
        {canManage && <SendHistory sends={sends} enabled={sendsEnabled} current={row.version || 1} />}
      </div>
    </aside>
  )
}

// A send of an earlier version says which one; a send of the current version needs no tag.
function SendHistory({ sends, enabled, current }) {
  if (!enabled) return <p className="ctl-hint">The send log starts once the Catalog update is applied.</p>
  const n = sends.length
  const issued = (s) => (s.audience_labels?.length ? s.audience_labels.join(', ') : `${s.sent_count} ${s.sent_count === 1 ? 'person' : 'people'}`)
  return (
    <>
      <div className="ctl-envelope">
        <table className="ctl-route">
          <caption>Send history</caption>
          <thead><tr><th scope="col">Date sent</th><th scope="col">Issued to</th><th scope="col">Via</th></tr></thead>
          <tbody>
            {n === 0 && <tr><td className="ctl-route-d"><span>-</span></td><td>Not sent yet</td><td className="ctl-route-v" /></tr>}
            {sends.slice(0, 8).map(s => (
              <tr key={s.id}>
                <td className="ctl-route-d"><span>{fmtShortDate(s.sent_at)}</span></td>
                <td>{issued(s)}{s.resource_version !== current ? ` (v${s.resource_version})` : ''}</td>
                <td className="ctl-route-v">Outreach</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ctl-hint">Sent {n} {n === 1 ? 'time' : 'times'}. Every send is logged here and on each recipient's record.</p>
    </>
  )
}

// FORMS-PHASE3: + New > Build a form. A name and a category, then the builder opens.
function NewFormDialog({ categories, onClose, onCreated }) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('student_onboarding')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const create = async (e) => {
    e.preventDefault()
    if (!title.trim()) { setError('Name the form.'); return }
    setBusy(true); setError(null)
    try { onCreated((await formStaff('create', { title: title.trim(), category })).form) }
    catch (err) { setError(err.message); setBusy(false) }
  }
  return (
    <div className="modal-overlay" onMouseDown={() => !busy && onClose()}>
      <form className="modal ctl-modal" role="dialog" aria-modal="true" aria-labelledby="ctl-newform-title" onMouseDown={e => e.stopPropagation()} onSubmit={create}>
        <div className="ctl-mh"><div><h2 id="ctl-newform-title">Build a form</h2><p>Name it now; you add questions in the builder.</p></div>
          <button type="button" className="ctl-icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
        <div className="ctl-mb">
          <div className="ctl-field"><label htmlFor="ctl-newform-name">Form name</label>
            <input id="ctl-newform-name" autoFocus value={title} maxLength={200} onChange={e => setTitle(e.target.value)} placeholder="For example, Uniform Request" /></div>
          <div className="ctl-field"><label htmlFor="ctl-newform-cat">Category</label>
            <select id="ctl-newform-cat" value={category} onChange={e => setCategory(e.target.value)}>
              {categories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select></div>
          {error && <div className="ctl-err" role="alert">{error}</div>}
        </div>
        <div className="ctl-mf"><small>It stays a draft until you publish it.</small>
          <span className="ctl-mf-acts"><button type="button" className="ctl-btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="ctl-btn ctl-btn-pri" disabled={busy}>{busy ? 'Creating…' : 'Open the builder'}</button></span></div>
      </form>
    </div>
  )
}

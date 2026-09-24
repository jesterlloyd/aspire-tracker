// src/components/catalog/CatalogModals.jsx
//
// CATALOG-REVAMP-1 (Phase 1): the Catalog's dialogs. Upload, Edit details, Remove and
// Manage categories keep their CATALOG-2B/2C/3 server contracts; what changed is the
// audience field, Featured folding into Pinned, the live category list (retired ones
// hidden), Upload new version, the Forms reassignment worklist, and the personal-file
// review. Every dialog traps focus and closes on Escape (useModalFocus).
import { useEffect, useId, useState } from 'react'
import { X, ChevronUp, ChevronDown, UserRound, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { AUDIENCES, audienceOf } from '../../lib/catalog/catalogModel'
import useModalFocus from './useModalFocus'
import { authedPost } from './catalogApi'

const ALLOWED_EXTS = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'png', 'jpg', 'jpeg']
const ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg'
const MAX_FILE_BYTES = 10 * 1024 * 1024

function checkFile(file) {
  if (!file) return 'Choose a file to upload.'
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (!ALLOWED_EXTS.includes(ext)) return `Unsupported file type ".${ext}". Allowed: ${ALLOWED_EXTS.join(', ')}.`
  if (file.size > MAX_FILE_BYTES) return 'File exceeds the 10 MB limit.'
  return null
}

// sign -> PUT the bytes with the one-time token -> commit (CATALOG-2B), for a new file or,
// with replace_id, a new version of an existing one.
async function uploadThroughCatalog(file, meta) {
  const signed = await authedPost('/api/catalog-resource-upload', { phase: 'sign', ...meta, filename: file.name, size: file.size })
  const up = await supabase.storage.from('aspire-catalog')
    .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type || undefined })
  if (up.error) throw new Error(`File upload failed: ${up.error.message}`)
  return authedPost('/api/catalog-resource-upload', { phase: 'commit', ...meta, filename: file.name })
}

function Shell({ title, sub, onClose, busy, children, footer, wide }) {
  const ref = useModalFocus(onClose, { disabled: busy })
  const id = useId()
  return (
    <div className="modal-overlay" onMouseDown={() => !busy && onClose()}>
      <div ref={ref} className={`modal ctl-modal${wide ? ' ctl-modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id}
        onMouseDown={e => e.stopPropagation()}>
        <div className="ctl-mh">
          <div><h2 id={id}>{title}</h2>{sub && <p>{sub}</p>}</div>
          <button type="button" className="ctl-icon-btn" onClick={() => !busy && onClose()} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="ctl-mb">{children}</div>
        <div className="ctl-mf"><span /><span className="ctl-mf-acts">{footer}</span></div>
      </div>
    </div>
  )
}

function AudienceSelect({ value, onChange, id }) {
  return (
    <select id={id} value={value} onChange={e => onChange(e.target.value)}>
      {AUDIENCES.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
    </select>
  )
}

const Err = ({ children }) => children ? <div className="ctl-err" role="alert">{children}</div> : null

// ── Upload a file ───────────────────────────────────────────────────────────────
export function AddResourceModal({ categories, onClose, onCreated }) {
  const [file, setFile] = useState(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState(categories[0]?.key || '')
  const [audience, setAudience] = useState('everyone')
  const [tagsStr, setTagsStr] = useState('')
  const [isPinned, setIsPinned] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function submit() {
    setErr(null)
    const bad = checkFile(file)
    if (bad) { setErr(bad); return }
    if (!title.trim()) { setErr('Title is required.'); return }
    setBusy(true)
    try {
      await uploadThroughCatalog(file, {
        title: title.trim(), description: description.trim(), category,
        audience: [audience], tags: tagsStr.split(',').map(t => t.trim()).filter(Boolean), is_pinned: isPinned,
      })
      onCreated()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Shell title="Upload a file" sub="PDF, Word, Excel or image, up to 10 MB." onClose={onClose} busy={busy}
      footer={<>
        <button type="button" className="ctl-btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="ctl-btn ctl-btn-pri" onClick={submit} disabled={busy}>{busy ? 'Uploading…' : 'Upload file'}</button>
      </>}>
      <div className="ctl-field"><label htmlFor="ctl-up-file">File</label>
        <input id="ctl-up-file" type="file" accept={ACCEPT} data-autofocus onChange={e => setFile(e.target.files?.[0] || null)} /></div>
      <div className="ctl-field"><label htmlFor="ctl-up-title">Title</label>
        <input id="ctl-up-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. General Guidelines for Pre-Licensure Students" /></div>
      <div className="ctl-field"><label htmlFor="ctl-up-desc">Description <span className="ctl-opt">(optional)</span></label>
        <textarea id="ctl-up-desc" rows={2} value={description} onChange={e => setDescription(e.target.value)} /></div>
      <div className="ctl-two">
        <div className="ctl-field"><label htmlFor="ctl-up-cat">Category</label>
          <select id="ctl-up-cat" value={category} onChange={e => setCategory(e.target.value)}>
            {categories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select></div>
        <div className="ctl-field"><label htmlFor="ctl-up-aud">Audience</label>
          <AudienceSelect id="ctl-up-aud" value={audience} onChange={setAudience} /></div>
      </div>
      <div className="ctl-field"><label htmlFor="ctl-up-tags">Tags <span className="ctl-opt">(comma-separated)</span></label>
        <input id="ctl-up-tags" value={tagsStr} onChange={e => setTagsStr(e.target.value)} placeholder="guidelines, onboarding" /></div>
      <label className="ctl-check"><input type="checkbox" checked={isPinned} onChange={e => setIsPinned(e.target.checked)} /> Pin to the top</label>
      <Err>{err}</Err>
    </Shell>
  )
}

// ── Upload new version ──────────────────────────────────────────────────────────
export function NewVersionModal({ resource, onClose, onSaved }) {
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const next = (resource.version || 1) + 1
  async function submit() {
    setErr(null)
    const bad = checkFile(file)
    if (bad) { setErr(bad); return }
    setBusy(true)
    try {
      await uploadThroughCatalog(file, { replace_id: resource.id })
      onSaved(next)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Shell title="Upload new version" sub={resource.title} onClose={onClose} busy={busy}
      footer={<>
        <button type="button" className="ctl-btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="ctl-btn ctl-btn-pri" onClick={submit} disabled={busy}>{busy ? 'Uploading…' : `Upload as v${next}`}</button>
      </>}>
      <div className="ctl-field"><label htmlFor="ctl-nv-file">File</label>
        <input id="ctl-nv-file" type="file" accept={ACCEPT} data-autofocus onChange={e => setFile(e.target.files?.[0] || null)} /></div>
      <p className="ctl-hint">The title, category and every copied link stay the same. New sends attach v{next}; the send log keeps the version each earlier send went out with.</p>
      <Err>{err}</Err>
    </Shell>
  )
}

// ── Edit details ────────────────────────────────────────────────────────────────
export function EditResourceModal({ resource, categories, onClose, onSaved }) {
  const [title, setTitle] = useState(resource.title || '')
  const [description, setDescription] = useState(resource.description || '')
  const [category, setCategory] = useState(resource.category)
  const [audience, setAudience] = useState(audienceOf(resource))
  const [tagsStr, setTagsStr] = useState(Array.isArray(resource.tags) ? resource.tags.join(', ') : '')
  const [isPinned, setIsPinned] = useState(!!resource.is_pinned)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  // A row still in a retired category may stay there until it is reassigned.
  const options = categories.some(c => c.key === resource.category)
    ? categories : [{ key: resource.category, label: `${resource.category} (retired)` }, ...categories]

  async function save() {
    setErr(null)
    if (!title.trim()) { setErr('Title is required.'); return }
    setBusy(true)
    try {
      const patch = {
        title: title.trim(), description: description.trim(),
        tags: tagsStr.split(',').map(t => t.trim()).filter(Boolean), is_pinned: isPinned,
        audience: [audience],
      }
      if (category !== resource.category) patch.category = category
      const ok = await onSaved(patch)
      if (!ok) setErr('The change was not saved. See the message on the page.')
    } finally { setBusy(false) }
  }
  return (
    <Shell title="Edit details" sub="The file and its link stay the same; only these details change." onClose={onClose} busy={busy}
      footer={<>
        <button type="button" className="ctl-btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="ctl-btn ctl-btn-pri" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
      </>}>
      <div className="ctl-field"><label htmlFor="ctl-ed-title">Title</label>
        <input id="ctl-ed-title" data-autofocus value={title} onChange={e => setTitle(e.target.value)} /></div>
      <div className="ctl-field"><label htmlFor="ctl-ed-desc">Description <span className="ctl-opt">(optional)</span></label>
        <textarea id="ctl-ed-desc" rows={2} value={description} onChange={e => setDescription(e.target.value)} /></div>
      <div className="ctl-two">
        <div className="ctl-field"><label htmlFor="ctl-ed-cat">Category</label>
          <select id="ctl-ed-cat" value={category} onChange={e => setCategory(e.target.value)}>
            {options.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select></div>
        <div className="ctl-field"><label htmlFor="ctl-ed-aud">Audience</label>
          <AudienceSelect id="ctl-ed-aud" value={audience} onChange={setAudience} /></div>
      </div>
      <div className="ctl-field"><label htmlFor="ctl-ed-tags">Tags <span className="ctl-opt">(comma-separated)</span></label>
        <input id="ctl-ed-tags" value={tagsStr} onChange={e => setTagsStr(e.target.value)} /></div>
      <label className="ctl-check"><input type="checkbox" checked={isPinned} onChange={e => setIsPinned(e.target.checked)} /> Pin to the top</label>
      <Err>{err}</Err>
    </Shell>
  )
}

// ── Permanent delete ────────────────────────────────────────────────────────────
export function DeleteConfirmDialog({ resource, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  return (
    <Shell title="Permanently delete from the Catalog?" onClose={onCancel} busy={busy}
      footer={<>
        <button type="button" className="ctl-btn" onClick={onCancel} disabled={busy} data-autofocus>Cancel</button>
        <button type="button" className="ctl-btn ctl-btn-danger" disabled={busy}
          onClick={async () => { setErr(null); setBusy(true); try { await onConfirm() } catch (e) { setErr(e.message) } finally { setBusy(false) } }}>
          {busy ? 'Deleting…' : 'Delete permanently'}
        </button>
      </>}>
      <p className="ctl-p"><b>{resource.title}</b> and its Catalog send log will be permanently deleted. A stored Catalog file is deleted too.</p>
      {resource.moved_to_record_document_id
        ? <p className="ctl-hint">The copy already moved to the student profile is preserved.</p>
        : <p className="ctl-hint">This cannot be undone. Items used by a form, form assignment, signature template or signature request cannot be deleted.</p>}
      <Err>{err}</Err>
    </Shell>
  )
}

// ── Manage categories ───────────────────────────────────────────────────────────
// Rename and reorder, as CATALOG-3 built it. The reorder endpoint needs every stored slug,
// so a retired category stays in this list (marked) and at the end. Below it, the items
// still filed under a retired category, each with a category to move to.
export function ManageCategoriesModal({ cats, rows, assignable, ownerActions, onClose, onSaved, onReassign }) {
  const [draft, setDraft] = useState(() => cats.map(c => ({
    slug: c.slug, display_name: c.display_name || '', description: c.description || '', retired: !!c.retired_at,
  })))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [confirmSlug, setConfirmSlug] = useState(null)
  const retired = new Set(cats.filter(c => c.retired_at).map(c => c.slug))
  const worklist = rows.filter(r => retired.has(r.category) && r.is_active !== false)
  const suggest = (r) => (assignable.some(c => c.key === 'student_onboarding') && /student|onboard|scrub|parking|consent|form|request/i.test(`${r.title} ${r.description || ''}`))
    ? 'student_onboarding' : (assignable[0]?.key || '')
  const [targets, setTargets] = useState(() => Object.fromEntries(worklist.map(r => [r.id, suggest(r)])))

  const move = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= draft.length) return
    const next = draft.slice(); [next[i], next[j]] = [next[j], next[i]]; setDraft(next)
  }
  const setField = (i, f, v) => { const next = draft.slice(); next[i] = { ...next[i], [f]: v }; setDraft(next) }
  const itemCount = (slug) => rows.filter(r => r.category === slug).length

  async function addCategory() {
    setErr(null)
    if (!newName.trim()) { setErr('Category name is required.'); return }
    setBusy(true)
    try {
      const { category } = await authedPost('/api/catalog-category-update', {
        action: 'create', display_name: newName.trim(), description: newDescription.trim(),
      })
      setDraft(d => [...d, { slug: category.slug, display_name: category.display_name, description: category.description || '', retired: false }])
      setNewName(''); setNewDescription(''); setAdding(false); onSaved()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  async function deleteCategory(slug) {
    setErr(null); setBusy(true)
    try {
      await authedPost('/api/catalog-category-update', { action: 'delete', slug, confirm: true })
      setDraft(d => d.filter(c => c.slug !== slug)); setConfirmSlug(null); onSaved()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  async function save() {
    setErr(null)
    if (draft.some(d => !d.display_name.trim())) { setErr('Every category needs a display name.'); return }
    const orig = Object.fromEntries(cats.map(c => [c.slug, c]))
    setBusy(true)
    try {
      for (const d of draft) {
        const o = orig[d.slug] || {}
        if (d.display_name.trim() !== (o.display_name || '') || d.description.trim() !== (o.description || '')) {
          await authedPost('/api/catalog-category-update', { action: 'rename', slug: d.slug, display_name: d.display_name.trim(), description: d.description.trim() })
        }
      }
      const order = draft.map(d => d.slug)
      if (JSON.stringify(order) !== JSON.stringify(cats.map(c => c.slug))) {
        await authedPost('/api/catalog-category-update', { action: 'reorder', order })
      }
      onSaved(); onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Shell wide title="Manage categories" sub="Rename, reorder, add or delete empty categories. Existing category IDs stay fixed."
      onClose={onClose} busy={busy}
      footer={<>
        <button type="button" className="ctl-btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="ctl-btn ctl-btn-pri" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save categories'}</button>
      </>}>
      {ownerActions && (
        <div className="ctl-catadd">
          {!adding ? (
            <button type="button" className="ctl-btn ctl-btn-sm" onClick={() => setAdding(true)} disabled={busy}><Plus size={14} /> Add category</button>
          ) : (
            <div className="ctl-catadd-fields">
              <div className="ctl-field"><label htmlFor="ctl-new-cat-name">Category name</label>
                <input id="ctl-new-cat-name" data-autofocus value={newName} maxLength={200} onChange={e => setNewName(e.target.value)} /></div>
              <div className="ctl-field"><label htmlFor="ctl-new-cat-desc">Description <span className="ctl-opt">(optional)</span></label>
                <input id="ctl-new-cat-desc" value={newDescription} maxLength={500} onChange={e => setNewDescription(e.target.value)} /></div>
              <span className="ctl-mf-acts">
                <button type="button" className="ctl-btn ctl-btn-sm" onClick={() => { setAdding(false); setNewName(''); setNewDescription('') }} disabled={busy}>Cancel</button>
                <button type="button" className="ctl-btn ctl-btn-sm ctl-btn-pri" onClick={addCategory} disabled={busy}>{busy ? 'Adding…' : 'Add'}</button>
              </span>
            </div>
          )}
        </div>
      )}
      <div className="ctl-catlist">
        {draft.map((d, i) => (
          <div key={d.slug} className="ctl-catrow">
            <div className="ctl-catmove">
              <button type="button" className="ctl-icon-btn ctl-icon-sm" aria-label={`Move ${d.display_name} up`} disabled={i === 0} onClick={() => move(i, -1)}><ChevronUp size={14} /></button>
              <button type="button" className="ctl-icon-btn ctl-icon-sm" aria-label={`Move ${d.display_name} down`} disabled={i === draft.length - 1} onClick={() => move(i, 1)}><ChevronDown size={14} /></button>
            </div>
            <div className="ctl-catfields">
              <input value={d.display_name} onChange={e => setField(i, 'display_name', e.target.value)} aria-label={`Display name for ${d.slug}`} />
              <input value={d.description} onChange={e => setField(i, 'description', e.target.value)} aria-label={`Description for ${d.slug}`} placeholder="Description (optional)" className="ctl-catdesc" />
            </div>
            <span className="ctl-catslug">
              <span>{d.slug}</span>{d.retired && <em>Retired</em>}
              {ownerActions && (confirmSlug === d.slug ? (
                <span className="ctl-catdelete-confirm">
                  <button type="button" className="ctl-btn ctl-btn-sm" onClick={() => setConfirmSlug(null)} disabled={busy}>Cancel</button>
                  <button type="button" className="ctl-btn ctl-btn-sm ctl-btn-danger" onClick={() => deleteCategory(d.slug)} disabled={busy || itemCount(d.slug) > 0}>Confirm delete</button>
                </span>
              ) : (
                <button type="button" className="ctl-icon-btn ctl-icon-sm ctl-catdelete" aria-label={`Delete ${d.display_name}`}
                  title={itemCount(d.slug) > 0 ? `${itemCount(d.slug)} Catalog item${itemCount(d.slug) === 1 ? '' : 's'} must be moved or deleted first` : `Delete ${d.display_name}`}
                  disabled={busy || itemCount(d.slug) > 0} onClick={() => setConfirmSlug(d.slug)}><Trash2 size={14} /></button>
              ))}
              {ownerActions && itemCount(d.slug) > 0 && <small>{itemCount(d.slug)} {itemCount(d.slug) === 1 ? 'item' : 'items'}</small>}
            </span>
          </div>
        ))}
      </div>

      {worklist.length > 0 && (
        <div className="ctl-worklist">
          <p className="ctl-h3">Still filed under a retired category ({worklist.length})</p>
          <p className="ctl-hint">Forms is now a kind of item, not a category. Move each of these to a category; student paperwork usually belongs in Student Onboarding.</p>
          {worklist.map(r => (
            <div key={r.id} className="ctl-workrow">
              <span className="ctl-worktitle">{r.title}</span>
              <select aria-label={`New category for ${r.title}`} value={targets[r.id] || ''} onChange={e => setTargets(t => ({ ...t, [r.id]: e.target.value }))}>
                {assignable.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              <button type="button" className="ctl-btn ctl-btn-sm" disabled={busy || !targets[r.id]}
                onClick={() => onReassign(r, targets[r.id])}>Move</button>
            </div>
          ))}
        </div>
      )}
      <Err>{err}</Err>
    </Shell>
  )
}

// ── Personal files review ───────────────────────────────────────────────────────
// Lists Catalog files whose names match a student. A staff member picks the student and
// confirms each move; nothing moves on a match alone.
export function PersonalFilesModal({ onClose, onMoved }) {
  const [state, setState] = useState({ loading: true, error: null, candidates: [], enabled: true })
  const [choice, setChoice] = useState({})
  const [confirming, setConfirming] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const load = async () => {
    try {
      const data = await authedPost('/api/catalog-personal-files')
      setState({ loading: false, error: null, candidates: data.candidates || [], enabled: data.enabled !== false })
      setChoice(Object.fromEntries((data.candidates || []).map(c => [c.resource.id, c.students.length === 1 ? c.students[0].id : ''])))
    } catch (e) { setState(s => ({ ...s, loading: false, error: e.message })) }
  }
  useEffect(() => { load() }, [])

  async function doMove(c) {
    setErr(null); setBusy(true)
    try {
      const data = await authedPost('/api/catalog-personal-files', { resource_id: c.resource.id, student_id: choice[c.resource.id], confirm: true })
      setConfirming(null)
      setState(s => ({ ...s, candidates: s.candidates.filter(x => x.resource.id !== c.resource.id) }))
      onMoved(data.moved)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const studentName = (c) => c.students.find(s => s.id === choice[c.resource.id])?.name

  return (
    <Shell wide title="Personal files in the Catalog" sub="The Catalog holds shared resources only. Move each file that belongs to one student onto that student's record."
      onClose={onClose} busy={busy}
      footer={<button type="button" className="ctl-btn" onClick={onClose} disabled={busy}>Close</button>}>
      {state.loading ? <p className="ctl-hint">Looking for files named after a student…</p>
        : state.error ? <Err>{state.error}</Err>
        : !state.candidates.length ? <p className="ctl-p">No Catalog file is named after a student. Nothing to move.</p>
        : (
          <div className="ctl-pf-list">
            {!state.enabled && <p className="ctl-hint">Moving is available once the Catalog update is applied. You can review the list now.</p>}
            {state.candidates.map(c => (
              <div key={c.resource.id} className="ctl-pf-row">
                <span className="ctl-pf-icon"><UserRound size={16} /></span>
                <div className="ctl-pf-main">
                  <b>{c.resource.title}</b>
                  <small>{c.resource.file_name}</small>
                </div>
                <select aria-label={`Student for ${c.resource.title}`} value={choice[c.resource.id] || ''}
                  onChange={e => setChoice(ch => ({ ...ch, [c.resource.id]: e.target.value }))}>
                  {c.students.length > 1 && <option value="">Choose the student…</option>}
                  {c.students.map(s => <option key={s.id} value={s.id}>{s.name}{s.school ? ` · ${s.school}` : ''}</option>)}
                </select>
                {confirming === c.resource.id ? (
                  <span className="ctl-pf-confirm">
                    <button type="button" className="ctl-btn ctl-btn-sm ctl-btn-pri" disabled={busy} onClick={() => doMove(c)}>
                      {busy ? 'Moving…' : `Move to ${studentName(c)}`}
                    </button>
                    <button type="button" className="ctl-btn ctl-btn-sm" disabled={busy} onClick={() => setConfirming(null)}>Cancel</button>
                  </span>
                ) : (
                  <button type="button" className="ctl-btn ctl-btn-sm" disabled={!choice[c.resource.id] || !state.enabled}
                    onClick={() => setConfirming(c.resource.id)}>Move…</button>
                )}
              </div>
            ))}
          </div>
        )}
      <Err>{err}</Err>
    </Shell>
  )
}

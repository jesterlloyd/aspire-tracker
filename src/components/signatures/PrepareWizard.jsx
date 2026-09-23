// src/components/signatures/PrepareWizard.jsx
//
// SIGNATURES-PHASE2: Prepare and send, four steps (brief section 4): Document, Recipients,
// Place fields, Review and send. PDF uploads only (Owner, 2026-09-23: Word files are saved
// as PDF first, so nothing leaves ASPIRE and pages never shift). Identity check is the
// emailed link + one-time code; text codes and portal sign-in are not built yet.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import {
  DOCUMENT_TYPES, isExcludedType, RECIPIENT_TYPES, colorForIndex, SENDER_ROLE, sendIssues, templateIssues, ruleSummaries, fieldLabel,
} from '../../lib/signatures/sigModel'
import { searchPeople, AUDIENCES } from '../../lib/catalog/catalogModel'
import FieldEditor from './FieldEditor'
import { sigStaff } from './sigApi'
import { blankRecipient, emptyDraft, nextRoleKey } from '../../lib/signatures/draft'

const STEPS = ['Document', 'Recipients', 'Place fields', 'Review and send']

export default function PrepareWizard({ initial, draftId: initialDraftId, startStep = 0, onSent, onPreview, notify, people }) {
  const [d, setD] = useState(() => ({ ...emptyDraft(), ...(initial || {}) }))
  const [step, setStep] = useState(startStep)
  const [draftId, setDraftId] = useState(initialDraftId || null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [templates, setTemplates] = useState([])
  const [docUrl, setDocUrl] = useState(null)
  const [cats, setCats] = useState([])
  const set = (patch) => setD(x => ({ ...x, ...patch }))
  const cat = { ...emptyDraft().catalog, ...(d.catalog || {}) }
  const setCat = (patch) => set({ catalog: { ...cat, ...patch, touched: true } })

  // The Catalog's own categories, less retired ones, for the template's Catalog item.
  useEffect(() => {
    supabase.from('catalog_categories').select('slug, display_name, retired_at').order('sort_order')
      .then(({ data }) => setCats((data || []).filter(c => !c.retired_at)))
  }, [])

  useEffect(() => { sigStaff('templates').then(r => setTemplates(r.templates || [])).catch(() => {}) }, [])
  useEffect(() => {
    if (!d.documentPath) { setDocUrl(null); return }
    sigStaff('doc_url', { path: d.documentPath }).then(r => setDocUrl(r.url)).catch(() => setDocUrl(null))
  }, [d.documentPath])

  const signers = d.recipients.map((r, i) => ({ ...r, roleKey: r.roleKey || `r${i + 1}` }))
  const issues = useMemo(() => sendIssues({ recipients: signers, fields: d.fields, documentType: d.documentType, excludedConfirmed: d.excludedConfirmed, senderValues: d.senderValues }), [signers, d.fields, d.documentType, d.excludedConfirmed, d.senderValues])
  const tplIssues = useMemo(() => templateIssues({ recipients: signers, fields: d.fields, documentType: d.documentType, excludedConfirmed: d.excludedConfirmed }), [signers, d.fields, d.documentType, d.excludedConfirmed])
  const stepBlock = step === 0 && !d.documentPath ? 'Upload a PDF or pick a template first.' : step === 0 && !d.title.trim() ? 'Name the document.' : null

  const pickTemplate = async (id) => {
    if (!id) { set({ templateId: null }); return }
    try {
      const { template: t } = await sigStaff('template_get', { template_id: id })
      const roles = t.signer_roles || []
      set({
        templateId: t.id, title: t.name, documentType: t.document_type, documentPath: t.source_path, sha256: t.source_sha256,
        pageSizes: t.page_sizes, fields: t.fields || [], ordered: t.signing_order !== 'parallel',
        recipients: roles.length ? roles.map((r, i) => ({ roleKey: r.key, type: r.type || 'signer', name: r.defaultName || '', email: r.defaultEmail || '', color: colorForIndex(i), label: r.label })) : [blankRecipient(0)],
      })
    } catch (e) { setErr(e.message) }
  }

  const upload = async (files) => {
    setErr(null); setBusy(true)
    try {
      const paths = []
      for (const file of files) {
        if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error(`${file.name} is not a PDF. Save Word files as PDF first.`)
        const s = await sigStaff('upload_sign', { size: file.size })
        const up = await supabase.storage.from('signature-documents').uploadToSignedUrl(s.path, s.token, file, { contentType: 'application/pdf' })
        if (up.error) throw new Error(`Upload failed: ${up.error.message}`)
        paths.push(s.path)
      }
      const c = await sigStaff('upload_commit', { paths })
      set({ documentPath: c.path, sha256: c.sha256, pageSizes: c.page_sizes, templateId: null, fields: [], title: d.title || files[0].name.replace(/\.pdf$/i, '') })
      notify?.(files.length > 1 ? `${files.length} files joined into one document of ${c.page_count} pages.` : `Uploaded, ${c.page_count} ${c.page_count === 1 ? 'page' : 'pages'}.`)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const saveDraft = async () => {
    setBusy(true); setErr(null)
    try { const r = await sigStaff('draft_save', { draft_id: draftId, draft: d }); setDraftId(r.id); notify?.('Draft saved.') }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const rolesOf = () => signers.map(r => ({ key: r.roleKey, type: r.type, label: r.label || r.name, defaultName: r.name, defaultEmail: r.email }))
  // A new template writes its Catalog details; an update writes them only if they were
  // changed here, so a re-save never blanks what Edit details set in the Catalog.
  const catalogOf = () => (d.templateId && !cat.touched ? undefined : {
    description: cat.description, audience: cat.audience, tags: cat.tags, pinned: cat.pinned,
    ...(cat.category ? { category: cat.category } : {}),
  })
  const putTemplate = async (roles) => {
    const t = await sigStaff('template_save', { template: { id: d.templateId, name: d.title, documentType: d.documentType, excludedConfirmed: d.excludedConfirmed, sourcePath: d.documentPath, sourceSha256: d.sha256, pageCount: d.pageSizes.length, pageSizes: d.pageSizes, fields: d.fields, roles, signingOrder: d.ordered ? 'sequential' : 'parallel', catalog: catalogOf() } })
    set({ templateId: t.template.id })
    return t.template.id
  }

  // Save the template without sending anything (Owner, 2026-09-23: the first template is
  // made before anyone is asked to sign it).
  const saveTemplateOnly = async () => {
    setBusy(true); setErr(null)
    try {
      const had = !!d.templateId
      await putTemplate(rolesOf())
      notify?.(had ? 'Template updated in the Catalog.' : 'Saved to the Catalog under Signature templates. Nothing was sent.')
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const send = async () => {
    setBusy(true); setErr(null)
    try {
      let templateId = d.templateId
      const roles = rolesOf()
      if (d.saveTemplate) templateId = await putTemplate(roles)
      const out = await sigStaff('send', { send: {
        templateId, title: d.title, documentType: d.documentType, excludedConfirmed: d.excludedConfirmed, documentPath: d.documentPath,
        originalSha256: d.sha256, pageSizes: d.pageSizes, fields: d.fields, roles, mode: 'one',
        people: [], fixed: signers.map(r => ({ name: r.name, email: r.email, roleKey: r.roleKey, type: r.type, studentId: r.studentId, contactId: r.contactId, schoolName: r.schoolName })),
        signingOrder: d.ordered ? 'sequential' : 'parallel', senderValues: d.senderValues, subject: d.subject || `Please sign: ${d.title}`,
        message: d.message, reminderRule: d.reminderRule, expiresDays: Number(d.expiresDays) || 30, draftId,
      } })
      onSent?.(out)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="sg-prepare">
      <div className="sg-steps" role="list">
        {STEPS.map((s, i) => (
          <button key={s} type="button" role="listitem" className={i < step ? 'sg-done' : ''} aria-current={i === step ? 'step' : undefined}
            onClick={() => { if (i <= step || !stepBlock) setStep(i) }}>
            <span className="sg-o">{i < step ? '✓' : i + 1}</span>{s}
          </button>
        ))}
      </div>

      {step === 0 && (
        <div className="sg-card sg-panel">
          <p className="sg-h3">Start from</p>
          <div className="sg-srcs">
            <button type="button" className="sg-src" aria-pressed={d.source === 'tpl'} onClick={() => set({ source: 'tpl' })}><b>Use a template</b><small>Fields and recipients already placed.</small></button>
            <button type="button" className="sg-src" aria-pressed={d.source === 'pdf'} onClick={() => set({ source: 'pdf' })}><b>Upload a PDF</b><small>Signs exactly as uploaded. Several files join into one.</small></button>
            <div className="sg-src sg-src-off" aria-disabled="true"><b>Upload a Word file</b><small>Not available: save the file as PDF first, so pages never shift.</small></div>
          </div>
          {d.source === 'tpl' ? (
            <div className="sg-field"><label htmlFor="sg-tpl">Template</label>
              <select id="sg-tpl" value={d.templateId || ''} onChange={e => pickTemplate(e.target.value)}>
                <option value="">Choose a template…</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name} · {(t.signer_roles || []).filter(r => r.type !== 'cc').length} signers · {(t.fields || []).length} fields</option>)}
              </select>
              {!templates.length && <p className="sg-hint">No templates yet. Upload a PDF and turn on "Save as a template" when you send.</p>}
            </div>
          ) : (
            <div className="sg-drop">
              <label className="sg-btn" htmlFor="sg-upload">{busy ? 'Uploading…' : d.documentPath ? 'Replace with other PDFs' : 'Choose PDF files'}</label>
              <input id="sg-upload" className="sg-sr" type="file" accept="application/pdf,.pdf" multiple onChange={e => e.target.files?.length && upload([...e.target.files])} />
              <p className="sg-hint">{d.documentPath ? `${d.pageSizes.length} pages ready.` : 'Up to 25 MB. Pick several to join them into one document, in order.'}</p>
            </div>
          )}
          <div className="sg-two">
            <div className="sg-field"><label htmlFor="sg-dtype">Document type</label>
              <select id="sg-dtype" value={d.documentType} onChange={e => set({ documentType: e.target.value, excludedConfirmed: false })}>
                {DOCUMENT_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}{t.excluded ? ' (excluded)' : ''}</option>)}
              </select></div>
            <div className="sg-field"><label htmlFor="sg-dname">Document name</label><input id="sg-dname" value={d.title} onChange={e => set({ title: e.target.value })} /></div>
          </div>
          {isExcludedType(d.documentType) && (
            <div className="sg-note" role="alert">
              <span>The law excludes this type from electronic signature (California UETA, federal ESIGN). It can be sent only if an admin confirms it is allowed.</span>
              <label className="sg-chkline"><input type="checkbox" checked={d.excludedConfirmed} onChange={e => set({ excludedConfirmed: e.target.checked })} /> I am an admin, and I confirm this document may be signed electronically.</label>
            </div>
          )}
          <p className="sg-hint">Document type sets retention and checks for types the law excludes from e-signature.</p>
        </div>
      )}

      {step === 1 && <Recipients d={d} set={set} people={people} />}

      {step === 2 && (
        <FieldEditor fields={d.fields} setFields={(fn) => setD(x => ({ ...x, fields: typeof fn === 'function' ? fn(x.fields) : fn }))}
          signers={signers.filter(r => r.type !== 'cc')} pageSizes={d.pageSizes} source={docUrl ? { url: docUrl } : null} notify={notify} />
      )}

      {step === 3 && (
        <div className="sg-review">
          <div className="sg-card sg-panel">
            {d.fields.some(f => f.role === SENDER_ROLE) && (
              <>
                <p className="sg-h3">Fill before sending</p>
                {d.fields.filter(f => f.role === SENDER_ROLE).map(f => (
                  <div key={f.id} className="sg-field"><label htmlFor={`sg-sv-${f.id}`}>{fieldLabel(f)} (locked for signers)</label>
                    <input id={`sg-sv-${f.id}`} value={d.senderValues[f.id] || ''} onChange={e => set({ senderValues: { ...d.senderValues, [f.id]: e.target.value } })} /></div>
                ))}
              </>
            )}
            <p className="sg-h3">Email to signers</p>
            <div className="sg-field"><label htmlFor="sg-subj">Subject</label><input id="sg-subj" value={d.subject || `Please sign: ${d.title}`} onChange={e => set({ subject: e.target.value })} /></div>
            <div className="sg-field"><label htmlFor="sg-msg">Message</label><textarea id="sg-msg" rows={6} value={d.message} onChange={e => set({ message: e.target.value })} />
              <p className="sg-hint">{'{first name}'} is replaced with each signer's first name.</p></div>
            <div className="sg-two">
              <div className="sg-field"><label htmlFor="sg-rem">Reminders</label>
                <select id="sg-rem" value={d.reminderRule} onChange={e => set({ reminderRule: e.target.value })}>
                  <option value="every_3_days">Every 3 days until signed</option><option value="once_before_expiry">Once, 2 days before it expires</option><option value="off">Off</option>
                </select></div>
              <div className="sg-field"><label htmlFor="sg-exp">Expires</label>
                <select id="sg-exp" value={d.expiresDays} onChange={e => set({ expiresDays: Number(e.target.value) })}>
                  <option value={14}>14 days after sending</option><option value={30}>30 days after sending</option><option value={60}>60 days after sending</option>
                </select></div>
            </div>
            <div className="sg-field"><span className="sg-lab">Identity check</span>
              <p className="sg-readonly">Email link + 6-digit one-time code, sent by email</p>
              <p className="sg-hint">Each signer gets a unique link, then enters a code before the document opens. Staff signers confirm with their ASPIRE password. Codes by text and portal sign-in are not available yet.</p></div>
          </div>
          <div className="sg-card sg-panel">
            <p className="sg-h3">Summary</p>
            <div className="sg-sumrow"><span>Document</span><b>{d.title || 'Untitled'}</b></div>
            {signers.filter(r => r.type !== 'cc').map((r, i) => (
              <div key={r.roleKey} className="sg-sumrow"><span><span className={`sg-ord sg-c-${r.color}`}>{i + 1}</span>{r.name || 'Unnamed'}{r.type === 'viewer' ? ' (needs to view)' : ''}</span><span>{d.fields.filter(f => f.role === r.roleKey).length} fields</span></div>
            ))}
            {signers.filter(r => r.type === 'cc').map(r => <div key={r.roleKey} className="sg-sumrow"><span>{r.name || r.email}</span><span>Receives a copy</span></div>)}
            <div className="sg-sumrow"><span>Signed copy returns to</span><b>You and every party</b></div>
            <label className="sg-tg"><span>Save as a template in the Catalog</span><input type="checkbox" checked={d.saveTemplate} onChange={e => set({ saveTemplate: e.target.checked })} /></label>
            <p className="sg-hint">Off: a one-time request. It still shows under Signature requests. Save template, below, saves it without sending.</p>
            <p className="sg-h3">Catalog details for the template</p>
            <div className="sg-field"><label htmlFor="sg-cat-desc">Description (optional)</label>
              <textarea id="sg-cat-desc" rows={3} value={cat.description} onChange={e => setCat({ description: e.target.value })} /></div>
            <div className="sg-two">
              <div className="sg-field"><label htmlFor="sg-cat-cat">Category</label>
                <select id="sg-cat-cat" value={cat.category} onChange={e => setCat({ category: e.target.value })}>
                  <option value="">Student Onboarding (default)</option>
                  {cats.map(c => <option key={c.slug} value={c.slug}>{c.display_name}</option>)}
                </select></div>
              <div className="sg-field"><label htmlFor="sg-cat-aud">Audience</label>
                <select id="sg-cat-aud" value={cat.audience} onChange={e => setCat({ audience: e.target.value })}>
                  {AUDIENCES.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
                </select></div>
            </div>
            <div className="sg-field"><label htmlFor="sg-cat-tags">Tags (comma-separated)</label>
              <input id="sg-cat-tags" value={cat.tags} onChange={e => setCat({ tags: e.target.value })} /></div>
            <label className="sg-tg"><span>Pin to the top</span><input type="checkbox" checked={cat.pinned} onChange={e => setCat({ pinned: e.target.checked })} /></label>
            {tplIssues.length > 0 && <div className="sg-warnlist" aria-label="Before saving as a template">{tplIssues.map(x => <div key={x} className="sg-wl sg-bad">✕ <span>{x}</span></div>)}</div>}
            <button type="button" className="sg-btn sg-sm" onClick={() => onPreview?.(d)}>Preview as signer</button>
            <p className="sg-h3">Checks</p>
            <div className="sg-warnlist">
              {issues.length
                ? issues.map(x => <div key={x} className="sg-wl sg-bad">✕ <span>{x}</span></div>)
                : ['Every signer has a signature field', 'Every signer has a valid email', 'Document type allows e-signature', 'Consent screen and one-time code are on', ...ruleSummaries(d.fields)].map(x => <div key={x} className="sg-wl sg-ok">✓ <span>{x}</span></div>)}
            </div>
          </div>
        </div>
      )}

      {err && <div className="sg-err" role="alert">{err}</div>}
      <div className="sg-foot">
        {step > 0 ? <button type="button" className="sg-btn" onClick={() => setStep(step - 1)}>‹ Back</button> : <span />}
        <span className="sg-row">
          <button type="button" className="sg-btn" onClick={saveDraft} disabled={busy || !d.documentPath}>Save draft</button>
          {step < 3
            ? <button type="button" className="sg-btn sg-pri" disabled={!!stepBlock} title={stepBlock || undefined} onClick={() => setStep(step + 1)}>Next: {STEPS[step + 1]}</button>
            : <>
                <button type="button" className="sg-btn" disabled={busy || tplIssues.length > 0} title={tplIssues[0] || undefined} onClick={saveTemplateOnly}>{d.templateId ? 'Update template' : 'Save template'}</button>
                <button type="button" className="sg-btn sg-pri" disabled={busy || issues.length > 0} onClick={send}>{busy ? 'Sending…' : 'Send for signature'}</button>
              </>}
        </span>
      </div>
    </div>
  )
}

function Recipients({ d, set, people }) {
  const [q, setQ] = useState('')
  const hits = useMemo(() => searchPeople(q, people || {}), [q, people])
  const upd = (i, patch) => set({ recipients: d.recipients.map((r, j) => j === i ? { ...r, ...patch } : r) })
  const add = (extra = {}) => set({ recipients: [...d.recipients, { ...blankRecipient(d.recipients.length), roleKey: nextRoleKey(d.recipients), ...extra }] })
  const remove = (i) => {
    const gone = d.recipients[i]
    set({ recipients: d.recipients.filter((_, j) => j !== i), fields: d.fields.filter(f => f.role !== gone.roleKey) })
  }
  const move = (i, dir) => {
    const j = i + dir; if (j < 0 || j >= d.recipients.length) return
    const next = [...d.recipients]; [next[i], next[j]] = [next[j], next[i]]
    set({ recipients: next.map((r, k) => ({ ...r, color: r.type === 'cc' ? r.color : colorForIndex(k) })) })
  }
  const addHit = (h) => {
    const s = (people.students || []).find(x => x.id === h.id)
    const c = (people.contacts || []).find(x => x.id === h.id)
    const blank = d.recipients.findIndex(r => !r.name && !r.email)
    const rec = h.type === 'student'
      ? { name: h.label, email: s?.school_email || s?.personal_email || '', studentId: h.id }
      : { name: h.label, email: c?.email || '', contactId: h.id, schoolName: c?.school_name || null }
    if (blank >= 0) upd(blank, rec); else add(rec)
    setQ('')
  }
  return (
    <div className="sg-card sg-panel">
      <label className="sg-tg"><span><b>Signing order</b><br /><span className="sg-hint">In order: each signer gets it after the one before signs.</span></span>
        <input type="checkbox" checked={d.ordered} onChange={e => set({ ordered: e.target.checked })} aria-label="Sign in order" /></label>
      <div className="sg-rtable">
        {d.recipients.map((r, i) => (
          <div key={r.roleKey} className={`sg-rrow sg-c-${r.type === 'cc' ? 'slate' : r.color}`}>
            <span className="sg-ord">{r.type === 'cc' ? 'cc' : d.ordered ? i + 1 : '•'}</span>
            <input value={r.name} onChange={e => upd(i, { name: e.target.value })} aria-label={`Recipient ${i + 1} name`} placeholder="Name" />
            <input value={r.email} onChange={e => upd(i, { email: e.target.value })} aria-label={`Recipient ${i + 1} email`} placeholder="Email" type="email" />
            <select value={r.type} onChange={e => upd(i, { type: e.target.value })} aria-label={`Recipient ${i + 1} role`}>
              {RECIPIENT_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            <span className="sg-row">
              <button type="button" className="sg-iconbtn" aria-label={`Move ${r.name || 'recipient'} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="sg-iconbtn" aria-label={`Remove ${r.name || 'recipient'}`} onClick={() => remove(i)}>✕</button>
            </span>
          </div>
        ))}
      </div>
      <div className="sg-row">
        <button type="button" className="sg-btn sg-sm" onClick={() => add()}>+ Add recipient</button>
        <input className="sg-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Add from Contacts or students" aria-label="Add from Contacts or students" />
      </div>
      {hits.length > 0 && <div className="sg-hits" role="listbox" aria-label="Matching people">{hits.map(h => <button key={h.key} type="button" role="option" aria-selected="false" onClick={() => addHit(h)}><b>{h.label}</b><small>{h.sub}</small></button>)}</div>}
      <p className="sg-hint">Signers fill and sign. "Needs to view" must open it before it moves on. "Receives a copy" gets the sealed copy. You always get the sealed copy back.</p>
    </div>
  )
}

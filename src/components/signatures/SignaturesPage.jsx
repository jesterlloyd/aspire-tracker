// src/components/signatures/SignaturesPage.jsx
//
// SIGNATURES-PHASE2: /catalog/signatures, three tabs (brief section 2): Signature requests,
// Prepare and send, Signer preview. Reached only when the catalog.signatures flag admits the
// caller; the Catalog renders nothing that links here otherwise, and the server answers 404.
// Deep links: ?request=<id>, ?tab=prepare&template=<id>&step=2, ?tab=preview&template=<id>,
// ?tab=prepare&from=<catalog file id> (a Catalog PDF's "Make a signature template").
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import RequestsView from './RequestsView'
import PrepareWizard from './PrepareWizard'
import { emptyDraft } from '../../lib/signatures/draft'
import SignerFlow from './SignerFlow'
import { sigStaff } from './sigApi'
import { colorForIndex } from '../../lib/signatures/sigModel'
import './signatures.css'

const TABS = [['requests', 'Signature requests'], ['prepare', 'Prepare and send'], ['preview', 'Signer preview']]

export default function SignaturesPage({ flagState, people, notify, backPath = '/catalog' }) {
  const navigate = useNavigate()
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const [tab, setTab] = useState(params.get('tab') || 'requests')
  // ?source=catalog opens step 1 on "Choose from the Catalog" (+ New > Make a template from a Catalog file).
  const [prep, setPrep] = useState(() => ({ key: 0, initial: params.get('source') === 'catalog' ? { source: 'catalog' } : null, draftId: null, step: Number(params.get('step') || 0) }))
  const [preview, setPreview] = useState(null)   // a wizard draft or template to preview
  const [count, setCount] = useState(null)

  useEffect(() => { sigStaff('list').then(r => setCount((r.requests || []).length)).catch(() => {}) }, [tab])

  // ?template=<id> opens it in the editor (Edit fields) or the preview.
  useEffect(() => {
    const id = params.get('template')
    if (!id) return
    sigStaff('template_get', { template_id: id }).then(({ template: t }) => {
      const d = fromTemplate(t)
      if ((params.get('tab') || '') === 'preview') setPreview(d)
      else setPrep(p => ({ ...p, key: p.key + 1, initial: d }))
    }).catch(e => notify?.(e.message, 'err'))
  }, [params, notify])

  const go = (k) => { setTab(k); const u = new URL(window.location.href); u.searchParams.set('tab', k); window.history.replaceState(null, '', u) }
  const continueDraft = useCallback((r) => { setPrep(p => ({ key: p.key + 1, initial: r.draft_state || {}, draftId: r.id, step: 0 })); go('prepare') }, [])
  const resend = useCallback((r, bundle) => {
    // Correct and resend: the same document, fields and recipients, as a new draft.
    const recips = (bundle?.signers || []).filter(s => s.status !== 'replaced').sort((a, b) => a.order_index - b.order_index)
      .map((s, i) => ({ roleKey: s.role_key, name: s.name, email: s.email, type: s.recipient_type, color: colorForIndex(i), studentId: s.student_id, contactId: s.contact_id, schoolName: s.school_name }))
    setPrep(p => ({ key: p.key + 1, draftId: null, step: 1, initial: {
      ...emptyDraft(), source: 'pdf', title: r.title, documentType: bundle?.request?.document_type || r.document_type,
      documentPath: bundle?.request?.document_path, sha256: bundle?.request?.original_sha256, pageSizes: bundle?.request?.page_sizes || [],
      fields: bundle?.request?.fields || [], recipients: recips, ordered: r.signing_order !== 'parallel',
    } }))
    go('prepare')
  }, [])

  return (
    <div className="sg">
      <div className="sg-crumb"><button type="button" onClick={() => navigate(backPath)}>‹ Catalog</button><span>/</span><span>Signatures</span></div>
      <h1 className="sg-title">Signatures</h1>
      {flagState !== 'on' && (
        <div className="sg-legal" role="note">
          Before launch: confirm with Legal and IT that in-app e-signature meets Cedars-Sinai policy, or connect the approved vendor behind this same screen.
          {flagState === 'owner' && ' Signatures are visible to the Owner only while that review is open.'}
        </div>
      )}
      <div className="sg-views" role="tablist" aria-label="Signatures view">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => go(k)}>
            {l}{k === 'requests' && count != null ? <span className="sg-n">{count}</span> : null}
          </button>
        ))}
      </div>
      {tab === 'requests' && <RequestsView focusId={params.get('request')} notify={notify} onContinueDraft={continueDraft} onResend={resend} />}
      {tab === 'prepare' && (
        <PrepareWizard key={prep.key} initial={prep.initial} draftId={prep.draftId} startStep={prep.step} notify={notify} people={people}
          importFrom={prep.key === 0 ? params.get('from') : null}
          onPreview={(d) => { setPreview(d); go('preview') }}
          onSent={(out) => { notify?.(out.requestIds.length > 1 ? `Sent ${out.requestIds.length} requests.` : 'Sent. Track it in Signature requests.'); setPrep(p => ({ key: p.key + 1, initial: null, draftId: null, step: 0 })); go('requests') }} />
      )}
      {tab === 'preview' && <PreviewTab draft={preview} onPick={setPreview} />}
    </div>
  )
}

function fromTemplate(t) {
  const roles = t.signer_roles || []
  return {
    ...emptyDraft(), source: 'tpl', templateId: t.id, title: t.name, documentType: t.document_type, documentPath: t.source_path,
    sha256: t.source_sha256, pageSizes: t.page_sizes || [], fields: t.fields || [], ordered: t.signing_order !== 'parallel',
    recipients: roles.map((r, i) => ({ roleKey: r.key, type: r.type || 'signer', name: r.defaultName || '', email: r.defaultEmail || '', color: colorForIndex(i), label: r.label })),
  }
}

// Signer preview: what signer 1 sees, with a fake api that saves and sends nothing.
function PreviewTab({ draft, onPick }) {
  const [templates, setTemplates] = useState([])
  const [url, setUrl] = useState(null)
  useEffect(() => { sigStaff('templates').then(r => setTemplates(r.templates || [])).catch(() => {}) }, [])
  useEffect(() => { if (draft?.documentPath) sigStaff('doc_url', { path: draft.documentPath }).then(r => setUrl(r.url)).catch(() => setUrl(null)) }, [draft?.documentPath])
  const signer = draft?.recipients?.find(r => r.type === 'signer')
  const api = useMemo(() => (draft && signer ? previewApi(draft, signer, url) : null), [draft, signer, url])
  return (
    <div className="sg-previewgrid">
      <div className="sg-phone"><div className="sg-screen">{api ? <SignerFlow api={api} preview /> : <p className="sg-hint sg-pad">Pick a document to preview.</p>}</div></div>
      <div className="sg-card sg-panel">
        <p className="sg-h3">What {signer?.name || 'signer 1'} sees</p>
        <ol className="sg-explain">
          <li>An email from ASPIRE Intelligence with a unique link. No account needed.</li>
          <li>A 6-digit code sent to that email. This is the identity check the audit trail records.</li>
          <li>The consent to electronic records, a sample PDF to open, and two boxes to check.</li>
          <li>Each highlighted field in order. A typed or drawn signature. Finish.</li>
          <li>A confirmation, and the sealed copy by email once everyone has signed.</li>
        </ol>
        <div className="sg-field"><label htmlFor="sg-prev-t">Preview a template</label>
          <select id="sg-prev-t" value={draft?.templateId || ''} onChange={e => e.target.value && sigStaff('template_get', { template_id: e.target.value }).then(({ template }) => onPick(fromTemplate(template)))}>
            <option value="">{draft ? 'The document you are preparing' : 'Choose…'}</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></div>
        <p className="sg-hint">Preview saves nothing and sends nothing.</p>
      </div>
    </div>
  )
}

// A SignerFlow api that walks the steps in memory: nothing is saved and nothing is sent.
function previewApi(draft, signer, url) {
  let step = 'code', signedAt = null
  const fields = (draft.fields || []).map(f => ({ ...f, mine: f.role === signer.roleKey, sender: f.role === 'sender' }))
  return {
    state: async () => ({
      step, signed_at: signedAt, request: { title: draft.title, sender_name: 'You' }, signer: { name: signer.name || 'Signer 1', role_key: signer.roleKey, recipient_type: 'signer' },
      disclosure: { version: 'preview', title: 'Consent to electronic records and signatures', body: { intro: 'Before you sign, please read this. It covers this document only.', points: ['The signer sees your organization’s current disclosure here.'] } },
      document: { page_sizes: draft.pageSizes, fields }, values: { ...(draft.senderValues || {}) }, prefill: { name: signer.name, email: signer.email },
      others: (draft.recipients || []).filter(r => r.type === 'signer' && r.roleKey !== signer.roleKey).map(r => ({ name: r.name })),
      next_signer: (draft.recipients || []).filter(r => r.type === 'signer')[1]?.name || null, time_zone: 'America/Los_Angeles',
    }),
    sendCode: async () => ({ sentTo: 'the signer’s email', ttlMinutes: 10 }),
    verify: async () => { step = 'consent' },
    samplePdf: async () => {},
    consent: async () => { step = 'sign' },
    document: async () => url,
    open: async () => {},
    finish: async () => { step = 'done'; signedAt = new Date().toISOString() },
    decline: async () => { step = 'code' },
    delegate: async () => {},
    paperCopy: async () => {},
    copy: async () => url,
  }
}

// src/components/studio/StudioSendDrawer.jsx
//
// STUDIO-1: who gets the design, then the send. Phase 1 chooses people by hand, from the same three
// sources as Outreach > Send to Many (this cohort's students, Connect contacts, pasted addresses),
// through the same audience rules (src/lib/connect/bulkAudience.js): the audience is exactly what
// was ticked, Select all never takes a Not Proceeding student, and one who was ticked by hand needs
// the acknowledgment at review. Keith's proposed audience is Phase 2.
//
// The send is /api/connect-send-bulk-message with body_format 'studio', in batches of at most 75
// (the endpoint's ceiling), each its own batch id, one after another. Every batch is in Sent History.

import { useEffect, useMemo, useState } from 'react'
import DetailDrawer from '../ui/DetailDrawer'
import { supabase } from '../../lib/supabase'
import { buildCombinedRecipients, selectableShownStudentIds, notProceedingRecipients, buildPayloadRecipients, NOT_PROCEEDING_STATUS } from '../../lib/connect/bulkAudience'
import { parseRecipientText } from '../../lib/recipientParse'
import { EMAIL_SOURCE_OPTIONS, studentHasEmailSource } from '../../lib/studentBulkEmail'
import { getStudentPreferredFullName } from '../../lib/studentNameFormatters'
import { CONTACT_CATEGORY_ORDER, canonicalCategory } from '../../lib/contactCategories'
import { studioSend } from '../../lib/studio/studioClient'
import { toBatches, BATCH_MAX } from '../../lib/studio/studioBatches'

const CONFIRM_PHRASE = 'SEND MESSAGES'
const NO_STUDENTS = []
const STUDENT_COLS = 'id, first_name, last_name, preferred_first_name, school, school_email, personal_email, status'
const CONTACT_COLS = 'id, full_name, preferred_name, email, role, category, school_name, organization, is_active'

export default function StudioSendDrawer({ design, name, designId, store, problems, cohortId, toast, onClose }) {
  const [step, setStep] = useState('choose')
  const [source, setSource] = useState('students')
  const [loadedStudents, setStudents] = useState(null)
  const [contacts, setContacts] = useState(null)
  const [emailSource, setEmailSource] = useState('school')
  const [studentQ, setStudentQ] = useState('')
  const [contactQ, setContactQ] = useState('')
  const [contactCat, setContactCat] = useState('All')
  const [studentSel, setStudentSel] = useState(() => new Set())
  const [contactSel, setContactSel] = useState(() => new Set())
  const [picked, setPicked] = useState([])
  const [pasteText, setPasteText] = useState('')
  const [invalid, setInvalid] = useState([])
  const [ack, setAck] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)

  const students = useMemo(() => (cohortId ? loadedStudents : NO_STUDENTS), [cohortId, loadedStudents])
  useEffect(() => {
    if (!cohortId) return undefined
    let off = false
    supabase.from('students').select(STUDENT_COLS).eq('cohort_id', cohortId).order('last_name').order('first_name')
      .then(({ data, error }) => { if (!off) setStudents(error ? [] : (data || [])) })
    return () => { off = true }
  }, [cohortId])
  useEffect(() => {
    if (source !== 'contacts' || contacts) return
    supabase.from('contacts').select(CONTACT_COLS).eq('is_active', true).order('full_name')
      .then(({ data, error }) => setContacts(error ? [] : (data || [])))
  }, [source, contacts])

  const recipients = useMemo(() => buildCombinedRecipients({ studentSel, contactSel, picked, students, contacts, emailSource }),
    [studentSel, contactSel, picked, students, contacts, emailSource])
  const notProceeding = notProceedingRecipients(recipients)

  const shownStudents = useMemo(() => {
    const q = studentQ.trim().toLowerCase()
    return (students || []).filter(s => studentHasEmailSource(s, emailSource))
      .filter(s => !q || `${getStudentPreferredFullName(s)} ${s.school || ''}`.toLowerCase().includes(q))
  }, [students, studentQ, emailSource])
  const shownContacts = useMemo(() => {
    const q = contactQ.trim().toLowerCase()
    return (contacts || []).filter(c => c.email)
      .filter(c => contactCat === 'All' || canonicalCategory(c.category) === contactCat)
      .filter(c => !q || `${c.preferred_name || ''} ${c.full_name || ''} ${c.organization || ''} ${c.email}`.toLowerCase().includes(q))
  }, [contacts, contactQ, contactCat])

  const toggle = (setter, id) => setter(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const blocked = problems.blocking.length > 0
  const canSend = !sending && !result && recipients.length > 0 && !blocked && confirm === CONFIRM_PHRASE && (notProceeding.length === 0 || ack)

  const send = async () => {
    if (!canSend) return
    setSending(true)
    const payload = buildPayloadRecipients(recipients, { ackNotProceeding: ack })
    const batches = toBatches(payload)
    const totals = { sent: 0, skipped: 0, failed: 0 }
    const batchIds = []
    const issues = []
    let stopped = ''
    for (let i = 0; i < batches.length; i++) {
      setProgress({ done: i, of: batches.length })
      const batch_id = crypto.randomUUID()
      try {
        const r = await studioSend({
          confirmation: CONFIRM_PHRASE, batch_id, template_key: 'studio', template_label: `Studio: ${name}`.slice(0, 160),
          subject: design.subject, body: JSON.stringify(design), include_signature: false, recipients: batches[i],
        })
        batchIds.push(batch_id)
        totals.sent += r.summary?.sent || 0
        totals.skipped += r.summary?.skipped || 0
        totals.failed += r.summary?.failed || 0
        for (const x of [...(r.skipped || []), ...(r.failed || [])]) issues.push({ email: x.email, reason: x.reason })
      } catch (e) {
        stopped = e.message
        totals.failed += batches.slice(i).reduce((n, b) => n + b.length, 0)
        break
      }
    }
    setProgress(null)
    setSending(false)
    setResult({ ...totals, issues, stopped })
    if (batchIds.length && designId) {
      await store.markSent(designId, { batch_ids: batchIds, ...totals }).catch(() => null)
    }
    if (totals.sent) toast?.success?.('Sent', `${totals.sent} ${totals.sent === 1 ? 'person' : 'people'} received "${design.subject}".`)
  }

  const footer = result
    ? <button type="button" className="st-btn st-btn-primary" onClick={onClose}>Done</button>
    : step === 'choose'
      ? (<>
        <span className="st-sub" style={{ margin: '0 auto 0 0' }}>{recipients.length} selected</span>
        <button type="button" className="st-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="st-btn st-btn-primary" disabled={!recipients.length} onClick={() => setStep('review')}>Review {recipients.length || ''} →</button>
      </>)
      : (<>
        <button type="button" className="st-btn" onClick={() => setStep('choose')} disabled={sending}>‹ Change people</button>
        <button type="button" className="st-btn st-btn-primary" disabled={!canSend} onClick={send}>
          {sending ? (progress ? `Sending batch ${progress.done + 1} of ${progress.of}…` : 'Sending…') : `Send to ${recipients.length}`}
        </button>
      </>)

  return (
    <DetailDrawer open title={result ? 'Sent' : step === 'choose' ? 'Who Gets It' : 'Review and Send'} onClose={sending ? () => {} : onClose} width={760} trapFocus footer={footer}>
      <div className="st-scope">
        {result ? <Results result={result} /> : step === 'choose' ? (
          <>
            <p className="st-sub" style={{ marginTop: 0 }}>Tick the people who should get "{name}". Only who you tick receives it.</p>
            <div className="st-tabs" role="tablist" aria-label="Recipient source">
              {[['students', 'Students'], ['contacts', 'Contacts'], ['paste', 'Paste or type']].map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={source === k} onClick={() => setSource(k)}>{l}</button>
              ))}
            </div>

            {source === 'students' && (
              <>
                <div className="st-row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
                  <input className="st-input" style={{ flex: '1 1 220px' }} placeholder="Search this cohort's students" value={studentQ} onChange={e => setStudentQ(e.target.value)} aria-label="Search students" />
                  <select className="st-select" style={{ width: 170 }} value={emailSource} onChange={e => setEmailSource(e.target.value)} aria-label="Email to use">
                    {EMAIL_SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <button type="button" className="st-btn st-btn-sm" onClick={() => setStudentSel(prev => new Set([...prev, ...selectableShownStudentIds(shownStudents)]))}>Select all shown</button>
                  <button type="button" className="st-btn st-btn-sm st-btn-ghost" onClick={() => setStudentSel(new Set())}>Clear</button>
                </div>
                {!cohortId && <p className="st-notice">Choose a cohort in the header to list its students.</p>}
                <div className="st-people" role="list">
                  {students === null && <p className="st-empty" style={{ padding: 12 }}>Loading students…</p>}
                  {students !== null && shownStudents.length === 0 && <p className="st-empty" style={{ padding: 12 }}>No students with a {emailSource} email match.</p>}
                  {shownStudents.map(s => (
                    <label key={s.id} className="st-person" role="listitem">
                      <input type="checkbox" checked={studentSel.has(s.id)} onChange={() => toggle(setStudentSel, s.id)} />
                      <span style={{ minWidth: 0 }}>{getStudentPreferredFullName(s)}<small>{s.school || 'School not set'}</small></span>
                      <span>{s.status === NOT_PROCEEDING_STATUS ? <span className="st-np">Not Proceeding</span> : <small>{s.status}</small>}</span>
                    </label>
                  ))}
                </div>
                <p className="st-hint">Select all never includes a Not Proceeding student. You can still tick one by hand, and you will be asked to confirm.</p>
              </>
            )}

            {source === 'contacts' && (
              <>
                <div className="st-row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
                  <input className="st-input" style={{ flex: '1 1 220px' }} placeholder="Search contacts" value={contactQ} onChange={e => setContactQ(e.target.value)} aria-label="Search contacts" />
                  <select className="st-select" style={{ width: 200 }} value={contactCat} onChange={e => setContactCat(e.target.value)} aria-label="Category">
                    <option value="All">All categories</option>
                    {CONTACT_CATEGORY_ORDER.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <button type="button" className="st-btn st-btn-sm" onClick={() => setContactSel(prev => new Set([...prev, ...shownContacts.map(c => c.id)]))}>Select all shown</button>
                  <button type="button" className="st-btn st-btn-sm st-btn-ghost" onClick={() => setContactSel(new Set())}>Clear</button>
                </div>
                <div className="st-people" role="list">
                  {contacts === null && <p className="st-empty" style={{ padding: 12 }}>Loading contacts…</p>}
                  {contacts !== null && shownContacts.length === 0 && <p className="st-empty" style={{ padding: 12 }}>No active contacts match.</p>}
                  {shownContacts.map(c => (
                    <label key={c.id} className="st-person" role="listitem">
                      <input type="checkbox" checked={contactSel.has(c.id)} onChange={() => toggle(setContactSel, c.id)} />
                      <span style={{ minWidth: 0 }}>{c.preferred_name || c.full_name}<small>{[c.organization || c.school_name, c.email].filter(Boolean).join(' · ')}</small></span>
                      <small>{canonicalCategory(c.category) || ''}</small>
                    </label>
                  ))}
                </div>
              </>
            )}

            {source === 'paste' && (
              <>
                <textarea className="st-textarea" rows={5} value={pasteText} onChange={e => setPasteText(e.target.value)}
                  placeholder="name@cshs.org, Another Person <another@school.edu>" aria-label="Addresses" />
                <div className="st-row" style={{ marginTop: 8 }}>
                  <button type="button" className="st-btn st-btn-sm" onClick={() => {
                    const { valid, invalid: bad } = parseRecipientText(pasteText)
                    setPicked(prev => { const seen = new Set(prev.map(p => p.normEmail)); return [...prev, ...valid.filter(v => !seen.has(v.normEmail))] })
                    setInvalid(bad); setPasteText('')
                  }}>Add addresses</button>
                  {picked.length > 0 && <button type="button" className="st-btn st-btn-sm st-btn-ghost" onClick={() => setPicked([])}>Clear {picked.length}</button>}
                </div>
                {invalid.length > 0 && <p className="st-notice st-notice-bad" style={{ marginTop: 10 }}>Not added, not an email address: {invalid.join(', ')}</p>}
                {picked.length > 0 && <p className="st-hint">{picked.map(p => p.email).join(', ')}</p>}
              </>
            )}
          </>
        ) : (
          <>
            <div className="st-counts">
              <div className="st-kpi"><b>{recipients.length}</b><span>Will receive it</span></div>
              <div className="st-kpi"><b>{toBatches(recipients).length}</b><span>{toBatches(recipients).length === 1 ? 'Batch' : 'Batches'} of up to {BATCH_MAX}</span></div>
              <div className="st-kpi"><b>{notProceeding.length}</b><span>Not Proceeding</span></div>
            </div>
            <p className="st-sub">Subject: <b>{design.subject || 'none yet'}</b>. From noreply as "ASPIRE at Cedars-Sinai", replies come to you.</p>
            {blocked && (
              <div className="st-notice st-notice-bad" role="alert" style={{ margin: '12px 0' }}>
                Fix these in the design first: {problems.blocking.join(' ')}
              </div>
            )}
            <div className="st-people" style={{ maxHeight: 260, marginTop: 12 }} role="list" aria-label="Recipients">
              {recipients.map(r => (
                <div key={r.normEmail} className="st-person" role="listitem" style={{ cursor: 'default', gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                  <span style={{ minWidth: 0 }}>{r.name || r.email}<small>{r.email}</small></span>
                  <small>{r.source === 'student' ? 'Student' : r.source === 'contact' ? 'Contact' : 'Typed'}</small>
                </div>
              ))}
            </div>
            {notProceeding.length > 0 && (
              <label className="st-row" style={{ marginTop: 12, fontSize: 13 }}>
                <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
                I mean to include {notProceeding.length} Not Proceeding {notProceeding.length === 1 ? 'student' : 'students'}: {notProceeding.map(r => r.name).join(', ')}.
              </label>
            )}
            <div className="st-field" style={{ marginTop: 16 }}>
              <label className="st-label" htmlFor="st-confirm">Type {CONFIRM_PHRASE} to send</label>
              <input id="st-confirm" className="st-input" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="off" />
            </div>
          </>
        )}
      </div>
    </DetailDrawer>
  )
}

function Results({ result }) {
  return (
    <>
      <div className="st-counts">
        <div className="st-kpi"><b>{result.sent}</b><span>Sent</span></div>
        <div className="st-kpi"><b>{result.skipped}</b><span>Skipped</span></div>
        <div className="st-kpi"><b>{result.failed}</b><span>Did not send</span></div>
      </div>
      {result.stopped && <p className="st-notice st-notice-bad">The send stopped: {result.stopped} Anyone not counted as sent did not receive it.</p>}
      {result.issues.length > 0 && (
        <div className="st-people" role="list" aria-label="Skipped or not sent">
          {result.issues.map((x, i) => (
            <div key={`${x.email}-${i}`} className="st-person" role="listitem" style={{ cursor: 'default', gridTemplateColumns: 'minmax(0,1fr) auto' }}>
              <span>{x.email || 'Unknown address'}</span><small>{String(x.reason || '').replace(/_/g, ' ')}</small>
            </div>
          ))}
        </div>
      )}
      <p className="st-sub">Every batch is in ASPIRE Connect &gt; Outreach &gt; Sent History as "Studio: …".</p>
    </>
  )
}

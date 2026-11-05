// src/components/studio/StudioSendDrawer.jsx
//
// STUDIO-1 and STUDIO-2: who gets the design, then the send.
//
// Two ways to say who (STUDIO-2, Owner, 2026-11-05):
//   By rule  "Winter 2027 students who are Placed", "Winter 2027 residency applicants who submitted
//            the Transition Form". The server resolves the rule (StudioRulePicker,
//            lib/server/studio/resolveAudience.js) and the sender reads every name, removes anyone,
//            and adds typed addresses. Not Proceeding is never in a rule's list.
//   By hand  Phase 1's picker: this cohort's students, Connect contacts, pasted addresses, through
//            the same audience rules as Outreach > Send to Many (src/lib/connect/bulkAudience.js).
//
// Either way, once 20261130000000 is applied the list is FROZEN on the server before anything is
// sent (send_freeze): a rule is resolved again there and only people the sender saw survive. Each
// batch names that frozen list, and the bulk endpoint refuses anyone off it, skips anyone who turned
// program news off, and gives each person their own Unsubscribe link. Before the migration only By
// hand is offered and it sends exactly as in Phase 1.
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
import { studioApi, studioSend } from '../../lib/studio/studioClient'
import { toBatches, BATCH_MAX } from '../../lib/studio/studioBatches'
import { sanitizeRule, ruleProblem, reasonWords, REPLY_ROUTES, defaultReplyRoute } from '../../lib/studio/audienceCatalog'
import StudioRulePicker from './StudioRulePicker'

const CONFIRM_PHRASE = 'SEND MESSAGES'
const NO_STUDENTS = []
const STUDENT_COLS = 'id, first_name, last_name, preferred_first_name, school, school_email, personal_email, status'
const CONTACT_COLS = 'id, full_name, preferred_name, email, role, category, school_name, organization, is_active'
const SOURCE_WORDS = { student: 'Student', contact: 'Contact', manual: 'Typed' }
const ROUTE_WORDS = { residency: 'Residency address', automatic: 'Usual address', school: 'School email', personal: 'Personal email' }

export default function StudioSendDrawer({ design, name, designId, store, problems, cohortId, toast, audiencesEnabled = false, onClose }) {
  const [step, setStep] = useState('choose')
  const [mode, setMode] = useState(audiencesEnabled ? 'rule' : 'hand')
  // By rule
  // STUDIO-3: a design Keith planned carries his PROPOSED audience; the drawer opens on it, says so,
  // and the sender reads every name and approves before anything is sent.
  const keithRule = design?.audience ? sanitizeRule(design.audience) : null
  const [rule, setRule] = useState(() => keithRule || sanitizeRule({ population: 'students', cohortIds: cohortId ? [cohortId] : [] }))
  const [fromKeith, setFromKeith] = useState(Boolean(keithRule))
  const [resolved, setResolved] = useState(null)        // { label, recipients, excluded }
  const [resolving, setResolving] = useState(false)
  const [removed, setRemoved] = useState(() => new Set())
  const [typed, setTyped] = useState([])
  const [typeText, setTypeText] = useState('')
  const [replyRoute, setReplyRoute] = useState('sender')
  // By hand
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
  // Send
  const [confirm, setConfirm] = useState('')
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const students = useMemo(() => (cohortId ? loadedStudents : NO_STUDENTS), [cohortId, loadedStudents])
  useEffect(() => {
    if (!cohortId || mode !== 'hand') return undefined
    let off = false
    supabase.from('students').select(STUDENT_COLS).eq('cohort_id', cohortId).order('last_name').order('first_name')
      .then(({ data, error: e }) => { if (!off) setStudents(e ? [] : (data || [])) })
    return () => { off = true }
  }, [cohortId, mode])
  useEffect(() => {
    if (mode !== 'hand' || source !== 'contacts' || contacts) return
    supabase.from('contacts').select(CONTACT_COLS).eq('is_active', true).order('full_name')
      .then(({ data, error: e }) => setContacts(e ? [] : (data || [])))
  }, [mode, source, contacts])

  // buildCombinedRecipients answers { recipients, duplicateCount }; the list is its recipients.
  const handRecipients = useMemo(() => buildCombinedRecipients({ studentSel, contactSel, picked, students, contacts, emailSource }).recipients,
    [studentSel, contactSel, picked, students, contacts, emailSource])
  const notProceeding = mode === 'hand' ? notProceedingRecipients(handRecipients) : []

  // The rule's list as it will be frozen: what the server resolved, less removals, plus typed.
  const ruleList = useMemo(() => {
    if (!resolved) return []
    const seen = new Set()
    const kept = resolved.recipients.filter(p => !removed.has(p.normEmail) && !seen.has(p.normEmail) && seen.add(p.normEmail))
    const extra = typed.filter(t => !seen.has(t.normEmail) && seen.add(t.normEmail))
    return [...kept, ...extra.map(t => ({ ...t, source: 'manual' }))]
  }, [resolved, removed, typed])
  const listCount = mode === 'rule' ? ruleList.length : handRecipients.length

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
  const canSend = !sending && !result && listCount > 0 && !blocked && confirm === CONFIRM_PHRASE && (notProceeding.length === 0 || ack)
  const problem = mode === 'rule' ? ruleProblem(rule) : ''

  const review = async () => {
    setError('')
    if (mode === 'hand') { setReplyRoute('sender'); setStep('review'); return }
    setResolving(true)
    try {
      const r = await studioApi('audience_resolve', { rule })
      setResolved(r); setRemoved(new Set()); setReplyRoute(defaultReplyRoute(rule)); setStep('review')
    } catch (e) { setError(e.message || 'The list could not be read.') }
    finally { setResolving(false) }
  }

  const addTyped = () => {
    const { valid, invalid: bad } = parseRecipientText(typeText)
    setTyped(prev => { const seen = new Set(prev.map(p => p.normEmail)); return [...prev, ...valid.filter(v => !seen.has(v.normEmail))] })
    setInvalid(bad); setTypeText('')
  }

  const send = async () => {
    if (!canSend) return
    setSending(true); setError('')
    let payload
    let sendId = null
    let frozenOut = []
    if (audiencesEnabled) {
      try {
        const f = await studioApi('send_freeze', mode === 'rule'
          ? { mode, rule, expected: resolved.recipients.map(p => p.normEmail), removed: [...removed], added: typed.map(t => ({ email: t.email, name: t.name })), reply_route: replyRoute, design_id: designId, subject: design.subject }
          : { mode, picked: buildPayloadRecipients(handRecipients, { ackNotProceeding: ack }), reply_route: replyRoute, design_id: designId, subject: design.subject })
        payload = f.recipients
        sendId = f.id
        frozenOut = (f.excluded || []).filter(x => ['changed_since_review', 'opted_out', 'not_found', 'inactive', 'email_mismatch'].includes(x.reason))
      } catch (e) {
        setSending(false); setError(e.message || 'The list could not be saved, so nothing was sent.'); return
      }
    } else {
      payload = buildPayloadRecipients(handRecipients, { ackNotProceeding: ack })
    }
    const batches = toBatches(payload)
    const totals = { sent: 0, skipped: 0, failed: 0 }
    const batchIds = []
    const issues = frozenOut.map(x => ({ email: x.email || x.name, reason: x.reason }))
    let stopped = ''
    for (let i = 0; i < batches.length; i++) {
      setProgress({ done: i, of: batches.length })
      const batch_id = crypto.randomUUID()
      try {
        const r = await studioSend({
          confirmation: CONFIRM_PHRASE, batch_id, template_key: 'studio', template_label: `Studio: ${name}`.slice(0, 160),
          subject: design.subject, body: JSON.stringify(design), include_signature: false, recipients: batches[i],
          ...(sendId ? { studio_send_id: sendId } : {}),
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
    if (sendId) await studioApi('send_finish', { id: sendId, batch_ids: batchIds, ...totals }).catch(() => null)
    else if (batchIds.length && designId) await store.markSent(designId, { batch_ids: batchIds, ...totals }).catch(() => null)
    if (totals.sent) toast?.success?.('Sent', `${totals.sent} ${totals.sent === 1 ? 'person' : 'people'} received "${design.subject}".`)
  }

  const footer = result
    ? <button type="button" className="st-btn st-btn-primary" onClick={onClose}>Done</button>
    : step === 'choose'
      ? (<>
        {mode === 'hand' && <span className="st-sub" style={{ margin: '0 auto 0 0' }}>{handRecipients.length} selected</span>}
        {mode === 'rule' && problem && <span className="st-sub" style={{ margin: '0 auto 0 0' }}>{problem}</span>}
        <button type="button" className="st-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="st-btn st-btn-primary" disabled={mode === 'rule' ? (!!problem || resolving) : !handRecipients.length} onClick={review}>
          {mode === 'rule' ? (resolving ? 'Reading the list…' : 'See who it reaches →') : `Review ${handRecipients.length || ''} →`}
        </button>
      </>)
      : (<>
        <button type="button" className="st-btn" onClick={() => { setStep('choose'); setConfirm('') }} disabled={sending}>‹ Change who</button>
        <button type="button" className="st-btn st-btn-primary" disabled={!canSend} onClick={send}>
          {sending ? (progress ? `Sending batch ${progress.done + 1} of ${progress.of}…` : 'Saving the list…') : `Send to ${listCount}`}
        </button>
      </>)

  return (
    <DetailDrawer open title={result ? 'Sent' : step === 'choose' ? 'Who Gets It' : 'Review and Send'} onClose={sending ? () => {} : onClose} width={760} trapFocus footer={footer}>
      <div className="st-scope">
        {error && <p className="st-notice st-notice-bad" role="alert" style={{ marginTop: 0 }}>{error}</p>}
        {result ? <Results result={result} /> : step === 'choose' ? (
          <>
            <div className="st-tabs" role="tablist" aria-label="How to choose people">
              {[['rule', 'By rule'], ['hand', 'By hand']].map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => { setMode(k); setError('') }}>{l}</button>
              ))}
            </div>
            {mode === 'rule' && !audiencesEnabled && (
              <p className="st-notice">Sending by rule needs a database update that has not been applied yet. Pick people by hand for now.</p>
            )}
            {mode === 'rule' && audiencesEnabled && (
              <>
                <p className="st-sub" style={{ marginTop: 0 }}>Describe who should get "{name}". You will see every name before anything is sent.</p>
                {fromKeith && (
                  <p className="st-notice st-notice-info st-keith-proposal" role="status">
                    Keith proposed this audience from your brief. Check it, change anything, and you will still see every name before it goes.
                  </p>
                )}
                <StudioRulePicker rule={rule} onRule={(r) => { setRule(r); setResolved(null); setFromKeith(false) }} />
              </>
            )}
            {mode === 'hand' && (
              <HandPicker {...{ name, source, setSource, cohortId, students, shownStudents, studentQ, setStudentQ, emailSource, setEmailSource, studentSel, setStudentSel,
                contacts, shownContacts, contactQ, setContactQ, contactCat, setContactCat, contactSel, setContactSel,
                pasteText, setPasteText, picked, setPicked, invalid, setInvalid, toggle }} />
            )}
          </>
        ) : (
          <>
            <div className="st-counts">
              <div className="st-kpi"><b>{listCount}</b><span>Will receive it</span></div>
              <div className="st-kpi"><b>{toBatches(Array.from({ length: listCount })).length}</b><span>{toBatches(Array.from({ length: listCount })).length === 1 ? 'Batch' : 'Batches'} of up to {BATCH_MAX}</span></div>
              {mode === 'rule'
                ? <div className="st-kpi"><b>{(resolved?.excluded.length || 0) + removed.size}</b><span>Left out</span></div>
                : <div className="st-kpi"><b>{notProceeding.length}</b><span>Not Proceeding</span></div>}
            </div>
            {mode === 'rule' && resolved && <p className="st-sub" style={{ marginTop: 0 }}><b>{resolved.label}</b></p>}
            <p className="st-sub">Subject: <b>{design.subject || 'none yet'}</b>. From noreply as "ASPIRE at Cedars-Sinai".</p>
            {blocked && (
              <div className="st-notice st-notice-bad" role="alert" style={{ margin: '12px 0' }}>
                Fix these in the design first: {problems.blocking.join(' ')}
              </div>
            )}

            {mode === 'rule' ? (
              <RuleReview {...{ ruleList, resolved, removed, setRemoved, typed, setTyped, typeText, setTypeText, addTyped, invalid }} />
            ) : (
              <div className="st-people" style={{ maxHeight: 260, marginTop: 12 }} role="list" aria-label="Recipients">
                {handRecipients.map(r => (
                  <div key={r.normEmail} className="st-person st-person-static" role="listitem">
                    <span style={{ minWidth: 0 }}>{r.name || r.email}<small>{r.email}</small></span>
                    <small>{SOURCE_WORDS[r.source]}</small>
                  </div>
                ))}
              </div>
            )}

            {notProceeding.length > 0 && (
              <label className="st-row" style={{ marginTop: 12, fontSize: 13 }}>
                <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
                I mean to include {notProceeding.length} Not Proceeding {notProceeding.length === 1 ? 'student' : 'students'}: {notProceeding.map(r => r.name).join(', ')}.
              </label>
            )}

            {audiencesEnabled && (
              <fieldset className="st-field st-fieldset" style={{ marginTop: 16 }}>
                <legend className="st-label">Replies</legend>
                {REPLY_ROUTES.map(o => (
                  <label key={o.key} className="st-check">
                    <input type="radio" name="st-reply" checked={replyRoute === o.key} onChange={() => setReplyRoute(o.key)} />
                    <span>{o.label}</span>
                  </label>
                ))}
              </fieldset>
            )}
            {audiencesEnabled && <p className="st-hint">Each email ends with an Unsubscribe link for program news. Anyone who has turned it off is skipped.</p>}

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

function RuleReview({ ruleList, resolved, removed, setRemoved, typed, setTyped, typeText, setTypeText, addTyped, invalid }) {
  const removedPeople = (resolved?.recipients || []).filter(p => removed.has(p.normEmail))
  const flip = (normEmail) => setRemoved(prev => { const n = new Set(prev); n.has(normEmail) ? n.delete(normEmail) : n.add(normEmail); return n })
  return (
    <>
      <div className="st-people" style={{ maxHeight: 300, marginTop: 12 }} role="list" aria-label="Recipients">
        {ruleList.length === 0 && <p className="st-empty" style={{ padding: 12 }}>Nobody matches this rule.</p>}
        {ruleList.map(p => (
          <div key={p.normEmail} className="st-person st-person-static st-person-x" role="listitem">
            <span style={{ minWidth: 0 }}>{p.name || p.email}<small>{p.email}{p.route && ROUTE_WORDS[p.route] ? ` · ${ROUTE_WORDS[p.route]}` : ''}</small></span>
            <small>{SOURCE_WORDS[p.source]}</small>
            <button type="button" className="st-btn st-btn-sm st-btn-ghost"
              aria-label={`Remove ${p.name || p.email}`}
              onClick={() => (p.source === 'manual' ? setTyped(t => t.filter(x => x.normEmail !== p.normEmail)) : flip(p.normEmail))}>Remove</button>
          </div>
        ))}
      </div>
      <div className="st-row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        <input className="st-input" style={{ flex: '1 1 260px' }} value={typeText} onChange={e => setTypeText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTyped() } }}
          placeholder="Add someone: name@cshs.org" aria-label="Add addresses" />
        <button type="button" className="st-btn st-btn-sm" onClick={addTyped} disabled={!typeText.trim()}>Add</button>
      </div>
      {invalid.length > 0 && <p className="st-notice st-notice-bad" style={{ marginTop: 8 }}>Not added, not an email address: {invalid.join(', ')}</p>}
      {typed.length > 0 && <p className="st-hint">{typed.length} typed {typed.length === 1 ? 'address' : 'addresses'} added.</p>}

      {((resolved?.excluded.length || 0) + removedPeople.length) > 0 && (
        <details className="st-left-out" style={{ marginTop: 12 }}>
          <summary>Left out ({(resolved?.excluded.length || 0) + removedPeople.length})</summary>
          <div className="st-people" style={{ maxHeight: 220, marginTop: 8 }} role="list" aria-label="Left out">
            {removedPeople.map(p => (
              <div key={`r-${p.normEmail}`} className="st-person st-person-static st-person-x" role="listitem">
                <span style={{ minWidth: 0 }}>{p.name || p.email}<small>{p.email}</small></span>
                <small>{reasonWords('removed')}</small>
                <button type="button" className="st-btn st-btn-sm st-btn-ghost" onClick={() => flip(p.normEmail)}>Put back</button>
              </div>
            ))}
            {(resolved?.excluded || []).map((x, i) => (
              <div key={`x-${i}`} className="st-person st-person-static" role="listitem">
                <span style={{ minWidth: 0 }}>{x.name || x.email || 'Unknown'}{x.email && x.name ? <small>{x.email}</small> : null}</span>
                <small>{reasonWords(x.reason)}</small>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  )
}

function HandPicker(p) {
  const { name, source, setSource, cohortId, students, shownStudents, studentQ, setStudentQ, emailSource, setEmailSource, studentSel, setStudentSel,
    contacts, shownContacts, contactQ, setContactQ, contactCat, setContactCat, contactSel, setContactSel,
    pasteText, setPasteText, picked, setPicked, invalid, setInvalid, toggle } = p
  return (
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
              setPicked(prev => { const seen = new Set(prev.map(x => x.normEmail)); return [...prev, ...valid.filter(v => !seen.has(v.normEmail))] })
              setInvalid(bad); setPasteText('')
            }}>Add addresses</button>
            {picked.length > 0 && <button type="button" className="st-btn st-btn-sm st-btn-ghost" onClick={() => setPicked([])}>Clear {picked.length}</button>}
          </div>
          {invalid.length > 0 && <p className="st-notice st-notice-bad" style={{ marginTop: 10 }}>Not added, not an email address: {invalid.join(', ')}</p>}
          {picked.length > 0 && <p className="st-hint">{picked.map(x => x.email).join(', ')}</p>}
        </>
      )}
    </>
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
            <div key={`${x.email}-${i}`} className="st-person st-person-static" role="listitem">
              <span>{x.email || 'Unknown address'}</span><small>{reasonWords(x.reason)}</small>
            </div>
          ))}
        </div>
      )}
      <p className="st-sub">Every batch is in ASPIRE Connect &gt; Outreach &gt; Sent History as "Studio: …".</p>
    </>
  )
}

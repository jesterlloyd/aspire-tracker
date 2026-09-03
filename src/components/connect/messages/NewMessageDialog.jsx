// src/components/connect/messages/NewMessageDialog.jsx
//
// ASPIRE MESSAGES, PHASE 4B2B-I: the staff New message workflow.
//
// MOUNTED IN PRODUCTION inside Connect > Messages (stale 'dormant' header
// corrected by ASPIRE-CHART);
// Connect.jsx, App.jsx, VALID_TABS, and /connect/messages are untouched.
//
// Contract (inspected, not invented):
//   GET  /api/messages-staff-options?kind=participants&q=  -> { options: [
//          { participant_profile_id, student_id, display_name, context,
//            access_active } ] }  minimum search 2, capped at 20
//   POST /api/messages-staff-start  { participant_profile_id, student_id,
//          subject, category, body }
//        201 { conversation_id, message_id, created_at, status }
//        409 { error: 'conflict', reason }
//
// The browser sends ONLY those five fields. It never sends p_delivery,
// recipient_email, recipient_kind, a notification recipient_profile_id,
// event_type, idempotency_key, snapshot fields, a CTA path, or notification
// metadata; the client's routing-field guard still enforces this. The server
// owns all routing and delivery construction.
//
// Privacy: no email is displayed, nothing is logged, and no field is persisted
// to browser storage.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, X, AlertCircle, RotateCw } from 'lucide-react'
import {
  MESSAGE_CATEGORIES, MESSAGE_MAX_BODY_CHARS, SUBJECT_MAX_CHARS,
  validateSubjectValue, validateBodyValue, mapMessagesError,
} from '../../../lib/messages/messagesConstants'
import { debounce } from '../../../lib/messages/inboxState'
import * as defaultApi from '../../../lib/messages/messagesApiClient'

const F = 'Plus Jakarta Sans, sans-serif'
const MIN_SEARCH = 2          // matches the endpoint's documented minimum
const SEARCH_DEBOUNCE_MS = 300 // inside the approved 250 to 400 range

const T = {
  accent: 'var(--color-accent-primary,#1D2567)',
  text: 'var(--text-primary,#0E1428)',
  muted: 'var(--text-secondary,#4A5560)',
  border: 'var(--border-input,rgba(29,37,103,0.10))',
  input: 'var(--bg-input,#fff)',
  danger: '#B3282D',
}

export default function NewMessageDialog({ open, onClose, onCreated, announce = () => {}, api = defaultApi }) {
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [participant, setParticipant] = useState(null)
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState('')
  const [body, setBody] = useState('')
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [pending, setPending] = useState(false)
  const dialogRef = useRef(null)
  const firstFieldRef = useRef(null)

  const applySearch = useMemo(() => debounce((v) => setSearch(v), SEARCH_DEBOUNCE_MS), [])
  useEffect(() => () => applySearch.cancel(), [applySearch])

  // Escape closes. Focus moves into the dialog on open; the caller returns focus
  // to the New message trigger.
  useEffect(() => {
    if (!open) return undefined
    firstFieldRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape' && !pending) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, pending])

  // Participant search through React Query, the app convention: it owns request
  // cancellation and stale responses, so no manual request state exists. Below
  // the minimum length nothing is requested at all.
  const term = search.trim()
  const searchEnabled = open && term.length >= MIN_SEARCH
  const { data: partData, isFetching, isError: searchFailed, refetch } = useQuery({
    queryKey: ['messages_participant_options', term],
    queryFn: ({ signal }) => api.listParticipantOptions(term, { signal }),
    enabled: searchEnabled,
    staleTime: 30 * 1000,
    retry: 1,
  })
  // Only active portal participants are selectable. The endpoint already returns
  // active-only; this is a second guard.
  const options = useMemo(
    () => (partData?.options || []).filter((o) => o.access_active !== false),
    [partData],
  )
  const searchState = !searchEnabled ? 'idle'
    : isFetching ? 'loading'
    : searchFailed ? 'error'
    : 'done'

  const reset = useCallback(() => {
    applySearch.cancel()
    setQ(''); setSearch('')
    setParticipant(null); setSubject(''); setCategory(''); setBody('')
    setErrors({}); setFormError(null)
  }, [applySearch])

  const close = useCallback(() => { if (!pending) onClose() }, [pending, onClose])

  const submit = async (e) => {
    e?.preventDefault?.()
    // Duplicate-submit guard: one user action produces one HTTP request. The
    // backend notification idempotency does not cover repeated HTTP requests.
    if (pending) return

    const next = {}
    if (!participant) next.participant = 'Select an active portal participant.'
    const s = validateSubjectValue(subject)
    if (!s.ok) next.subject = s.error
    const b = validateBodyValue(body)
    if (!b.ok) next.body = b.error
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setPending(true)
    setFormError(null)
    try {
      const result = await api.startStaffConversation({
        participantProfileId: participant.participant_profile_id,
        studentId: participant.student_id,
        subject: s.value,
        category: category || null,
        body: b.value,
      })
      announce('Message sent.')
      reset()
      onClose()
      onCreated?.(result?.conversation_id || null)
    } catch (err) {
      // Failure preserves every entered field and the participant selection.
      setFormError(mapMessagesError(err?.status))
      // A conflict means the participant lost active portal access. Refresh the
      // options and block submission until another active participant is picked.
      if (err?.status === 409) {
        setParticipant(null)
        setErrors((p) => ({ ...p, participant: 'This participant no longer has active portal access. Select another participant.' }))
        refetch()
      }
      setPending(false)
    }
  }

  if (!open) return null

  const bodyCount = body.length
  const nearLimit = bodyCount > MESSAGE_MAX_BODY_CHARS - 500

  return (
    <div style={overlay} role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nm-title"
        style={dialog}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h3 id="nm-title" style={{ margin: 0, fontSize: 15.5, fontWeight: 700, color: T.text, fontFamily: F }}>
            New message
          </h3>
          <button type="button" onClick={close} disabled={pending} style={iconBtn} aria-label="Close new message">
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={submit} noValidate>
          {/* Participant search */}
          <label htmlFor="nm-search" style={label}>Participant</label>
          {participant ? (
            <div style={{ ...selected, marginBottom: 4 }}>
              <span style={{ fontSize: 13, color: T.text, fontWeight: 600 }}>{participant.display_name}</span>
              {participant.context && <span style={{ fontSize: 11.5, color: T.muted }}>{participant.context}</span>}
              <button
                type="button"
                onClick={() => setParticipant(null)}
                disabled={pending}
                style={{ ...linkBtn, marginLeft: 'auto' }}
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <div style={{ position: 'relative' }}>
                <Search size={14} aria-hidden="true" style={{ position: 'absolute', left: 10, top: 10, color: T.muted }} />
                <input
                  id="nm-search"
                  ref={firstFieldRef}
                  type="search"
                  value={q}
                  disabled={pending}
                  onChange={(e) => { setQ(e.target.value); applySearch(e.target.value) }}
                  placeholder="Search active participants by name"
                  aria-describedby="nm-search-hint"
                  style={{ ...input, paddingLeft: 30 }}
                />
              </div>
              <p id="nm-search-hint" style={hint}>Enter at least {MIN_SEARCH} characters.</p>

              {searchState === 'loading' && <p style={hint} role="status">Searching</p>}
              {searchState === 'error' && (
                <p style={{ ...hint, color: T.danger }}>
                  Could not load participants.{' '}
                  <button type="button" onClick={() => refetch()} style={linkBtn}>
                    <RotateCw size={11} aria-hidden="true" /> Retry
                  </button>
                </p>
              )}
              {searchState === 'done' && options.length === 0 && (
                <p style={hint}>No active participants match that search.</p>
              )}
              {options.length > 0 && (
                <ul role="listbox" aria-label="Active participants" style={listbox}>
                  {options.map((o) => (
                    <li key={o.participant_profile_id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected="false"
                        onClick={() => { setParticipant(o); setErrors((p) => ({ ...p, participant: undefined })) }}
                        style={optionBtn}
                      >
                        <span style={{ fontSize: 13, color: T.text }}>{o.display_name}</span>
                        {o.context && <span style={{ fontSize: 11.5, color: T.muted }}>{o.context}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {errors.participant && <FieldError id="nm-participant-err">{errors.participant}</FieldError>}

          {/* Subject */}
          <label htmlFor="nm-subject" style={label}>Subject</label>
          <input
            id="nm-subject"
            type="text"
            value={subject}
            disabled={pending}
            maxLength={SUBJECT_MAX_CHARS}
            onChange={(e) => setSubject(e.target.value)}
            aria-invalid={errors.subject ? 'true' : undefined}
            aria-describedby={errors.subject ? 'nm-subject-err' : 'nm-subject-count'}
            style={input}
          />
          <p id="nm-subject-count" style={hint}>{subject.trim().length} of {SUBJECT_MAX_CHARS}</p>
          {errors.subject && <FieldError id="nm-subject-err">{errors.subject}</FieldError>}

          {/* Category */}
          <label htmlFor="nm-category" style={label}>Category</label>
          <select
            id="nm-category"
            value={category}
            disabled={pending}
            onChange={(e) => setCategory(e.target.value)}
            style={input}
          >
            <option value="">Uncategorized</option>
            {MESSAGE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Body */}
          <label htmlFor="nm-body" style={label}>Message</label>
          <textarea
            id="nm-body"
            rows={5}
            value={body}
            disabled={pending}
            onChange={(e) => setBody(e.target.value)}
            aria-invalid={errors.body ? 'true' : undefined}
            aria-describedby={errors.body ? 'nm-body-err' : 'nm-body-count'}
            style={{ ...input, resize: 'vertical', fontFamily: F }}
          />
          <p id="nm-body-count" style={{ ...hint, color: nearLimit ? T.danger : T.muted }}>
            {bodyCount} of {MESSAGE_MAX_BODY_CHARS}
          </p>
          {errors.body && <FieldError id="nm-body-err">{errors.body}</FieldError>}

          {formError && (
            <p role="alert" style={{ ...hint, color: T.danger, display: 'flex', alignItems: 'center', gap: 5 }}>
              <AlertCircle size={12} aria-hidden="true" /> {formError}
            </p>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" onClick={close} disabled={pending} style={secondaryBtn}>Cancel</button>
            <button type="submit" disabled={pending} style={{ ...primaryBtn, opacity: pending ? 0.6 : 1 }}>
              {pending ? 'Sending' : 'Send message'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function FieldError({ id, children }) {
  return (
    <p id={id} style={{ margin: '2px 0 0', fontSize: 11.5, color: T.danger, fontFamily: F }}>
      {children}
    </p>
  )
}

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(14,20,40,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 60,
}
const dialog = {
  width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto',
  background: T.input, border: `1px solid ${T.border}`, borderRadius: 12,
  padding: 16, fontFamily: F, boxShadow: '0 10px 40px -12px rgba(29,37,103,0.35)',
}
const label = { display: 'block', marginTop: 10, marginBottom: 3, fontSize: 12, fontWeight: 600, color: T.text, fontFamily: F }
const input = {
  width: '100%', minHeight: 34, padding: '7px 10px', boxSizing: 'border-box',
  border: `1px solid ${T.border}`, borderRadius: 7, fontSize: 13,
  color: T.text, background: T.input, fontFamily: F,
}
const hint = { margin: '3px 0 0', fontSize: 11.5, color: T.muted, fontFamily: F }
const listbox = {
  listStyle: 'none', margin: '5px 0 0', padding: 0, maxHeight: 160, overflowY: 'auto',
  border: `1px solid ${T.border}`, borderRadius: 7,
}
const optionBtn = {
  width: '100%', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 1,
  padding: '7px 10px', minHeight: 44, border: 'none', background: 'none',
  cursor: 'pointer', fontFamily: F,
}
const selected = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', minHeight: 44,
  border: `1px solid ${T.border}`, borderRadius: 7,
}
const primaryBtn = {
  minHeight: 36, padding: '0 14px', borderRadius: 7, border: 'none', cursor: 'pointer',
  background: T.accent, color: '#fff', fontSize: 12.5, fontWeight: 600, fontFamily: F,
}
const secondaryBtn = {
  minHeight: 36, padding: '0 14px', borderRadius: 7, cursor: 'pointer',
  border: `1px solid ${T.border}`, background: T.input, color: T.text,
  fontSize: 12.5, fontWeight: 600, fontFamily: F,
}
const linkBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 3, background: 'none', border: 'none',
  padding: '4px 2px', minHeight: 28, fontSize: 12, color: T.accent, cursor: 'pointer',
  textDecoration: 'underline', fontFamily: F,
}
const iconBtn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 30, height: 30, borderRadius: 6, border: 'none', background: 'none',
  cursor: 'pointer', color: T.muted,
}

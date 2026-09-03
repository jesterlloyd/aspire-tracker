// src/components/connect/messages/ThreadActions.jsx
//
// ASPIRE MESSAGES, PHASE 4B2B-I: the staff reply composer and the assignment,
// status, category, and follow-up controls.
//
// MOUNTED IN PRODUCTION inside Connect > Messages (stale 'dormant' header
// corrected by ASPIRE-CHART).
//
// Contracts (inspected, not invented):
//   POST /api/messages-staff-reply  { conversation_id, body }
//        201 { message_id, created_at, reopened }
//        409 { error: 'conflict', reason: 'no_active_participant' }
//   POST /api/messages-staff-manage { action, conversation_id, ... }
//        actions: assign | status | category | flag
//        assign   -> { assignee_profile_id: uuid | null }
//        status   -> { status: 'open' | 'waiting' | 'resolved' }
//        category -> { category: approved | null }
//        flag     -> { flagged: boolean }
//        200 { action, ...data }
//   GET  /api/messages-staff-options?kind=assignees
//        -> { options: [{ profile_id, display_name, role, is_current_user }] }
//
// None of these actions sends an email: assignment, status (including
// resolution), category, and follow-up are all silent by backend design. The
// browser never sends notification-routing fields.
//
// Privacy: the reply draft lives in component memory only. It is never written
// to localStorage, sessionStorage, IndexedDB, or analytics, and background
// polling never clears it.

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Flag, AlertCircle } from 'lucide-react'
import {
  MESSAGE_CATEGORIES, STAFF_STATUSES, STAFF_STATUS_LABEL,
  MESSAGE_MAX_BODY_CHARS, validateBodyValue, mapMessagesError,
} from '../../../lib/messages/messagesConstants'
import * as defaultApi from '../../../lib/messages/messagesApiClient'

const F = 'Plus Jakarta Sans, sans-serif'

// The exact approved safety notice. Never shortened or paraphrased.
export const SAFETY_NOTICE = "ASPIRE Messages is not monitored continuously. Do not include patient names, medical record numbers, or other identifying information. For urgent patient-care or safety concerns, follow your unit's established escalation process."

// The exact approved inactive-participant notice.
export const INACTIVE_NOTICE = 'This participant no longer has active portal access. You can review and manage this conversation, but you cannot send a new message.'

const T = {
  accent: 'var(--color-accent-primary,#1D2567)',
  text: 'var(--text-primary,#0E1428)',
  muted: 'var(--text-secondary,#4A5560)',
  border: 'var(--border-input,rgba(29,37,103,0.10))',
  input: 'var(--bg-input,#fff)',
  danger: '#B3282D',
}

// ── Reply composer ──────────────────────────────────────────────────────────

export function ReplyComposer({ conversationId, accessActive, api = defaultApi, announce = () => {}, onSent = () => {} }) {
  const queryClient = useQueryClient()
  const [body, setBody] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)

  const trimmed = body.trim()
  const tooLong = body.length > MESSAGE_MAX_BODY_CHARS
  // Sending is blocked when access is inactive, a request is pending, the body is
  // blank after trimming, the body is too long, or nothing is selected.
  const disabled = !accessActive || pending || trimmed.length < 1 || tooLong || !conversationId

  const send = async (e) => {
    e?.preventDefault?.()
    // One activation produces one request; repeated Enter or clicks are ignored.
    if (disabled) return
    const v = validateBodyValue(body)
    if (!v.ok) { setError(v.error); return }

    setPending(true)
    setError(null)
    try {
      const result = await api.replyStaffConversation({ conversationId, body: v.value })
      // Only after the authoritative response does the draft clear. Nothing is
      // optimistically inserted, so a duplicate message can never appear.
      setBody('')
      announce('Message sent.')
      queryClient.invalidateQueries({ queryKey: ['messages_staff_thread', conversationId] })
      queryClient.invalidateQueries({ queryKey: ['messages_staff_list'] })
      queryClient.invalidateQueries({ queryKey: ['messages_staff_unread'] })
      onSent(result)
    } catch (err) {
      // Failure preserves the draft.
      setError(mapMessagesError(err?.status))
      if (err?.status === 409) {
        // Access changed underneath us: refresh the thread so the header and the
        // composer reflect the authoritative access state. The draft is kept.
        queryClient.invalidateQueries({ queryKey: ['messages_staff_thread', conversationId] })
      }
    } finally {
      setPending(false)
    }
  }

  const nearLimit = body.length > MESSAGE_MAX_BODY_CHARS - 500

  return (
    <div style={{ borderTop: `1px solid ${T.border}`, padding: '10px 16px 12px' }}>
      {!accessActive && (
        <p style={notice} role="note">{INACTIVE_NOTICE}</p>
      )}

      <form onSubmit={send}>
        <label htmlFor="reply-body" style={srOnly}>Reply to this conversation</label>
        <textarea
          id="reply-body"
          rows={3}
          value={body}
          disabled={!accessActive || pending}
          onChange={(e) => setBody(e.target.value)}
          placeholder={accessActive ? 'Write a reply' : 'Replies are unavailable for this participant'}
          aria-describedby="reply-count reply-safety"
          style={{
            width: '100%', boxSizing: 'border-box', padding: '8px 10px',
            border: `1px solid ${T.border}`, borderRadius: 7, fontSize: 13,
            color: T.text, background: T.input, resize: 'vertical', fontFamily: F,
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
          <span id="reply-count" style={{ fontSize: 11.5, color: nearLimit ? T.danger : T.muted, fontFamily: F }}>
            {body.length} of {MESSAGE_MAX_BODY_CHARS}
          </span>
          {error && (
            <span role="alert" style={{ fontSize: 11.5, color: T.danger, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <AlertCircle size={12} aria-hidden="true" /> {error}
            </span>
          )}
          <button type="submit" disabled={disabled} style={{ ...primaryBtn, marginLeft: 'auto', opacity: disabled ? 0.5 : 1 }}>
            {pending ? 'Sending' : 'Send'}
          </button>
        </div>

        {/* The exact approved safety notice, verbatim. */}
        <p id="reply-safety" style={safety}>{SAFETY_NOTICE}</p>
      </form>
    </div>
  )
}

// ── Management controls ─────────────────────────────────────────────────────

export function ThreadManagementControls({ conversation, api = defaultApi, announce = () => {} }) {
  const queryClient = useQueryClient()
  // One action-specific pending state, so a slow assignment never blocks status.
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const id = conversation?.id

  // Eligible assignees: active Owner/Admin only, from the narrow lookup. Never a
  // directory, and inactive or non-admin staff can never appear.
  const { data: assigneeData } = useQuery({
    queryKey: ['messages_assignee_options'],
    queryFn: ({ signal }) => api.listAssigneeOptions({ signal }),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })
  const assignees = assigneeData?.options || []

  const run = async (action, payload, successMessage) => {
    // Duplicate-request guard per action.
    if (busy) return
    setBusy(action)
    setError(null)
    try {
      await api.manageStaffConversation({ action, conversation_id: id, ...payload })
      // Invalidate only the relevant keys; search, filters, pagination, the
      // selected conversation, and the mobile view are all untouched.
      queryClient.invalidateQueries({ queryKey: ['messages_staff_thread', id] })
      queryClient.invalidateQueries({ queryKey: ['messages_staff_list'] })
      announce(successMessage)
    } catch (err) {
      // No optimistic value was written, so the server state simply stands.
      setError(mapMessagesError(err?.status))
      queryClient.invalidateQueries({ queryKey: ['messages_staff_thread', id] })
    } finally {
      setBusy(null)
    }
  }

  const flagged = conversation?.follow_up_flagged === true

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 }}>
      <Control id="mg-status" label="Status" busy={busy === 'status'}>
        <select
          id="mg-status"
          value={conversation?.status || 'open'}
          disabled={busy === 'status'}
          onChange={(e) => run('status', { status: e.target.value }, `Status set to ${STAFF_STATUS_LABEL[e.target.value]}.`)}
          style={select}
        >
          {STAFF_STATUSES.map((s) => <option key={s} value={s}>{STAFF_STATUS_LABEL[s]}</option>)}
        </select>
      </Control>

      <Control id="mg-assignee" label="Assignee" busy={busy === 'assign'}>
        <select
          id="mg-assignee"
          value={conversation?.assigned_staff_profile_id || ''}
          disabled={busy === 'assign'}
          onChange={(e) => run('assign', { assignee_profile_id: e.target.value || null },
            e.target.value ? 'Assignment updated.' : 'Assignment cleared.')}
          style={select}
        >
          <option value="">Unassigned</option>
          {assignees.map((a) => (
            <option key={a.profile_id} value={a.profile_id}>
              {a.is_current_user ? `${a.display_name} (me)` : a.display_name}
            </option>
          ))}
        </select>
      </Control>

      <Control id="mg-category" label="Category" busy={busy === 'category'}>
        <select
          id="mg-category"
          value={conversation?.category || ''}
          disabled={busy === 'category'}
          onChange={(e) => run('category', { category: e.target.value || null },
            e.target.value ? 'Category updated.' : 'Category cleared.')}
          style={select}
        >
          <option value="">Uncategorized</option>
          {MESSAGE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Control>

      <button
        type="button"
        disabled={busy === 'flag'}
        aria-pressed={flagged}
        onClick={() => run('flag', { flagged: !flagged }, flagged ? 'Follow up cleared.' : 'Marked for follow up.')}
        style={{
          ...toggleBtn,
          background: flagged ? T.accent : T.input,
          color: flagged ? '#fff' : T.text,
        }}
      >
        <Flag size={11} aria-hidden="true" />
        Follow up{flagged ? ': on' : ''}
      </button>

      {error && (
        <span role="alert" style={{ fontSize: 11.5, color: T.danger, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <AlertCircle size={12} aria-hidden="true" /> {error}
        </span>
      )}
    </div>
  )
}

function Control({ id, label, busy, children }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <label htmlFor={id} style={srOnly}>{label}</label>
      {children}
      {busy && <span style={{ fontSize: 10.5, color: T.muted }} role="status">Saving</span>}
    </span>
  )
}

const srOnly = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
}
const select = {
  minHeight: 30, padding: '0 6px', borderRadius: 6, fontSize: 12, fontFamily: F,
  border: `1px solid ${T.border}`, background: T.input, color: T.text, cursor: 'pointer',
  maxWidth: 190,
}
const toggleBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 30,
  padding: '0 10px', borderRadius: 999, cursor: 'pointer',
  border: `1px solid ${T.border}`, fontSize: 11.5, fontWeight: 600, fontFamily: F,
}
const primaryBtn = {
  minHeight: 34, padding: '0 14px', borderRadius: 7, border: 'none', cursor: 'pointer',
  background: T.accent, color: '#fff', fontSize: 12.5, fontWeight: 600, fontFamily: F,
}
const notice = {
  margin: '0 0 8px', padding: '7px 10px', fontSize: 12, lineHeight: 1.5,
  color: T.text, background: 'rgba(29,37,103,0.04)',
  border: `1px solid ${T.border}`, borderRadius: 7, fontFamily: F,
}
const safety = {
  margin: '8px 0 0', fontSize: 11, lineHeight: 1.5, color: T.muted, fontFamily: F,
}

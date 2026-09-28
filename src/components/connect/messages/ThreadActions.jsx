// src/components/connect/messages/ThreadActions.jsx
//
// ASPIRE MESSAGES, PHASE 4B2B-I: the staff reply composer and the thread
// actions. MOUNTED IN PRODUCTION inside Connect > Messages and the drawer.
//
// MESSAGES-SIMPLIFY-1: the thread has two actions, Follow up and Done (Reopen
// on a Done thread). The Status, Assignee and Category selects are gone; the
// columns stay in the database and Messages no longer writes them. Every reply
// and reaction is attributed to the signed-in user, which the composer states.
//
// Contracts (inspected, not invented):
//   POST /api/messages-staff-reply  { conversation_id, body }
//        201 { message_id, created_at, reopened }
//        409 { error: 'conflict', reason: 'no_active_participant' }
//   POST /api/messages-staff-manage { action, conversation_id, ... }
//        flag -> { flagged: boolean }
//        done -> { done: boolean }   Done resolves and clears the flag;
//                                    Reopen sets it open.
//        200 { action, ...data }
//
// None of these actions sends an email.
//
// Privacy: the reply draft lives in component memory only. It is never written
// to localStorage, sessionStorage, IndexedDB, or analytics, and background
// polling never clears it.

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Flag, AlertCircle, Check, RotateCcw } from 'lucide-react'
import {
  MESSAGE_MAX_BODY_CHARS, validateBodyValue, mapMessagesError,
} from '../../../lib/messages/messagesConstants'
import { isDone } from '../../../lib/messages/messagesTriage'
import { useAuth } from '../../../contexts/AuthContext'
import * as defaultApi from '../../../lib/messages/messagesApiClient'

const F = 'Plus Jakarta Sans, sans-serif'

// The exact approved safety notice. Never shortened or paraphrased.
export const SAFETY_NOTICE = "ASPIRE Messages is not monitored continuously. Do not include patient names, medical record numbers, or other identifying information. For urgent patient-care or safety concerns, follow your unit's established escalation process."
export const PRIVACY_NOTICE = 'Do not include patient names, medical record numbers, or other identifying information.'
export const FULL_NOTICE = "ASPIRE Messages is not monitored continuously. For urgent patient-care or safety concerns, follow your unit's established escalation process."

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

export function ReplyComposer({ conversationId, accessActive, api = defaultApi, announce = () => {}, onSent = () => {}, focusOnMount = false }) {
  const queryClient = useQueryClient()
  const { userProfile } = useAuth() || {}
  const replyingAs = userProfile?.full_name || ''
  const [body, setBody] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)
  const [noticeOpen, setNoticeOpen] = useState(false)

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
        <div className="messages-composer-hint">
          {replyingAs && <span>Replying as <b>{replyingAs}</b></span>}
          <span>Press and hold a student&apos;s message to react.</span>
        </div>
        <label htmlFor="reply-body" style={srOnly}>Reply to this conversation</label>
        <textarea
          id="reply-body"
          className="messages-focusable"
          autoFocus={focusOnMount}
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
          <button
            type="submit"
            disabled={disabled}
            className="messages-focusable"
            style={{ ...primaryBtn, marginLeft: 'auto', opacity: disabled ? 0.5 : 1 }}
          >
            {pending ? 'Sending' : 'Send'}
          </button>
        </div>

        <div id="reply-safety" style={safety}>
          <span>{PRIVACY_NOTICE}</span>{' '}
          <button
            type="button"
            className="messages-focusable"
            aria-expanded={noticeOpen}
            onClick={() => setNoticeOpen((open) => !open)}
            style={noticeButton}
          >
            {noticeOpen ? 'Hide full notice' : 'Full notice'}
          </button>
          {noticeOpen && <p style={{ margin: '5px 0 0' }}>{FULL_NOTICE}</p>}
        </div>
      </form>
    </div>
  )
}

// ── Thread actions ──────────────────────────────────────────────────────────

export function ThreadManagementControls({ conversation, api = defaultApi, announce = () => {} }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const id = conversation?.id
  const flagged = conversation?.follow_up_flagged === true
  const done = isDone(conversation)

  const run = async (action, payload, successMessage) => {
    if (busy) return
    setBusy(action)
    setError(null)
    try {
      await api.manageStaffConversation({ action, conversation_id: id, ...payload })
      queryClient.invalidateQueries({ queryKey: ['messages_staff_thread', id] })
      queryClient.invalidateQueries({ queryKey: ['messages_staff_list'] })
      queryClient.invalidateQueries({ queryKey: ['messages_staff_unread'] })
      announce(successMessage)
    } catch (err) {
      setError(mapMessagesError(err?.status))
      queryClient.invalidateQueries({ queryKey: ['messages_staff_thread', id] })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="messages-thread-actions">
      <button
        type="button"
        className={`messages-action-btn messages-focusable${flagged ? ' messages-action-btn--flag-on' : ''}`}
        disabled={busy === 'flag'}
        aria-pressed={flagged}
        onClick={() => run('flag', { flagged: !flagged }, flagged ? 'Follow up cleared.' : 'Marked for follow up.')}
      >
        <Flag size={14} fill={flagged ? 'currentColor' : 'none'} aria-hidden="true" />
        {flagged ? 'Following up' : 'Follow up'}
      </button>
      <button
        type="button"
        className="messages-action-btn messages-action-btn--primary messages-focusable"
        disabled={busy === 'done'}
        onClick={() => run('done', { done: !done }, done ? 'Reopened.' : 'Marked done.')}
      >
        {done ? <RotateCcw size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
        {done ? 'Reopen' : 'Done'}
      </button>
      {error && (
        <span role="alert" style={{ fontSize: 11.5, color: T.danger, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <AlertCircle size={12} aria-hidden="true" /> {error}
        </span>
      )}
    </div>
  )
}

const srOnly = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
}
const primaryBtn = {
  minHeight: 34, padding: '0 14px', borderRadius: 7, border: 'none', cursor: 'pointer',
  background: T.accent, color: 'var(--color-text-inverse,#fff)', fontSize: 12.5, fontWeight: 600, fontFamily: F,
}
const notice = {
  margin: '0 0 8px', padding: '7px 10px', fontSize: 12, lineHeight: 1.5,
  color: T.text, background: 'rgba(29,37,103,0.04)',
  border: `1px solid ${T.border}`, borderRadius: 7, fontFamily: F,
}
const safety = {
  margin: '8px 0 0', fontSize: 11, lineHeight: 1.5, color: T.muted, fontFamily: F,
}
const noticeButton = {
  padding: 0, border: 0, background: 'transparent', color: T.accent,
  font: 'inherit', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer',
}

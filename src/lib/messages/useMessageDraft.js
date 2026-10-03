// src/lib/messages/useMessageDraft.js
//
// MESSAGE-DRAFTS-1: one hook for every Messages composer. It reads the saved
// draft for the signed-in person and slot, writes every change as it happens
// (so closing a drawer mid-sentence loses nothing), and follows the slot when
// the reader moves to another thread. The rules live in messageDrafts.js.
//
//   const { draft, update, discard, saved } = useMessageDraft(`reply.${id}`, { body: '' })
//   useMessageDraft('new', { subject: '', body: '' }, ['subject', 'body'])  (typed fields only)
//   update({ body })   on every keystroke
//   discard()          after a successful send, or when the person discards it
//
// With no signed-in profile (or no slot) the draft lives in memory only.

import { useCallback, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { loadDraft, saveDraft, clearDraft, isEmptyDraft } from './messageDrafts.js'

export function useMessageDraft(slot, empty, textKeys = null) {
  const { userProfile } = useAuth() || {}
  const userId = userProfile?.id || null
  // The blank shape, fixed at first render (a caller's literal is new every render).
  const [blank] = useState(() => ({ ...empty }))
  const read = useCallback(() => ({ ...blank, ...(loadDraft(userId, slot) || {}) }), [blank, userId, slot])

  const [state, setState] = useState(() => ({ owner: `${userId}|${slot}`, draft: read() }))
  // Another thread (or another person) has its own draft: reload, never carry over.
  const owner = `${userId}|${slot}`
  let current = state
  if (state.owner !== owner) {
    current = { owner, draft: read() }
    setState(current)
  }
  const draft = current.draft

  const update = useCallback((patch) => {
    setState((prev) => {
      const next = { ...prev.draft, ...patch }
      saveDraft(userId, slot, next, Date.now(), textKeys)
      return { owner: prev.owner, draft: next }
    })
  }, [userId, slot, textKeys])

  const discard = useCallback(() => {
    clearDraft(userId, slot)
    setState((prev) => ({ owner: prev.owner, draft: { ...blank } }))
  }, [blank, userId, slot])

  return { draft, update, discard, saved: Boolean(userId && slot) && !isEmptyDraft(draft, textKeys) }
}

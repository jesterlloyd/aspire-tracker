// src/components/ngrp/UpdateAnswersEditor.jsx
//
// TRANSITION-STAFF-REVISION-1 (Owner, 2026-11-05): the binder's Update Answers. The alumnus's
// own Transition Form (NgrpTransitionFormPage, staff door) over the page, so the team edits
// exactly what the alumnus sees, under the same rules. It saves a new revision through
// ngrp-manage form_staff_* (Owner and Admin), with a reason; nothing is emailed.
import { Suspense, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { postNgrpManage } from '../../lib/ngrp/useNgrpData'
import { lazyReload } from '../../lib/lazyReload'

const NgrpTransitionFormPage = lazyReload(() => import('../../pages/NgrpTransitionFormPage'), 'NgrpTransitionFormPage')

export default function UpdateAnswersEditor({ candidateId, onDone, onCancel }) {
  const staff = useMemo(() => ({
    post: async (action, extra = {}) => {
      if (action !== 'load' && action !== 'submit') return { status: 204, body: null }
      const res = await postNgrpManage(action === 'load' ? 'form_staff_load' : 'form_staff_submit', { candidate_id: candidateId, ...extra })
      if (res.ok) return { status: 200, body: res }
      return { status: res.status || 500, body: { error: res.code || res.error, errors: res.errors } }
    },
    onDone, onCancel,
  }), [candidateId, onDone, onCancel])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onCancel?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Update Transition Form answers"
      style={{ position: 'fixed', inset: 0, zIndex: 1200, overflowY: 'auto', background: '#F4F1EC' }}>
      <Suspense fallback={null}>
        <NgrpTransitionFormPage staff={staff} />
      </Suspense>
    </div>,
    document.body,
  )
}

// AP-CLEARANCE-1: the clearance rows for one student, read through /api/student-documents.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export async function postStudentDocuments(body) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/api/student-documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, data: json }
}

export function useClearanceOnRecord(studentId, enabled) {
  const [state, setState] = useState({ forId: null, rows: [] })
  useEffect(() => {
    if (!enabled || !studentId) return undefined
    let live = true
    postStudentDocuments({ action: 'clearance', student_id: studentId }).then(r => {
      if (live) setState({ forId: studentId, rows: r.ok && r.data.provisioned ? r.data.rows || [] : [] })
    }).catch(() => { if (live) setState({ forId: studentId, rows: [] }) })
    return () => { live = false }
  }, [studentId, enabled])
  return state.forId === studentId ? state.rows : []
}


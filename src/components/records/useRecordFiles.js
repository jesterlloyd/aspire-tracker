// src/components/records/useRecordFiles.js
// CATALOG-REVAMP-1: reads a record's filed documents and the Catalog sends that reached
// it, and opens one document through /api/record-document-open. The components that draw
// them live in RecordDocuments.jsx.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const EMPTY = { docs: [], sends: [], ready: true }
const LOADING = { docs: [], sends: [], ready: false }
const notEnabled = (e) => e && (e.code === '42P01' || e.code === '42703' || e.code === 'PGRST205' || e.code === 'PGRST200')

export function useRecordFiles({ studentId = null, schoolName = null, enabled = true }) {
  const [state, setState] = useState({ key: null, docs: [], sends: [] })
  const want = enabled && (studentId || schoolName) ? `${studentId || ''}|${schoolName || ''}` : null
  useEffect(() => {
    if (!want) return undefined
    let live = true
    ;(async () => {
      const key = studentId ? ['student_id', studentId] : ['school_name', schoolName]
      const [d, s] = await Promise.all([
        supabase.from('record_documents').select('id, title, file_name, source, size_bytes, created_at')
          .eq(key[0], key[1]).order('created_at', { ascending: false }),
        supabase.from('catalog_send_recipients')
          .select('id, created_at, send:catalog_sends(sent_at, resource_version, resource:catalog_resources(title))')
          .eq(key[0], key[1]).eq('status', 'sent').order('created_at', { ascending: false }).limit(50),
      ])
      if (!live) return
      setState({
        key: want,
        docs: d.error ? [] : (d.data || []),
        sends: s.error ? [] : (s.data || []),
        off: notEnabled(d.error) || notEnabled(s.error),
      })
    })()
    return () => { live = false }
  }, [want, studentId, schoolName])
  // Nothing to read (not permitted, or no record) is an empty, settled answer. A result for
  // a different record is never shown while this one loads.
  if (!want) return EMPTY
  return state.key === want ? { ...state, ready: true } : LOADING
}

export function useOpenRecordDocument() {
  const [busy, setBusy] = useState(null)
  const open = useCallback(async (doc, mode = 'download') => {
    setBusy(doc.id)
    const pending = mode === 'open' ? window.open('', '_blank') : null
    if (pending) pending.opener = null
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/record-document-open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ id: doc.id, mode }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.signedUrl) throw new Error(body.error || 'Could not open the file')
      if (pending) pending.location = body.signedUrl
      else {
        const a = document.createElement('a')
        a.href = body.signedUrl; a.rel = 'noopener'; a.download = doc.file_name || ''
        document.body.appendChild(a); a.click(); a.remove()
      }
      return true
    } catch {
      if (pending) pending.close()
      return false
    } finally { setBusy(null) }
  }, [])
  return { open, busy }
}


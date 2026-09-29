// src/components/keith/keithProvenanceStore.js
//
// KEITH-FOUNDATION-1: where the Keith mark gets its state. Marks ask by provenance id; the asks of one
// tick go to /api/keith-provenance as one request (a Sheet of forty receipt rows is one call, not
// forty), and the answer is cached until someone says the record changed (refreshKeithProvenance),
// which a feature does after the person acts on Keith's output.
//
// A record the server leaves out (the caller may not see it, or it is rejected or reverted) is cached
// as null, and its mark draws nothing.

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const cache = new Map()        // id -> record | null
const inflight = new Set()
const listeners = new Map()    // id -> Set<fn>
let queue = new Set()
let timer = null

const notify = (id) => { for (const fn of listeners.get(id) || []) fn() }

async function flush() {
  timer = null
  const ids = [...queue]
  queue = new Set()
  if (!ids.length) return
  ids.forEach(id => inflight.add(id))
  let records = {}
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    const res = await fetch('/api/keith-provenance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action: 'cards', ids }),
    })
    if (res.ok) records = (await res.json())?.records || {}
  } catch { /* no mark is better than a wrong one */ }
  for (const id of ids) {
    inflight.delete(id)
    cache.set(id, records[id] || null)
    notify(id)
  }
}

function request(id) {
  if (cache.has(id) || inflight.has(id) || queue.has(id)) return
  queue.add(id)
  if (!timer) timer = setTimeout(flush, 0)
}

/** Fetch the record again: call it after the person accepts, edits, rejects or undoes. */
export function refreshKeithProvenance(id) {
  if (!id) return
  cache.delete(id)
  request(id)
}

/** For a render test, and for a caller that already holds the card. */
export function primeKeithProvenance(id, record) {
  cache.set(id, record || null)
  notify(id)
}

/** The card record for a provenance id: undefined while loading, null when there is nothing to show. */
export function useKeithProvenance(id) {
  const [, bump] = useState(0)
  useEffect(() => {
    if (!id) return undefined
    const fn = () => bump(n => n + 1)
    if (!listeners.has(id)) listeners.set(id, new Set())
    listeners.get(id).add(fn)
    request(id)
    return () => { listeners.get(id)?.delete(fn) }
  }, [id])
  return id ? cache.get(id) : null
}

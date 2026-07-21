// src/portal/unit/useUnitStudentPhotos.js
//
// UL-PHASE1-VISUAL: roster photo prefetch and reuse for the Unit Leader Portal.
//
// WHY THIS EXISTS. Each avatar signing its own URL on mount means N requests for a
// roster of N and a visible pop-in when the drawer re-signs the same photo. This
// primes ALL of a roster's photos in ONE batch request and stores them in the shared
// studentPhotoCache, so the roster avatar and the detail drawer read the SAME resolved
// URL and the drawer shows the photo instantly with no second load.
//
// IT REUSES THE SHARED CACHE ON PURPOSE. studentPhotoCache is already cleared on
// sign-out, role change, and account-state change via AuthContext, so a Unit Leader's
// signed URLs inherit that scope-clearing for free. Keys are namespaced 'ul:headshot:'
// so a Unit Leader-signed URL and a staff-signed URL for the same student can never
// collide in the map.
//
// AUTHORIZATION IS THE SERVER'S. This module only calls the Unit Leader batch endpoint,
// which re-derives scope from the caller's grant. It never sees a storage path and
// never a student outside scope: an out-of-scope id simply comes back with a null URL.

import { useEffect, useState, useCallback } from 'react'
import { peekStudentPhotoUrl, resolveStudentPhotoUrl } from '../../lib/studentPhotoCache'
import { getStudentFileUrlsBatch } from './unitLeaderApi'

const MAX_BATCH = 100
export const ulPhotoKey = (studentId) => (studentId ? `ul:headshot:${studentId}` : null)

/**
 * Prefetch photos for a roster, keyed by student id, into the shared cache.
 *
 * `students` is the roster array; only those with has_photo === true are requested,
 * so students without a photo never cost a round trip. Returns a `version` counter
 * that bumps when new photos land, so consumers re-render, and a `peek(id)` for a
 * synchronous warm read.
 */
export function useUnitStudentPhotos(students) {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const wanted = (students || [])
      .filter(s => s?.id && s.has_photo && !peekStudentPhotoUrl(ulPhotoKey(s.id)))
      .map(s => s.id)
    if (wanted.length === 0) return undefined

    let live = true
    const ac = new AbortController()
    ;(async () => {
      // Chunk to the endpoint's batch ceiling; rosters are small but this stays honest.
      for (let i = 0; i < wanted.length && live; i += MAX_BATCH) {
        const chunk = wanted.slice(i, i + MAX_BATCH)
        const res = await getStudentFileUrlsBatch(
          chunk.map(id => ({ student_id: id, kind: 'headshot' })), ac.signal)
        if (!live || !res.ok) return
        for (const r of res.data?.results || []) {
          if (!r?.signed_url) continue
          // Prime the shared cache through resolveStudentPhotoUrl so this URL obeys the
          // same TTL and scope rules as every other cached photo. The fetcher just hands
          // back the URL the batch already returned; no extra request is made.
          await resolveStudentPhotoUrl(ulPhotoKey(r.student_id), async () => r.signed_url)
        }
        if (live) setVersion(v => v + 1)
      }
    })().catch(() => { /* a failed prefetch just leaves initials showing */ })

    return () => { live = false; ac.abort() }
  }, [students])

  // Depend on version so a warm read re-evaluates after a prefetch lands.
  const peek = useCallback((studentId) => peekStudentPhotoUrl(ulPhotoKey(studentId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version])

  return { version, peek }
}

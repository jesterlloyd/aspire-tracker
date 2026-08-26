// src/lib/studentFileBatchCore.js
//
// STUDENT-PHOTO-PERF-1: the pure request-coalescing core for the staff photo
// pipeline, dependency-free so it is unit-testable under node (the wiring to
// the real batch client lives in studentPhotoBatch.js, which imports the
// browser Supabase module and therefore cannot load outside Vite).
//
// WHY THIS EXISTS. Every StudentAvatar resolves its own signed URL on mount, so
// a staff list of N students used to fire N separate POSTs to
// /api/student-file-access, each a full serverless invocation (JWT verify +
// profile lookup + students query + storage signing). The endpoint has
// supported batch mode since Wave F-2, but no staff surface used it. Instead of
// adding a prefetch hook to every one of the ~19 consumers (and racing their
// mount effects), the coalescer collapses the individual requests themselves:
// all fetches queued within one short window become ONE batch POST. A
// 40-student roster becomes a single invocation; consumers never change.
//
// AUTHORIZATION IS UNCHANGED. The injected fetch calls the same endpoint with
// the same caller JWT; batch mode applies the identical per-item access matrix,
// and a denied or missing item resolves to null exactly as the single mode did.
// No caching happens here - studentPhotoCache remains the only cache, with its
// existing scope clearing.

// Wide enough to collect every avatar mounted in the same React commit (their
// effects all run synchronously), narrow enough to be imperceptible.
export const BATCH_WINDOW_MS = 20
// Mirrors MAX_BATCH in api/student-file-access.js.
export const BATCH_MAX_ITEMS = 100

// fetchBatch: (items: [{studentId, kind}]) => Promise<Map<`${id}:${kind}`, url|null>>
export function createStudentFileBatcher({ fetchBatch, windowMs = BATCH_WINDOW_MS, maxBatch = BATCH_MAX_ITEMS } = {}) {
  let queue = new Map() // `${studentId}:${kind}` -> { studentId, kind, settlers: [{resolve, reject}] }
  let timer = null

  async function flush() {
    timer = null
    const batch = queue
    queue = new Map()
    const entries = [...batch.values()]
    for (let i = 0; i < entries.length; i += maxBatch) {
      const chunk = entries.slice(i, i + maxBatch)
      try {
        const map = await fetchBatch(chunk.map((e) => ({ studentId: e.studentId, kind: e.kind })))
        for (const e of chunk) {
          const url = map.get(`${e.studentId}:${e.kind}`) ?? null
          e.settlers.forEach((s) => s.resolve(url))
        }
      } catch (err) {
        // The whole chunk shares one response; every waiter sees the same
        // failure, exactly as if it had made the request itself (401/403 still
        // clear the photo cache via resolveStudentPhotoUrl's error path).
        for (const e of chunk) e.settlers.forEach((s) => s.reject(err))
      }
    }
  }

  return {
    // Resolve one { studentId, kind } to a signed URL (or null) through the
    // shared batch window. Concurrent callers for the same item share one
    // queue entry.
    queue({ studentId, kind }) {
      return new Promise((resolve, reject) => {
        const key = `${studentId}:${kind}`
        let entry = queue.get(key)
        if (!entry) {
          entry = { studentId, kind, settlers: [] }
          queue.set(key, entry)
        }
        entry.settlers.push({ resolve, reject })
        if (!timer) timer = setTimeout(flush, windowMs)
      })
    },
    // Test hook: how many distinct items are waiting in the current window.
    pending() {
      return queue.size
    },
  }
}

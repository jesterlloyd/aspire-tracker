import { createPreceptorRequestIdController } from '../../lib/preceptorRequestId.js'

// One controller per mounted creation form. A failed HTTP attempt releases the
// in-flight guard but retains its request id; success completes the intent so the
// next form submission receives a fresh id.
export function createUnitPreceptorCreationController({ create, requestIds } = {}) {
  const ids = requestIds || createPreceptorRequestIdController()

  return {
    async submit(fields) {
      const requestId = ids.begin()
      if (!requestId) return { ok: false, error: 'submission_in_progress' }

      const result = await create({ ...fields, requestId })
      if (result.ok) ids.complete()
      else ids.releaseForRetry()
      return result
    },
    reset() {
      ids.reset()
    },
  }
}

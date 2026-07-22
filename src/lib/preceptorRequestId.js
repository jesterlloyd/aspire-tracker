export function createPreceptorRequestIdController(createId = () => globalThis.crypto.randomUUID()) {
  let requestId = null
  let inFlight = false

  return {
    begin() {
      if (inFlight) return null
      inFlight = true
      requestId ||= createId()
      return requestId
    },
    releaseForRetry() {
      inFlight = false
    },
    complete() {
      requestId = null
      inFlight = false
    },
    reset() {
      requestId = null
      inFlight = false
    },
  }
}

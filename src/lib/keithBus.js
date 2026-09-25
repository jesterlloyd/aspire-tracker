// HOME-1 (2026-09-24): one way for the rest of the app to ask Keith a question.
//
// Keith keeps its open state and its input as local state, so until now nothing outside
// the component could open the drawer with a question already sent. The home page's
// launcher needs exactly that: its last row is "Ask Keith: '...'", and the answer arrives
// in Keith's own drawer. This is the same announce/subscribe shape as floatingPanels.js:
// tiny, behavioural, no React.

const listeners = new Set()
let pending = null

/** Open Keith and send `text`. If Keith is not mounted yet, the question waits for it. */
export function askKeith(text) {
  const t = String(text || '').trim()
  if (!t) return
  if (listeners.size === 0) { pending = t; return }
  listeners.forEach(fn => { try { fn(t) } catch { /* one bad listener must not break the rest */ } })
}

/** Keith subscribes here. Returns an unsubscribe function. A question asked before Keith mounted is delivered at once. */
export function onAskKeith(fn) {
  listeners.add(fn)
  if (pending) { const t = pending; pending = null; try { fn(t) } catch { /* ignore */ } }
  return () => listeners.delete(fn)
}

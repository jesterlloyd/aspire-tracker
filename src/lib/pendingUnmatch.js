// PLACEMENT-BOARD-FELT-1: the Undo window for pulling a pin (Owner decision,
// 2026-09-17: "delay the write").
//
// WHY THE WRITE WAITS. An unmatch cannot be reversed by placing the student
// again: it clears the primary preceptor, reverts ASPIRE status, and leaves the
// Notified confirmations keyed to a match row that no longer exists. A second
// placement would look like an undo and quietly lose all three. So pulling a pin
// HOLDS the unmatch for UNDO_WINDOW_MS: the note leaves the board on screen,
// nothing is written, and Undo simply lets go.
//
// This window is the board's ONLY safeguard (Owner, 2026-09-17: the confirmation
// dialog was removed, because a dialog is dismissed on reflex and an Undo is not),
// which is why it is ten seconds rather than six.
//
// The rules this module owns, and nothing else:
//   - One held unmatch at a time. The board commits a held one before it places
//     or unmatches anything else, so writes can never interleave.
//   - commit is the unmatch handler captured when the hold began. It sees the
//     placement exactly as it was confirmed, which is what an immediate unmatch
//     would have seen.
//   - flush() commits early (a cohort switch, leaving the board, another write)
//     and is safe to call repeatedly: a commit already running is returned, never
//     started twice.
//   - undo() only works while the hold is still waiting. Once the commit has
//     started, Undo is too late and says so by returning false.
//   - If the page closes during the window, nothing was written and the student
//     stays placed. That is the safe failure.

export const UNDO_WINDOW_MS = 10000

export function createPendingUnmatch({
  delayMs = UNDO_WINDOW_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  onChange = () => {},
} = {}) {
  let held = null   // { entry, commit, timer, phase: 'waiting' | 'committing', promise }

  const snapshot = () => (held ? { ...held.entry, phase: held.phase } : null)
  const emit = () => onChange(snapshot())

  function flush() {
    if (!held) return Promise.resolve(false)
    if (held.phase === 'committing') return held.promise.then(() => true)
    const current = held
    clearTimer(current.timer)
    current.phase = 'committing'
    current.promise = Promise.resolve()
      .then(() => current.commit())
      // A failed commit is reported by the handler itself (it toasts); the hold
      // must still end, so the note comes back from whatever the data now says.
      .catch(() => {})
      .finally(() => {
        if (held === current) held = null
        emit()
      })
    emit()
    return current.promise.then(() => true)
  }

  function hold(entry, commit) {
    if (held) throw new Error('An unmatch is already held; flush it first.')
    held = { entry, commit, phase: 'waiting', promise: null, timer: null }
    held.timer = setTimer(() => { flush() }, delayMs)
    emit()
  }

  function undo() {
    if (!held || held.phase !== 'waiting') return false
    clearTimer(held.timer)
    held = null
    emit()
    return true
  }

  return { hold, undo, flush, current: snapshot }
}

// src/components/shared/confirmDialog.jsx
//
// CONFIRM-DIALOG-1 (Owner, 2026-10-01: "I need a new modal to confirm deletion or something. and alike"):
// the app's ONE confirmation, in place of the browser's own "aspireintelligence.app says" box.
//
//   if (!(await confirmDialog('Delete this row?', { confirmLabel: 'Delete', danger: true }))) return
//
// It is a function, like window.confirm was, so a handler changes by one word: it resolves true when
// the person confirms and false when they cancel, press Escape or click outside. A sentence after the
// first question mark becomes the dialog's explanation. It mounts its own root on <body>, so it works
// in the staff app and in every portal with no host component, and above any drawer or modal that
// asked. Focus goes to Cancel for a destructive action (Enter must never delete by reflex) and to the
// confirm button otherwise, is trapped while the dialog is open, and returns to what had it.
import { createRoot } from 'react-dom/client'
import ConfirmDialogBox from './ConfirmDialogBox'

/** "Delete this row? It cannot be undone." -> { title: 'Delete this row?', message: 'It cannot be undone.' } */
export function splitQuestion(text) {
  const s = String(text || '').trim()
  const i = s.indexOf('?')
  return i < 0 || i === s.length - 1 ? { title: s, message: '' } : { title: s.slice(0, i + 1), message: s.slice(i + 1).trim() }
}

/**
 * Ask, in the app's own dialog. `question` is the words (or pass `title` and `message` in options).
 * Options: confirmLabel ('Confirm'), cancelLabel ('Cancel'), danger (a destructive action: red button,
 * focus starts on Cancel). Resolves true or false; never rejects.
 */
export function confirmDialog(question, { title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
  if (typeof document === 'undefined') return Promise.resolve(false)
  const words = title ? { title, message: message || '' } : splitQuestion(question)
  return new Promise((resolve) => {
    const before = document.activeElement
    const host = document.createElement('div')
    host.setAttribute('data-confirm-dialog', '')
    document.body.appendChild(host)
    const root = createRoot(host)
    const done = (answer) => {
      root.unmount()
      host.remove()
      before?.focus?.()
      resolve(answer)
    }
    root.render(<ConfirmDialogBox {...words} confirmLabel={confirmLabel} cancelLabel={cancelLabel} danger={danger} onDone={done} />)
  })
}

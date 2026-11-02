import { useEffect } from 'react'

// The dialog's keyboard: focus the [data-autofocus] control, Escape closes, Tab stays inside,
// focus goes back where it was. Shared with PreceptorFeedbackDialog.
export function useDialogKeys(ref, onClose) {
  useEffect(() => {
    const back = document.activeElement
    const box = ref.current
    box?.querySelector('[data-autofocus]')?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
      if (e.key !== 'Tab' || !box) return
      const items = [...box.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter(el => !el.disabled && el.offsetParent !== null)
      if (!items.length) return
      const first = items[0]; const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('keydown', onKey, true); back?.focus?.() }
  }, [ref, onClose])
}

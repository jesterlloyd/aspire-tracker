import { useState, useCallback, useMemo } from 'react';

let toastId = 0;

export function useToast() {
  const [toasts, setToasts] = useState([]);

  // PLACEMENT-BOARD-FELT-1: a toast may carry ONE action ({ label, onClick }),
  // used by the Placement Board's Undo. addToast returns the id so the caller
  // can dismiss it early. Callers that pass two arguments are unaffected.
  const addToast = useCallback(({ type = 'info', title, message, duration = 4000, action = null }) => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, type, title, message, duration, action }]);
    return id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Keep the public API stable across toast state updates. Consumers commonly
  // include this object in effect dependencies; recreating it after addToast
  // can otherwise retrigger the same effect and enqueue duplicate notices.
  const toast = useMemo(() => ({
    success: (title, message, options) => addToast({ ...options, type: 'success', title, message }),
    warning: (title, message, options) => addToast({ ...options, type: 'warning', title, message }),
    error:   (title, message, options) => addToast({ ...options, type: 'error',   title, message }),
    info:    (title, message, options) => addToast({ ...options, type: 'info',    title, message }),
    dismiss: (id) => removeToast(id),
  }), [addToast, removeToast]);

  return { toasts, removeToast, toast };
}

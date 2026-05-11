import { useState, useCallback } from 'react';

let toastId = 0;

export function useToast() {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback(({ type = 'info', title, message, duration = 4000 }) => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, type, title, message, duration }]);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = {
    success: (title, message) => addToast({ type: 'success', title, message }),
    warning: (title, message) => addToast({ type: 'warning', title, message }),
    error:   (title, message) => addToast({ type: 'error',   title, message }),
    info:    (title, message) => addToast({ type: 'info',    title, message }),
  };

  return { toasts, removeToast, toast };
}

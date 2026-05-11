import React, { useEffect } from 'react';
import { CheckCircle, AlertTriangle, XCircle, Info, X } from 'lucide-react';

const TOAST_STYLES = {
  success: {
    bg: '#f0fdf4', border: '#86efac',
    icon: <CheckCircle size={16} color="#166534" strokeWidth={2} />,
    titleColor: '#14532d', textColor: '#166534',
  },
  warning: {
    bg: '#fefce8', border: '#fde047',
    icon: <AlertTriangle size={16} color="#92400e" strokeWidth={2} />,
    titleColor: '#78350f', textColor: '#92400e',
  },
  error: {
    bg: '#fff1f2', border: '#fca5a5',
    icon: <XCircle size={16} color="#991b1b" strokeWidth={2} />,
    titleColor: '#7f1d1d', textColor: '#991b1b',
  },
  info: {
    bg: '#eff6ff', border: '#93c5fd',
    icon: <Info size={16} color="#1d4ed8" strokeWidth={2} />,
    titleColor: '#1e3a8a', textColor: '#1d4ed8',
  },
};

function ToastItem({ toast, onRemove }) {
  const style = TOAST_STYLES[toast.type] || TOAST_STYLES.info;

  useEffect(() => {
    const timer = setTimeout(() => onRemove(toast.id), toast.duration || 4000);
    return () => clearTimeout(timer);
  }, [toast.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '10px',
      background: style.bg, border: `1px solid ${style.border}`,
      borderRadius: '12px', padding: '12px 14px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
      minWidth: '280px', maxWidth: '380px',
      animation: 'toastSlideIn 0.25s ease',
      fontFamily: 'DM Sans',
    }}>
      <div style={{ flexShrink: 0, marginTop: '1px' }}>{style.icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {toast.title && (
          <div style={{ fontWeight: 700, fontSize: '13px', color: style.titleColor, marginBottom: toast.message ? '2px' : 0 }}>
            {toast.title}
          </div>
        )}
        {toast.message && (
          <div style={{ fontSize: '12px', color: style.textColor, lineHeight: 1.5 }}>
            {toast.message}
          </div>
        )}
      </div>
      <button onClick={() => onRemove(toast.id)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', color: style.textColor, opacity: 0.5, flexShrink: 0, lineHeight: 1 }}>
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastContainer({ toasts, removeToast }) {
  return (
    <>
      <div style={{
        position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
        display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center',
        zIndex: 9998, pointerEvents: 'none',
      }}>
        {toasts.map(t => (
          <div key={t.id} style={{ pointerEvents: 'auto' }}>
            <ToastItem toast={t} onRemove={removeToast} />
          </div>
        ))}
      </div>
      <style>{`
        @keyframes toastSlideIn {
          from { opacity: 0; transform: translateY(12px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </>
  );
}

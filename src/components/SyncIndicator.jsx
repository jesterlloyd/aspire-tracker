import React from 'react';
import { RefreshCw } from 'lucide-react';

/**
 * SyncIndicator
 * Whisper-level display showing when data was last fetched.
 * Always muted, never distracting.
 */
export default function SyncIndicator({ display, align = 'right', dark = false }) {
  if (!display) return null;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      justifyContent: align === 'right' ? 'flex-end'
        : align === 'left'  ? 'flex-start'
        : 'center',
    }}>
      <RefreshCw size={10} color={dark ? 'rgba(255,255,255,0.35)' : '#9ca3af'} strokeWidth={2} />
      <span style={{
        fontFamily: 'Plus Jakarta Sans, sans-serif',
        fontWeight: 400,
        fontSize: '10px',
        color: dark ? 'rgba(255,255,255,0.35)' : '#9ca3af',
        letterSpacing: '0.01em',
        userSelect: 'none',
      }}>
        {display}
      </span>
    </div>
  );
}

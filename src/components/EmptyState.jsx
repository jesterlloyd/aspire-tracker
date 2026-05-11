import React from 'react';

export default function EmptyState({
  icon,
  heading,
  subtext,
  action,
  actionLabel,
  compact = false,
}) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: compact ? '24px 16px' : '48px 24px',
      textAlign: 'center',
      gap: compact ? '8px' : '12px',
    }}>
      {icon && (
        <div style={{
          width: compact ? '40px' : '56px',
          height: compact ? '40px' : '56px',
          borderRadius: '50%',
          background: '#f3f4f6',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '4px',
          flexShrink: 0,
        }}>
          {React.cloneElement(icon, {
            size: compact ? 18 : 24,
            color: '#9ca3af',
            strokeWidth: 1.5,
          })}
        </div>
      )}
      <div style={{
        fontFamily: 'DM Sans',
        fontWeight: 700,
        fontSize: compact ? '13px' : '15px',
        color: '#374151',
        lineHeight: 1.3,
      }}>
        {heading}
      </div>
      {subtext && (
        <div style={{
          fontFamily: 'DM Sans',
          fontWeight: 400,
          fontSize: compact ? '12px' : '13px',
          color: '#9ca3af',
          lineHeight: 1.6,
          maxWidth: '280px',
        }}>
          {subtext}
        </div>
      )}
      {action && actionLabel && (
        <button
          onClick={action}
          style={{
            marginTop: '4px',
            padding: '7px 16px',
            borderRadius: '8px',
            background: '#1D2567',
            border: 'none',
            color: '#ffffff',
            fontFamily: 'DM Sans',
            fontWeight: 600,
            fontSize: '12px',
            cursor: 'pointer',
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

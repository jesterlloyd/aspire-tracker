import React from 'react';

const COLOR_SCHEMES = {
  neutral: {
    bg: '#f9fafb', border: '#e5e7eb', shadow: 'rgba(0,0,0,0.06)',
    iconBg: '#e5e7eb', iconColor: '#6b7280',
    valueColor: '#111827', labelColor: '#6b7280',
  },
  nightfall: {
    bg: '#1d2567', border: '#1d2567', shadow: 'rgba(29,37,103,0.25)',
    iconBg: 'rgba(255,255,255,0.15)', iconColor: '#ffffff',
    valueColor: '#ffffff', labelColor: 'rgba(255,255,255,0.75)',
  },
  marina: {
    bg: '#dceff8', border: '#9dd6f2', shadow: 'rgba(29,37,103,0.10)',
    iconBg: '#9dd6f2', iconColor: '#0e7490',
    valueColor: '#0c4a6e', labelColor: '#0e7490',
  },
  green: {
    bg: '#dcfce7', border: '#86efac', shadow: 'rgba(22,101,52,0.12)',
    iconBg: '#86efac', iconColor: '#166534',
    valueColor: '#14532d', labelColor: '#166534',
  },
  darkgreen: {
    bg: '#d1fae5', border: '#6ee7b7', shadow: 'rgba(6,95,70,0.12)',
    iconBg: '#6ee7b7', iconColor: '#065f46',
    valueColor: '#064e3b', labelColor: '#065f46',
  },
  amber: {
    bg: '#fef3c7', border: '#fcd34d', shadow: 'rgba(146,64,14,0.10)',
    iconBg: '#fde68a', iconColor: '#92400e',
    valueColor: '#78350f', labelColor: '#92400e',
  },
  red: {
    bg: '#fee2e2', border: '#fca5a5', shadow: 'rgba(153,27,27,0.10)',
    iconBg: '#fecaca', iconColor: '#991b1b',
    valueColor: '#7f1d1d', labelColor: '#991b1b',
  },
  purple: {
    bg: '#ede9fe', border: '#c4b5fd', shadow: 'rgba(91,33,182,0.10)',
    iconBg: '#c4b5fd', iconColor: '#5b21b6',
    valueColor: '#4c1d95', labelColor: '#5b21b6',
  },
  indigo: {
    bg: '#eff6ff', border: '#bfdbfe', shadow: 'rgba(29,78,216,0.10)',
    iconBg: '#bfdbfe', iconColor: '#1d4ed8',
    valueColor: '#1e3a8a', labelColor: '#1d4ed8',
  },
};

export default function StatCard({
  value,
  label,
  sublabel,
  icon: Icon,
  colorScheme = 'neutral',
  onClick,
}) {
  const scheme = COLOR_SCHEMES[colorScheme] || COLOR_SCHEMES.neutral;

  return (
    <div
      onClick={onClick}
      style={{
        background: scheme.bg,
        border: `1px solid ${scheme.border}`,
        borderRadius: '12px',
        boxShadow: `0 4px 12px ${scheme.shadow}`,
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        minHeight: '72px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'box-shadow 0.2s ease, transform 0.15s ease',
        flex: '1',
        minWidth: '120px',
      }}
      onMouseEnter={e => {
        if (onClick) {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = `0 8px 20px ${scheme.shadow}`;
        }
      }}
      onMouseLeave={e => {
        if (onClick) {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = `0 4px 12px ${scheme.shadow}`;
        }
      }}
    >
      {Icon && (
        <div style={{
          width: '38px', height: '38px', borderRadius: '50%',
          background: scheme.iconBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Icon size={17} color={scheme.iconColor} strokeWidth={2.5} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'DM Sans, sans-serif', fontWeight: 700,
          fontSize: '26px', lineHeight: 1,
          color: scheme.valueColor, marginBottom: '4px',
        }}>
          {value}
        </div>
        <div style={{
          fontFamily: 'DM Sans, sans-serif', fontWeight: 600,
          fontSize: '11px', textTransform: 'uppercase',
          letterSpacing: '0.05em', color: scheme.labelColor,
          lineHeight: 1.2,
        }}>
          {label}
        </div>
        {sublabel && (
          <div style={{
            fontFamily: 'DM Sans, sans-serif', fontWeight: 400,
            fontSize: '11px', color: scheme.labelColor,
            opacity: 0.65, marginTop: '2px', lineHeight: 1.2,
          }}>
            {sublabel}
          </div>
        )}
      </div>
    </div>
  );
}

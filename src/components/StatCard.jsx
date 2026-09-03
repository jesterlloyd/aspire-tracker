import React from 'react';

const COLOR_SCHEMES = {
  neutral: {
    bg: '#f8f9fa', border: '#dee2e6', shadow: 'rgba(0,0,0,0.08)',
    iconBg: '#e9ecef', iconColor: '#495057',
    valueColor: '#212529', labelColor: '#6c757d',
  },
  nightfall: {
    bg: '#1D2567', border: '#151c4e', shadow: 'rgba(29,37,103,0.30)',
    iconBg: 'rgba(255,255,255,0.18)', iconColor: '#ffffff',
    valueColor: '#ffffff', labelColor: 'rgba(255,255,255,0.80)',
  },
  marina: {
    bg: '#DCEFF8', border: '#9dd6f2', shadow: 'rgba(29,37,103,0.12)',
    iconBg: '#9dd6f2', iconColor: '#0e7490',
    valueColor: '#0c4a6e', labelColor: '#0e7490',
  },
  green: {
    bg: '#dcfce7', border: '#6ee7b7', shadow: 'rgba(22,101,52,0.15)',
    iconBg: '#6ee7b7', iconColor: '#166534',
    valueColor: '#14532d', labelColor: '#166534',
  },
  darkgreen: {
    bg: '#d1fae5', border: '#34d399', shadow: 'rgba(6,95,70,0.15)',
    iconBg: '#34d399', iconColor: '#065f46',
    valueColor: '#064e3b', labelColor: '#065f46',
  },
  amber: {
    bg: '#fef3c7', border: '#fbbf24', shadow: 'rgba(146,64,14,0.15)',
    iconBg: '#fde68a', iconColor: '#92400e',
    valueColor: '#78350f', labelColor: '#92400e',
  },
  red: {
    bg: '#fee2e2', border: '#f87171', shadow: 'rgba(153,27,27,0.15)',
    iconBg: '#fca5a5', iconColor: '#991b1b',
    valueColor: '#7f1d1d', labelColor: '#991b1b',
  },
  purple: {
    bg: '#ede9fe', border: '#a78bfa', shadow: 'rgba(91,33,182,0.15)',
    iconBg: '#c4b5fd', iconColor: '#5b21b6',
    valueColor: '#4c1d95', labelColor: '#5b21b6',
  },
  indigo: {
    bg: '#e0e7ff', border: '#818cf8', shadow: 'rgba(29,78,216,0.15)',
    iconBg: '#a5b4fc', iconColor: '#1d4ed8',
    valueColor: '#1e3a8a', labelColor: '#1d4ed8',
  },
  nova: {
    bg: '#eef0fe', border: '#9FAFF8', shadow: 'rgba(159,175,248,0.25)',
    iconBg: '#9FAFF8', iconColor: '#1D2567',
    valueColor: '#1D2567', labelColor: '#3730a3',
  },
  sage: {
    bg: '#EDF2E2', border: '#a3c4a0', shadow: 'rgba(88,55,51,0.10)',
    iconBg: '#c6d9c0', iconColor: '#166534',
    valueColor: '#14532d', labelColor: '#166534',
  },
  dawn: {
    bg: '#FCE9DA', border: '#f0c9b0', shadow: 'rgba(88,55,51,0.12)',
    iconBg: '#f0c9b0', iconColor: '#583733',
    valueColor: '#583733', labelColor: '#7c3a2d',
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
        borderRadius: '12px',
        boxShadow: `0 2px 12px ${scheme.shadow}, 0 1px 4px rgba(0,0,0,0.06)`,
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        minHeight: '72px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'box-shadow 0.2s ease, transform 0.15s ease',
        flex: '1',
        minWidth: '130px',
      }}
      onMouseEnter={e => {
        if (onClick) {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = `0 8px 24px ${scheme.shadow}, 0 1px 4px rgba(0,0,0,0.06)`;
        }
      }}
      onMouseLeave={e => {
        if (onClick) {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = `0 2px 12px ${scheme.shadow}, 0 1px 4px rgba(0,0,0,0.06)`;
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
          fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 700,
          fontSize: '26px', lineHeight: 1,
          color: scheme.valueColor, marginBottom: '4px',
        }}>
          {value}
        </div>
        <div style={{
          fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 600,
          fontSize: '11px', textTransform: 'uppercase',
          letterSpacing: '0.05em', color: scheme.labelColor,
          lineHeight: 1.2,
        }}>
          {label}
        </div>
        {sublabel && (
          <div style={{
            fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 400,
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

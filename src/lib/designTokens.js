export const TOKENS = {
  colors: {
    raven:     '#191919',
    nightfall: '#1D2567',
    navyDeep:  '#141928',
    navyMid:   '#1a2347',
    marina:    '#DCEFF8',
    sand:      '#F4F1EC',
    pearl:     '#FFFFFF',
    csRed:     '#DC1E34',
    chroma:    '#930045',
    sage:      '#EDF2E2',
    dawn:      '#FCE9DA',
    nova:      '#9FAFF8',
    raven70:   'rgba(25,25,25,0.70)',
  },
  radius: {
    xs:   '4px',
    sm:   '6px',
    md:   '8px',
    lg:   '12px',
    xl:   '16px',
    pill: '20px',
    full: '50%',
  },
  shadow: {
    xs:   '0 1px 3px rgba(0,0,0,0.06)',
    sm:   '0 2px 8px rgba(0,0,0,0.08)',
    md:   '0 4px 16px rgba(0,0,0,0.10)',
    lg:   '0 8px 32px rgba(29,37,103,0.14)',
    card: '0 2px 12px rgba(0,0,0,0.07)',
  },
  font: {
    family: 'DM Sans, sans-serif',
    sizes: {
      xs:   '10px',
      sm:   '11px',
      base: '13px',
      md:   '14px',
      lg:   '15px',
      xl:   '16px',
      h3:   '18px',
      h2:   '20px',
      h1:   '24px',
    },
    weights: {
      regular: 400,
      medium:  500,
      semi:    600,
      bold:    700,
      black:   800,
    },
  },
  space: {
    xs:  '4px',
    sm:  '8px',
    md:  '12px',
    lg:  '16px',
    xl:  '24px',
    xxl: '32px',
  },
  statCard: {
    minHeight: '72px',
    padding:   '14px 16px',
    radius:    '12px',
    iconSize:  '38px',
    valueSize: '26px',
    labelSize: '11px',
    gap:       '12px',
  },
};

export const SPACING = {
  pageTop:    '20px',
  sectionGap: '16px',
  panelPad:   '20px 24px',
  columnGap:  '16px',
  cardRadius: '14px',
  innerRadius:'10px',
};

export const BUTTON = {
  height:   '34px',
  radius:   '9px',
  font:     'DM Sans',
  weight:   600,
  fontSize: '13px',
  padding:  '0 16px',
  primary: {
    background: '#1D2567',
    border:     'none',
    color:      '#ffffff',
    hover:      '#141928',
  },
  secondary: {
    background: '#f3f4ff',
    border:     '1px solid #e0e7ff',
    color:      '#1D2567',
    hover:      '#e8ecff',
  },
  destructive: {
    background: '#fef2f2',
    border:     '1px solid #fecaca',
    color:      '#dc2626',
    hover:      '#fee2e2',
  },
  workflow: {
    background: '#f0fdf4',
    border:     '1px solid #bbf7d0',
    color:      '#166534',
    hover:      '#dcfce7',
  },
};

export const toLocalDateStr = (date = new Date()) => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function btnStyle(type = 'primary', extra = {}) {
  const b = BUTTON[type] || BUTTON.primary;
  return {
    height:         BUTTON.height,
    padding:        BUTTON.padding,
    background:     b.background,
    border:         b.border || 'none',
    borderRadius:   BUTTON.radius,
    fontFamily:     BUTTON.font,
    fontWeight:     BUTTON.weight,
    fontSize:       BUTTON.fontSize,
    color:          b.color,
    cursor:         'pointer',
    display:        'inline-flex',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            '6px',
    transition:     'all 0.15s ease',
    whiteSpace:     'nowrap',
    flexShrink:     0,
    ...extra,
  };
}

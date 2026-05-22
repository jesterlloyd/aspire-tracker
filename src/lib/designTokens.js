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

// Re-export from shared/ so all frontend imports keep working unchanged.
// The canonical implementation lives in shared/dateUtils.js (importable by api/ too).
export { toLocalDateStr } from '../../shared/dateUtils.js'

// ── Phase 4 token system ──────────────────────────────────────────────────────
// New components consume from here; existing components migrate opportunistically.

export const colors = {
  // Surfaces
  bg:          '#FAFAF7',
  bgWarm:      '#F4F1EC',   // Sand
  surface:     '#FFFFFF',
  surface2:    '#FCFCF9',
  surfaceDeep: '#F6F6F2',

  // Ink
  ink1: '#0E1428',
  ink2: '#1D2567',          // Nightfall — Cedars brand
  ink3: '#475467',
  ink4: '#98A2B3',
  ink5: '#D0D5DD',

  // Hairlines
  line1: 'rgba(29, 37, 103, 0.08)',
  line2: 'rgba(29, 37, 103, 0.04)',

  // Accents (one per surface)
  chroma: '#930045',
  sage:   '#2F7D5C',
  dawn:   '#C08A2A',
  marina: '#275E63',

  // State tints
  tintSage:   '#EEF7F0',
  tintDawn:   '#FBF5E8',
  tintMarina: '#EDF5F4',
  tintChroma: '#F8EDF2',
  tintNight:  '#EDEEF4',
};

export const radii = {
  pill:    999,
  card:    14,
  control: 8,
  chip:    6,
  micro:   4,
};

export const shadows = {
  s1:             '0 1px 0 rgba(29,37,103,0.04), 0 1px 2px rgba(29,37,103,0.04)',
  s2:             '0 1px 0 rgba(29,37,103,0.04), 0 4px 12px rgba(29,37,103,0.05)',
  s3:             '0 1px 0 rgba(29,37,103,0.04), 0 8px 24px rgba(29,37,103,0.08)',
  innerHighlight: 'inset 0 1px 0 rgba(255,255,255,0.9)',
};

export const type = {
  family: 'DM Sans, system-ui, sans-serif',
  sizes: {
    micro:   10.5,
    small:   11.5,
    body:    13,
    bodyLg:  14,
    title:   16,
    heading: 22,
    display: 32,
  },
  weights: {
    regular:  400,
    medium:   500,
    semibold: 600,
    bold:     700,
  },
  letterSpacing: {
    tight:   '-0.025em',
    snug:    '-0.01em',
    normal:  '0',
    wide:    '0.06em',
    eyebrow: '0.14em',
  },
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 };

// Reusable composed styles
export const styles = {
  panel: {
    background:   colors.surface,
    border:       `1px solid ${colors.line1}`,
    borderRadius: radii.card,
    boxShadow:    `${shadows.s1}, ${shadows.innerHighlight}`,
    overflow:     'hidden',
    fontFamily:   type.family,
  },
  eyebrow: {
    fontSize:        type.sizes.micro,
    textTransform:   'uppercase',
    letterSpacing:   type.letterSpacing.eyebrow,
    color:           colors.ink3,
    fontWeight:      type.weights.semibold,
  },
  bigNumber: {
    fontSize:           type.sizes.display,
    fontWeight:         type.weights.bold,
    lineHeight:         1,
    letterSpacing:      type.letterSpacing.tight,
    color:              colors.ink1,
    fontVariantNumeric: 'tabular-nums',
    fontFamily:         type.family,
  },
  countBadge: {
    display:            'inline-flex',
    alignItems:         'center',
    justifyContent:     'center',
    minWidth:           20,
    height:             18,
    padding:            '1px 7px',
    borderRadius:       radii.pill,
    background:         colors.surfaceDeep,
    color:              colors.ink3,
    fontSize:           10,
    fontWeight:         type.weights.semibold,
    fontVariantNumeric: 'tabular-nums',
  },
};
// ─────────────────────────────────────────────────────────────────────────────

// ── Student Profiles split-view ratio ────────────────────────────────────────
// Controls the left (list/grid) vs right (drawer) panel share.
// Expressed as CSS flex-grow values so both panels honour the same available space.
// To adjust: change gridFlex / drawerFlex here, update the CSS vars in index.css.

export const PROFILES_SPLIT = {
  gridFlex:   1,   // flex-grow for the list / grid panel
  drawerFlex: 1,   // flex-grow for the student detail drawer
};
// ─────────────────────────────────────────────────────────────────────────────

// ── StudentCard tokens ────────────────────────────────────────────────────────
// Single source of truth for the unified StudentCard primitive.
// Changing any value here updates all three variants (profile, on-campus, interview)
// and makes the card ready to absorb into a future <EntityCard> design system.

export const CARD = {
  width:         180,         // px — canonical card width in the grid
  radius:        12,          // px — border-radius matching existing panel convention
  avatarSize:    72,          // px — circular avatar diameter
  stripMinHeight: 52,         // px — metadata strip min-height (content drives actual height)
  hoverLiftPx:   -3,          // px — translateY offset on mouse-enter
  hoverDuration: '150ms',     // hover transition timing
  shadowRest:    '0 1px 3px rgba(0,0,0,0.05)',
  shadowHover:   '0 6px 18px rgba(0,0,0,0.11)',
  tintOpacity:   0.14,        // pastel tint opacity for interview variant strip background
  focusRing:     '0 0 0 3px rgba(29,37,103,0.30)',  // keyboard focus indicator
};
// ─────────────────────────────────────────────────────────────────────────────

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

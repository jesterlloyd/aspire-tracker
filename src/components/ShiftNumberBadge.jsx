// SHIFT-SEQUENCE-1: the shared "Shift #" badge.
//
// One presentation for the clinical-shift sequence everywhere it appears, so a
// record shows the same number in the same shape on every surface.
//
// ACCESSIBILITY: the number is never conveyed by shape or color alone. The
// visible glyph is the integer itself, and an sr-only "Shift 8" accompanies it
// so a screen reader announces what the badge means rather than a bare digit.
//
// NO UNICODE ENCLOSED NUMERALS: those only exist for a limited range (and vary
// by font), so a student's 21st shift would render as a box. This is a styled
// circle that holds any integer, widening for 3+ digits instead of clipping.
export default function ShiftNumberBadge({ ordinal, size = 22 }) {
  if (!Number.isInteger(ordinal) || ordinal < 1) {
    // Unknown sequence (a row outside the computed set) states itself rather
    // than rendering a misleading number.
    return <span style={{ color: '#9ca3af', fontSize: 11 }} aria-label="Shift number unavailable">–</span>
  }
  const wide = ordinal > 99
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: size, height: size, padding: wide ? '0 6px' : 0,
        borderRadius: 999, background: '#EEF2FB', color: '#1D2567',
        border: '1px solid #c7d2fe', fontFamily: 'Plus Jakarta Sans, sans-serif',
        fontSize: 11, fontWeight: 700, lineHeight: 1, boxSizing: 'border-box',
      }}
    >
      <span aria-hidden="true">{ordinal}</span>
      <span className="sr-only">{`Shift ${ordinal}`}</span>
    </span>
  )
}

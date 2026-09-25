// src/components/shared/SegmentedPicker.jsx
//
// SEGMENTED-PICKER-1: the app's conjoined view picker, in one place.
//
// Rotation (Placement Board | Preceptors | Activity), Student Profiles (Profiles |
// CS-Link Access) and Settings > Accounts each hand-rolled the same control: a bordered
// group with square inner edges, a solid navy active segment and a white resting one.
// Three copies of one shape drift, and one of them already had a comment admitting it was
// a copy of the other two. This is that shape, once.
//
// THE VALUES ARE THE ONES THAT SHIPPED. Height 32, 13px of horizontal padding, 12px Plus
// Jakarta Sans at 500, a 7px group radius, `--border-input` for the frame, and the accent
// for the active segment. A page adopting this gets what it already rendered.
//
// `paper` is for a surface that is paper rather than app chrome (the planner calendars).
// It swaps the frame and the resting ink for the sheet's own `--rule` and `--paper-muted`
// and washes the resting segment instead of painting it white, so the control reads as a
// mark on the page. The active segment stays solid navy on every surface, because "which
// view am I in" must not change meaning between one calendar and another.
//
// Dark mode reads `--seg-active-ink` and `--seg-rest-ink` from theme.css (both undefined in
// light, so light renders exactly as before); the shipped pair measured 3.03:1 and 3.27:1.
//
// `aria-pressed` is on every segment, which two of the three copies were missing.

export default function SegmentedPicker({
  options,
  value,
  onChange,
  ariaLabel,
  paper = false,
  size = 'md',
}) {
  const h = size === 'sm' ? 26 : 32
  const padX = size === 'sm' ? 12 : 13

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={paper ? 'pl-seg' : undefined}
      style={{
        display: 'flex',
        borderRadius: 7,
        border: paper ? undefined : '1px solid var(--border-input,rgba(29,37,103,0.10))',
        overflow: 'hidden',
        width: 'fit-content',
      }}
    >
      {options.map(opt => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            title={opt.title || undefined}
            className={paper ? 'pl-seg-btn' : undefined}
            style={{
              height: h,
              padding: `0 ${padX}px`,
              display: 'flex',
              alignItems: 'center',
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontFamily: 'Plus Jakarta Sans,sans-serif',
              fontWeight: active ? 700 : 500,
              whiteSpace: 'nowrap',
              ...(paper ? {} : {
                background: active ? 'var(--color-accent-primary,#1D2567)' : 'var(--bg-input,#fff)',
                color: active ? 'var(--seg-active-ink,#fff)' : 'var(--seg-rest-ink,var(--text-secondary,#4A5560))',
              }),
              transition: 'all 0.12s',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// AvatarWithRing — circular avatar with SVG completion ring around it.
// Ring color reflects profile completion percentage:
//   100% → sage  |  67-99% → amber  |  34-66% → rose  |  0-33% → muted border
import StudentAvatar from './StudentAvatar'

const RING_COLORS = {
  complete:  'var(--color-status-success, #166534)',
  high:      'var(--color-status-warning, #f59e0b)',
  medium:    'var(--color-status-danger,  #E2569C)',
  low:       'var(--color-border-default, #d1d5db)',
}

function ringColor(pct) {
  if (pct >= 100) return RING_COLORS.complete
  if (pct >= 67)  return RING_COLORS.high
  if (pct >= 34)  return RING_COLORS.medium
  return RING_COLORS.low
}

export default function AvatarWithRing({ student, size = 48, completionPct = 0, style }) {
  const gap     = 3
  const strokeW = 2.5
  const svgSize = size + 2 * (gap + strokeW)
  const cx      = svgSize / 2
  const cy      = svgSize / 2
  const r       = size / 2 + gap + strokeW / 2
  const circ    = 2 * Math.PI * r
  const dashOff = circ * (1 - Math.min(completionPct, 100) / 100)
  const color   = ringColor(completionPct)

  return (
    <div style={{ position: 'relative', width: svgSize, height: svgSize, flexShrink: 0, ...style }}>
      <svg
        width={svgSize} height={svgSize}
        style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)' }}
        aria-hidden="true"
      >
        {/* Track ring */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke="var(--color-border-subtle, #e5e7eb)"
          strokeWidth={strokeW}
        />
        {/* Progress ring */}
        {completionPct > 0 && (
          <circle
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={color}
            strokeWidth={strokeW}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={dashOff}
          />
        )}
      </svg>
      {/* Avatar centered inside the ring */}
      <div style={{ position: 'absolute', top: gap + strokeW, left: gap + strokeW }}>
        <StudentAvatar student={student} size={size} />
      </div>
    </div>
  )
}

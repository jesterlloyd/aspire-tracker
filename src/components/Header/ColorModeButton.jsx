// APPEARANCE-STYLE-1 (2026-09-21): the quick light/dark switch in the header, beside the
// other 34px icon buttons. It shows what is on screen (a sun in light, a moon in dark)
// and a press switches to the opposite as an EXPLICIT choice: from System it resolves
// what the OS is painting first, then sets the other one. It writes the same account
// preference as Settings > Appearance through the same hook, so the Color mode cards move
// with it, and it follows the OS live while the mode is System because it reads the
// painted theme.
import { Sun, Moon } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import { useAppearance } from '../../hooks/useAppearance'
import { oppositeMode, quickToggleLabel } from '../../lib/appearance'

// The drawing, on plain props, so the render test can call it without a provider.
export function ColorModeButtonView({ resolved, onToggle }) {
  const Icon = resolved === 'dark' ? Moon : Sun
  return (
    <Tooltip label="Switch light or dark" placement="bottom">
      <button
        type="button"
        data-testid="color-mode-button"
        // chartTokens.css owns `display` so the phone rule can hide it (inline would win).
        className="chart-color-mode"
        aria-label={quickToggleLabel(resolved)}
        onClick={onToggle}
        style={{
          position: 'relative', flexShrink: 0,
          width: 34, height: 34, alignItems: 'center', justifyContent: 'center',
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.10)',
          // The header's icon buttons are one row at one corner; this matches them.
          borderRadius: 8,
          color: 'rgba(255,255,255,0.75)', cursor: 'pointer',
          transition: 'background 0.15s, border-color 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.14)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
      >
        <Icon size={15} strokeWidth={1.9} aria-hidden="true" />
      </button>
    </Tooltip>
  )
}

export default function ColorModeButton({ toast }) {
  const { effectiveTheme, setColorMode } = useAppearance()
  const onToggle = async () => {
    const result = await setColorMode(oppositeMode(effectiveTheme))
    if (!result.ok) toast?.error('Color mode not saved', 'Your earlier choice is back. Please try again.')
  }
  return <ColorModeButtonView resolved={effectiveTheme} onToggle={onToggle} />
}

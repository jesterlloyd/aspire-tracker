import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme } from '../contexts/ThemeContext'

const OPTIONS = [
  { value: 'light',  Icon: Sun,     label: 'Light'  },
  { value: 'dark',   Icon: Moon,    label: 'Dark'   },
  { value: 'system', Icon: Monitor, label: 'System' },
]

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      background: 'var(--color-bg-elevated, rgba(255,255,255,0.08))',
      borderRadius: 8, padding: '3px',
      border: '1px solid var(--color-border-default, rgba(255,255,255,0.12))',
    }}>
      {OPTIONS.map(({ value, Icon, label }) => {
        const active = theme === value
        return (
          <button
            key={value}
            onClick={() => setTheme(value)}
            title={label}
            aria-label={`Switch to ${label} mode`}
            aria-pressed={active}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, borderRadius: 6,
              border: 'none', cursor: 'pointer',
              background: active
                ? 'var(--color-bg-surface, rgba(255,255,255,0.15))'
                : 'transparent',
              color: active
                ? 'var(--color-text-primary, #F2F5F8)'
                : 'var(--color-text-muted, rgba(255,255,255,0.5))',
              transition: 'background 150ms, color 150ms',
            }}
            onMouseEnter={e => {
              if (!active) e.currentTarget.style.background = 'var(--color-bg-hover, rgba(255,255,255,0.08))'
            }}
            onMouseLeave={e => {
              if (!active) e.currentTarget.style.background = 'transparent'
            }}
          >
            <Icon size={14} strokeWidth={2} />
          </button>
        )
      })}
    </div>
  )
}

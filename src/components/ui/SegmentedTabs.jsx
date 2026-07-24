import { useRef } from 'react'

export default function SegmentedTabs({ label, items = [], value, onChange, className = '' }) {
  const refs = useRef([])
  const enabledItems = items.filter(item => !item.disabled)

  const focusByOffset = (currentKey, offset) => {
    if (enabledItems.length === 0) return
    const currentIndex = enabledItems.findIndex(item => item.key === currentKey)
    const start = currentIndex >= 0 ? currentIndex : 0
    const next = enabledItems[(start + offset + enabledItems.length) % enabledItems.length]
    const domIndex = items.findIndex(item => item.key === next.key)
    refs.current[domIndex]?.focus?.()
  }

  const handleKeyDown = (event, item) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      focusByOffset(item.key, 1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusByOffset(item.key, -1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      const first = items.findIndex(entry => !entry.disabled)
      refs.current[first]?.focus?.()
    } else if (event.key === 'End') {
      event.preventDefault()
      const last = items.map((entry, index) => ({ entry, index })).filter(({ entry }) => !entry.disabled).at(-1)
      if (last) refs.current[last.index]?.focus?.()
    }
  }

  return (
    <div className={`segmented-tabs ${className}`.trim()} role="tablist" aria-label={label}>
      {items.map((item, index) => {
        const Icon = item.Icon
        const selected = value === item.key
        return (
          <button
            key={item.key}
            ref={el => { refs.current[index] = el }}
            type="button"
            role="tab"
            className="segmented-tabs-item"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange?.(item.key)}
            onKeyDown={event => handleKeyDown(event, item)}
          >
            {Icon && <Icon size={13} aria-hidden="true" />}
            <span>{item.label}</span>
            {item.badge != null && item.badge !== '' && (
              <span className="segmented-tabs-badge" aria-hidden="true">{item.badge}</span>
            )}
            {item.srLabel && <span className="sr-only">{item.srLabel}</span>}
          </button>
        )
      })}
    </div>
  )
}

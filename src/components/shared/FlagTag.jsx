/**
 * FlagTag - the follow-up flag without the material (APPEARANCE-STYLE-1, 2026-09-21).
 *
 * Classic style sews a ribbon into a book or a binder (FlagRibbon). Modern has no
 * leather to sew it into, so the same flag is a small tag: "Flagged" when set, a quiet
 * "Flag" when not. It is the ribbon's interaction without the pull: one real button,
 * aria-pressed for its state, the same onFlag / onUnflag the ribbon calls, the same
 * disabled state when the column is not there. Flag data and behavior do not change
 * between styles; only the drawing does.
 *
 * Its colours are a literal pair (flagTag.css): it sits on paper or a fixed white panel,
 * which are light in both themes. A surface that follows the theme redefines the
 * --flag-tag-* properties on itself.
 */
import { Flag } from 'lucide-react'
import './flagTag.css'

export default function FlagTag({
  flagged,
  disabled = false,
  onFlag,
  onUnflag,
  labelOn = 'Flagged for follow-up. Press to remove the flag.',
  labelOff = 'Flag for follow-up.',
  className = '',
}) {
  return (
    <button
      type="button"
      data-testid="flag-tag"
      className={`flag-tag${flagged ? ' flag-tag-on' : ''}${className ? ` ${className}` : ''}`}
      aria-pressed={flagged ? 'true' : 'false'}
      aria-label={flagged ? labelOn : labelOff}
      disabled={disabled}
      onClick={() => (flagged ? onUnflag?.() : onFlag?.())}
    >
      <Flag size={11} strokeWidth={2.2} aria-hidden="true" />
      {flagged ? 'Flagged' : 'Flag'}
    </button>
  )
}

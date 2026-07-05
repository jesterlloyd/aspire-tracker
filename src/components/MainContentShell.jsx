// MainContentShell - shared content wrapper applied to all main tabs.
// Provides consistent max-width, centering, and safe-area bottom padding.
// CSS lives in .main-content-shell (index.css); values mirror .app-main.

export default function MainContentShell({ children, className = '' }) {
  return (
    <div className={`main-content-shell${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  )
}

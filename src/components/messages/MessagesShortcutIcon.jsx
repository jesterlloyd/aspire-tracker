export default function MessagesShortcutIcon({ size = 52 }) {
  return (
    <img
      src="/brand/messages-shortcut.png"
      alt=""
      aria-hidden="true"
      draggable="false"
      width={size}
      height={size}
      style={{ display: 'block', flexShrink: 0, pointerEvents: 'none' }}
    />
  )
}

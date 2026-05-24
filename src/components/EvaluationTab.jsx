export default function EvaluationTab() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: 320, gap: 12, fontFamily: 'DM Sans, sans-serif', padding: '48px 24px',
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: 12,
        background: 'var(--color-bg-elevated,#EDEEF4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 4,
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#374151' }}>Evaluation</div>
      <div style={{ fontSize: 13, color: '#9ca3af', maxWidth: 360, textAlign: 'center', lineHeight: 1.6 }}>
        Student and preceptor evaluation tools are coming soon.
      </div>
    </div>
  )
}

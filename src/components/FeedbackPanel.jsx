// All external navigation must use openLink helpers (src/lib/openLink.js)
import { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { openMailtoLink } from '../lib/openLink';

export default function FeedbackPanel({ activeTab, cohortName, isAuthenticated }) {
  const [isOpen,      setIsOpen]      = useState(false);
  const [category,    setCategory]    = useState('');
  const [message,     setMessage]     = useState('');
  const [showTooltip, setShowTooltip] = useState(false);

  if (!isAuthenticated) return null;

  const handleSend = () => {
    if (!category || !message.trim()) return;

    const tabLabel = activeTab
      ? activeTab.charAt(0).toUpperCase() + activeTab.slice(1).replace(/-/g, ' ')
      : 'Unknown tab';

    const subject = encodeURIComponent(
      `[${category}] ASPIRE Intelligence – ${tabLabel}`
    );

    const body = encodeURIComponent(
      `Category: ${category}\nReported from: ${tabLabel} · ${cohortName || 'Unknown cohort'}\n\n${message}\n\n---\nSent via ASPIRE Intelligence feedback panel`
    );

    openMailtoLink(`mailto:JesterLloyd.Bautista@cshs.org?subject=${subject}&body=${body}`);

    setMessage('');
    setCategory('');
    setIsOpen(false);
  };

  return (
    <>
      {/* Tooltip */}
      <div style={{
        position: 'fixed',
        bottom: '88px',
        left: '24px',
        background: '#1d2567',
        color: '#ffffff',
        fontFamily: 'DM Sans',
        fontSize: '12px',
        fontWeight: 500,
        padding: '6px 12px',
        borderRadius: '8px',
        whiteSpace: 'nowrap',
        opacity: showTooltip && !isOpen ? 1 : 0,
        transition: 'opacity 0.2s ease',
        pointerEvents: 'none',
        zIndex: 1001,
      }}>
        Send feedback
      </div>

      {/* Floating button */}
      <button
        data-tour="feedback-button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Send feedback"
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08)'; setShowTooltip(true); }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; setShowTooltip(false); }}
        style={{
          position: 'fixed',
          bottom: '24px',
          left: '24px',
          width: '52px',
          height: '52px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #930045, #6d0033)',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: isOpen
            ? '0 0 0 2px rgba(147,0,69,0.5), 0 0 20px rgba(147,0,69,0.4)'
            : '0 4px 16px rgba(147,0,69,0.35)',
          zIndex: 1000,
          transition: 'all 0.2s ease',
        }}
      >
        <MessageCircle size={22} color="#ffffff" strokeWidth={2} />
      </button>

      {/* Panel */}
      {isOpen && (
        <>
          <div
            onClick={() => setIsOpen(false)}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.15)',
              zIndex: 998,
            }}
          />
          <div style={{
            position: 'fixed',
            bottom: '88px',
            left: '24px',
            width: '380px',
            background: '#ffffff',
            borderRadius: '16px',
            boxShadow: '0 8px 32px rgba(29,37,103,0.18)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 999,
            animation: 'feedbackSlideIn 0.2s ease',
          }}>

            {/* Header */}
            <div style={{
              background: 'linear-gradient(135deg, #930045, #6d0033)',
              padding: '16px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}>
              <MessageCircle size={20} color="#ffffff" strokeWidth={2} />
              <div>
                <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: '15px', color: '#ffffff' }}>
                  Send a Message
                </div>
                <div style={{ fontFamily: 'DM Sans', fontSize: '12px', color: 'rgba(255,255,255,0.75)' }}>
                  Report a bug, suggest a feature, or ask a question
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: '18px' }}
              >×</button>
            </div>

            {/* Body */}
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

              {/* Category chips */}
              <div>
                <div style={{ fontFamily: 'DM Sans', fontWeight: 600, fontSize: '12px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                  What's this about?
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[
                    { value: 'Bug Report',    emoji: '🐛' },
                    { value: 'Feature Idea',  emoji: '💡' },
                    { value: 'Question',      emoji: '❓' },
                  ].map(cat => (
                    <button
                      key={cat.value}
                      onClick={() => setCategory(cat.value)}
                      style={{
                        flex: 1,
                        padding: '8px 4px',
                        borderRadius: '10px',
                        border: `2px solid ${category === cat.value ? '#930045' : '#e5e7eb'}`,
                        background: category === cat.value ? '#fff0f6' : '#f9fafb',
                        fontFamily: 'DM Sans',
                        fontSize: '12px',
                        fontWeight: category === cat.value ? 600 : 400,
                        color: category === cat.value ? '#930045' : '#6b7280',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <span style={{ fontSize: '18px' }}>{cat.emoji}</span>
                      {cat.value}
                    </button>
                  ))}
                </div>
              </div>

              {/* Message field */}
              <div>
                <div style={{ fontFamily: 'DM Sans', fontWeight: 600, fontSize: '12px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                  Your message
                </div>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder={
                    category === 'Bug Report'
                      ? 'Describe what happened and what you expected instead...'
                      : category === 'Feature Idea'
                      ? 'Describe the feature and how it would help your workflow...'
                      : 'Ask anything about the platform or the ASPIRE program...'
                  }
                  rows={5}
                  style={{
                    width: '100%',
                    border: '1px solid #e5e7eb',
                    borderRadius: '10px',
                    padding: '10px 12px',
                    fontFamily: 'DM Sans',
                    fontSize: '13px',
                    color: '#374151',
                    resize: 'vertical',
                    outline: 'none',
                    boxSizing: 'border-box',
                    lineHeight: 1.6,
                  }}
                  onFocus={e => e.currentTarget.style.borderColor = '#930045'}
                  onBlur={e => e.currentTarget.style.borderColor = '#e5e7eb'}
                />
              </div>

              {/* Context note */}
              <div style={{
                background: '#fff0f6',
                border: '1px solid #f9a8d4',
                borderRadius: '8px',
                padding: '8px 12px',
                fontFamily: 'DM Sans',
                fontSize: '11px',
                color: '#930045',
              }}>
                📍 Will include: {activeTab ? `${activeTab} tab` : 'current tab'} · {cohortName || 'current cohort'}
              </div>

              {/* Send button */}
              <button
                onClick={handleSend}
                disabled={!category || !message.trim()}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '10px',
                  background: category && message.trim() ? 'linear-gradient(135deg, #930045, #6d0033)' : '#e5e7eb',
                  border: 'none',
                  color: category && message.trim() ? '#ffffff' : '#9ca3af',
                  fontFamily: 'DM Sans',
                  fontWeight: 700,
                  fontSize: '14px',
                  cursor: category && message.trim() ? 'pointer' : 'default',
                  transition: 'all 0.15s ease',
                }}
              >
                Send to Jester
              </button>
            </div>

            <style>{`
              @keyframes feedbackSlideIn {
                from { opacity: 0; transform: translateY(12px) scale(0.97); }
                to   { opacity: 1; transform: translateY(0) scale(1); }
              }
            `}</style>
          </div>
        </>
      )}
    </>
  );
}

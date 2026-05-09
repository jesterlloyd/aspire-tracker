import React, { useState, useRef, useEffect } from 'react';
import { SUGGESTED_PROMPTS, generateStaticResponse, getKeithContext } from '../lib/keithKnowledge';

export default function Keith({ activeTab, setActiveTab, cohortName, cohortId, supabase, isAuthenticated }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [context, setContext] = useState(null);
  const [contextLoading, setContextLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  if (!isAuthenticated) return null;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => { scrollToBottom(); }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) inputRef.current.focus();
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && cohortId && supabase && !context) {
      setContextLoading(true);
      getKeithContext(supabase, cohortId).then(ctx => {
        setContext(ctx);
        setContextLoading(false);
      });
    }
  }, [isOpen, cohortId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setContext(null);
  }, [cohortId]);

  const welcomeMessage = {
    id: 'welcome',
    role: 'keith',
    text: `Hi! I'm Keith, your ASPIRE Program assistant.\n\nI'm here to help you manage the ASPIRE workflow. I can help you:\n\n• Identify students who need follow-up\n• Summarize cohort status\n• Draft common ASPIRE emails\n• Answer questions about any part of the program\n\nWhat can I help you with today?`,
  };

  const handleSend = async (messageText) => {
    const text = messageText || input.trim();
    if (!text) return;

    const userMessage = { id: Date.now(), role: 'user', text };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    // Include last 10 messages for context window efficiency
    const conversationHistory = [...messages, userMessage].slice(-10);

    try {
      const response = await fetch('/api/keith', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: conversationHistory,
          context,
          cohortName,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const keithMessage = {
          id: Date.now() + 1,
          role: 'keith',
          text: data.response,
          isAI: true,
          hasCopy: data.response.includes('Subject:'),
        };
        setMessages(prev => [...prev, keithMessage]);
        setIsTyping(false);
        return;
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Could not parse error' }));
        console.error('Keith API error:', response.status, errorData);
        const errorMessage = {
          id: Date.now() + 1,
          role: 'keith',
          text: `API error ${response.status}: ${errorData.error || 'Unknown error'}. Details: ${JSON.stringify(errorData.details || errorData.message || '')}`,
          isAI: false,
        };
        setMessages(prev => [...prev, errorMessage]);
        setIsTyping(false);
        return;
      }
    } catch (err) {
      console.warn('Keith API call failed:', err.message);
      // Continue to static fallback below
    }

    // Fallback to Phase 2 static responses if API unavailable
    await new Promise(resolve => setTimeout(resolve, 600));
    const staticResponse = generateStaticResponse(text, cohortName, context);
    const keithMessage = {
      id: Date.now() + 1,
      role: 'keith',
      ...staticResponse,
      isAI: false,
    };
    setMessages(prev => [...prev, keithMessage]);
    setIsTyping(false);
  };

  const handleAction = (action) => {
    if (!action) return;
    if (action.type === 'tab') {
      setActiveTab(action.tab);
      setIsOpen(false);
    }
    if (action.type === 'bell') {
      document.getElementById('keith-bell-trigger')?.click();
      setIsOpen(false);
    }
  };

  const handleCopy = (id, text) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatText = (text) => {
    return text.split('\n').map((line, i) => (
      <span key={i}>{line}{i < text.split('\n').length - 1 && <br />}</span>
    ));
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        title="Ask Keith"
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          width: '60px',
          height: '60px',
          borderRadius: '50%',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '0',
          zIndex: 1000,
          transition: 'transform 0.2s ease',
          transform: isOpen ? 'scale(0.95)' : 'scale(1)',
        }}
        onMouseEnter={e => { if (!isOpen) e.currentTarget.style.transform = 'scale(1.08)'; }}
        onMouseLeave={e => { if (!isOpen) e.currentTarget.style.transform = isOpen ? 'scale(0.95)' : 'scale(1)'; }}
      >
        {/* Orb */}
        <div style={{
          width: '60px',
          height: '60px',
          borderRadius: '50%',
          position: 'relative',
          overflow: 'hidden',
          background: 'radial-gradient(circle at 35% 35%, #1e0a5e, #060318)',
          boxShadow: isOpen
            ? '0 0 0 2px rgba(139,92,246,0.6), 0 0 24px rgba(99,102,241,0.7), 0 0 48px rgba(56,189,248,0.35)'
            : '0 0 0 1.5px rgba(99,102,241,0.4), 0 0 14px rgba(99,102,241,0.35), 0 4px 20px rgba(0,0,0,0.5)',
          transition: 'box-shadow 0.3s ease',
        }}>
          {/* Purple swirl arm - rotates clockwise */}
          <div style={{
            position: 'absolute',
            inset: '-8px',
            borderRadius: '42% 58% 65% 35% / 38% 42% 58% 62%',
            background: 'linear-gradient(140deg, rgba(167,139,250,0.92) 0%, rgba(109,40,217,0.55) 45%, transparent 75%)',
            animation: `keithSpin ${isOpen ? '2.5s' : '4s'} linear infinite`,
            filter: 'blur(2.5px)',
          }} />
          {/* Cyan swirl arm - rotates counter-clockwise */}
          <div style={{
            position: 'absolute',
            inset: '-8px',
            borderRadius: '58% 42% 35% 65% / 62% 58% 42% 38%',
            background: 'linear-gradient(320deg, rgba(56,189,248,0.92) 0%, rgba(14,165,233,0.55) 45%, transparent 75%)',
            animation: `keithSpin ${isOpen ? '2.5s' : '4s'} linear infinite reverse`,
            filter: 'blur(2.5px)',
          }} />
          {/* Inner glow layer */}
          <div style={{
            position: 'absolute',
            inset: '8px',
            borderRadius: '50%',
            background: 'radial-gradient(circle at 45% 40%, rgba(99,102,241,0.5) 0%, transparent 70%)',
            animation: 'keithGlow 2.5s ease-in-out infinite',
          }} />
          {/* Bright center glow */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '18px',
            height: '18px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,255,255,0.98) 0%, rgba(186,230,253,0.75) 40%, transparent 100%)',
            animation: 'keithPulse 2.5s ease-in-out infinite',
          }} />
          {/* Outer rim highlight */}
          <div style={{
            position: 'absolute',
            inset: '0',
            borderRadius: '50%',
            background: 'radial-gradient(circle at 30% 25%, rgba(255,255,255,0.12) 0%, transparent 60%)',
            pointerEvents: 'none',
          }} />
        </div>
      </button>

      {/* Drawer */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setIsOpen(false)}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.15)',
              zIndex: 998,
            }}
          />

          {/* Drawer panel */}
          <div style={{
            position: 'fixed',
            bottom: '96px',
            right: '24px',
            width: '400px',
            maxHeight: '600px',
            background: '#ffffff',
            borderRadius: '16px',
            boxShadow: '0 8px 32px rgba(29,37,103,0.18)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 999,
            animation: 'keithSlideIn 0.2s ease',
          }}>

            {/* Header */}
            <div style={{
              background: '#1d2567',
              padding: '16px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              flexShrink: 0,
            }}>
              {/* Header orb — static, no animation */}
              <div style={{
                width: '36px', height: '36px', borderRadius: '50%',
                position: 'relative', overflow: 'hidden', flexShrink: 0,
                background: 'radial-gradient(circle at 35% 35%, #1e0a5e, #060318)',
                boxShadow: '0 0 0 1px rgba(99,102,241,0.5), 0 0 8px rgba(99,102,241,0.3)',
              }}>
                <div style={{ position: 'absolute', inset: '-4px', borderRadius: '42% 58% 65% 35% / 38% 42% 58% 62%', background: 'linear-gradient(140deg, rgba(167,139,250,0.85) 0%, rgba(109,40,217,0.5) 45%, transparent 75%)', filter: 'blur(1.5px)' }} />
                <div style={{ position: 'absolute', inset: '-4px', borderRadius: '58% 42% 35% 65% / 62% 58% 42% 38%', background: 'linear-gradient(320deg, rgba(56,189,248,0.85) 0%, rgba(14,165,233,0.5) 45%, transparent 75%)', filter: 'blur(1.5px)' }} />
                <div style={{ position: 'absolute', inset: '5px', borderRadius: '50%', background: 'radial-gradient(circle at 45% 40%, rgba(99,102,241,0.45) 0%, transparent 70%)' }} />
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '10px', height: '10px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(186,230,253,0.7) 40%, transparent 100%)' }} />
                <div style={{ position: 'absolute', inset: '0', borderRadius: '50%', background: 'radial-gradient(circle at 30% 25%, rgba(255,255,255,0.12) 0%, transparent 60%)', pointerEvents: 'none' }} />
              </div>
              <div>
                <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: '16px', color: '#ffffff' }}>Keith</div>
                <div style={{ fontFamily: 'DM Sans', fontWeight: 400, fontSize: '12px', color: 'rgba(255,255,255,0.65)' }}>ASPIRE Program Assistant</div>
              </div>
              <button
                onClick={() => setMessages([])}
                title="New conversation"
                style={{
                  marginLeft: 'auto',
                  background: 'none', border: 'none',
                  color: 'rgba(255,255,255,0.55)', cursor: 'pointer',
                  padding: '4px 8px', fontSize: '13px',
                  fontFamily: 'DM Sans', borderRadius: '6px',
                  transition: 'color 0.15s ease',
                }}
                onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.9)'}
                onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.55)'}
              >↺ New</button>
              <button
                onClick={() => setIsOpen(false)}
                style={{
                  background: 'none', border: 'none',
                  color: 'rgba(255,255,255,0.65)', cursor: 'pointer',
                  fontSize: '18px', lineHeight: 1, padding: '4px',
                }}
              >×</button>
            </div>

            {/* Messages */}
            <div style={{
              flex: 1, overflowY: 'auto',
              padding: '16px',
              display: 'flex', flexDirection: 'column', gap: '12px',
              minHeight: 0,
            }}>
              {/* Welcome */}
              <div style={{
                background: '#f0f4ff',
                border: '1px solid #e0e7ff',
                borderRadius: '12px 12px 12px 4px',
                padding: '12px 14px',
                maxWidth: '90%',
              }}>
                <div style={{ fontFamily: 'DM Sans', fontSize: '13px', color: '#374151', lineHeight: 1.6 }}>
                  {formatText(welcomeMessage.text)}
                </div>
              </div>

              {/* Suggested prompts — only show when no messages yet */}
              {messages.length === 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
                  {SUGGESTED_PROMPTS.map((prompt, i) => (
                    <button
                      key={i}
                      onClick={() => handleSend(prompt.label)}
                      style={{
                        background: '#f9fafb',
                        border: '1px solid #e5e7eb',
                        borderRadius: '20px',
                        padding: '5px 12px',
                        fontFamily: 'DM Sans',
                        fontSize: '12px',
                        color: '#374151',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        whiteSpace: 'nowrap',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = '#eff6ff';
                        e.currentTarget.style.borderColor = '#bfdbfe';
                        e.currentTarget.style.color = '#1d4ed8';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = '#f9fafb';
                        e.currentTarget.style.borderColor = '#e5e7eb';
                        e.currentTarget.style.color = '#374151';
                      }}
                    >
                      {prompt.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Conversation messages */}
              {messages.map(msg => (
                <div key={msg.id} style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  gap: '6px',
                }}>
                  <div style={{
                    background: msg.role === 'user' ? '#1d2567' : '#f0f4ff',
                    border: msg.role === 'user' ? 'none' : '1px solid #e0e7ff',
                    borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                    padding: '10px 14px',
                    maxWidth: '88%',
                  }}>
                    <div style={{
                      fontFamily: 'DM Sans', fontSize: '13px', lineHeight: 1.6,
                      color: msg.role === 'user' ? '#ffffff' : '#374151',
                      whiteSpace: 'pre-wrap',
                    }}>
                      {formatText(msg.text)}
                    </div>
                    {msg.role === 'keith' && (
                      <div style={{
                        fontSize: '9px',
                        color: msg.isAI ? '#166534' : '#9ca3af',
                        marginTop: '2px',
                        paddingLeft: '2px',
                      }}>
                        {msg.isAI ? '✦ Keith AI' : '◦ Static'}
                      </div>
                    )}
                  </div>

                  {/* Copy button for email drafts */}
                  {msg.hasCopy && (
                    <button
                      onClick={() => handleCopy(msg.id, msg.text)}
                      style={{
                        background: copiedId === msg.id ? '#dcfce7' : '#f9fafb',
                        border: `1px solid ${copiedId === msg.id ? '#86efac' : '#e5e7eb'}`,
                        borderRadius: '8px',
                        padding: '4px 10px',
                        fontFamily: 'DM Sans', fontSize: '11px',
                        color: copiedId === msg.id ? '#166534' : '#6b7280',
                        cursor: 'pointer',
                      }}
                    >
                      {copiedId === msg.id ? '✓ Copied' : 'Copy Email'}
                    </button>
                  )}

                  {/* Navigation action */}
                  {msg.action && (
                    <button
                      onClick={() => handleAction(msg.action)}
                      style={{
                        background: '#eff6ff',
                        border: '1px solid #bfdbfe',
                        borderRadius: '8px',
                        padding: '4px 10px',
                        fontFamily: 'DM Sans', fontSize: '11px',
                        color: '#1d4ed8',
                        cursor: 'pointer',
                      }}
                    >
                      → {msg.action.label}
                    </button>
                  )}
                </div>
              ))}

              {/* Typing indicator */}
              {isTyping && (
                <div style={{
                  background: '#f0f4ff',
                  border: '1px solid #e0e7ff',
                  borderRadius: '12px 12px 12px 4px',
                  padding: '10px 14px',
                  width: 'fit-content',
                }}>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    {[0, 1, 2].map(i => (
                      <div key={i} style={{
                        width: '6px', height: '6px', borderRadius: '50%',
                        background: '#9faff8',
                        animation: `keithDot 1.2s ease infinite ${i * 0.2}s`,
                      }} />
                    ))}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div style={{
              padding: '12px 16px',
              borderTop: '1px solid #f3f4f6',
              display: 'flex',
              gap: '8px',
              flexShrink: 0,
            }}>
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Ask Keith anything about ASPIRE..."
                style={{
                  flex: 1,
                  border: '1px solid #e5e7eb',
                  borderRadius: '20px',
                  padding: '8px 14px',
                  fontFamily: 'DM Sans', fontSize: '13px',
                  color: '#374151',
                  outline: 'none',
                  background: '#f9fafb',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = '#9faff8'; e.currentTarget.style.background = '#ffffff'; }}
                onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.background = '#f9fafb'; }}
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim()}
                style={{
                  background: input.trim() ? '#1d2567' : '#e5e7eb',
                  border: 'none',
                  borderRadius: '50%',
                  width: '36px', height: '36px',
                  cursor: input.trim() ? 'pointer' : 'default',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'background 0.15s ease',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>

            {/* Phase note */}
            <div style={{
              padding: '6px 16px 10px',
              fontFamily: 'DM Sans', fontSize: '10px',
              color: '#9ca3af', textAlign: 'center',
            }}>
              Keith · {contextLoading ? 'Loading cohort data...' : context ? `Live data · ${cohortName}` : 'Static mode'} · Powered by Claude
            </div>
          </div>
        </>
      )}

      {/* Keyframe animations */}
      <style>{`
        @keyframes keithSlideIn {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes keithDot {
          0%, 60%, 100% { opacity: 0.3; transform: scale(0.8); }
          30% { opacity: 1; transform: scale(1); }
        }
        @keyframes keithSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes keithPulse {
          0%, 100% { opacity: 0.75; transform: translate(-50%, -50%) scale(0.95); }
          50% { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
        }
        @keyframes keithGlow {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 1; }
        }
      `}</style>
    </>
  );
}

// RESIDENCY-KEITH-2 (Owner, 2026-11-02: "why not reuse what was already existing?"): the one
// Keith chat, drawn once. The staff app (Keith.jsx, /api/keith) and the Residency Portal
// (ngrp/ResidencyKeith.jsx, /api/keith-residency) both render this shell and keep their own
// conversation, endpoint and rules. The markup and styles were moved out of Keith.jsx unchanged;
// change the look here and both get it.
//
// The shell draws: the "Ask Keith" tooltip, the 60px orb launcher, the backdrop, the panel with
// its navy head (orb, Keith AI wordmark, New, close), the scrolling list (the host's children),
// the input row and the host's footer. `data-keith-launcher` and `data-keith-panel` let a portal
// move its own launchers out of the way (portal.css).
import { useState } from 'react';
import Tooltip from '../ui/Tooltip';
import KeithOrbVideo from './KeithOrbVideo';

export default function KeithChatShell({
  open, busy = false, replay = 0, onReplay,
  onToggle, onClose, onNew,
  hideLauncher = false, launcherProps = {},
  launcherRight = '24px', launcherBottom = '24px', tooltipRight = '96px',
  panelBottom = '96px', panelHeightGap = '160px',
  listRef, onListScroll, endRef, children,
  input, inputOverlay = null, footer = null,
  // KEITH-HUMANIZER-1: `companion` is a second panel the host draws beside Keith's while it is open
  // (it closes with it); `headerAction` is a control in the navy head, before New.
  companion = null, headerAction = null,
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const orb = (size, thinking, r = 0) => <KeithOrbVideo size={size} working={thinking} replay={r} />;
  const canSend = Boolean(input?.canSend);

  return (
    <>
      {/* Tooltip - sits to the LEFT of the orb (MESSAGES-AUTOSCROLL-1: the
          Messages shortcut now occupies the space directly above Keith, so the
          tooltip no longer floats up into it). */}
      {showTooltip && !open && (
        <div style={{
          position: 'fixed',
          bottom: `calc(${launcherBottom} + 14px)`,
          right: tooltipRight,
          background: 'var(--aspire-tooltip-bg, rgba(9, 12, 28, 0.94))',
          color: 'var(--aspire-tooltip-fg, #ffffff)',
          fontFamily: 'var(--aspire-tooltip-font-family, Plus Jakarta Sans, sans-serif)',
          fontSize: 'var(--aspire-tooltip-font-size, 12px)',
          fontWeight: 'var(--aspire-tooltip-font-weight, 500)',
          lineHeight: 'var(--aspire-tooltip-line-height, 1.2)',
          padding: 'var(--aspire-tooltip-padding, 6px 12px)',
          borderRadius: 'var(--aspire-tooltip-radius, 8px)',
          border: '1px solid var(--aspire-tooltip-border, transparent)',
          whiteSpace: 'nowrap',
          zIndex: 1001,
          pointerEvents: 'none',
          boxShadow: 'var(--aspire-tooltip-shadow, 0 4px 14px rgba(0,0,0,0.45))',
        }}>
          Ask Keith
        </div>
      )}

      {/* Floating button. A host may hide the closed launcher when it provides another
          Keith entry point; the launcher returns while the drawer is open so Keith can
          always be put away from the same control. */}
      {(!hideLauncher || open) && (
      <button
        type="button"
        data-keith-launcher=""
        {...launcherProps}
        onClick={onToggle}
        aria-label="Ask Keith"
        aria-expanded={open}
        style={{
          position: 'fixed',
          bottom: launcherBottom,
          right: launcherRight,
          width: '60px',
          height: '60px',
          borderRadius: '50%',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '0',
          zIndex: 1000,
          transition: 'transform 0.2s ease',
          transform: open ? 'scale(0.95)' : 'scale(1)',
        }}
        onMouseEnter={e => { setShowTooltip(true); onReplay?.(); if (!open) e.currentTarget.style.transform = 'scale(1.08)'; }}
        onFocus={() => onReplay?.()}
        onMouseLeave={e => { setShowTooltip(false); if (!open) e.currentTarget.style.transform = open ? 'scale(0.95)' : 'scale(1)'; }}
      >
        {/* Orb - loops while a reply is in flight. The ring is a token: white in light mode, none in dark. */}
        <div className="keith-launcher-orb" style={{
          width: '60px', height: '60px', borderRadius: '50%',
          boxShadow: open
            ? '0 0 0 2px rgba(139,92,246,0.55), 0 0 22px rgba(99,102,241,0.55), 0 6px 20px rgba(0,0,0,0.35)'
            : '0 6px 18px rgba(20,24,80,0.45), var(--keith-launcher-ring, 0 0 0 2px #ffffff)',
          transition: 'box-shadow 0.3s ease',
        }}>
          {orb(60, busy, replay)}
        </div>
      </button>
      )}

      {/* Drawer */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            onClick={onClose}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.15)',
              zIndex: 998,
            }}
          />

          {companion}

          {/* Drawer panel */}
          <div data-keith-panel="" role="dialog" aria-label="Keith" style={{
            position: 'fixed',
            bottom: panelBottom,
            right: 'max(12px, min(24px, calc(100vw - 412px)))',
            width: 'min(400px, calc(100vw - 24px))',
            // KEITH-CHAT-UX-1: taller, responsive height. Caps at 720px on large screens and shrinks
            // with the viewport, always leaving ~160px of vertical clearance (bottom offset + top gap)
            // so the panel never covers the app header. minHeight is itself capped to the same
            // available space so it can never force overflow on short screens.
            height: `min(720px, calc(100vh - ${panelHeightGap}))`,
            minHeight: `min(360px, calc(100vh - ${panelHeightGap}))`,
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
              {/* Header orb - loops with the launcher while a reply is in flight. */}
              <div style={{ flexShrink: 0, borderRadius: '50%', boxShadow: '0 0 0 1px rgba(99,102,241,0.45), 0 0 8px rgba(99,102,241,0.28)' }}>
                {orb(36, busy)}
              </div>
              {/* KEITH-FOUNDATION-1: the Keith AI wordmark (public/brand/keith-lockup.png), set as text in
                  white because the header is navy in both themes and the artwork's ink is navy. */}
              <div className="keith-wordmark" aria-label="Keith AI">
                <span className="keith-wordmark-name" aria-hidden="true">Keith</span>
                <span className="keith-wordmark-ai" aria-hidden="true">AI</span>
              </div>
              {headerAction}
              <Tooltip label="New conversation" placement="bottom">
              <button
                type="button"
                onClick={onNew}
                style={{
                  marginLeft: headerAction ? 0 : 'auto',
                  background: 'none', border: 'none',
                  color: 'rgba(255,255,255,0.55)', cursor: 'pointer',
                  padding: '4px 8px', fontSize: '13px',
                  fontFamily: 'Plus Jakarta Sans', borderRadius: '6px',
                  transition: 'color 0.15s ease',
                }}
                onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.9)'}
                onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.55)'}
              >↺ New</button>
              </Tooltip>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close Keith"
                style={{
                  background: 'none', border: 'none',
                  color: 'rgba(255,255,255,0.65)', cursor: 'pointer',
                  fontSize: '18px', lineHeight: 1, padding: '4px',
                }}
              >×</button>
            </div>

            {/* Messages */}
            <div ref={listRef} onScroll={onListScroll} aria-live="polite" style={{
              flex: 1, overflowY: 'auto',
              padding: '16px',
              display: 'flex', flexDirection: 'column', gap: '12px',
              minHeight: 0,
            }}>
              {children}
              <div ref={endRef} />
            </div>

            {/* Input */}
            <div style={{
              padding: '12px 16px',
              borderTop: '1px solid #f3f4f6',
              display: 'flex',
              gap: '8px',
              flexShrink: 0,
              position: 'relative',
            }}>
              {inputOverlay}
              <input
                ref={input?.ref}
                value={input?.value ?? ''}
                onChange={input?.onChange}
                onSelect={input?.onSelect}
                onKeyUp={input?.onKeyUp}
                onKeyDown={input?.onKeyDown}
                placeholder={input?.placeholder}
                aria-label={input?.ariaLabel || 'Ask Keith'}
                maxLength={input?.maxLength}
                style={{
                  flex: 1,
                  border: '1px solid #e5e7eb',
                  borderRadius: '20px',
                  padding: '8px 14px',
                  fontFamily: 'Plus Jakarta Sans', fontSize: '13px',
                  color: '#374151',
                  outline: 'none',
                  background: '#f9fafb',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = '#9faff8'; e.currentTarget.style.background = '#ffffff'; }}
                onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.background = '#f9fafb'; }}
              />
              <button
                type="button"
                aria-label="Send"
                onClick={() => input?.onSend?.()}
                disabled={!canSend}
                style={{
                  background: canSend ? '#1d2567' : '#e5e7eb',
                  border: 'none',
                  borderRadius: '50%',
                  width: '36px', height: '36px',
                  cursor: canSend ? 'pointer' : 'default',
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

            {footer}
          </div>
        </>
      )}

      {/* Launcher orb, wordmark and panel animation. */}
      <style>{`
        .keith-orb-video {
          position: relative; display: block; overflow: hidden; border-radius: 50%;
          background: #070918;
        }
        .keith-orb-video video, .keith-orb-video img {
          display: block; width: 100%; height: 100%; object-fit: cover; transform: scale(1.04);
        }
        .keith-wordmark { display: flex; flex-direction: column; line-height: 1; gap: 3px; }
        .keith-wordmark-name { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 19px; letter-spacing: -0.01em; color: #FFFFFF; }
        .keith-wordmark-ai { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 11px; letter-spacing: 0.06em; color: rgba(255,255,255,0.78); }
        @keyframes keithSlideIn {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes keithDot {
          0%, 60%, 100% { opacity: 0.3; transform: scale(0.8); }
          30% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </>
  );
}

// The welcome bubble: a greeting and one line under it.
export function KeithWelcome({ title, children }) {
  return (
    <div style={{
      background: '#f0f4ff',
      border: '1px solid #e0e7ff',
      borderRadius: '12px 12px 12px 4px',
      padding: '12px 14px',
      maxWidth: '90%',
    }}>
      <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: '14px', fontWeight: 600, color: '#1d2567' }}>
        {title}
      </div>
      <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: '12.5px', color: '#374151', lineHeight: 1.55, marginTop: 3 }}>
        {children}
      </div>
    </div>
  );
}

// Suggested prompts - empty state only.
export function KeithChips({ chips, disabled = false, onPick }) {
  if (!chips?.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
      {chips.map((label, i) => (
        <button
          key={i}
          type="button"
          disabled={disabled}
          onClick={() => onPick(label)}
          style={{
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: '20px',
            padding: '5px 12px',
            fontFamily: 'Plus Jakarta Sans',
            fontSize: '12px',
            color: '#374151',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.45 : 1,
            transition: 'all 0.15s ease',
            whiteSpace: 'nowrap',
            pointerEvents: disabled ? 'none' : 'auto',
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
          {label}
        </button>
      ))}
    </div>
  );
}

// One message: the bubble (`body`, then `inside` under the badge) and whatever the host hangs
// under the bubble (`after`).
export function KeithMessage({ fromUser, ai = false, body, inside = null, after = null }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: fromUser ? 'flex-end' : 'flex-start',
      gap: '6px',
    }}>
      <div style={{
        background: fromUser ? '#1d2567' : '#f0f4ff',
        border: fromUser ? 'none' : '1px solid #e0e7ff',
        borderRadius: fromUser ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
        padding: '10px 14px',
        maxWidth: '88%',
      }}>
        <div style={{
          fontFamily: 'Plus Jakarta Sans', fontSize: '13px', lineHeight: 1.6,
          color: fromUser ? '#ffffff' : '#374151',
          whiteSpace: 'pre-wrap',
        }}>
          {body}
        </div>
        {/* KEITH-REFRESH-1: only real Keith answers carry a badge. */}
        {!fromUser && ai && (
          <div style={{ fontSize: '9px', color: '#166534', marginTop: '2px', paddingLeft: '2px' }}>
            ✦ Keith
          </div>
        )}
        {inside}
      </div>
      {after}
    </div>
  );
}

// "Try again" under a reply that failed for a reason that may pass.
export function KeithRetry({ onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        background: '#fff7ed', border: '1px solid #fed7aa',
        borderRadius: '8px', padding: '4px 10px',
        fontFamily: 'Plus Jakarta Sans', fontSize: '11px',
        color: '#c2410c', cursor: 'pointer',
      }}
    >
      ↺ Try again
    </button>
  );
}

// Typing indicator.
export function KeithTyping() {
  return (
    <div role="status" aria-label="Keith is working" style={{
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
  );
}

// The footer line: a source label on the left, the model select on the right.
export function KeithFooter({ label, models, value, onChange, labels }) {
  return (
    <div style={{
      padding: '4px 16px 10px',
      display: 'flex', alignItems: 'center', gap: 8,
      fontFamily: 'Plus Jakarta Sans', fontSize: '10px', color: '#9ca3af',
    }}>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      {/* KEITH-MODEL-SELECT-1: the server enforces who may choose which model. */}
      <select
        aria-label="Model"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          marginLeft: 'auto', flexShrink: 0,
          fontFamily: 'Plus Jakarta Sans', fontSize: '10px', color: '#6b7280',
          border: '1px solid #e5e7eb', borderRadius: 6,
          background: '#f9fafb', padding: '2px 4px', cursor: 'pointer',
        }}
      >
        {models.map(m => <option key={m} value={m}>{labels[m]}</option>)}
      </select>
    </div>
  );
}

// src/components/connect/AutomationEmailPreviewDrawer.jsx
//
// AUTOMATIONS-EMAIL-PREVIEW-1 - right-side slide-over that previews a scheduled automation's email
// using SAFE SYNTHETIC fixtures (src/lib/notifications/previewFixtures.js). Client-side render only:
// it calls the same template builder the cron sends, with mock data. No network, no DB, no tokens.
//
// Visually mirrors the Sent History "View message" drawer (sandboxed iframe, no scripts) without
// modifying Sent History. A shared extraction is noted as future tech debt.

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'

const F = 'Plus Jakarta Sans, sans-serif'
const NAVY = '#1D2567'
const SENDER = 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>'

// `entry` is a fixture from AUTOMATION_PREVIEW_FIXTURES: { recipientType, variants?, render(variantKey) }.
// `footNote` overrides the closing line. It defaults to the automation wording every
// existing caller expects; NGRP-TRANSITION-PREVIEW-1 passes its own because the
// Transition Form is sent BY HAND, and telling a reader an automation sends it would be
// the one false sentence on a screen whose entire purpose is showing exactly what goes out.
export default function AutomationEmailPreviewDrawer({ title, entry, onClose, footNote = null }) {
  const variants = entry?.variants || null
  const [variant, setVariant] = useState(variants?.[0]?.key || null)

  // Render the chosen variant client-side; never throws out - surfaces as an error state instead.
  const result = useMemo(() => {
    if (!entry) return { error: 'No preview available.' }
    try {
      const { subject, html } = entry.render(variant)
      return { subject, html }
    } catch (err) {
      return { error: err?.message || String(err) }
    }
  }, [entry, variant])

  const pill = {
    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
    background: '#FBF5E8', color: '#8B5E1A', border: '1px solid #f0c9b0',
    textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap',
  }

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${title || 'Automation'} email preview`}
      style={{ position: 'fixed', inset: 0, zIndex: 700, background: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'flex-end' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: 'min(520px, 100%)', height: '100%', background: '#fff', display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 24px rgba(0,0,0,0.12)', fontFamily: F }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, padding: '14px 18px', borderBottom: '1px solid #eee', flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, lineHeight: 1.3 }}>{title || 'Automation'}</div>
            <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 2 }}>Preview · sample data</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={pill}>Sample data, not a real send</span>
            <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', lineHeight: 1, padding: 6, minWidth: 44, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Variant switcher (Teams: First reminder / Escalation) */}
        {variants && (
          <div style={{ display: 'flex', gap: 6, padding: '10px 18px 0', flexShrink: 0 }}>
            {variants.map(v => {
              const active = v.key === variant
              return (
                <button
                  key={v.key}
                  onClick={() => setVariant(v.key)}
                  aria-pressed={active}
                  style={{
                    padding: '7px 14px', minHeight: 36, borderRadius: 8, cursor: 'pointer', fontFamily: F,
                    fontSize: 12, fontWeight: 600,
                    background: active ? NAVY : '#fff',
                    color: active ? '#fff' : '#4A5560',
                    border: `1px solid ${active ? NAVY : 'rgba(29,37,103,0.18)'}`,
                  }}
                >{v.label}</button>
              )
            })}
          </div>
        )}

        {/* Scrollable content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 18px' }}>
          {result.error ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#b91c1c', marginBottom: 6 }}>Preview unavailable</div>
              <div style={{ fontSize: 11.5, color: '#9ca3af', wordBreak: 'break-word', lineHeight: 1.5 }}>{result.error}</div>
            </div>
          ) : (
            <>
              {/* Sender / subject / recipient meta */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', gap: 8, fontSize: 12.5, marginBottom: 6 }}>
                  <span style={{ color: '#9ca3af', minWidth: 64, flexShrink: 0 }}>From</span>
                  <span style={{ color: '#374151', wordBreak: 'break-word' }}>{SENDER}</span>
                </div>
                {entry?.recipientType && (
                  <div style={{ display: 'flex', gap: 8, fontSize: 12.5, marginBottom: 6 }}>
                    <span style={{ color: '#9ca3af', minWidth: 64, flexShrink: 0 }}>To</span>
                    <span style={{ color: '#374151' }}>{entry.recipientType} (sample)</span>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, fontSize: 12.5 }}>
                  <span style={{ color: '#9ca3af', minWidth: 64, flexShrink: 0 }}>Subject</span>
                  <span style={{ color: '#191919', fontWeight: 600, wordBreak: 'break-word' }}>{result.subject || '(No subject)'}</span>
                </div>
              </div>

              {/* Body preview - strict sandbox, no scripts, no same-origin, no referrer */}
              <iframe
                srcDoc={result.html}
                sandbox=""
                referrerPolicy="no-referrer"
                title="Email Preview"
                style={{ width: '100%', minHeight: 520, border: '1px solid #eee', borderRadius: 8, background: '#fff' }}
              />

              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 12, lineHeight: 1.5 }}>
                {footNote || 'This preview uses synthetic data and is rendered with the same template the automation sends.'}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// src/components/RestrictedAccessOverlay.jsx
// RESTRICTED-ACCESS-OVERLAY-UNIFORMITY: shared restricted-access overlay used by the Rotation
// (MatchingTab) and Evaluation (EvaluationTab) tabs so both look identical — a centered white
// card with a lock icon, floating over a softened/blurred backdrop.
//
// Render this INSIDE a `position: relative` container; it absolutely fills that container and
// blurs whatever is painted behind it (the real dashboard for Rotation; a non-sensitive
// placeholder backdrop for Evaluation — interviewers never fetch evaluation data).
import { Lock } from 'lucide-react'

const F = 'DM Sans, sans-serif'

export default function RestrictedAccessOverlay({ title, body, contact }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(244,241,236,0.55)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
      zIndex: 10, padding: 20,
    }}>
      <div style={{
        maxWidth: 520, background: '#ffffff', border: '1px solid #E5E7EB', borderRadius: 12,
        padding: 32, textAlign: 'center', boxShadow: '0 10px 40px rgba(0,0,0,0.08)', fontFamily: F,
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#EDEEF4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Lock size={20} color="#1D2567" />
          </div>
        </div>
        <div style={{ fontSize: 20, fontWeight: 600, color: '#1D2567', marginBottom: 12 }}>
          {title}
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.7, color: '#374151' }}>
          {body}
        </div>
        {contact && (
          <div style={{ fontSize: 14, lineHeight: 1.7, color: '#6b7280', marginTop: 12 }}>
            {contact}
          </div>
        )}
      </div>
    </div>
  )
}

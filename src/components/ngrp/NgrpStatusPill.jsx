// NGRP-WORKSPACE-1: one pill renderer for every NGRP vocabulary. Shape and
// type metrics match .aspire-status-pill; every pill pairs its color family
// with an icon AND a text label, so color is never the only signal, and the
// neutral (gray dash) states read as "no action yet", not as failures.
import { CheckCircle2, Clock, Info, AlertTriangle, Minus } from 'lucide-react'
import { PILL_FAMILIES } from '../../lib/ngrp/ngrpStates'

const ICONS = { check: CheckCircle2, clock: Clock, info: Info, alert: AlertTriangle, dash: Minus }

export default function NgrpStatusPill({ config, value, srPrefix }) {
  const meta = config[value] || { label: value || '—', family: 'mute', icon: 'dash' }
  const fam = PILL_FAMILIES[meta.family] || PILL_FAMILIES.mute
  const Icon = ICONS[meta.icon] || Minus
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        fontSize: 11, fontWeight: 700, lineHeight: 1.4,
        padding: '3px 9px', borderRadius: 999,
        background: fam.bg, color: fam.text, border: `1px solid ${fam.border}`,
        whiteSpace: 'nowrap', fontFamily: 'Plus Jakarta Sans, sans-serif',
      }}
    >
      <Icon size={11} strokeWidth={2.4} aria-hidden="true" style={{ flexShrink: 0 }} />
      {srPrefix && <span className="sr-only">{srPrefix}: </span>}
      {meta.label}
    </span>
  )
}

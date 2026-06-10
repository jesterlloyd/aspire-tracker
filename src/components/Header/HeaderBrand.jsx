// WS2.0: extracted verbatim from App.jsx header (Zone 1 — Brand). No behavior change.
import Tooltip from '../ui/Tooltip'

export default function HeaderBrand() {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:14, flexShrink:0 }}>
      <img src="/cs-logo-large.png" alt="Cedars-Sinai" style={{ height:46, width:'auto', objectFit:'contain' }} />
      <div style={{ width:1, height:30, background:'rgba(255,255,255,0.18)', flexShrink:0 }} />
      <Tooltip label="Affiliate Students' Pathway from Internship to Residency Experience" placement="bottom">
        <div style={{ fontSize:20, fontWeight:700, color:'#fff', letterSpacing:'-0.01em', cursor:'default' }}>
          ASPIRE Intelligence
        </div>
      </Tooltip>
    </div>
  )
}

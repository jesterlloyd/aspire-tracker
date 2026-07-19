// WS2.0: extracted verbatim from App.jsx header (Zone 1 - Brand).
// ASPIRE-CHART: styling moved to .chart-brand classes so the mark scales and
// the wordmark wraps on narrow screens instead of forcing header overflow.
import Tooltip from '../ui/Tooltip'

export default function HeaderBrand() {
  return (
    <div className="chart-brand">
      <img src="/cs-logo-large.png" alt="Cedars-Sinai" className="chart-brand-logo" />
      <div className="chart-brand-divider" />
      <Tooltip label="Affiliate Students' Pathway from Internship to Residency Experience" placement="bottom">
        <div className="chart-brand-title">
          ASPIRE Intelligence
        </div>
      </Tooltip>
    </div>
  )
}

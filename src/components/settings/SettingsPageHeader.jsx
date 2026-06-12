// KT-3a-1 → UI-1: the Settings page-header now delegates to the shared
// ui/PageHeader primitive (same pixels; the markup moved there verbatim).
// Kept as a thin alias so Settings-side imports stay stable.
import PageHeader from '../ui/PageHeader'

export default function SettingsPageHeader(props) {
  return <PageHeader {...props} />
}

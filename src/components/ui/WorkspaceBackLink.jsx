// UI-POLISH-2 / 2b - Shared "Back to <workspace>" return control used by the app-level utility
// surfaces (ASPIRE Connect, ASPIRE Catalog, Settings). Consolidates three previously-duplicated
// copies into one consistent, deliberate pill (not floating gray text).
//
// Behavior is UNCHANGED from the prior per-page links: it navigates to `path` (the caller's
// prior-workspace path) and labels itself "Back to {label}" to match that destination.
import { useNavigate } from 'react-router-dom'
import BackButton from '../BackButton'

export default function WorkspaceBackLink({ path = '/aggregate', label = 'At a Glance' }) {
  const navigate = useNavigate()
  return <BackButton label={`Back to ${label}`} onClick={() => navigate(path)} />
}

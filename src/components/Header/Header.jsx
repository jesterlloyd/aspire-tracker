// WS2.0: application header container, extracted from App.jsx. Composes the existing
// header zones with NO behavior change. All state/handlers/refs remain owned by App.jsx
// and are passed in via the grouped `cohort` / `search` / `actions` props. This is the
// foundation WS2.1 (Settings shell) will build on — Settings will later be added inside
// HeaderActions. No utilities are added/removed/reordered here. LastSyncedIndicator stays.
import HeaderBrand from './HeaderBrand'
import CohortPicker from './CohortPicker'
import LastSyncedIndicator from './LastSyncedIndicator'
import UniversalSearch from './UniversalSearch'
import HeaderActions from './HeaderActions'

export default function Header({ cohort, search, actions }) {
  return (
    <header style={{
      background: 'linear-gradient(180deg, #1D2567 0%, #161D52 100%)',
      padding: '0 24px',
      height: 64,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      fontFamily: 'DM Sans, sans-serif',
      flexShrink: 0,
      position: 'relative',
    }}>
      {/* Zone 1: Brand */}
      <HeaderBrand />

      <div style={{ flex:1 }} />

      {/* Zone 2: Status — cohort picker + sync */}
      <CohortPicker {...cohort} />

      <LastSyncedIndicator />

      {/* Zone 3: Search */}
      <UniversalSearch {...search} />

      {/* Zone 3: Actions — connect + bell + user menu */}
      <HeaderActions {...actions} />
    </header>
  )
}

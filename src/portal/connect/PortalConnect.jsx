// PORTAL-CONNECT-1 (Owner, 2026-10-07): a portal's ASPIRE Connect.
//
// "Look at the tabs, they're getting so many. We can cluster the contacts and messages together
// to go inside the ASPIRE Connect app the way it is in the main staff app." So a portal that has
// Contacts and Messages reaches them the way staff do: the Connect icon in the nightfall header
// opens one page with a Contacts | Messages picker (the staff Connect page's own SegmentedTabs),
// and both leave the section nav. The NE&L Portal and the Residency Portal mount this; the
// Residency one is built to take Outreach and Automations later, as the staff Connect has them.
//
// The header icon rides the shared PortalHeaderControls slot, so it sits beside the scope picker,
// left of the profile menu, and stays visible whatever the page shows. With unread messages it
// carries the same pin badge the staff icon does and opens Messages; otherwise it opens the last
// tab the person used (`aspire.portal-connect.lastTab`), Contacts the first time.
import SegmentedPicker from '../../components/shared/SegmentedPicker'
import ConnectIconButton from '../../components/Header/ConnectIconButton'
import { PortalHeaderControls } from '../PortalHeaderSlots'
import { formatUnread, unreadLabel } from '../../lib/messages/messagesConstants'
import { portalConnectDestination, rememberPortalConnectTab } from './portalConnectModel'

const srOnly = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
}

/** The header icon, portaled into the shell's controls slot. */
export function PortalConnectHeaderButton({ active = false, unread = 0, messagesEnabled = false, onOpen }) {
  const label = messagesEnabled && unread > 0 ? `ASPIRE Connect, ${unreadLabel(unread)}` : 'ASPIRE Connect'
  return (
    <PortalHeaderControls>
      <ConnectIconButton
        active={active}
        badge={messagesEnabled ? unread : 0}
        ariaLabel={label}
        onClick={() => onOpen?.(portalConnectDestination({ unread, messagesEnabled }))}
      />
    </PortalHeaderControls>
  )
}

/**
 * The page: the picker, then whichever workspace is open. The host passes the two workspaces
 * (Contacts stays mounted and hidden so its list, filter and open record survive a trip to
 * Messages, exactly as the NE&L sections always did).
 */
export function PortalConnectPage({ tab, onNavigate, unread = 0, messagesEnabled = false, contacts, messages, label = 'ASPIRE Connect sections' }) {
  const waiting = messagesEnabled && unread > 0
  // The canonical SegmentedPicker (the portals' own picker, as on the Unit Leader's At a Glance);
  // the staff Connect page's SegmentedTabs is styled in the staff sheet only. A waiting count
  // rides the Messages label as the pin badge rides the icon.
  const options = [
    { value: 'contacts', label: 'Contacts' },
    { value: 'messages', label: waiting ? `Messages · ${formatUnread(unread)}` : 'Messages' },
  ]
  return (
    <div className="ptl-connect">
      <div className="ptl-connect-picker" data-tour="portal-connect-picker">
        <SegmentedPicker ariaLabel={label} value={tab} onChange={key => { rememberPortalConnectTab(key); onNavigate?.(key) }} options={options} />
        {waiting && <span style={srOnly}>{unreadLabel(unread)}</span>}
      </div>
      <div style={{ display: tab === 'contacts' ? 'block' : 'none' }}>{contacts}</div>
      {tab === 'messages' && messages}
    </div>
  )
}

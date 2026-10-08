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
import BackButton from '../../components/BackButton'
import { useChartViewport } from '../../components/student/useChartViewport'
import { PortalHeaderControls } from '../PortalHeaderSlots'
import { PortalNavRefresh } from '../PortalRefresh'
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
 * The page, drawn as the staff Connect page is (PORTAL-CONNECT-2, Owner, 2026-10-07): a back pill
 * to the section the person came from and Refresh on one row, "ASPIRE Connect" with its line, the
 * Contacts | Messages picker, then the open workspace. The pill, Refresh and the title scroll away,
 * the picker pins under the nightfall header, and the workspace takes exactly what the window has
 * left under the picker (useChartViewport, the student chart's and the staff Connect's own rule),
 * so Contacts is locked and only its list and record scroll. The host passes the two workspaces;
 * Contacts stays mounted and hidden so its list, filter and open record survive a trip to Messages.
 */
export function PortalConnectPage({ tab, active = true, onNavigate, unread = 0, messagesEnabled = false, contacts, messages, label = 'ASPIRE Connect sections', backPath, backLabel = 'At a Glance', onBack }) {
  const waiting = messagesEnabled && unread > 0
  // The page may be mounted hidden (NE&L keeps it mounted so Contacts keeps its state); it
  // measures again whenever it is shown or its tab changes.
  const { barRef, chartHeight, toolbarTop } = useChartViewport(`${active}:${tab}`)
  // The canonical SegmentedPicker (the portals' own picker, as on the Unit Leader's At a Glance);
  // the staff Connect page's SegmentedTabs is styled in the staff sheet only. A waiting count
  // rides the Messages label as the pin badge rides the icon.
  const options = [
    { value: 'contacts', label: 'Contacts' },
    { value: 'messages', label: waiting ? `Messages · ${formatUnread(unread)}` : 'Messages' },
  ]
  const bodyHeight = chartHeight ? `${chartHeight}px` : undefined
  return (
    <div className="ptl-connect" style={{ '--ptl-connect-h': bodyHeight }}>
      <div className="ptl-connect-top">
        <BackButton label={`Back to ${backLabel}`} onClick={() => onBack?.(backPath)} />
        <PortalNavRefresh tooltipLabel="Refresh" />
      </div>
      <div className="ptl-connect-title">
        <h2>ASPIRE Connect</h2>
        <p>Contacts and secure messages with the ASPIRE team.</p>
      </div>
      <div className="ptl-connect-picker" ref={barRef} style={{ top: toolbarTop }} data-tour="portal-connect-picker">
        <SegmentedPicker ariaLabel={label} value={tab} onChange={key => { rememberPortalConnectTab(key); onNavigate?.(key) }} options={options} />
        {waiting && <span style={srOnly}>{unreadLabel(unread)}</span>}
      </div>
      {/* Contacts is LOCKED to the measured height; Messages keeps its own scrolling inside at
          least that height, as the staff Connect's Messages wrapper does. */}
      <div className="ptl-connect-body" style={{ display: tab === 'contacts' ? 'block' : 'none', height: bodyHeight }}>{contacts}</div>
      {tab === 'messages' && <div className="ptl-connect-body" style={{ minHeight: bodyHeight }}>{messages}</div>}
    </div>
  )
}

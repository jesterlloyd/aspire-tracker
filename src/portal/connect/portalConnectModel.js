// PORTAL-CONNECT-1: the rules of a portal's ASPIRE Connect, pure (see PortalConnect.jsx).

export const PORTAL_CONNECT_TABS = Object.freeze(['contacts', 'messages'])
const LAST_TAB_KEY = 'aspire.portal-connect.lastTab'

export function rememberPortalConnectTab(tab) {
  try { if (PORTAL_CONNECT_TABS.includes(tab)) localStorage.setItem(LAST_TAB_KEY, tab) } catch { /* private window */ }
}

/** Where the icon goes: Messages when something waits, else the last tab used, else Contacts. */
export function portalConnectDestination({ unread = 0, messagesEnabled = false } = {}) {
  if (messagesEnabled && unread > 0) return 'messages'
  let saved = null
  try { saved = localStorage.getItem(LAST_TAB_KEY) } catch { /* private window */ }
  if (saved === 'messages' && !messagesEnabled) return 'contacts'
  return PORTAL_CONNECT_TABS.includes(saved) ? saved : 'contacts'
}

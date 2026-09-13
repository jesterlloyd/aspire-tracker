// MASTHEAD-PHASE-1: see identityContext.js. Wrap anything that renders
// masthead pieces so they can read the viewer's key.
import { MastheadIdentityContext } from './identityContext'

export function MastheadIdentity({ userKey, children }) {
  return <MastheadIdentityContext.Provider value={userKey || null}>{children}</MastheadIdentityContext.Provider>
}

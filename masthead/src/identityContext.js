// MASTHEAD-PHASE-1: who is looking at the card, as an opaque key.
//
// The card stores one thing per person - the chosen city - and it used to read
// the person's id from ASPIRE's AuthContext. A masthead that other products
// load cannot know their auth, so the host names the person instead: a string
// it chooses (a user id, or anything stable and private to the host). Nothing
// here interprets the key; it only namespaces storage. The provider component
// lives in identity.jsx; this file holds the context and the hook so each file
// exports one kind of thing (the fast-refresh rule).
import { createContext, useContext } from 'react'

export const MastheadIdentityContext = createContext(null)

/** The host's key for the viewer, or null (an anonymous or signed-out view). */
export function useMastheadUserKey() {
  return useContext(MastheadIdentityContext)
}

import { createContext, useContext, useMemo } from 'react'
import { useOnlinePresence } from '../hooks/useOnlinePresence'

const PresenceContext = createContext({ onlineUserIds: new Set() })

export function PresenceProvider({ children }) {
  const { onlineUserIds } = useOnlinePresence()
  // ASPIRE-CHART performance: stable value identity between presence syncs so
  // a sync event does not re-render every consumer with a fresh object.
  const value = useMemo(() => ({ onlineUserIds }), [onlineUserIds])
  return (
    <PresenceContext.Provider value={value}>
      {children}
    </PresenceContext.Provider>
  )
}

export function usePresence() {
  return useContext(PresenceContext)
}

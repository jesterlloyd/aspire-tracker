import { createContext, useContext } from 'react'
import { useOnlinePresence } from '../hooks/useOnlinePresence'

const PresenceContext = createContext({ onlineUserIds: new Set() })

export function PresenceProvider({ children }) {
  const { onlineUserIds } = useOnlinePresence()
  return (
    <PresenceContext.Provider value={{ onlineUserIds }}>
      {children}
    </PresenceContext.Provider>
  )
}

export function usePresence() {
  return useContext(PresenceContext)
}

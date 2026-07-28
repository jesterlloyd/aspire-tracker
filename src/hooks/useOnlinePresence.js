import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const PRESENCE_CHANNEL = 'aspire-online-users'

export function useOnlinePresence() {
  const { userProfile } = useAuth()
  const [onlineUserIds, setOnlineUserIds] = useState(new Set())
  // ACCOUNTS-ACCESS-DIRECTORY-2: profile_id-keyed companion set. auth_user_id
  // stays the presence channel key (unchanged), but the directory must never
  // render auth_user_id, so we also derive online state from each tracked
  // payload's profile_id.
  const [onlineProfileIds, setOnlineProfileIds] = useState(new Set())
  const channelRef = useRef(null)

  useEffect(() => {
    if (!userProfile?.auth_user_id) return

    const channel = supabase.channel(PRESENCE_CHANNEL, {
      config: { presence: { key: userProfile.auth_user_id } },
    })

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        setOnlineUserIds(new Set(Object.keys(state)))
        const profileIds = Object.values(state)
          .flat()
          .map(m => m.profile_id)
          .filter(Boolean)
        setOnlineProfileIds(new Set(profileIds))
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            user_id: userProfile.auth_user_id,
            profile_id: userProfile.id,
            full_name: userProfile.full_name,
            online_at: new Date().toISOString(),
          })
        }
      })

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        channelRef.current.unsubscribe()
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [userProfile?.auth_user_id, userProfile?.id, userProfile?.full_name])

  return { onlineUserIds, onlineProfileIds }
}

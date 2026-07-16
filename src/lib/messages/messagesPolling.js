// src/lib/messages/messagesPolling.js
//
// ASPIRE MESSAGES, PHASE 4B2A STAGE B: reusable polling utilities.
//
// Version one uses polling, never Supabase Realtime. These live in their own
// module so the workspace file exports only components (fast refresh), and so
// Phase 4B2b can mount the unread hook at the slower cadence for the Connect tab
// badge without importing the whole workspace.
//
// Every interval is React Query driven, so requests are cancelled on unmount and
// never overlap: React Query will not start a refetch while one is in flight for
// the same key. There is no setInterval to leak.

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as defaultApi from './messagesApiClient';

// Active workspace: inbox, selected thread, and unread all refresh at 30s.
export const ACTIVE_POLL_MS = 30 * 1000;
// Future inactive Connect tab: unread badge only, at 60s.
export const IDLE_UNREAD_POLL_MS = 60 * 1000;

// True while the tab is visible. Polling pauses when the document is hidden and
// resumes on focus. Listeners are removed on unmount, so nothing leaks.
export function useDocumentVisible() {
  const [visible, setVisible] = useState(
    typeof document === 'undefined' ? true : !document.hidden,
  );
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const sync = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
    };
  }, []);
  return visible;
}

// The current staff member's unread count. Reusable at two cadences: the active
// workspace passes ACTIVE_POLL_MS; Phase 4B2b will mount this same hook with
// IDLE_UNREAD_POLL_MS to drive the Connect tab badge while another sub-tab is
// active. It is NOT mounted in Connect yet.
//
// Unread counts only portal-authored messages unread by THIS staff profile, so
// one staff member reading never clears another's count.
export function useStaffUnreadCount({ intervalMs = ACTIVE_POLL_MS, api = defaultApi } = {}) {
  const visible = useDocumentVisible();
  const { data } = useQuery({
    queryKey: ['messages_staff_unread'],
    queryFn: ({ signal }) => api.getStaffUnreadCount({ signal }),
    // false pauses the interval entirely while hidden; focus triggers a refetch.
    refetchInterval: visible ? intervalMs : false,
    refetchOnWindowFocus: true,
    staleTime: 10 * 1000,
    retry: 1,
  });
  return Number(data?.unread_count) || 0;
}

// Narrow-width detection for the mobile list-to-thread state model.
export const MOBILE_MAX_WIDTH = 900;
export function useIsNarrow(maxWidth = MOBILE_MAX_WIDTH) {
  const [narrow, setNarrow] = useState(
    typeof window === 'undefined' ? false : window.innerWidth <= maxWidth,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setNarrow(window.innerWidth <= maxWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [maxWidth]);
  return narrow;
}

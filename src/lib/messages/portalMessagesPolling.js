// ASPIRE MESSAGES, PHASE 5B-i: dormant polling foundation for the Student Portal.
//
// DORMANT: the unread hook is not mounted by any routed portal page. Phase 5B-ii
// mounts it once Student Portal navigation exposes Messages.
//
// Cadence mirrors the staff workspace: 30 seconds while Messages is the active
// view, 60 seconds for the unread total elsewhere in the portal, paused while
// the document is hidden. No Supabase Realtime.

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPortalUnreadCount } from './portalMessagesApiClient.js';

export const PORTAL_ACTIVE_POLL_MS = 30 * 1000;
export const PORTAL_IDLE_UNREAD_POLL_MS = 60 * 1000;
export const PORTAL_MOBILE_MAX_WIDTH = 900;

// Visibility, so a backgrounded tab stops polling entirely rather than burning
// requests nobody is reading.
export function usePortalDocumentVisible() {
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

// A width of 0 means "not measured yet", not "phone". A real viewport is never
// zero pixels wide, but innerWidth can read 0 before first layout or in an
// embedded context. Treating that as narrow would collapse a desktop into the
// mobile list-first view, so an unmeasured width falls back to the wide layout.
const isNarrowWidth = (width, maxWidth) => width > 0 && width <= maxWidth;

export function usePortalIsNarrow(maxWidth = PORTAL_MOBILE_MAX_WIDTH) {
  const [narrow, setNarrow] = useState(
    typeof window === 'undefined' ? false : isNarrowWidth(window.innerWidth, maxWidth),
  );
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setNarrow(isNarrowWidth(window.innerWidth, maxWidth));
    // Sync once on mount: the initial state may have been computed before layout.
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [maxWidth]);
  return narrow;
}

// The student's unread total.
//
// `enabled` is the authorization guard: a user without active Student Portal
// access must never issue a Messages request, not even for a count. React
// forbids mounting a hook conditionally, so the gate is an option rather than a
// conditional call site.
//
// React Query serializes refetches per query key, so a slow response cannot
// stack up overlapping requests behind it.
export function usePortalUnreadCount({
  intervalMs = PORTAL_ACTIVE_POLL_MS,
  enabled = true,
  api = { getPortalUnreadCount },
} = {}) {
  const visible = usePortalDocumentVisible();
  const { data } = useQuery({
    queryKey: ['portal_messages_unread'],
    queryFn: ({ signal }) => api.getPortalUnreadCount({ signal }),
    enabled,
    refetchInterval: enabled && visible ? intervalMs : false,
    refetchOnWindowFocus: enabled,
    staleTime: 10 * 1000,
    retry: 1,
  });
  return Number(data?.unread_count) || 0;
}

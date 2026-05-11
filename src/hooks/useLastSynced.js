import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * useLastSynced
 * Tracks when data was last fetched and returns a human-readable display string.
 * Call markSynced() after any Supabase query resolves successfully.
 */
export function useLastSynced() {
  const [lastSynced, setLastSynced] = useState(null);
  const [display, setDisplay] = useState('');
  const intervalRef = useRef(null);

  const markSynced = useCallback(() => {
    setLastSynced(new Date());
  }, []);

  useEffect(() => {
    if (!lastSynced) return;

    const updateDisplay = () => {
      const now = new Date();
      const diffSeconds = Math.floor((now - lastSynced) / 1000);

      if (diffSeconds < 15) {
        setDisplay('Updated just now');
      } else if (diffSeconds < 60) {
        setDisplay(`Updated ${diffSeconds}s ago`);
      } else if (diffSeconds < 600) {
        const mins = Math.floor(diffSeconds / 60);
        setDisplay(`Updated ${mins}m ago`);
      } else {
        const time = lastSynced.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
        setDisplay(`Last synced ${time}`);
      }
    };

    updateDisplay();
    intervalRef.current = setInterval(updateDisplay, 30000);
    return () => clearInterval(intervalRef.current);
  }, [lastSynced]);

  return { markSynced, display, lastSynced };
}

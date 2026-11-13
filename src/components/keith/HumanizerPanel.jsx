// KEITH-HUMANIZER-2 (Owner, 2026-11-13): the Clever AI humanizer lives INSIDE Keith's panel, at the
// bottom, opened by the Humanizer button in Keith's footer: copy Keith's answer from the chat above,
// paste it below. (KEITH-HUMANIZER-1 drew it as a second panel beside Keith; the Owner replaced that
// the same day.) The staff app's Keith hands the panel to KeithChatShell as `dock`; the Residency
// Portal's Keith does not. The frame is built by src/lib/cleverWidget.js, so no vendor script runs
// in the app. Keith's panel is white in both themes, so the widget is asked for its light theme.
import { useEffect, useRef, useState } from 'react';
import { mountCleverWidget } from '../../lib/cleverWidget';
import './humanizerPanel.css';

export const HUMANIZER_WIDGET_ID = 'ce82cd4f78e94cfb87275ebf191a9054';
const DOCK_ID = 'keith-humanizer-dock';

// The footer button. A toggle: pressed while the widget is open.
export function HumanizerToggle({ open, onToggle }) {
  return (
    <button
      type="button"
      className="keith-humanizer-toggle"
      aria-pressed={open}
      aria-controls={DOCK_ID}
      onClick={onToggle}
    >
      Humanizer
    </button>
  );
}

export default function HumanizerPanel() {
  const hostRef = useRef(null);
  const [state, setState] = useState('loading');

  useEffect(() => mountCleverWidget(hostRef.current, {
    id: HUMANIZER_WIDGET_ID,
    theme: 'light',
    scheme: 'light',
    label: 'Clever AI humanizer',
    onState: setState,
  }), []);

  return (
    <section id={DOCK_ID} className="keith-humanizer" data-keith-dock="" aria-label="Humanizer">
      <p className="keith-humanizer-note">
        Text you paste here is sent to Clever AI, outside ASPIRE. Leave out names and student details.
      </p>
      <div className="keith-humanizer-body">
        <div ref={hostRef} />
        {state === 'loading' && <p className="keith-humanizer-status" role="status">Loading the humanizer…</p>}
        {state === 'unavailable' && (
          <p className="keith-humanizer-status" role="status">
            The humanizer is not available here. It opens only on the live site.
          </p>
        )}
      </div>
    </section>
  );
}

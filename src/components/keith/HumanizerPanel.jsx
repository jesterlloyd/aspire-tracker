// KEITH-HUMANIZER-1 (Owner, 2026-11-13): the Clever AI humanizer, a second panel that opens beside
// Keith's and closes with it. The staff app's Keith hands it to KeithChatShell as `companion`; the
// Residency Portal's Keith does not. The frame is built by src/lib/cleverWidget.js, so no vendor
// script runs in the app. The panel is white in both themes, as Keith's is, so the widget is asked
// for its light theme.
import { useEffect, useRef, useState } from 'react';
import { mountCleverWidget } from '../../lib/cleverWidget';
import './humanizerPanel.css';

export const HUMANIZER_WIDGET_ID = 'ce82cd4f78e94cfb87275ebf191a9054';

export default function HumanizerPanel({ panelBottom = '96px', panelHeightGap = '160px', onHide }) {
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
    <section
      className="keith-humanizer"
      data-keith-companion=""
      aria-label="Humanizer"
      style={{ '--kh-bottom': panelBottom, '--kh-gap': panelHeightGap }}
    >
      <header className="keith-humanizer-head">
        <div className="keith-humanizer-title">
          <span className="keith-humanizer-name">Humanizer</span>
          <span className="keith-humanizer-by">Clever AI</span>
        </div>
        <button type="button" className="keith-humanizer-close" onClick={onHide} aria-label="Hide Humanizer">×</button>
      </header>
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

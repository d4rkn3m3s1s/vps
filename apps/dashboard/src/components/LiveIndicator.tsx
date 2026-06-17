'use client';

import { useLive } from '../lib/live';

// Small pill in the topbar showing the real-time connection state.
export function LiveIndicator() {
  const { connected } = useLive();
  return (
    <span className={`live-pill${connected ? ' live-pill-on' : ''}`} title={connected ? 'Real-time connected' : 'Reconnecting…'}>
      <span className="live-dot" />
      {connected ? 'Live' : 'Offline'}
    </span>
  );
}

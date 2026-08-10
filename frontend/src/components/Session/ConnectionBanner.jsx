/* -------------------------------------------------------
 * ConnectionBanner.jsx — says out loud when the session has gone
 *
 * A tunnel URL is not stable. It changes when the host quits, but also when
 * their Wi-Fi blinks, when their laptop wakes from sleep, when Cloudflare
 * rotates an edge node, or when their ISP hands out a new IP. Every one of
 * those looks identical from here: the socket stops answering.
 *
 * Before this, that failure was completely silent. The retry loop ran forever
 * against a dead address, the editor stayed unlocked, and people carried on
 * typing into a session that no longer existed — finding out only when they
 * pressed Run, if at all.
 *
 * Two states on purpose:
 *   reconnecting — a thin, calm strip. Most drops are a blink, and the CRDT
 *                  merges anything typed in the gap once the socket returns.
 *                  Shouting here would train people to ignore it.
 *   lost         — the editor is now read-only and the work has stopped, so
 *                  this says so plainly and gives the one instruction that
 *                  actually helps: ask for a fresh link.
 * ------------------------------------------------------- */

import React, { useState } from 'react';
import useEditorStore from '../../store/useEditorStore';
import { buildJoinCode, getOrigin } from '../../services/backendHost';

const ConnectionBanner = () => {
  const connectionState = useEditorStore((s) => s.connectionState);
  const sessionId = useEditorStore((s) => s.sessionId);
  const reformSessionAsHost = useEditorStore((s) => s.reformSessionAsHost);

  const [busy, setBusy] = useState(false);
  const [takeover, setTakeover] = useState(null);

  /* Taking over is a new session, not a repair of the old one — so the invite
   * has to be regenerated and handed to the user to pass on. There is no way to
   * reach the others automatically; the only channel to them died with the
   * host. */
  const handleTakeover = async () => {
    setBusy(true);
    setTakeover(null);
    const result = await reformSessionAsHost();
    if (result.ok) {
      const store = useEditorStore.getState();
      store.setJoinCode(buildJoinCode(result.sessionId, getOrigin()));
      store.setJoinCodeStale(true);   // forces the share panel back on screen
    }
    setTakeover(result);
    setBusy(false);
  };

  // Only meaningful inside a session — local mode has no socket to lose.
  if (!sessionId || connectionState === 'connected') return null;

  if (connectionState === 'reconnecting') {
    return (
      <div className="conn-banner is-reconnecting">
        <span className="conn-banner-pulse" />
        <span className="conn-banner-text">Reconnecting…</span>
      </div>
    );
  }

  return (
    <div className="conn-banner is-lost">
      <span className="conn-banner-icon">⚠</span>
      <div className="conn-banner-body">
        <div className="conn-banner-title">Lost connection to the host</div>
        <div className="conn-banner-sub">
          Your edits are no longer being shared, so the editor is read-only.
          {' '}<strong>Your files are safe on this computer.</strong> Ask the host
          for a new invite link — or carry on here and let the others join you.
        </div>

        {takeover && (
          <div className={`conn-banner-takeover ${takeover.ok ? 'is-ok' : 'is-error'}`}>
            {takeover.ok
              ? 'You are hosting now. Share the new invite code from the file panel so the others can rejoin.'
              : takeover.reason}
          </div>
        )}
      </div>

      <button
        className="conn-banner-btn"
        onClick={handleTakeover}
        disabled={busy}
        title="Start a fresh session from the copy of the project on this machine"
      >
        {busy ? 'Starting…' : 'Continue as host'}
      </button>
    </div>
  );
};

export default ConnectionBanner;

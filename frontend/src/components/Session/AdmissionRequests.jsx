/* -------------------------------------------------------
 * AdmissionRequests.jsx — the owner's side of the door
 *
 * A session code travels. It gets pasted into a group chat, quoted in a reply,
 * screenshotted, forwarded to "one more person who should see this". None of
 * that is malicious and all of it is invisible: before this, anyone holding the
 * code and password was simply in, and the owner found out — if they looked at
 * the avatars — after the fact.
 *
 * So arrivals are a decision rather than an event, and this is what makes it.
 * It sits at the top of the editor rather than in a toast: a toast that expires
 * while you are typing is a "yes" nobody made. Someone is standing outside; the
 * prompt waits until you say something.
 *
 * Monochrome, like the rest of the app, and still. The urgency is carried by a
 * clock counting up while they stand there, and by the dashed frame — the same
 * mark the agent's proposal uses, which reads as "this is provisional, decide
 * about it" rather than as another panel that has always been there.
 * Colour would have said "error"; this is not an error, it is someone waiting.
 *
 * Rendered for the owner only. The pending list is broadcast to the whole
 * session — the backend is a relay and does not know who is who — so the
 * decision to show it is taken here.
 * ------------------------------------------------------- */

import React, { useEffect, useState } from 'react';
import useEditorStore from '../../store/useEditorStore';
import { sendAdmissionDecision } from '../../services/socket';
import { initials } from '../../utils/initials';

/* How long they have been standing there. Seconds up to a minute, then
 * minutes — precision stops being the point once it is "a while". */
const waited = (since, now) => {
  const secs = Math.max(0, Math.floor((now - since) / 1000));
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
};

const AdmissionRequests = () => {
  const sessionId = useEditorStore((s) => s.sessionId);
  const userRole = useEditorStore((s) => s.userRole);
  const pending = useEditorStore((s) => s.pendingAdmissions);

  const active = sessionId && userRole === 'owner' && pending?.length > 0;

  /* Retick every second so the wait counts up. Only while someone is actually
     waiting — an interval running behind an empty strip is pure waste. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  if (!active) return null;

  const decide = (requestId, decision) => sendAdmissionDecision(sessionId, requestId, decision);

  return (
    <div className="adm">
      {pending.length > 1 && (
        <div className="adm-count">{pending.length} waiting</div>
      )}

      {pending.map((req) => (
        <div key={req.requestId} className="adm-row">
          {/* Just the initials. The pulsing ring that used to leave them is
              gone: a strip that already waits for an answer does not also need
              to twitch to be noticed, and a loop running behind whatever you
              were reading is the kind of motion you end up working around. The
              clock counting up carries the waiting on its own. */}
          <span className="adm-av">{initials(req.username)}</span>

          <div className="adm-who">
            <span className="adm-name">{req.username}</span>
            <span className="adm-sub">wants to join</span>
          </div>

          <span className="adm-clock">{waited(req.createdAt, now)}</span>

          {/* Refuse on the left, admit on the right. The irreversible answer
              should not be the one under a thumb that is already moving, and
              the solid button is the app's yes everywhere else. */}
          <button className="adm-btn" onClick={() => decide(req.requestId, 'deny')}>
            Deny
          </button>
          <button className="adm-btn is-yes" onClick={() => decide(req.requestId, 'admit')}>
            Let in
          </button>
        </div>
      ))}
    </div>
  );
};

export default AdmissionRequests;

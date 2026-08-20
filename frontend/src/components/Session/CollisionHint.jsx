/* -------------------------------------------------------
 * CollisionHint.jsx — you and someone else, tied to the same file
 *
 * A CRDT stops people overwriting each other. It does not stop two people
 * building the same thing, and no merge algorithm can: technically nothing
 * went wrong. Only a human can resolve it, and only if they are told.
 *
 * The whole idea is carried by one image — your face, a thread, their face.
 * You are both pulling on the same file. That needs no paragraph explaining
 * it, which is why there isn't one: the earlier version argued its case in
 * three lines of body copy, and nobody reads an argument hovering over their
 * editor. One image, one line.
 *
 * It floats over the corner rather than displacing the code. Collapsed it is
 * only the thread; it opens when someone is actually typing, and on hover.
 * ------------------------------------------------------- */

import React, { useState, useEffect, useRef } from 'react';
import useEditorStore from '../../store/useEditorStore';
import { initials } from '../../utils/initials';

/* Stays open this long after the last keystroke — enough to read, not long
 * enough to become furniture. */
const OPEN_AFTER_TYPING_MS = 4000;

const CollisionHint = () => {
  const filePresence = useEditorStore((s) => s.filePresence);
  const remoteTyping = useEditorStore((s) => s.remoteTyping);
  const activePath = useEditorStore((s) => s.activePath);
  const currentUser = useEditorStore((s) => s.currentUser);
  const sessionId = useEditorStore((s) => s.sessionId);

  const [dismissed, setDismissed] = useState(null);
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const closeTimer = useRef(null);

  useEffect(() => { setDismissed(null); setOpen(false); }, [activePath]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const others = Object.entries(filePresence)
    .filter(([uid, p]) => p.path === activePath && uid !== currentUser?.id)
    .map(([uid, p]) => ({ uid, ...p, typing: Boolean(remoteTyping[uid]) }));

  const someoneTyping = others.some((o) => o.typing);

  /* The timer restarts on every keystroke, so a continuous typist cannot make
   * the card flicker — it closes once they actually stop. */
  useEffect(() => {
    if (!someoneTyping) return;
    setOpen(true);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), OPEN_AFTER_TYPING_MS);
  }, [someoneTyping, remoteTyping]);

  if (!sessionId || !activePath || dismissed === activePath || others.length === 0) return null;

  const active = someoneTyping ? others.filter((o) => o.typing) : others;
  const accent = active[0]?.color || '#6366f1';
  const lead = active[0];

  const label = others.length === 1
    ? lead.username
    : `${lead.username} +${others.length - 1}`;

  return (
    <div
      className={`cx ${open || hovered ? 'is-open' : ''} ${someoneTyping ? 'is-live' : ''}`}
      style={{ '--cx-accent': accent }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* The image that does the explaining: you, a thread, them. */}
      <div className="cx-thread">
        <span className="cx-av is-me" title="You">
          {initials(currentUser?.username || 'Me')}
        </span>

        <span className="cx-line">
          {someoneTyping && <span className="cx-spark" />}
        </span>

        {others.slice(0, 2).map((o, i) => (
          <span
            key={o.uid}
            className={`cx-av ${o.typing ? 'is-typing' : ''}`}
            style={{ background: o.color || '#6366f1', zIndex: 3 - i }}
            title={`${o.username}${o.typing ? ' — typing now' : ' — has this file open'}`}
          >
            {initials(o.username)}
            {o.typing && <span className="cx-ring" />}
          </span>
        ))}
        {others.length > 2 && <span className="cx-av is-more">+{others.length - 2}</span>}
      </div>

      <div className="cx-body">
        <span className="cx-text">
          <b>{label}</b>
          {someoneTyping ? ' is typing in this file' : ' is in this file too'}
          <span className="cx-hint"> — worth a word first</span>
        </span>
        <button
          className="cx-x"
          onClick={() => setDismissed(activePath)}
          aria-label="Hide for this file"
          title="Hide for this file"
        >
          ×
        </button>
      </div>
    </div>
  );
};

export default CollisionHint;

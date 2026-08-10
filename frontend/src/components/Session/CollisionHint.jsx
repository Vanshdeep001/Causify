/* -------------------------------------------------------
 * CollisionHint.jsx — someone else is already in this file
 *
 * A CRDT stops people overwriting each other. It does not stop two people
 * building the same thing: Rohan writes the login handler, Priya writes the
 * login handler, both merge perfectly, and an hour of somebody's night is gone
 * — discovered at 3am when the pieces don't fit.
 *
 * That is the one collision no merge algorithm can catch, because technically
 * nothing went wrong. Only a human can resolve it, and only if they are told.
 *
 * The file tree already shows a dot for who is where. This exists because a
 * dot is passive — it helps if you happen to look at it, and nobody looks at
 * the tree while they are typing. This speaks at the one moment it can change
 * a decision: as the file is opened.
 * ------------------------------------------------------- */

import React, { useState, useEffect } from 'react';
import useEditorStore from '../../store/useEditorStore';

const CollisionHint = () => {
  const filePresence = useEditorStore((s) => s.filePresence);
  const activePath = useEditorStore((s) => s.activePath);
  const currentUser = useEditorStore((s) => s.currentUser);
  const sessionId = useEditorStore((s) => s.sessionId);

  // Dismissal is per file: waving it away for one file should not hide a
  // genuine collision in the next one.
  const [dismissed, setDismissed] = useState(null);

  useEffect(() => { setDismissed(null); }, [activePath]);

  if (!sessionId || !activePath || dismissed === activePath) return null;

  const others = Object.entries(filePresence)
    .filter(([uid, p]) => p.path === activePath && uid !== currentUser?.id)
    .map(([uid, p]) => ({ uid, ...p }));

  if (others.length === 0) return null;

  const names = others.map((o) => o.username);
  const who = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

  return (
    <div className="collide-hint">
      <span className="collide-dots">
        {others.slice(0, 3).map((o) => (
          <span key={o.uid} className="collide-dot" style={{ background: o.color || '#6366f1' }} />
        ))}
      </span>
      <span className="collide-text">
        <strong>{who}</strong> {names.length === 1 ? 'is' : 'are'} working in this file right now
        {' — '}worth a word before you both write the same thing.
      </span>
      <button
        className="collide-x"
        onClick={() => setDismissed(activePath)}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
};

export default CollisionHint;

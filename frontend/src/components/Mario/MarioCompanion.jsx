/* -------------------------------------------------------
 * MarioCompanion.jsx — the repair agent, given a body
 *
 * The auto-fix agent used to live inside the terminal's output panel. That put
 * the one thing capable of repairing your code behind a precondition: something
 * had to have been run, and failed, before you could reach it. A dev server
 * crashing in a project folder never produced the panel at all.
 *
 * So he moved out. This is a floating window you summon from the header and
 * drag wherever it is least in the way, holding two things:
 *
 *   • the repair flow, unchanged — AutoFixPanel is mounted here as-is
 *   • an ask box, for "change this", "write me that", "why is this failing"
 *
 * Dragging is deliberately hand-rolled. It is a pointer-down, a pointer-move
 * and a clamp; a drag library would be more code to install than to write, and
 * would still need the clamping written by hand.
 * ------------------------------------------------------- */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import useEditorStore from '../../store/useEditorStore';
import AutoFixPanel from '../Output/AutoFixPanel';
import { PixelSprite, MARIO_PAL, MARIO_ROWS } from '../common/pixelArt';

const PANEL_W = 380;
/* Enough of the window must stay on screen to grab it again. Dragging something
   fully off the edge and having no way back is the classic floating-panel bug. */
const KEEP_VISIBLE = 56;
const MARGIN = 16;

/** Where he stands when nobody has moved him: out of the way, bottom right. */
const defaultPos = () => ({
  x: Math.max(MARGIN, window.innerWidth - PANEL_W - MARGIN),
  y: Math.max(MARGIN, window.innerHeight - 460),
});

/** Keep a position inside the current window, whatever it was when saved. */
const clamp = (pos) => ({
  x: Math.min(Math.max(pos.x, MARGIN - PANEL_W + KEEP_VISIBLE), window.innerWidth - KEEP_VISIBLE),
  y: Math.min(Math.max(pos.y, MARGIN), window.innerHeight - KEEP_VISIBLE),
});

const MarioCompanion = () => {
  const marioOpen = useEditorStore((s) => s.marioOpen);
  const marioPos = useEditorStore((s) => s.marioPos);
  const marioCollapsed = useEditorStore((s) => s.marioCollapsed);
  const setMarioOpen = useEditorStore((s) => s.setMarioOpen);
  const setMarioPos = useEditorStore((s) => s.setMarioPos);
  const toggleMarioCollapsed = useEditorStore((s) => s.toggleMarioCollapsed);

  const autoFixState = useEditorStore((s) => s.autoFixState);
  const requestAutoFix = useEditorStore((s) => s.requestAutoFix);
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const activePath = useEditorStore((s) => s.activePath);

  const [pos, setPos] = useState(() => marioPos || defaultPos());
  const [dragging, setDragging] = useState(false);
  const [ask, setAsk] = useState('');
  const grabOffset = useRef({ x: 0, y: 0 });

  /* A saved position is only trustworthy relative to the window it was saved
     in. Re-clamp on mount and on resize so a smaller window never hides him. */
  useEffect(() => {
    setPos((p) => clamp(p));
    const onResize = () => setPos((p) => clamp(p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onPointerDown = useCallback((e) => {
    // Left button only — a right-click drag is not a drag.
    if (e.button !== 0) return;
    grabOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [pos]);

  const onPointerMove = useCallback((e) => {
    if (!dragging) return;
    setPos(clamp({ x: e.clientX - grabOffset.current.x, y: e.clientY - grabOffset.current.y }));
  }, [dragging]);

  const onPointerUp = useCallback((e) => {
    if (!dragging) return;
    setDragging(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    // Persist only when the drag ends. Writing on every move would put a
    // localStorage round-trip inside a pointermove handler.
    setPos((p) => { setMarioPos(p); return p; });
  }, [dragging, setMarioPos]);

  if (!marioOpen) return null;

  const busy = autoFixState === 'working';

  const submitAsk = () => {
    const text = ask.trim();
    if (!text || busy) return;
    requestAutoFix({ instruction: text });
    setAsk('');
  };

  /* What he can actually act on right now, said plainly. An empty ask box with
     nothing to fix is the one state where the button would do nothing, and
     saying why beats a button that silently ignores you. */
  const scope = workspaceRoot
    ? 'this project'
    : (activePath ? activePath.split('/').pop() : 'nothing open');

  return (
    <div
      className={`mario-companion${dragging ? ' is-dragging' : ''}`}
      style={{ left: pos.x, top: pos.y, width: marioCollapsed ? 'auto' : PANEL_W }}
    >
      {/* ── The grab handle ── */}
      <div
        className="mario-bar"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className={`mario-sprite${busy ? ' is-busy' : ''}`}>
          <PixelSprite rows={MARIO_ROWS} palette={MARIO_PAL} px={2} />
        </span>

        <span className="mario-title">
          MARIO
          <span className="mario-scope">{busy ? 'working…' : scope}</span>
        </span>

        <button
          className="mario-bar-btn"
          title={marioCollapsed ? 'Expand' : 'Collapse'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={toggleMarioCollapsed}
        >
          {marioCollapsed ? '▢' : '—'}
        </button>
        <button
          className="mario-bar-btn"
          title="Send Mario away"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setMarioOpen(false)}
        >
          ✕
        </button>
      </div>

      {!marioCollapsed && (
        <div className="mario-body">
          {/* The repair flow, exactly as it was in the terminal. */}
          <AutoFixPanel />

          {/* ── Ask ── */}
          <div className="mario-ask">
            <textarea
              className="mario-ask-input"
              value={ask}
              disabled={busy}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter is a newline, as everywhere else.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submitAsk();
                }
              }}
              placeholder={busy ? 'Working…' : 'Ask Mario to fix or change something…'}
              rows={2}
            />
            <button
              className="mario-ask-send"
              onClick={submitAsk}
              disabled={busy || !ask.trim()}
              title="Send to Mario (Enter)"
            >
              ▶
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MarioCompanion;

/* -------------------------------------------------------
 * MarioCompanion.jsx — a character who lives in the editor
 *
 * The repair agent used to be a panel inside the terminal, which meant it only
 * existed after a run had failed. A dev server crashing in a project folder
 * never produced it at all.
 *
 * He is not a panel any more, and deliberately not a chat window either. He is
 * a character standing in your editor: drag him anywhere, and when you come
 * near, a command line unfurls from his side. Say what you want; he does it.
 *
 * ── Why he is animated ──
 * A single sprite frame parked on a dark background does not read as a
 * character — it reads as a stray emoji somebody left there. What makes him a
 * presence is that he is never quite still: he breathes, he glances around, he
 * hops when you approach, he actually walks while the agent is thinking, and
 * once in a while he says something. All of it is built from the three 12×16
 * frames that already exist in Output/MarioSprites.jsx — the same ones the
 * repair panel animates — so this adds behaviour, not artwork.
 *
 * The restraint that keeps it from being irritating: he only speaks unprompted
 * when he has been ignored for a while, never while you are typing to him,
 * never twice in a row with the same line, and never while he is working.
 * ------------------------------------------------------- */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import useEditorStore from '../../store/useEditorStore';
import AutoFixPanel from '../Output/AutoFixPanel';
import { PixelSprite } from '../common/pixelArt';
import {
  AGENT_PAL, AGENT_IDLE, AGENT_BLINK, AGENT_WALK, AGENT_JUMP,
  AGENT_COLS, AGENT_ROWS,
} from './sprites';

/* px=4 on a 16×20 sprite — 64×80 on screen. Big enough that the eyes, the
   moustache and the overall buttons all resolve, which is the difference
   between a character and a person-shaped smudge; small enough to stand over
   code without being in the way. */
const SPRITE_PX = 4;
const CHAR_W = AGENT_COLS * SPRITE_PX;   // 64
const CHAR_H = AGENT_ROWS * SPRITE_PX;   // 80
const MARGIN = 12;

/* How long a hop lasts, and how long a line stays up. */
const HOP_MS = 420;
const SAY_MS = 3600;

/* ── Idle life ──
 * A character who only moves when you touch him is a button with a costume.
 * These two keep him alive while you are looking elsewhere: a blink every few
 * seconds, and a hop every so often. Both are jittered, because anything on a
 * fixed interval stops reading as behaviour and starts reading as a metronome.
 *
 * Blinking is the cheapest possible signal that something is alive, and the
 * frames are built for it — the eyes are two rows tall so dropping one reads as
 * a lid closing rather than as the eyes disappearing.
 */
const BLINK_MS = 120;
const BLINK_MIN_MS = 1700;
const BLINK_MAX_MS = 4200;
const IDLE_HOP_MIN_MS = 4500;
const IDLE_HOP_MAX_MS = 10000;

/* Height of the terminal at each layout, matching TerminalPanel's own sizing.
   Split is a fixed 400px there; normal reads the resizable `terminalHeight`. */
const TERMINAL_SPLIT_H = 400;

const between = (min, max) => min + Math.random() * (max - min);

/* Idle chatter. Long and jittered: a fixed interval reads as a machine ticking,
   and anything shorter than this becomes noise you learn to resent. */
const CHATTER_MIN_MS = 55_000;
const CHATTER_MAX_MS = 120_000;

/* What he says when left alone. Short — a speech bubble that needs reading is a
   dialog, and a dialog you did not ask for is an interruption. */
const IDLE_LINES = [
  "Let's-a go!",
  'Need a hand?',
  'Drag me anywhere.',
  'Still here!',
  'Mamma mia…',
  "What's-a broken?",
  'Just say the word.',
];

const defaultPos = () => ({
  x: Math.max(MARGIN, window.innerWidth - CHAR_W - 44),
  y: Math.max(MARGIN, window.innerHeight - 240),
});

/**
 * The lowest his feet may go.
 *
 * The terminal is a solid panel across the bottom of the window, and he floats
 * above the whole app — so with nothing stopping him he ends up standing in
 * front of the output, covering the very thing you opened the terminal to read.
 * Being on top of it is not better than being behind it; it is worse, because
 * now he is in the way of text you are trying to follow.
 *
 * So the terminal is treated as ground. It rises, he stands on top of it.
 *
 * Maximised is the one case with no room left: the terminal is the whole
 * window, so the floor becomes the window and he sits over it rather than being
 * pushed off-screen entirely.
 */
const floorY = (terminal) => {
  const { open, mode, height } = terminal;
  if (!open || mode === 'maximized') return window.innerHeight;
  return window.innerHeight - (mode === 'split' ? TERMINAL_SPLIT_H : height);
};

const clamp = (p, terminal) => ({
  x: Math.min(Math.max(p.x, MARGIN), window.innerWidth - CHAR_W - MARGIN),
  y: Math.min(Math.max(p.y, MARGIN), Math.max(MARGIN, floorY(terminal) - CHAR_H - MARGIN)),
});

const MarioCompanion = () => {
  const marioOpen = useEditorStore((s) => s.marioOpen);
  const marioPos = useEditorStore((s) => s.marioPos);
  const setMarioOpen = useEditorStore((s) => s.setMarioOpen);
  const setMarioPos = useEditorStore((s) => s.setMarioPos);

  const autoFix = useEditorStore((s) => s.autoFix);
  const autoFixState = useEditorStore((s) => s.autoFixState);
  const requestAutoFix = useEditorStore((s) => s.requestAutoFix);
  const clearAutoFix = useEditorStore((s) => s.clearAutoFix);
  const activePath = useEditorStore((s) => s.activePath);

  /* The terminal is ground he has to stand on top of, so its geometry is part
     of where he is allowed to be. */
  const isTerminalOpen = useEditorStore((s) => s.isTerminalOpen);
  const terminalHeight = useEditorStore((s) => s.terminalHeight);
  const terminalLayoutMode = useEditorStore((s) => s.terminalLayoutMode);
  const terminal = {
    open: isTerminalOpen,
    mode: terminalLayoutMode,
    height: terminalHeight,
  };

  const [pos, setPos] = useState(() => marioPos || defaultPos());
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState('');
  const [dragging, setDragging] = useState(false);

  /* Animation state, kept separate from the app's state on purpose: he is
     allowed to hop for reasons that have nothing to do with the agent. */
  const [hopping, setHopping] = useState(false);
  const [walkFrame, setWalkFrame] = useState(0);
  const [blinking, setBlinking] = useState(false);
  const [bubble, setBubble] = useState(null);   // { text, id }

  const grab = useRef({ x: 0, y: 0 });
  const inputRef = useRef(null);
  const lastLine = useRef('');
  const bubbleTimer = useRef(null);

  const busy = autoFixState === 'working';
  const hasResult = Boolean(autoFix);

  /* Open when there is a reason to be. Hover starts it; everything else here is
     a reason not to take it away again while the user is mid-thought. */
  const open = !dragging && (hovered || focused || busy || hasResult || text.length > 0);

  /* The bar precedes nothing in flow — it is anchored to him — but it still has
     to grow into the screen rather than off it. */
  const openRight = pos.x < window.innerWidth / 2;

  /* ── Speaking ── */
  const say = useCallback((line) => {
    if (!line) return;
    clearTimeout(bubbleTimer.current);
    lastLine.current = line;
    setBubble({ text: line, id: Date.now() });
    bubbleTimer.current = setTimeout(() => setBubble(null), SAY_MS);
  }, []);

  const hop = useCallback(() => {
    setHopping(true);
    setTimeout(() => setHopping(false), HOP_MS);
  }, []);

  useEffect(() => () => clearTimeout(bubbleTimer.current), []);

  /* ── Keep him on screen, and out of the terminal ──
     Re-run whenever the window or the terminal changes shape. A saved position
     is only ever trustworthy relative to the layout it was saved in, and the
     terminal opening is exactly the moment the old one stops being valid.
     The hop is the tell: he notices the ground rising and gets out of the way,
     rather than silently teleporting upward. */
  useEffect(() => {
    setPos((prev) => {
      const next = clamp(prev, terminal);
      if (next.y !== prev.y || next.x !== prev.x) hop();
      return next;
    });

    const onResize = () => setPos((p) => clamp(p, terminal));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // The three terminal primitives rather than the object, which is rebuilt
    // every render and would re-arm this forever.
  }, [isTerminalOpen, terminalHeight, terminalLayoutMode, hop]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── The walk cycle ──
     Real frame swapping rather than a CSS wobble. 140ms is roughly the NES
     footfall rate; faster looks frantic, slower looks like he is wading. */
  useEffect(() => {
    if (!busy) { setWalkFrame(0); return undefined; }
    const t = setInterval(() => setWalkFrame((f) => (f + 1) % 2), 140);
    return () => clearInterval(t);
  }, [busy]);

  /* ── Blinking ──
     Self-rescheduling rather than an interval, so each gap is drawn fresh and
     the rhythm never settles into something you can predict. */
  useEffect(() => {
    if (dragging) return undefined;

    let blinkOff;
    const blinkOn = setTimeout(() => {
      setBlinking(true);
      blinkOff = setTimeout(() => setBlinking(false), BLINK_MS);
    }, between(BLINK_MIN_MS, BLINK_MAX_MS));

    return () => { clearTimeout(blinkOn); clearTimeout(blinkOff); };
    // `blinking` in the deps is what re-arms the next one after each blink.
  }, [blinking, dragging]);

  /* ── The occasional hop ──
     Not while he is working, being dragged, or being talked to — a character
     who fidgets while you are typing at him is a distraction, not company. */
  useEffect(() => {
    if (busy || dragging || open) return undefined;
    const t = setTimeout(hop, between(IDLE_HOP_MIN_MS, IDLE_HOP_MAX_MS));
    return () => clearTimeout(t);
  }, [busy, dragging, open, hopping, hop]);

  /* ── He hops when you come near ── */
  useEffect(() => {
    if (hovered && !busy) hop();
  }, [hovered, busy, hop]);

  /* ── Idle chatter ──
     Rescheduled at a random delay each time so he never falls into a rhythm.
     Suppressed whenever he is busy, being talked to, or holding a result — the
     only moment a stray line is welcome is when nothing else is happening. */
  useEffect(() => {
    if (busy || hasResult || open) return undefined;

    const delay = CHATTER_MIN_MS + Math.random() * (CHATTER_MAX_MS - CHATTER_MIN_MS);
    const t = setTimeout(() => {
      // Never the same line twice running — repetition is what makes an idle
      // animation feel like a loop instead of a character.
      const choices = IDLE_LINES.filter((l) => l !== lastLine.current);
      say(choices[Math.floor(Math.random() * choices.length)]);
      hop();
    }, delay);

    return () => clearTimeout(t);
  }, [busy, hasResult, open, bubble, say, hop]);

  /* ── He reacts to the verdict ──
     Keyed on the proposal's identity rather than on `autoFixState`, which also
     changes when a fix is applied — reacting to that would have him celebrating
     twice for one result. */
  const verdict = autoFix?.status;
  useEffect(() => {
    if (!verdict) return;
    if (verdict === 'VERIFIED') { say('Course clear!'); hop(); }
    else if (verdict === 'NO_AI_KEY') say('Insert coin…');
    else if (verdict === 'UNVERIFIED') say('Have a look first.');
    else say('Mamma mia!');
  }, [verdict, say, hop]);

  // Focus the field as it opens, so hovering and typing is one motion.
  useEffect(() => {
    if (open && !busy && !hasResult) {
      const t = setTimeout(() => inputRef.current?.focus(), 170);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open, busy, hasResult]);

  /* ── Dragging ── */
  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    grab.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [pos]);

  const onPointerMove = useCallback((e) => {
    if (!dragging) return;
    setPos(clamp(
      { x: e.clientX - grab.current.x, y: e.clientY - grab.current.y },
      terminal,
    ));
  }, [dragging, isTerminalOpen, terminalHeight, terminalLayoutMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerUp = useCallback((e) => {
    if (!dragging) return;
    setDragging(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    // Persist once, at the end — not on every pointermove.
    setPos((p) => { setMarioPos(p); return p; });
  }, [dragging, setMarioPos]);

  if (!marioOpen) return null;

  const send = () => {
    const t = text.trim();
    if (!t || busy) return;
    say('Here we go!');
    requestAutoFix({ instruction: t });
    setText('');
  };

  const scope = activePath ? activePath.split('/').pop() : 'no file open';

  /* Which frame he is wearing this instant, most specific first.
     Dragging shows the airborne pose — picked up off the ground, legs out —
     which costs nothing and is the kind of detail that sells a character. */
  let frame = AGENT_IDLE;
  if (dragging || hopping) frame = AGENT_JUMP;
  else if (busy) frame = walkFrame === 1 ? AGENT_WALK : AGENT_IDLE;
  else if (blinking) frame = AGENT_BLINK;

  return (
    <div
      className={[
        'mario-agent',
        open ? 'is-open' : '',
        openRight ? 'opens-right' : '',
        busy ? 'is-busy' : '',
        dragging ? 'is-dragging' : '',
        hopping ? 'is-hopping' : '',
        hasResult ? 'has-result' : '',
      ].join(' ').trim()}
      style={{ left: pos.x, top: pos.y }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* ── The proposal ──
          Above him: a diff needs width and height a command line does not, and
          growing upward keeps him on the spot the user parked him. */}
      {hasResult && (
        <div className="mario-result">
          <div className="mario-result-head">
            <span>{autoFix?.targetPath || scope}</span>
            <button onClick={clearAutoFix} title="Dismiss">✕</button>
          </div>
          <div className="mario-result-body">
            <AutoFixPanel />
          </div>
        </div>
      )}

      {/* ── Speech ──
          Keyed by id so a new line re-triggers the pop animation instead of
          silently swapping the text inside a bubble that is already open. */}
      {bubble && !hasResult && (
        <div className="mario-bubble" key={bubble.id}>
          <span>{bubble.text}</span>
          <i className="mario-bubble-tail" />
        </div>
      )}

      {/* ── The command line ── */}
      <div className="mario-bar" aria-hidden={!open}>
        <div className="mario-bar-inner">
          {busy ? (
            <span className="mario-status">
              <span className="mario-status-text">working on {scope}</span>
              <span className="mario-status-dots"><i /><i /><i /></span>
            </span>
          ) : (
            <>
              <input
                ref={inputRef}
                className="mario-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); send(); }
                  if (e.key === 'Escape') { setText(''); e.currentTarget.blur(); }
                }}
                placeholder={`fix, change or write — ${scope}`}
                spellCheck={false}
              />
              <button
                className="mario-send"
                onClick={send}
                disabled={!text.trim()}
                title="Send (Enter)"
              >
                ▶
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Mario himself ── */}
      <div
        className="mario-char"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => { clearAutoFix(); setMarioOpen(false); }}
        title="Drag to move · double-click to send him back"
      >
        <span className="mario-shadow" />
        <span className="mario-sprite">
          <PixelSprite rows={frame} palette={AGENT_PAL} px={SPRITE_PX} />
        </span>
      </div>
    </div>
  );
};

export default MarioCompanion;

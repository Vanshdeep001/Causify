/* -------------------------------------------------------
 * XTermTab.jsx — Interactive Terminal Instance
 *
 * Renders a single xterm.js terminal connected to a real
 * PTY session in the Electron main process via IPC.
 *
 * Features:
 *   - Full ANSI color support (xterm-256color)
 *   - Auto-resize via FitAddon + ResizeObserver
 *   - Keystroke forwarding to PTY
 *   - PTY output rendering
 *   - Graceful cleanup on unmount
 * ------------------------------------------------------- */

import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import useEditorStore from '../../store/useEditorStore';
import { PixelSprite, COIN_ROWS, COIN_PAL, MARIO_ROWS, MARIO_PAL } from '../common/pixelArt';
import 'xterm/css/xterm.css';

/* ── WORLD 1-1 — the terminal as an 8-bit level ───────────────────────────
 *
 * Strictly black and white. The character is carried by everything except
 * colour: a VT320 typeface, a CRT surface, and Mario — the same sprite the git
 * history draws — standing in for the cursor.
 *
 * Working in monochrome is a real constraint rather than a coat of paint. A
 * colour terminal separates output by hue, so removing hue removes that
 * separation unless something takes its place. Here it is brightness: the
 * sixteen ANSI slots are a deliberate value ladder rather than sixteen greys
 * picked to look nice. See TERM_THEME.
 */
const TERM_THEME = {
  background: '#080808',
  foreground: '#E8E8E8',
  // Transparent: the cursor is drawn as a Mario sprite over the top instead.
  cursor: 'rgba(0,0,0,0)',
  cursorAccent: '#080808',
  selectionBackground: 'rgba(255, 255, 255, 0.22)',
  selectionForeground: '#FFFFFF',

  /* Monochrome, so meaning is carried by VALUE instead of hue.
   *
   * A colour terminal separates output by hue; strip the hue and that
   * separation vanishes unless something replaces it. So the sixteen slots are
   * laid out as a deliberate brightness ladder, brightest = most urgent:
   *
   *   errors      pure white   — the one thing that must interrupt you
   *   warnings    near white
   *   success     mid grey     — good news does not need to shout
   *   info/paths  darker grey
   *   comments    dimmest still readable
   *
   * npm and git output stays legible and still separates, just by weight of
   * light rather than by colour. */
  black: '#1C1C1C',
  red: '#FFFFFF',          // errors — brightest thing on screen
  green: '#B0B0B0',        // success
  yellow: '#DEDEDE',       // warnings
  blue: '#8A8A8A',         // paths, info
  magenta: '#9E9E9E',
  cyan: '#C4C4C4',
  white: '#E8E8E8',

  brightBlack: '#7E7E7E',  // comments and box-drawing — 4.9:1, the dimmest that still reads
  brightRed: '#FFFFFF',
  brightGreen: '#C8C8C8',
  brightYellow: '#F2F2F2',
  brightBlue: '#A6A6A6',
  brightMagenta: '#B8B8B8',
  brightCyan: '#DADADA',
  brightWhite: '#FFFFFF',
};

const TERM_OPTIONS = {
  theme: TERM_THEME,
  // VT323 — the DEC VT320 terminal face. Genuinely monospace and designed for
  // exactly this, so the retro look costs nothing structurally: the grid still
  // lines up. It renders small for its em, hence the larger size below.
  fontFamily: "'VT323', 'IBM Plex Mono', 'JetBrains Mono', monospace",
  fontSize: 17,
  fontWeight: '400',
  fontWeightBold: '600',
  // Looser than a code editor. Terminal output is scanned, not read line by
  // line, and the extra air is what makes a wall of log output parseable.
  // VT323 is tall and narrow, so it needs less leading than a normal mono face.
  lineHeight: 1.35,
  letterSpacing: 0.5,
  // Mario stands in for the cursor, so xterm's own is switched off rather than
  // left blinking invisibly underneath him.
  cursorBlink: false,
  cursorStyle: 'block',
  cursorWidth: 1,
  scrollback: 5000,
  allowProposedApi: true,
  allowTransparency: true,
  macOptionIsMeta: true,
  drawBoldTextInBrightColors: true,
};

const XTermTab = ({ ptyId: externalPtyId, onExit, cwd, isActive }) => {
  const containerRef = useRef(null);
  // The panel root — Mario is positioned against this.
  const rootRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);
  const ptyIdRef = useRef(externalPtyId || null);
  const cleanupFnsRef = useRef([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isExited, setIsExited] = useState(false);
  // Terminal grid, shown on the status strip. Set by the resize observer.
  const [dimensions, setDimensions] = useState(null);
  // Where to draw Mario. Tracked from xterm's own cursor element rather than
  // computed from row/column maths, so it stays right through scrolling,
  // resizing and reflow without duplicating xterm's layout logic.
  const [marioAt, setMarioAt] = useState(null);

  const pendingTerminalCommand = useEditorStore((s) => s.pendingTerminalCommand);
  const clearPendingTerminalCommand = useEditorStore((s) => s.clearPendingTerminalCommand);

  useEffect(() => {
    if (!containerRef.current) return;

    const api = window.electronAPI;
    if (!api || !api.createPty) {
      console.error('[XTermTab] electronAPI.createPty not available — not running in Electron');
      return;
    }

    // Create xterm.js instance
    const term = new Terminal(TERM_OPTIONS);
    const fitAddon = new FitAddon();
    /* Clicking a URL in output — the localhost address a dev server prints —
     * opens it in the real browser.
     *
     * The addon's default activation requires a modifier key on some platforms,
     * which is why a plain click appeared to do nothing. Handling it explicitly
     * makes a plain click work everywhere. window.open is the right call in both
     * environments: Electron's window-open handler routes it to the system
     * browser, and in a browser it opens a tab. */
    const webLinksAddon = new WebLinksAddon((event, uri) => {
      try {
        window.open(uri, '_blank', 'noopener,noreferrer');
      } catch (err) {
        console.error('[Terminal] Could not open link:', err.message);
      }
    });

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    /* Copy / paste.
     *
     * In a terminal Ctrl+C is SIGINT, so it cannot simply be rebound to copy —
     * that would take away the only way to stop a runaway process. The
     * convention every terminal settled on is: with text selected, Ctrl+C
     * copies; with nothing selected, it interrupts. That is what this does, and
     * it is why copying used to kill the command instead.
     *
     * Ctrl+Shift+C / Ctrl+Shift+V always copy and paste, for when you want to be
     * explicit. On macOS, Cmd+C / Cmd+V are never SIGINT so they always apply.
     */
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;

      const key = event.key.toLowerCase();
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const cmd = isMac && event.metaKey;
      const ctrl = event.ctrlKey;
      if (!cmd && !ctrl) return true;

      const copy = () => {
        const selection = term.getSelection();
        if (!selection) return false;
        navigator.clipboard.writeText(selection)
          .catch((err) => console.error('[Terminal] Copy failed:', err.message));
        term.clearSelection();
        return true;
      };

      const paste = () => {
        navigator.clipboard.readText()
          .then((text) => {
            if (text && ptyIdRef.current) api.writePty(ptyIdRef.current, text);
          })
          .catch((err) => console.error('[Terminal] Paste failed:', err.message));
      };

      // Copy if there is a selection; otherwise fall through, which is what
      // keeps plain Ctrl+C working as an interrupt.
      if (key === 'c') return !copy();

      if (key === 'v' && (cmd || ctrl)) {
        paste();
        return false;
      }

      return true;
    });

    term.open(containerRef.current);

    /* Mario stands where the cursor is.
     *
     * His position is read from xterm's own cursor element instead of being
     * calculated from row/column and cell size. That keeps him correct through
     * scrolling, resizing and reflow for free, rather than reimplementing —
     * and drifting from — xterm's layout.
     *
     * Coalesced into a single animation frame because onRender fires on every
     * output chunk, and a layout read per chunk would be felt during a build. */
    let cursorFrame = 0;
    const trackCursor = () => {
      if (cursorFrame) return;
      cursorFrame = requestAnimationFrame(() => {
        cursorFrame = 0;
        const root = rootRef.current;
        const cursorEl = containerRef.current?.querySelector('.xterm-cursor');
        if (!root || !cursorEl) { setMarioAt(null); return; }

        // Measured against the panel root, since that is what Mario is
        // positioned inside.
        const cell = cursorEl.getBoundingClientRect();
        const box = root.getBoundingClientRect();
        if (cell.width === 0 || cell.height === 0) { setMarioAt(null); return; }

        const next = { left: cell.left - box.left, top: cell.top - box.top, height: cell.height };
        setMarioAt((prev) =>
          prev && prev.left === next.left && prev.top === next.top && prev.height === next.height
            ? prev   // identical — skip the re-render
            : next
        );
      });
    };

    const renderDisposable = term.onRender(trackCursor);
    const cursorDisposable = term.onCursorMove(trackCursor);
    cleanupFnsRef.current.push(() => {
      if (cursorFrame) cancelAnimationFrame(cursorFrame);
      renderDisposable.dispose();
      cursorDisposable.dispose();
    });

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Start the PTY session
    const initPty = async () => {
      try {
        const { cols, rows } = term;
        const result = await api.createPty({
          cwd: cwd || undefined,
          cols,
          rows,
        });

        const ptyId = result.ptyId;
        ptyIdRef.current = ptyId;
        setIsConnected(true);

        // PTY output → xterm
        const unsubOutput = api.onPtyOutput(ptyId, (data) => {
          try {
            term.write(data);
          } catch {}
        });
        cleanupFnsRef.current.push(unsubOutput);

        // PTY exit
        const unsubExit = api.onPtyExit(ptyId, ({ exitCode }) => {
          setIsExited(true);
          setIsConnected(false);
          term.write(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`);
          if (onExit) onExit(ptyId, exitCode);
        });
        cleanupFnsRef.current.push(unsubExit);

        // xterm keystrokes → PTY
        const onDataDisposable = term.onData((data) => {
          api.writePty(ptyId, data);
        });
        cleanupFnsRef.current.push(() => onDataDisposable.dispose());

      } catch (err) {
        console.error('[XTermTab] Failed to create PTY:', err);
        term.write(`\x1b[31mFailed to start terminal: ${err.message}\x1b[0m\r\n`);
      }
    };

    // Fit BEFORE spawning: the PTY must start at the panel's real size.
    // Spawning at the default 80x24 and resizing afterwards makes ConPTY
    // repaint and strand the prompt in the middle of the screen.
    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch {}
      initPty();
    });

    // ResizeObserver for auto-fit
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (!fitAddonRef.current) return;
        try {
          fitAddonRef.current.fit();
          const { cols, rows } = term;
          if (cols > 0 && rows > 0) {
            // Surfaced on the status strip — the grid size is the one number a
            // terminal has, and it matters when output wraps unexpectedly.
            setDimensions((prev) =>
              prev && prev.cols === cols && prev.rows === rows ? prev : { cols, rows }
            );
          }
          if (ptyIdRef.current && cols > 0 && rows > 0) {
            api.resizePty(ptyIdRef.current, cols, rows);
          }
        } catch {}
      });
    });
    resizeObserver.observe(containerRef.current);

    // Cleanup on unmount
    return () => {
      resizeObserver.disconnect();

      // Unsubscribe all listeners
      for (const fn of cleanupFnsRef.current) {
        try { fn(); } catch {}
      }
      cleanupFnsRef.current = [];

      // Kill the PTY
      if (ptyIdRef.current) {
        api.killPty(ptyIdRef.current).catch(() => {});
      }

      // Dispose xterm
      try { term.dispose(); } catch {}
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, []); // Mount once

  // Trigger pending commands from the editor (runs only in the active tab)
  useEffect(() => {
    if (isConnected && isActive && pendingTerminalCommand) {
      // Small timeout to let terminal prompt print completely before sending command
      const timer = setTimeout(() => {
        if (ptyIdRef.current) {
          window.electronAPI.writePty(ptyIdRef.current, pendingTerminalCommand + '\r');
          clearPendingTerminalCommand();
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isConnected, isActive, pendingTerminalCommand, clearPendingTerminalCommand]);

  // Expose a clear method via ref if needed
  const handleClear = () => {
    if (termRef.current) {
      termRef.current.clear();
    }
  };

  // Shown on the status strip. The full path is rarely useful and rarely fits;
  // the folder you are actually in is what you check for.
  const cwdLabel = cwd ? String(cwd).replace(/[\\/]+$/, '').split(/[\\/]/).pop() : '~';
  const gridLabel = dimensions ? `${dimensions.cols}×${dimensions.rows}` : '—';

  const alive = isConnected && !isExited;

  return (
    <div className="sigbay" ref={rootRef}>
      {/* Brick wall the output sits against. Inert to the pointer. */}
      <div className="sigbay-rail" />

      {/* xterm owns this element's children — nothing of ours goes inside it. */}
      <div ref={containerRef} className="sigbay-screen" />

      {/* The cursor, drawn as the same Mario the git history uses. A sibling of
          the terminal rather than a child, so React and xterm never contend
          over the same DOM. Sized to the line height so he sits in the text. */}
      {marioAt && alive && (
        <div
          className="sigbay-mario"
          style={{ left: `${marioAt.left}px`, top: `${marioAt.top}px` }}
        >
          <PixelSprite
            rows={MARIO_ROWS}
            palette={MARIO_PAL}
            px={marioAt.height / MARIO_ROWS.length}
          />
        </div>
      )}

      {/* Scanlines sit above the glyphs — the screen is in front of the picture. */}
      <div className="sigbay-scanlines" />

      {/* Level HUD, laid out like the Super Mario Bros. status bar. */}
      <div className="sigbay-status">
        <span>
          <span className="sigbay-status-key">WORLD</span>&nbsp;
          <span className="sigbay-status-path">{cwdLabel}</span>
        </span>
        <span><span className="sigbay-status-key">SIZE</span>&nbsp;{gridLabel}</span>
        <span className={`sigbay-live ${alive ? '' : 'is-down'}`}>
          <PixelSprite
            rows={COIN_ROWS}
            palette={COIN_PAL}
            px={1.6}
            style={{ transformOrigin: 'center' }}
            className="sigbay-coin"
          />
          {isExited ? 'GAME OVER' : isConnected ? 'RUNNING' : 'LOADING'}
        </span>
      </div>

      {/* Connection status indicator */}
      {!isConnected && !isExited && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
          pointerEvents: 'none',
        }}>
          <div style={{
            width: '14px',
            height: '14px',
            border: '2px solid rgba(251, 208, 0, 0.18)',
            borderTopColor: '#FBD000',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
          <span style={{
            fontFamily: "'Silkscreen', 'IBM Plex Mono', monospace",
            fontSize: '0.5rem',
            color: '#FBD000',
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
          }}>
            Loading World
          </span>
        </div>
      )}
    </div>
  );
};

export default XTermTab;

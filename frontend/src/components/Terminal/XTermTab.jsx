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
import 'xterm/css/xterm.css';

/* ── Causify-themed xterm config ── */
const TERM_THEME = {
  background: '#0A0A0A',
  foreground: '#EDEDED',
  cursor: '#FFFFFF',
  cursorAccent: '#0A0A0A',
  selectionBackground: 'rgba(255, 255, 255, 0.18)',
  selectionForeground: '#FFFFFF',
  // ANSI colors — monochromatic palette with subtle differentiation
  black: '#0A0A0A',
  red: '#E5484D',
  green: '#3DD68C',
  yellow: '#FFB224',
  blue: '#6E9EFF',
  magenta: '#C084FC',
  cyan: '#67E8F9',
  white: '#EDEDED',
  brightBlack: '#484848',
  brightRed: '#FF6B6B',
  brightGreen: '#6EE7A8',
  brightYellow: '#FFD666',
  brightBlue: '#93B8FF',
  brightMagenta: '#D8B4FE',
  brightCyan: '#A5F3FC',
  brightWhite: '#FFFFFF',
};

const TERM_OPTIONS = {
  theme: TERM_THEME,
  fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
  fontSize: 13,
  fontWeight: '400',
  fontWeightBold: '700',
  lineHeight: 1.55,
  letterSpacing: 0,
  cursorBlink: true,
  cursorStyle: 'bar',
  cursorWidth: 2,
  scrollback: 5000,
  allowProposedApi: true,
  allowTransparency: true,
  macOptionIsMeta: true,
  drawBoldTextInBrightColors: true,
};

const XTermTab = ({ ptyId: externalPtyId, onExit, cwd, isActive }) => {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);
  const ptyIdRef = useRef(externalPtyId || null);
  const cleanupFnsRef = useRef([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isExited, setIsExited] = useState(false);

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
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);

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

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        background: '#0A0A0A',
        overflow: 'hidden',
      }}
    >
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          padding: '10px 0 0 14px',
        }}
      />

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
            border: '2px solid rgba(255, 255, 255, 0.15)',
            borderTopColor: '#FFFFFF',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
          <span style={{
            fontFamily: "var(--font-number, 'JetBrains Mono', monospace)",
            fontSize: '0.55rem',
            color: 'rgba(255, 255, 255, 0.4)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}>
            INITIALIZING SHELL
          </span>
        </div>
      )}
    </div>
  );
};

export default XTermTab;

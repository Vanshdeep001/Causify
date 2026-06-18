/* -------------------------------------------------------
 * XTermOutput.jsx — Read-only Terminal output renderer
 *
 * Renders program output using xterm.js for consistency
 * with the interactive terminal, with full support for ANSI 
 * colors, font styles, and selection.
 * ------------------------------------------------------- */

import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';

/* ── Causify-themed xterm config (matching XTermTab.jsx) ── */
const TERM_THEME = {
  background: '#0A0A0A',
  foreground: '#EDEDED',
  cursor: 'transparent', // Read-only, hide cursor
  selectionBackground: 'rgba(255, 255, 255, 0.18)',
  selectionForeground: '#FFFFFF',
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
  lineHeight: 1.4,
  letterSpacing: 0,
  cursorBlink: false,
  cursorStyle: 'underline',
  cursorWidth: 0,
  disableStdin: true, // Read-only
  scrollback: 10000,
  allowProposedApi: true,
  allowTransparency: true,
  drawBoldTextInBrightColors: true,
};

const XTermOutput = ({ output, error }) => {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);

  const normalizeNewlines = (str) => {
    if (!str) return '';
    return str.replace(/\r?\n/g, '\r\n');
  };

  useEffect(() => {
    if (!containerRef.current) return;

    // Create xterm.js instance
    const term = new Terminal(TERM_OPTIONS);
    const fitAddon = new FitAddon();

    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Initial fit
    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch {}
    });

    // Write initial output and error
    term.clear();
    if (output) {
      term.write(normalizeNewlines(output));
    }
    if (error) {
      if (output && !output.endsWith('\n')) {
        term.write('\r\n');
      }
      term.write(`\x1b[31m${normalizeNewlines(error)}\x1b[0m\r\n`);
    }

    // ResizeObserver for auto-fit
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (!fitAddonRef.current) return;
        try {
          fitAddonRef.current.fit();
        } catch {}
      });
    });
    resizeObserver.observe(containerRef.current);

    // Cleanup on unmount
    return () => {
      resizeObserver.disconnect();
      try { term.dispose(); } catch {}
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Update terminal content when output or error changes
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    term.clear();
    if (output) {
      term.write(normalizeNewlines(output));
    }
    if (error) {
      if (output && !output.endsWith('\n')) {
        term.write('\r\n');
      }
      term.write(`\x1b[31m${normalizeNewlines(error)}\x1b[0m\r\n`);
    }

    // Fit again just in case dimensions changed
    requestAnimationFrame(() => {
      if (fitAddonRef.current) {
        try { fitAddonRef.current.fit(); } catch {}
      }
    });
  }, [output, error]);

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
          padding: '8px 0 0 8px',
        }}
      />
    </div>
  );
};

export default XTermOutput;

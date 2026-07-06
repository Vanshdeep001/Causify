/* -------------------------------------------------------
 * EmptyEditorState.jsx — Super-Mario welcome screen
 *
 * "WELCOME TO CAUSIFY" on one line; beside it a pixel scene:
 * the character jumps, smashes the ?-block, the block bursts
 * into shards and two power-ups pop out — OPEN A FILE and
 * IMPORT PROJECT — which land as the two entry actions.
 *
 * Same pixel language as MarioLoader (crispEdges SVG rects).
 * ------------------------------------------------------- */

import React, { useEffect, useState } from 'react';
import useEditorStore from '../../store/useEditorStore';

const EmptyEditorState = ({ sidebarCollapsed = false }) => {
  const requestExplorerAction = useEditorStore((s) => s.requestExplorerAction);

  // Cards become clickable once they have landed
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 2100);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className={`empty-editor-state${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}>
      <style>{`
        .mst-row {
          display: flex;
          align-items: flex-end;
          justify-content: center;
          gap: clamp(10px, 1.2vw, 18px);
          flex-wrap: nowrap;
        }
        .mst-title {
          white-space: nowrap;
          font-size: clamp(1.8rem, 3.6vw, 3.2rem) !important;
          margin: 0 0 8px 0 !important;
          flex-shrink: 0;
        }

        /* ── Stage (just Mario + brick animation) ── */
        .mst-stage {
          position: relative;
          width: 72px;
          height: 160px;
          flex-shrink: 0;
        }

        /* ── Character: run-up squash, jump, land, then idle ── */
        .mst-mario {
          position: absolute;
          bottom: 4px;
          left: 4px;
          width: 64px; height: 64px;
          transform-origin: bottom center;
          animation: mst-jump 1.4s cubic-bezier(0.3, 0.5, 0.4, 1) 0.6s both;
        }
        @keyframes mst-jump {
          0%   { transform: translateY(0) scaleY(1) scaleX(1); }
          16%  { transform: translateY(0) scaleY(0.72) scaleX(1.25); }
          24%  { transform: translateY(0) scaleY(1.12) scaleX(0.9); }
          52%  { transform: translateY(-92px) scaleY(1.05) scaleX(1); }
          58%  { transform: translateY(-92px) scaleY(1) scaleX(1); }
          86%  { transform: translateY(0) scaleY(0.8) scaleX(1.18); }
          100% { transform: translateY(0) scaleY(1) scaleX(1); }
        }
        .mst-mario-inner {
          display: block; width: 100%; height: 100%;
          animation: mst-idle 3.2s ease-in-out 3.4s infinite;
          transform-origin: bottom center;
        }
        @keyframes mst-idle {
          0%, 100% { transform: scaleY(1); }
          50% { transform: scaleY(1.03); }
        }

        /* ── ?-block: bounce on hit, then shatter away ── */
        .mst-block {
          position: absolute;
          top: 0;
          left: 16px;
          width: 40px; height: 40px;
          animation: mst-block-hit 0.7s ease-out 1.2s both;
        }
        @keyframes mst-block-hit {
          0% { transform: translateY(0); }
          35% { transform: translateY(-12px); }
          70% { transform: translateY(3px); }
          100% { transform: translateY(0); }
        }
        .mst-block-q {
          position: absolute; inset: 0;
          animation: mst-block-gone 0.3s steps(2) 1.5s both;
        }
        @keyframes mst-block-gone {
          0% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.25); }
        }

        /* ── Brick shards ── */
        .mst-shard {
          position: absolute;
          top: 20px; left: 36px;
          background: #FFFFFF;
          opacity: 0;
        }
        .mst-s1 { width: 6px; height: 6px; animation: mst-sh1 1.2s cubic-bezier(0.2, 0.6, 0.6, 1) 1.5s both; }
        .mst-s2 { width: 5px; height: 5px; animation: mst-sh2 1.3s  cubic-bezier(0.2, 0.6, 0.6, 1) 1.5s both; }
        .mst-s3 { width: 4px; height: 4px; animation: mst-sh3 1.1s  cubic-bezier(0.2, 0.6, 0.6, 1) 1.5s both; }
        .mst-s4 { width: 6px; height: 6px; animation: mst-sh4 1.35s cubic-bezier(0.2, 0.6, 0.6, 1) 1.5s both; }
        .mst-s5 { width: 3px; height: 3px; animation: mst-sh5 1.0s  cubic-bezier(0.2, 0.6, 0.6, 1) 1.5s both; }
        .mst-s6 { width: 4px; height: 4px; animation: mst-sh6 1.3s  cubic-bezier(0.2, 0.6, 0.6, 1) 1.5s both; }
        @keyframes mst-sh1 { 0% { opacity: 1; transform: translate(0,0) rotate(0); } 55% { transform: translate(-44px,-52px) rotate(120deg); opacity: 1; } 100% { transform: translate(-62px,10px) rotate(260deg); opacity: 0; } }
        @keyframes mst-sh2 { 0% { opacity: 1; transform: translate(0,0) rotate(0); } 55% { transform: translate(46px,-48px) rotate(-140deg); opacity: 1; } 100% { transform: translate(66px,14px) rotate(-260deg); opacity: 0; } }
        @keyframes mst-sh3 { 0% { opacity: 1; transform: translate(0,0) rotate(0); } 55% { transform: translate(-20px,-64px) rotate(90deg); opacity: 1; } 100% { transform: translate(-30px,-6px) rotate(200deg); opacity: 0; } }
        @keyframes mst-sh4 { 0% { opacity: 1; transform: translate(0,0) rotate(0); } 55% { transform: translate(24px,-66px) rotate(-100deg); opacity: 1; } 100% { transform: translate(34px,-2px) rotate(-220deg); opacity: 0; } }
        @keyframes mst-sh5 { 0% { opacity: 1; transform: translate(0,0); } 60% { transform: translate(0,-76px); opacity: 1; } 100% { transform: translate(4px,-24px); opacity: 0; } }
        @keyframes mst-sh6 { 0% { opacity: 1; transform: translate(0,0) rotate(0); } 55% { transform: translate(-58px,-30px) rotate(160deg); opacity: 1; } 100% { transform: translate(-78px,26px) rotate(300deg); opacity: 0; } }

        /* ── Cards row: centered below the title ── */
        .mst-cards-row {
          display: flex;
          justify-content: center;
          align-items: flex-start;
          gap: 48px;
          margin-top: 24px;
        }

        /* ── Power-up cards ── */
        .mst-item {
          width: 112px;
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          pointer-events: none;
          opacity: 0;
        }
        .mst-item-left  { animation: mst-pop-in 1.0s cubic-bezier(0.34, 1.3, 0.5, 1) 1.8s both; }
        .mst-item-right { animation: mst-pop-in 1.0s cubic-bezier(0.34, 1.3, 0.5, 1) 2.1s both; }
        @keyframes mst-pop-in {
          0%   { opacity: 0; transform: scale(0.2) translateY(-40px); }
          40%  { opacity: 1; transform: scale(0.6) translateY(-20px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        .mst-cards-row.mst-ready .mst-item { pointer-events: auto; }

        .mst-item-inner {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 9px;
          transition: transform 0.16s ease;
        }
        .mst-item-left  .mst-item-inner { animation: mst-float 3.6s ease-in-out 2.3s infinite; }
        .mst-item-right .mst-item-inner { animation: mst-float 3.6s ease-in-out 2.8s infinite; }
        @keyframes mst-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
        .mst-cards-row.mst-ready .mst-item:hover .mst-item-inner { transform: translateY(-5px); animation-play-state: paused; }
        .mst-cards-row.mst-ready .mst-item:active .mst-item-inner { transform: translateY(-2px) scale(0.95); }

        .mst-item-box {
          width: 56px; height: 56px;
          display: flex; align-items: center; justify-content: center;
          transition: filter 0.16s ease;
        }
        .mst-cards-row.mst-ready .mst-item:hover .mst-item-box { filter: drop-shadow(0 0 10px rgba(255,255,255,0.45)); }

        .mst-item-label {
          font-family: 'Silkscreen', var(--font-number);
          font-size: 0.6rem;
          letter-spacing: 0.1em;
          color: var(--t2);
          white-space: nowrap;
          transition: color 0.16s ease;
        }
        .mst-item-sub {
          font-family: var(--font-number);
          font-size: 0.5rem;
          letter-spacing: 0.14em;
          color: var(--t4);
          white-space: nowrap;
          margin-top: -4px;
        }
        .mst-cards-row.mst-ready .mst-item:hover .mst-item-label { color: #FFFFFF; }
      `}</style>

      {/* Title + Mario/brick animation row */}
      <div className="mst-row">
        <h2 className="empty-editor-brand mst-title">Welcome to Causify</h2>

        <div className="mst-stage">
          {/* ?-block */}
          <div className="mst-block">
            <div className="mst-block-q">
              <svg width="40" height="40" viewBox="0 0 16 16" shapeRendering="crispEdges">
                <rect x="0" y="0" width="16" height="16" fill="none" stroke="#FFFFFF" strokeWidth="1" />
                <rect x="2" y="2" width="1" height="1" fill="#FFFFFF" />
                <rect x="13" y="2" width="1" height="1" fill="#FFFFFF" />
                <rect x="2" y="13" width="1" height="1" fill="#FFFFFF" />
                <rect x="13" y="13" width="1" height="1" fill="#FFFFFF" />
                <rect x="6" y="4" width="4" height="1" fill="#FFFFFF" />
                <rect x="5" y="5" width="2" height="1" fill="#FFFFFF" />
                <rect x="9" y="5" width="2" height="1" fill="#FFFFFF" />
                <rect x="8" y="6" width="2" height="2" fill="#FFFFFF" />
                <rect x="7" y="8" width="2" height="1" fill="#FFFFFF" />
                <rect x="7" y="10" width="2" height="2" fill="#FFFFFF" />
              </svg>
            </div>
          </div>

          {/* Brick shards */}
          <div className="mst-shard mst-s1" />
          <div className="mst-shard mst-s2" />
          <div className="mst-shard mst-s3" />
          <div className="mst-shard mst-s4" />
          <div className="mst-shard mst-s5" />
          <div className="mst-shard mst-s6" />

          {/* Character */}
          <div className="mst-mario">
            <span className="mst-mario-inner">
              <svg width="64" height="64" viewBox="0 0 16 16" shapeRendering="crispEdges">
                <rect x="4" y="4" width="8" height="8" fill="#FFFFFF" />
                <rect x="5" y="5" width="6" height="4" fill="var(--s0)" />
                <rect x="6" y="6" width="1" height="2" fill="#FFFFFF" />
                <rect x="9" y="6" width="1" height="2" fill="#FFFFFF" />
                <rect x="7" y="9" width="2" height="1" fill="#FFFFFF" />
                <rect x="3" y="3" width="10" height="1" fill="#FFFFFF" />
                <rect x="5" y="2" width="6" height="1" fill="#FFFFFF" />
                <rect x="4" y="12" width="2" height="2" fill="#FFFFFF" />
                <rect x="10" y="12" width="2" height="2" fill="#FFFFFF" />
              </svg>
            </span>
          </div>
        </div>
      </div>

      {/* Action cards — separate centered row */}
      <div className={`mst-cards-row${ready ? ' mst-ready' : ''}`}>
        {/* Power-up: CREATE A FILE — same flow as the workspace NEW FILE */}
        <button
          type="button"
          className="mst-item mst-item-left"
          onClick={() => requestExplorerAction('new-file')}
          aria-label="Create a new file"
          title="Create blank text buffer"
        >
          <span className="mst-item-inner">
            <span className="mst-item-box">
              <svg width="56" height="56" viewBox="0 0 16 16" shapeRendering="crispEdges">
                <rect x="0" y="0" width="16" height="16" fill="none" stroke="#FFFFFF" strokeWidth="1" />
                <rect x="2" y="2" width="1" height="1" fill="#FFFFFF" />
                <rect x="13" y="2" width="1" height="1" fill="#FFFFFF" />
                <rect x="2" y="13" width="1" height="1" fill="#FFFFFF" />
                <rect x="13" y="13" width="1" height="1" fill="#FFFFFF" />
                {/* pixel page with folded corner + plus */}
                <rect x="5" y="3" width="4" height="1" fill="#FFFFFF" />
                <rect x="5" y="4" width="1" height="9" fill="#FFFFFF" />
                <rect x="9" y="3" width="1" height="3" fill="#FFFFFF" />
                <rect x="9" y="5" width="2" height="1" fill="#FFFFFF" />
                <rect x="11" y="5" width="1" height="8" fill="#FFFFFF" />
                <rect x="5" y="12" width="7" height="1" fill="#FFFFFF" />
                <rect x="8" y="7" width="1" height="3" fill="#FFFFFF" />
                <rect x="7" y="8" width="3" height="1" fill="#FFFFFF" />
              </svg>
            </span>
            <span className="mst-item-label">CREATE A FILE</span>
            <span className="mst-item-sub">BLANK TEXT BUFFER</span>
          </span>
        </button>

        {/* Power-up: IMPORT PROJECT */}
        <button
          type="button"
          className="mst-item mst-item-right"
          onClick={() => requestExplorerAction('import-project')}
          aria-label="Import a project folder"
          title="Load a local repository folder"
        >
          <span className="mst-item-inner">
            <span className="mst-item-box">
              <svg width="56" height="56" viewBox="0 0 16 16" shapeRendering="crispEdges">
                <rect x="0" y="0" width="16" height="16" fill="none" stroke="#FFFFFF" strokeWidth="1" />
                <rect x="2" y="2" width="1" height="1" fill="#FFFFFF" />
                <rect x="13" y="2" width="1" height="1" fill="#FFFFFF" />
                <rect x="2" y="13" width="1" height="1" fill="#FFFFFF" />
                <rect x="13" y="13" width="1" height="1" fill="#FFFFFF" />
                {/* pixel folder */}
                <rect x="3" y="5" width="4" height="1" fill="#FFFFFF" />
                <rect x="7" y="6" width="6" height="1" fill="#FFFFFF" />
                <rect x="3" y="6" width="1" height="6" fill="#FFFFFF" />
                <rect x="12" y="7" width="1" height="5" fill="#FFFFFF" />
                <rect x="3" y="12" width="10" height="1" fill="#FFFFFF" />
                <rect x="6" y="9" width="4" height="1" fill="#FFFFFF" />
                <rect x="8" y="8" width="1" height="3" fill="#FFFFFF" opacity="0" />
              </svg>
            </span>
            <span className="mst-item-label">IMPORT PROJECT</span>
            <span className="mst-item-sub">CLONE OR LOAD A REPO</span>
          </span>
        </button>
      </div>
    </div>
  );
};

export default EmptyEditorState;

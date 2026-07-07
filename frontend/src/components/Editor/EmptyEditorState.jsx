/* -------------------------------------------------------
 * EmptyEditorState.jsx — Super-Mario welcome screen
 *
 * Centred scene: a ?-block sits at screen centre with Mario
 * standing far below. Mario crouches, leaps up to just
 * touch the bottom of the block, the block shatters, and
 * "WELCOME TO CAUSIFY" rises gently from inside it (like
 * a mushroom in Super Mario Bros). Mario then fades away,
 * leaving only the centred welcome message.
 * ------------------------------------------------------- */

import React from 'react';

const EmptyEditorState = ({ sidebarCollapsed = false }) => {
  return (
    <div className={`empty-editor-state${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}>
      <style>{`
        /* ── The whole scene: dead-centre of the viewport ── */
        .mst-scene {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          /* Only the msg-clip is in flow (70px tall).
             Block + Mario are absolute so they don't
             shift the text above viewport centre. */
        }

        /* ── Message that rises from the brick ──
           The clip wrapper sits above the brick, overflow hidden.
           The text starts fully pushed down (hidden) and slides
           up gently like a mushroom emerging from a ? block. */
        .mst-msg-clip {
          width: max-content;
          height: 70px;
          overflow: hidden;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          pointer-events: none;
        }
        .mst-msg-inner {
          transform: translateY(100%);
          animation: mst-msg-rise 1.4s cubic-bezier(0.16, 0.7, 0.3, 1) 1.8s forwards;
        }
        @keyframes mst-msg-rise {
          0%   { transform: translateY(100%); }
          100% { transform: translateY(0%); }
        }
        .mst-msg-inner h2 {
          font-family: 'Silkscreen', var(--font-number);
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          line-height: 1.2;
          font-size: clamp(1.6rem, 3.2vw, 2.6rem);
          margin: 0;
          padding: 0 12px 6px;
          color: transparent;
          -webkit-text-fill-color: transparent;
          -webkit-text-stroke: 1.5px rgba(237, 237, 237, 0.92);
          text-stroke: 1.5px rgba(237, 237, 237, 0.92);
          white-space: nowrap;
        }

        /* ── ?-block: absolutely positioned just below the msg-clip ── */
        .mst-block {
          position: absolute;
          top: 70px; /* flush with bottom of msg-clip */
          left: 50%;
          margin-left: -24px; /* half of 48px width */
          width: 48px;
          height: 48px;
          z-index: 2;
          animation: mst-block-bump 0.45s ease-out 1.25s both;
        }
        @keyframes mst-block-bump {
          0%   { transform: translateY(0); }
          28%  { transform: translateY(-12px); }
          55%  { transform: translateY(3px); }
          100% { transform: translateY(0); }
        }
        .mst-block-face {
          animation: mst-block-vanish 0.3s steps(2) 1.6s both;
        }
        @keyframes mst-block-vanish {
          0%   { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.3); }
        }

        /* ── Brick shards ── */
        .mst-shard {
          position: absolute;
          background: #FFFFFF;
          opacity: 0;
          z-index: 3;
          top: 50%; left: 50%;
        }
        .mst-sh1 { width:6px;height:6px; animation: mst-f1 1.0s cubic-bezier(.2,.6,.6,1) 1.6s both; }
        .mst-sh2 { width:5px;height:5px; animation: mst-f2 1.1s cubic-bezier(.2,.6,.6,1) 1.6s both; }
        .mst-sh3 { width:4px;height:4px; animation: mst-f3 .9s  cubic-bezier(.2,.6,.6,1) 1.6s both; }
        .mst-sh4 { width:6px;height:6px; animation: mst-f4 1.15s cubic-bezier(.2,.6,.6,1) 1.6s both; }
        .mst-sh5 { width:3px;height:3px; animation: mst-f5 .85s cubic-bezier(.2,.6,.6,1) 1.6s both; }
        .mst-sh6 { width:5px;height:5px; animation: mst-f6 1.05s cubic-bezier(.2,.6,.6,1) 1.6s both; }

        @keyframes mst-f1{0%{opacity:1;transform:translate(0,0) rotate(0)}50%{transform:translate(-50px,-58px) rotate(120deg);opacity:1}100%{transform:translate(-70px,12px) rotate(260deg);opacity:0}}
        @keyframes mst-f2{0%{opacity:1;transform:translate(0,0) rotate(0)}50%{transform:translate(52px,-54px) rotate(-140deg);opacity:1}100%{transform:translate(72px,16px) rotate(-260deg);opacity:0}}
        @keyframes mst-f3{0%{opacity:1;transform:translate(0,0) rotate(0)}50%{transform:translate(-22px,-72px) rotate(90deg);opacity:1}100%{transform:translate(-34px,-8px) rotate(200deg);opacity:0}}
        @keyframes mst-f4{0%{opacity:1;transform:translate(0,0) rotate(0)}50%{transform:translate(26px,-74px) rotate(-100deg);opacity:1}100%{transform:translate(38px,-4px) rotate(-220deg);opacity:0}}
        @keyframes mst-f5{0%{opacity:1;transform:translate(0,0)}55%{transform:translate(0,-82px);opacity:1}100%{transform:translate(6px,-28px);opacity:0}}
        @keyframes mst-f6{0%{opacity:1;transform:translate(0,0) rotate(0)}50%{transform:translate(-62px,-34px) rotate(160deg);opacity:1}100%{transform:translate(-82px,28px) rotate(300deg);opacity:0}}

        /* ── Mario: absolutely positioned below the block ── */
        .mst-mario {
          position: absolute;
          top: 198px; /* 70px msg-clip + 48px block + 80px gap */
          left: 50%;
          margin-left: -28px; /* half of 56px width */
          width: 56px;
          height: 56px;
          z-index: 1;
          transform-origin: bottom center;
          /* Jump: rises 124px (80px gap + 44px to reach brick bottom) */
          animation:
            mst-jump 1.3s cubic-bezier(.3,.5,.4,1) 0.5s both,
            mst-mario-gone 0.6s ease 2.4s forwards;
        }
        @keyframes mst-jump {
          0%   { transform: translateY(0) scaleY(1) scaleX(1); }
          12%  { transform: translateY(0) scaleY(0.68) scaleX(1.3); }
          20%  { transform: translateY(0) scaleY(1.15) scaleX(0.88); }
          48%  { transform: translateY(-124px) scaleY(1.04) scaleX(1); }
          54%  { transform: translateY(-124px) scaleY(0.92) scaleX(1.06); }
          82%  { transform: translateY(0) scaleY(0.76) scaleX(1.22); }
          100% { transform: translateY(0) scaleY(1) scaleX(1); }
        }
        /* Mario fades out after text emerges */
        @keyframes mst-mario-gone {
          0%   { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(10px) scale(0.7); }
        }

        .mst-mario-body {
          display: block; width: 100%; height: 100%;
          transform-origin: bottom center;
        }
      `}</style>

      <div className="mst-scene">
        {/* Message clip — text hidden inside, rises gently on cue */}
        <div className="mst-msg-clip">
          <div className="mst-msg-inner">
            <h2 className="empty-editor-brand">Welcome to Causify</h2>
          </div>
        </div>

        {/* ?-block — sits right below the message clip */}
        <div className="mst-block">
          <div className="mst-block-face">
            <svg width="48" height="48" viewBox="0 0 16 16" shapeRendering="crispEdges">
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
          {/* Brick shards */}
          <div className="mst-shard mst-sh1" />
          <div className="mst-shard mst-sh2" />
          <div className="mst-shard mst-sh3" />
          <div className="mst-shard mst-sh4" />
          <div className="mst-shard mst-sh5" />
          <div className="mst-shard mst-sh6" />
        </div>

        {/* Mario — 80px below the block */}
        <div className="mst-mario">
          <svg width="56" height="56" viewBox="0 0 16 16" shapeRendering="crispEdges">
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
        </div>
      </div>
    </div>
  );
};

export default EmptyEditorState;

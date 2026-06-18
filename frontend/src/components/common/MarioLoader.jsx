/* -------------------------------------------------------
 * MarioLoader.jsx — Retro pixel "jumping character" loader
 *
 * The same Mario-style animation used in the terminal output
 * (OutputPanel's scanning segment), extracted into a reusable
 * component. Renders a bouncing question block + jumping pixel
 * character with particle bursts, plus a title/subtitle.
 *
 * Props:
 *   - title:    bold heading (default "Loading")
 *   - subtitle: small uppercase telemetry line (optional)
 *   - overlay:  when true (default) fills its positioned parent
 *               with an absolute, opaque backdrop
 * ------------------------------------------------------- */

import React from 'react';

const MarioLoader = ({ title = 'Loading', subtitle = '', overlay = true }) => {
  const wrapperStyle = overlay
    ? {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1000,
      }
    : { position: 'relative', width: '100%', height: '100%' };

  return (
    <div
      style={{
        ...wrapperStyle,
        background: 'var(--s0)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        textAlign: 'center',
      }}
    >
      <style>{`
        @keyframes ml-character-jump {
          0%, 100% { transform: translateY(0) scaleY(1) scaleX(1); }
          20% { transform: translateY(0) scaleY(0.75) scaleX(1.25); }
          26% { transform: translateY(0) scaleY(1.15) scaleX(0.85); }
          50% { transform: translateY(-38px) scaleY(1) scaleX(1); }
          72% { transform: translateY(0) scaleY(1) scaleX(1); }
          76% { transform: translateY(0) scaleY(0.7) scaleX(1.3); }
          84% { transform: translateY(0) scaleY(1.05) scaleX(0.95); }
          90% { transform: translateY(0) scaleY(1) scaleX(1); }
        }
        @keyframes ml-block-bounce {
          0%, 48%, 62%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
          56% { transform: translateY(2px); }
        }
        @keyframes ml-particle-tl {
          0%, 49% { transform: translate(0, 0); opacity: 0; }
          50% { opacity: 1; }
          75% { transform: translate(-28px, -20px); opacity: 0; }
          100% { opacity: 0; }
        }
        @keyframes ml-particle-tr {
          0%, 49% { transform: translate(0, 0); opacity: 0; }
          50% { opacity: 1; }
          75% { transform: translate(28px, -20px); opacity: 0; }
          100% { opacity: 0; }
        }
        @keyframes ml-particle-bl {
          0%, 49% { transform: translate(0, 0); opacity: 0; }
          50% { opacity: 1; }
          75% { transform: translate(-20px, 16px); opacity: 0; }
          100% { opacity: 0; }
        }
        @keyframes ml-particle-br {
          0%, 49% { transform: translate(0, 0); opacity: 0; }
          50% { opacity: 1; }
          75% { transform: translate(20px, 16px); opacity: 0; }
          100% { opacity: 0; }
        }
        @keyframes ml-particle-top {
          0%, 49% { transform: translate(0, 0); opacity: 0; }
          50% { opacity: 1; }
          75% { transform: translate(0, -32px); opacity: 0; }
          100% { opacity: 0; }
        }
        .ml-pixel-particle { position: absolute; background: #FFFFFF; }
        .ml-p-tl { width: 4px; height: 4px; animation: ml-particle-tl 1.6s infinite; }
        .ml-p-tr { width: 5px; height: 5px; animation: ml-particle-tr 1.6s infinite; }
        .ml-p-bl { width: 3px; height: 3px; animation: ml-particle-bl 1.6s infinite; }
        .ml-p-br { width: 4px; height: 4px; animation: ml-particle-br 1.6s infinite; }
        .ml-p-top { width: 5px; height: 5px; animation: ml-particle-top 1.6s infinite; }
      `}</style>

      {/* Retro Animation Stage */}
      <div
        style={{
          position: 'relative',
          width: '180px',
          height: '140px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-end',
          marginBottom: '28px',
        }}
      >
        {/* Pixel Question Block */}
        <div
          style={{
            position: 'absolute',
            top: '16px',
            left: 'calc(50% - 20px)',
            width: '40px',
            height: '40px',
            animation: 'ml-block-bounce 1.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) infinite',
          }}
        >
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

        {/* Particles */}
        <div style={{ position: 'absolute', top: '36px', left: '50%', width: '0', height: '0' }}>
          <div className="ml-pixel-particle ml-p-tl" />
          <div className="ml-pixel-particle ml-p-tr" />
          <div className="ml-pixel-particle ml-p-bl" />
          <div className="ml-pixel-particle ml-p-br" />
          <div className="ml-pixel-particle ml-p-top" />
        </div>

        {/* Character */}
        <div
          style={{
            position: 'absolute',
            bottom: '0',
            left: 'calc(50% - 20px)',
            width: '40px',
            height: '40px',
            transformOrigin: 'bottom center',
            animation: 'ml-character-jump 1.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) infinite',
          }}
        >
          <svg width="40" height="40" viewBox="0 0 16 16" shapeRendering="crispEdges">
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

      {/* Platform under the character */}
      <div
        style={{
          width: '140px',
          height: '1px',
          background: '#FFFFFF',
          opacity: 0.15,
          marginTop: '-28px',
          marginBottom: '28px',
        }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <div
          style={{
            fontFamily: 'var(--font-header)',
            fontSize: '0.82rem',
            fontWeight: 900,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: '#FFFFFF',
            lineHeight: 1.2,
            marginBottom: subtitle ? '8px' : 0,
          }}
        >
          {title}
        </div>

        {subtitle && (
          <div
            style={{
              fontFamily: 'var(--font-number)',
              fontSize: '0.55rem',
              fontWeight: 500,
              color: 'var(--t2)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
            }}
          >
            <span style={{ color: 'var(--t4)' }}>▶</span> {subtitle}
          </div>
        )}
      </div>
    </div>
  );
};

export default MarioLoader;

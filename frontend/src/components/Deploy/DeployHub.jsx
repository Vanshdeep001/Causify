/* -------------------------------------------------------
 * DeployHub.jsx — Deploy HQ target switcher
 *
 * One deploy tab, two targets:
 *   FRONTEND — one-click Vercel deployment (DeployPanel)
 *   BACKEND  — one-click Render deployment (RenderDeployPanel)
 *
 * The active target lives in the store so it survives pane
 * remounts and is shared between split panes.
 * ------------------------------------------------------- */

import React, { useEffect } from 'react';
import useEditorStore from '../../store/useEditorStore';
import DeployPanel from './DeployPanel';
import RenderDeployPanel from './RenderDeployPanel';

const RENDER_MINT = '#46E3B7';
const VERCEL_BLUE = '#38BDF8';

const TargetButton = ({ active, accent, onClick, icon, title, caption }) => (
  <button
    onClick={onClick}
    style={{
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      padding: '8px 12px',
      background: 'transparent',
      border: 'none',
      borderBottom: `2px solid ${active ? accent : 'transparent'}`,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
    }}
    onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
  >
    <span style={{ display: 'flex', color: active ? accent : 'var(--t4)', transition: 'color 0.2s ease' }}>
      {icon}
    </span>
    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
      <span style={{
        fontFamily: "'Space Grotesk', sans-serif",
        fontSize: '0.62rem', fontWeight: 700,
        letterSpacing: '0.08em',
        color: active ? 'var(--t1)' : 'var(--t3)',
        transition: 'color 0.2s ease',
      }}>
        {title}
      </span>
      <span style={{
        fontFamily: 'var(--font-number)',
        fontSize: '0.48rem',
        letterSpacing: '0.06em',
        color: active ? accent : 'var(--t4)',
        transition: 'color 0.2s ease',
      }}>
        {caption}
      </span>
    </span>
  </button>
);

const DeployHub = () => {
  const deployTarget = useEditorStore((s) => s.deployTarget);
  const setDeployTarget = useEditorStore((s) => s.setDeployTarget);
  const pendingRedeploy = useEditorStore((s) => s.pendingRedeploy);

  // Redeploys triggered from the Timeline are Vercel redeploys — make sure
  // the frontend panel is mounted so it can pick the flag up.
  useEffect(() => {
    if (pendingRedeploy && deployTarget !== 'frontend') {
      setDeployTarget('frontend');
    }
  }, [pendingRedeploy, deployTarget, setDeployTarget]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--s0)' }}>

      {/* Target switcher */}
      <div style={{
        display: 'flex',
        flexShrink: 0,
        borderBottom: '1px solid var(--line)',
      }}>
        <TargetButton
          active={deployTarget === 'frontend'}
          accent={VERCEL_BLUE}
          onClick={() => setDeployTarget('frontend')}
          title="FRONTEND"
          caption="STATIC & WEB APPS · VERCEL"
          icon={(
            <svg width="12" height="12" viewBox="0 0 76 65" fill="currentColor">
              <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
            </svg>
          )}
        />
        <div style={{ width: '1px', background: 'var(--line)' }} />
        <TargetButton
          active={deployTarget === 'backend'}
          accent={RENDER_MINT}
          onClick={() => setDeployTarget('backend')}
          title="BACKEND"
          caption="APIS & SERVERS · RENDER"
          icon={(
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="8" rx="2" />
              <rect x="2" y="14" width="20" height="8" rx="2" />
              <line x1="6" y1="6" x2="6.01" y2="6" />
              <line x1="6" y1="18" x2="6.01" y2="18" />
            </svg>
          )}
        />
      </div>

      {/* Active panel */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {deployTarget === 'backend' ? <RenderDeployPanel /> : <DeployPanel />}
      </div>
    </div>
  );
};

export default DeployHub;

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

const VercelGlyph = (
  <svg width="15" height="13" viewBox="0 0 76 65" fill="currentColor">
    <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
  </svg>
);

const RenderGlyph = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2.5" y="3" width="19" height="7" rx="2" />
    <rect x="2.5" y="14" width="19" height="7" rx="2" />
    <line x1="6.5" y1="6.5" x2="6.51" y2="6.5" />
    <line x1="6.5" y1="17.5" x2="6.51" y2="17.5" />
  </svg>
);

const Segment = ({ active, accent, onClick, icon, name, provider }) => (
  <button
    onClick={onClick}
    aria-pressed={active}
    className={`dhub-seg${active ? ' is-active' : ''}`}
    style={{ '--dhub-accent': accent }}
  >
    <span className="dhub-seg-glyph">{icon}</span>
    <span className="dhub-seg-name">{name}</span>
    <span className="dhub-seg-provider">{provider}</span>
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

  const isBackend = deployTarget === 'backend';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--s0)' }}>

      {/* Target switcher — segmented control with a sliding thumb */}
      <div className="dhub-switcher">
        <div className="dhub-track">
          <div
            className="dhub-thumb"
            style={{
              '--dhub-accent': isBackend ? RENDER_MINT : VERCEL_BLUE,
              transform: isBackend ? 'translateX(100%)' : 'translateX(0)',
            }}
          />

          <Segment
            active={!isBackend}
            accent={VERCEL_BLUE}
            onClick={() => setDeployTarget('frontend')}
            name="FRONTEND"
            provider="VERCEL"
            icon={VercelGlyph}
          />
          <Segment
            active={isBackend}
            accent={RENDER_MINT}
            onClick={() => setDeployTarget('backend')}
            name="BACKEND"
            provider="RENDER"
            icon={RenderGlyph}
          />
        </div>
      </div>

      {/* Active panel */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {isBackend ? <RenderDeployPanel /> : <DeployPanel />}
      </div>
    </div>
  );
};

export default DeployHub;

/* -------------------------------------------------------
 * ImpactWarningBanner.jsx — Cross-File Impact Warning UI
 *
 * Appears above the editor when a change in one file
 * breaks references in other files. Shows affected files,
 * predicted errors, and a one-click REVERT button.
 *
 * Follows the Neo-Brutalist design system.
 * ------------------------------------------------------- */

import React, { useState } from 'react';
import useEditorStore from '../../store/useEditorStore';

const ImpactWarningBanner = () => {
  const impactWarnings = useEditorStore((s) => s.impactWarnings);
  const dismissImpactWarning = useEditorStore((s) => s.dismissImpactWarning);
  const revertChange = useEditorStore((s) => s.revertChange);
  const [expanded, setExpanded] = useState(null); // warningId

  // Show only the latest warning
  const warning = impactWarnings.length > 0 ? impactWarnings[impactWarnings.length - 1] : null;

  // No auto-dismiss — user must explicitly click REVERT or KEEP

  if (!warning) return null;

  const { impacts, changedBy, changedPath, summary } = warning;
  const errorImpacts = impacts.filter(i => i.severity === 'error');
  const warningImpacts = impacts.filter(i => i.severity === 'warning');
  const isExpanded = expanded === warning.id;
  const fileName = changedPath.split('/').pop();

  return (
    <div style={{
      background: '#080808',
      border: '3px solid #ff3e3e',
      borderBottom: 'none',
      padding: '0',
      fontFamily: 'var(--font-body)',
      position: 'relative',
      zIndex: 50,
      boxShadow: '0 4px 0 #ff3e3e',
      animation: 'impact-slide-in 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
    }}>

      {/* ── Top accent bar ── */}
      <div style={{
        height: '3px',
        background: errorImpacts.length > 0
          ? 'linear-gradient(90deg, #ff3e3e, #ff6b35, #ff3e3e)'
          : 'linear-gradient(90deg, #ffc107, #ff9800, #ffc107)',
        animation: 'impact-pulse 2s ease-in-out infinite',
      }} />

      {/* ── Main banner content ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', gap: '12px',
      }}>

        {/* Left: Icon + Message */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
          {/* Pulsing icon */}
          <div style={{
            width: '32px', height: '32px', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: errorImpacts.length > 0 ? 'rgba(255,62,62,0.2)' : 'rgba(255,193,7,0.2)',
            border: `2px solid ${errorImpacts.length > 0 ? '#ff3e3e' : '#ffc107'}`,
            fontFamily: 'var(--font-header)',
            fontSize: '1rem',
            animation: 'impact-icon-pulse 1.5s ease-in-out infinite',
          }}>
            ⚠️
          </div>

          {/* Text */}
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontFamily: 'var(--font-header)', fontWeight: 900,
              fontSize: '0.7rem', letterSpacing: '0.08em',
              color: errorImpacts.length > 0 ? '#ff3e3e' : '#ffc107',
              marginBottom: '2px',
            }}>
              {errorImpacts.length > 0 ? 'CROSS-FILE ERROR DETECTED' : 'CROSS-FILE WARNING'}
            </div>
            <div style={{
              fontSize: '0.72rem', color: '#ccc',
              fontFamily: 'var(--font-body)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              A change to{' '}
              <strong style={{ color: '#fff' }}>{fileName}</strong>
              {' '}by <strong style={{ color: '#fff' }}>{changedBy}</strong>{' '}{summary}
            </div>
          </div>
        </div>

        {/* Right: Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {/* Expand/Collapse details */}
          <button
            onClick={() => setExpanded(isExpanded ? null : warning.id)}
            style={{
              background: 'transparent', border: '1.5px solid #555',
              color: '#aaa', padding: '5px 12px',
              fontFamily: 'var(--font-number)', fontWeight: 700,
              fontSize: '0.6rem', cursor: 'pointer',
              letterSpacing: '0.06em',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#fff'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#555'; e.currentTarget.style.color = '#aaa'; }}
          >
            {isExpanded ? 'HIDE' : 'DETAILS'}
          </button>

          {/* Revert button */}
          <button
            onClick={() => revertChange(warning.id)}
            style={{
              background: '#ff3e3e', border: '2px solid #080808',
              color: '#fff', padding: '5px 14px',
              fontFamily: 'var(--font-header)', fontWeight: 900,
              fontSize: '0.65rem', cursor: 'pointer',
              letterSpacing: '0.06em',
              boxShadow: '3px 3px 0 #080808',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translate(-1px,-1px)'; e.currentTarget.style.boxShadow = '4px 4px 0 #080808'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '3px 3px 0 #080808'; }}
          >
            ↩ REVERT
          </button>

          {/* Keep (accept the change) */}
          <button
            onClick={() => dismissImpactWarning(warning.id)}
            style={{
              background: '#222', border: '2px solid #080808',
              color: '#aaa', padding: '5px 14px',
              fontFamily: 'var(--font-header)', fontWeight: 900,
              fontSize: '0.65rem', cursor: 'pointer',
              letterSpacing: '0.06em',
              boxShadow: '3px 3px 0 #080808',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translate(-1px,-1px)'; e.currentTarget.style.boxShadow = '4px 4px 0 #080808'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '3px 3px 0 #080808'; e.currentTarget.style.color = '#aaa'; }}
          >
            ✓ KEEP
          </button>
        </div>
      </div>

      {/* ── Expanded details panel ── */}
      {isExpanded && (
        <div style={{
          borderTop: '1px solid #333',
          padding: '12px 16px',
          maxHeight: '200px', overflowY: 'auto',
        }}>
          {impacts.map((impact, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: '10px',
              padding: '6px 0',
              borderBottom: i < impacts.length - 1 ? '1px solid #222' : 'none',
            }}>
              {/* Severity badge */}
              <span style={{
                flexShrink: 0, padding: '2px 8px',
                fontFamily: 'var(--font-number)', fontWeight: 900,
                fontSize: '0.55rem', letterSpacing: '0.08em',
                background: impact.severity === 'error' ? 'rgba(255,62,62,0.2)' : 'rgba(255,193,7,0.2)',
                color: impact.severity === 'error' ? '#ff3e3e' : '#ffc107',
                border: `1px solid ${impact.severity === 'error' ? '#ff3e3e' : '#ffc107'}`,
              }}>
                {impact.severity === 'error' ? 'ERROR' : 'WARN'}
              </span>

              {/* Details */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: '0.68rem', color: '#ddd',
                  fontFamily: 'var(--font-body)',
                }}>
                  {impact.description}
                </div>
                <div style={{
                  fontSize: '0.6rem', color: '#888',
                  fontFamily: 'var(--font-number)',
                  marginTop: '3px',
                  fontStyle: 'italic',
                }}>
                  ➜ {impact.predictedError}
                </div>
              </div>

              {/* Affected file */}
              <span style={{
                flexShrink: 0, padding: '2px 8px',
                fontFamily: 'var(--font-number)', fontWeight: 700,
                fontSize: '0.55rem', color: '#6366f1',
                background: 'rgba(99,102,241,0.1)',
                border: '1px solid rgba(99,102,241,0.3)',
              }}>
                {impact.file.split('/').pop()}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Animations ── */}
      <style>{`
        @keyframes impact-slide-in {
          from { transform: translateY(-100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes impact-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        @keyframes impact-icon-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
      `}</style>
    </div>
  );
};

export default ImpactWarningBanner;

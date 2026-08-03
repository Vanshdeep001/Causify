/* -------------------------------------------------------
 * ImpactWarningBanner.jsx — Cross-File Impact Warning UI
 *
 * Appears above the editor when someone else's change breaks a
 * reference in the file you have open. Offers a one-click revert.
 *
 * Visually restrained on purpose. This sits on screen until it is
 * answered, directly above the code someone is trying to read, so it
 * has to hold attention without competing with the editor for it.
 * Severity is carried by a single accent edge and the label colour
 * rather than by framing the whole thing in red — and nothing pulses,
 * because motion that never stops stops being information.
 * ------------------------------------------------------- */

import React, { useState } from 'react';
import useEditorStore from '../../store/useEditorStore';

const WarningIcon = ({ color }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const ImpactWarningBanner = () => {
  const impactWarnings = useEditorStore((s) => s.impactWarnings);
  const dismissImpactWarning = useEditorStore((s) => s.dismissImpactWarning);
  const revertChange = useEditorStore((s) => s.revertChange);
  const [expanded, setExpanded] = useState(null); // warningId

  // Show only the latest warning; older ones are counted, not stacked.
  const warning = impactWarnings.length > 0 ? impactWarnings[impactWarnings.length - 1] : null;
  if (!warning) return null;

  const { impacts, changedBy, changedPath } = warning;
  const errorCount = impacts.filter((i) => i.severity === 'error').length;
  const warnCount = impacts.length - errorCount;
  const isError = errorCount > 0;
  const isExpanded = expanded === warning.id;

  const accent = isError ? 'var(--crimson)' : 'var(--amber)';
  const fileName = changedPath.split('/').pop();
  const olderCount = impactWarnings.length - 1;

  /* "1 error and 2 warnings" — assembled here rather than reusing the
   * analyzer's summary string, whose wording was written for a sentence
   * that started differently and read as a capital mid-line. */
  const counts = [
    errorCount > 0 ? `${errorCount} error${errorCount > 1 ? 's' : ''}` : null,
    warnCount > 0 ? `${warnCount} warning${warnCount > 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(' · ');

  const affected = [...new Set(impacts.map((i) => i.file.split('/').pop()))];

  const ghostButton = {
    background: 'transparent',
    border: '1px solid var(--line-strong)',
    borderRadius: '4px',
    color: 'var(--t3)',
    padding: '5px 11px',
    fontFamily: 'var(--font-number)',
    fontWeight: 600,
    fontSize: '0.58rem',
    letterSpacing: '0.07em',
    cursor: 'pointer',
    transition: 'color 0.12s ease, border-color 0.12s ease, background 0.12s ease',
    whiteSpace: 'nowrap',
  };

  const hoverGhost = (e, on) => {
    e.currentTarget.style.color = on ? 'var(--t1)' : 'var(--t3)';
    e.currentTarget.style.borderColor = on ? 'var(--line-strong)' : 'var(--line-strong)';
    e.currentTarget.style.background = on ? 'rgba(255,255,255,0.05)' : 'transparent';
  };

  return (
    <div
      style={{
        margin: '8px 10px 0',
        background: 'var(--bg-paper)',
        border: '1px solid var(--line-strong)',
        borderLeft: `2px solid ${accent}`,
        borderRadius: '6px',
        fontFamily: 'var(--font-body)',
        position: 'relative',
        zIndex: 50,
        overflow: 'hidden',
        animation: 'impact-in 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* ── Header row ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '10px 12px',
      }}>
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          <WarningIcon color={accent} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '3px',
          }}>
            <span style={{
              fontFamily: 'var(--font-header)',
              fontWeight: 700,
              fontSize: '0.6rem',
              letterSpacing: '0.1em',
              color: accent,
            }}>
              {isError ? 'CROSS-FILE ERROR' : 'CROSS-FILE WARNING'}
            </span>

            {olderCount > 0 && (
              <span style={{
                fontFamily: 'var(--font-number)',
                fontSize: '0.52rem',
                color: 'var(--t3)',
                border: '1px solid var(--line)',
                borderRadius: '3px',
                padding: '1px 5px',
              }}>
                +{olderCount} EARLIER
              </span>
            )}
          </div>

          <div style={{
            fontSize: '0.7rem',
            color: 'var(--t2)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            lineHeight: 1.45,
          }}>
            <strong style={{ color: 'var(--t1)', fontWeight: 600 }}>{changedBy}</strong>
            {' changed '}
            <span style={{ color: 'var(--t1)', fontFamily: 'var(--font-number)' }}>{fileName}</span>
            <span style={{ color: 'var(--line-strong)', margin: '0 7px' }}>│</span>
            <span style={{ color: accent }}>{counts}</span>
            {' in '}
            <span style={{ color: 'var(--t1)', fontFamily: 'var(--font-number)' }}>
              {affected.join(', ')}
            </span>
          </div>
        </div>

        {/* ── Actions ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <button
            onClick={() => setExpanded(isExpanded ? null : warning.id)}
            style={ghostButton}
            onMouseEnter={(e) => hoverGhost(e, true)}
            onMouseLeave={(e) => hoverGhost(e, false)}
          >
            {isExpanded ? 'HIDE' : 'DETAILS'}
          </button>

          {/* The corrective action, tinted rather than filled — it undoes
              someone else's work, so it should read as deliberate. */}
          <button
            onClick={() => revertChange(warning.id)}
            style={{
              ...ghostButton,
              color: accent,
              borderColor: isError ? 'rgba(229,72,77,0.45)' : 'rgba(255,178,36,0.45)',
              background: isError ? 'var(--crimson-dim)' : 'rgba(255,178,36,0.10)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = isError ? 'rgba(229,72,77,0.20)' : 'rgba(255,178,36,0.20)';
              e.currentTarget.style.borderColor = accent;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = isError ? 'var(--crimson-dim)' : 'rgba(255,178,36,0.10)';
              e.currentTarget.style.borderColor = isError ? 'rgba(229,72,77,0.45)' : 'rgba(255,178,36,0.45)';
            }}
          >
            REVERT
          </button>

          <button
            onClick={() => dismissImpactWarning(warning.id)}
            style={{ ...ghostButton, color: 'var(--t2)' }}
            onMouseEnter={(e) => hoverGhost(e, true)}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--t2)'; e.currentTarget.style.background = 'transparent'; }}
          >
            KEEP
          </button>
        </div>
      </div>

      {/* ── Details ── */}
      {isExpanded && (
        <div style={{
          borderTop: '1px solid var(--line)',
          background: 'var(--bg-creme)',
          maxHeight: '190px',
          overflowY: 'auto',
        }}>
          {impacts.map((impact, i) => {
            const rowAccent = impact.severity === 'error' ? 'var(--crimson)' : 'var(--amber)';
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '9px 12px',
                  borderBottom: i < impacts.length - 1 ? '1px solid var(--line-faint)' : 'none',
                }}
              >
                <span style={{
                  flexShrink: 0,
                  marginTop: '1px',
                  width: '38px',
                  textAlign: 'center',
                  padding: '2px 0',
                  fontFamily: 'var(--font-number)',
                  fontWeight: 700,
                  fontSize: '0.5rem',
                  letterSpacing: '0.06em',
                  color: rowAccent,
                  border: `1px solid ${impact.severity === 'error' ? 'rgba(229,72,77,0.35)' : 'rgba(255,178,36,0.35)'}`,
                  borderRadius: '3px',
                }}>
                  {impact.severity === 'error' ? 'ERR' : 'WARN'}
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--t1)', lineHeight: 1.45 }}>
                    {impact.description}
                  </div>
                  <div style={{
                    fontSize: '0.6rem',
                    color: 'var(--t3)',
                    fontFamily: 'var(--font-number)',
                    marginTop: '4px',
                    lineHeight: 1.4,
                    wordBreak: 'break-word',
                  }}>
                    {impact.predictedError}
                  </div>
                </div>

                <span style={{
                  flexShrink: 0,
                  padding: '2px 7px',
                  fontFamily: 'var(--font-number)',
                  fontSize: '0.54rem',
                  color: 'var(--t2)',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--line)',
                  borderRadius: '3px',
                }}>
                  {impact.file.split('/').pop()}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @keyframes impact-in {
          from { transform: translateY(-6px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default ImpactWarningBanner;

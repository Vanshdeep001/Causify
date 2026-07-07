/* -------------------------------------------------------
 * WebRootConfirmModal.jsx — Deploy Folder Selection
 *
 * Shown when several distinct deployable frontends are
 * detected in the session. The user picks which folder
 * becomes the Vercel deploy root — only its contents are
 * uploaded; everything else is left out of the deploy.
 * ------------------------------------------------------- */

import React, { useState } from 'react';

const VERCEL_BLUE = '#38BDF8';

const WebRootConfirmModal = ({ candidates = [], onConfirm, onCancel }) => {
  const [selected, setSelected] = useState(0);

  const displayDir = (dir) => (dir === '.' ? './ (project root)' : `${dir}/`);

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      animation: 'fadeIn 0.2s ease-out',
    }}>
      <div style={{
        width: '480px',
        maxHeight: '80vh',
        background: 'var(--s1)',
        border: '1px solid var(--line-strong)',
        borderRadius: '6px',
        display: 'flex',
        flexDirection: 'column',
        animation: 'slide-up 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>

        {/* Header */}
        <div style={{
          padding: '24px 28px 16px',
          borderBottom: '1px solid var(--line)',
        }}>
          <h2 style={{
            fontFamily: 'var(--font-header)',
            fontSize: '0.95rem',
            fontWeight: 900,
            letterSpacing: '0.04em',
            margin: 0,
            color: 'var(--t1)',
          }}>
            SELECT DEPLOY FOLDER
          </h2>
          <div style={{
            fontFamily: 'var(--font-number)',
            fontSize: '0.56rem',
            color: 'var(--t3)',
            marginTop: '6px',
            letterSpacing: '0.04em',
            lineHeight: 1.5,
          }}>
            {candidates.length} deployable frontends were found in this session.
            Choose which folder to upload — <span style={{ color: VERCEL_BLUE, fontWeight: 700 }}>only its contents</span> become
            the Vercel deploy root; everything outside it stays local.
          </div>
        </div>

        {/* Candidate list */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '14px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}>
          {candidates.map((c, idx) => {
            const isSelected = selected === idx;
            return (
              <div
                key={c.dir}
                onClick={() => setSelected(idx)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 14px',
                  borderRadius: '5px',
                  border: `1px solid ${isSelected ? VERCEL_BLUE : 'var(--line)'}`,
                  background: isSelected ? 'rgba(56, 189, 248, 0.06)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s ease, background 0.15s ease',
                }}
              >
                {/* Radio dot */}
                <span style={{
                  width: '12px', height: '12px',
                  borderRadius: '50%',
                  flexShrink: 0,
                  border: `1.5px solid ${isSelected ? VERCEL_BLUE : 'var(--t4)'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'border-color 0.15s ease',
                }}>
                  {isSelected && (
                    <span style={{
                      width: '5px', height: '5px',
                      borderRadius: '50%',
                      background: VERCEL_BLUE,
                    }} />
                  )}
                </span>

                {/* Folder path */}
                <span style={{
                  fontFamily: 'var(--font-code)',
                  fontSize: '0.78rem',
                  color: isSelected ? 'var(--t1)' : 'var(--t2)',
                  fontWeight: isSelected ? 600 : 400,
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {displayDir(c.dir)}
                </span>

                {/* Framework / static tag */}
                <span style={{
                  fontFamily: 'var(--font-number)',
                  fontSize: '0.52rem',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: c.framework ? VERCEL_BLUE : 'var(--t3)',
                  border: `1px solid ${c.framework ? 'rgba(56, 189, 248, 0.35)' : 'var(--line)'}`,
                  borderRadius: '3px',
                  padding: '2px 6px',
                  flexShrink: 0,
                }}>
                  {c.label || (c.framework ? 'Framework' : 'Static')}
                </span>

                {/* File count */}
                <span style={{
                  fontFamily: 'var(--font-number)',
                  fontSize: '0.56rem',
                  color: 'var(--t4)',
                  letterSpacing: '0.04em',
                  flexShrink: 0,
                }}>
                  {c.fileCount} file{c.fileCount === 1 ? '' : 's'}
                </span>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 28px 20px',
          borderTop: '1px solid var(--line)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <button
            onClick={() => onCancel?.()}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--t3)',
              fontFamily: 'var(--font-number)',
              fontSize: '0.62rem',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              padding: '8px 0',
            }}
          >
            Cancel
          </button>

          <button
            onClick={() => onConfirm?.(candidates[selected]?.dir)}
            style={{
              background: VERCEL_BLUE,
              border: 'none',
              borderRadius: '4px',
              color: '#000000',
              fontFamily: 'var(--font-header)',
              fontSize: '0.66rem',
              fontWeight: 900,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              padding: '10px 18px',
              cursor: 'pointer',
              boxShadow: '0 3px 10px rgba(56, 189, 248, 0.25)',
            }}
          >
            Deploy This Folder
          </button>
        </div>
      </div>
    </div>
  );
};

export default WebRootConfirmModal;

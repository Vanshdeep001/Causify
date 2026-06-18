/* -------------------------------------------------------
 * LinkToCodeModal.jsx — Modal to Link Canvas Element to Code
 * ------------------------------------------------------- */

import React, { useState, useEffect } from 'react';
import useEditorStore from '../../store/useEditorStore';

const LinkToCodeModal = ({ isOpen, onClose, onSave, initialData }) => {
  const files = useEditorStore((s) => s.files);
  const causalityGraph = useEditorStore((s) => s.causalityGraph);

  const filePaths = Object.keys(files || {});
  const graphNodes = causalityGraph?.nodes || [];

  const [linkType, setLinkType] = useState('file'); // 'file' | 'fileRange' | 'graphNode'
  const [filePath, setFilePath] = useState('');
  const [startLine, setStartLine] = useState(1);
  const [endLine, setEndLine] = useState(1);
  const [graphNodeId, setGraphNodeId] = useState('');

  // Load initial data if editing
  useEffect(() => {
    if (isOpen) {
      setLinkType(initialData?.linkType || 'file');
      setFilePath(initialData?.filePath || filePaths[0] || '');
      setStartLine(initialData?.startLine || 1);
      setEndLine(initialData?.endLine || 1);
      setGraphNodeId(initialData?.graphNodeId || (graphNodes[0]?.id || ''));
    }
  }, [isOpen, initialData]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const result = { linkType };
    if (linkType === 'file') {
      result.filePath = filePath;
    } else if (linkType === 'fileRange') {
      result.filePath = filePath;
      result.startLine = parseInt(startLine, 10) || 1;
      result.endLine = parseInt(endLine, 10) || 1;
    } else if (linkType === 'graphNode') {
      result.graphNodeId = graphNodeId;
    }
    onSave(result);
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 20000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      animation: 'fadeIn 0.2s ease-out',
      padding: '24px',
    }}>
      <div style={{
        background: 'rgba(20, 20, 20, 0.85)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '16px',
        padding: '24px',
        width: '100%',
        maxWidth: '440px',
        boxShadow: '0 10px 40px rgba(0, 0, 0, 0.6)',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        animation: 'slideUp 0.2s ease-out',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 700,
            fontSize: '16px',
            color: '#EDEDED',
            letterSpacing: '0.02em',
          }}>
            Link to codebase element
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#6E6E6E',
              cursor: 'pointer',
              fontSize: '18px',
              padding: '4px',
            }}
          >
            &times;
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          {/* Link Type Selector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '11px', color: 'var(--t3)', fontFamily: "'JetBrains Mono', monospace" }}>
              LINK TYPE
            </label>
            <div style={{ display: 'flex', gap: '8px', background: 'var(--s2)', padding: '3px', borderRadius: '8px', border: '1px solid var(--line)' }}>
              {[
                { id: 'file', label: 'File' },
                { id: 'fileRange', label: 'Line Range' },
                { id: 'graphNode', label: 'Graph Node' }
              ].map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setLinkType(opt.id)}
                  style={{
                    flex: 1,
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: linkType === opt.id ? 'var(--s4)' : 'transparent',
                    color: linkType === opt.id ? 'var(--t1)' : 'var(--t3)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Conditional Inputs */}
          {linkType !== 'graphNode' ? (
            <>
              {/* File Selection */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '11px', color: 'var(--t3)', fontFamily: "'JetBrains Mono', monospace" }}>
                  SELECT FILE
                </label>
                <select
                  value={filePath}
                  onChange={(e) => setFilePath(e.target.value)}
                  style={{
                    background: 'var(--s2)',
                    border: '1px solid var(--line)',
                    borderRadius: '8px',
                    color: 'var(--t1)',
                    padding: '8px 12px',
                    fontSize: '12px',
                    fontFamily: "'JetBrains Mono', monospace",
                    width: '100%',
                    outline: 'none',
                  }}
                >
                  {filePaths.length === 0 ? (
                    <option value="">No files in workspace</option>
                  ) : (
                    filePaths.map(p => (
                      <option key={p} value={p}>{p.split('/').pop()} ({p})</option>
                    ))
                  )}
                </select>
              </div>

              {/* Line Range */}
              {linkType === 'fileRange' && (
                <div style={{ display: 'flex', gap: '12px' }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--t3)', fontFamily: "'JetBrains Mono', monospace" }}>
                      START LINE
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={startLine}
                      onChange={(e) => setStartLine(parseInt(e.target.value, 10) || 1)}
                      style={{
                        background: 'var(--s2)',
                        border: '1px solid var(--line)',
                        borderRadius: '8px',
                        color: 'var(--t1)',
                        padding: '8px 12px',
                        fontSize: '12px',
                        outline: 'none',
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    />
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--t3)', fontFamily: "'JetBrains Mono', monospace" }}>
                      END LINE
                    </label>
                    <input
                      type="number"
                      min={startLine}
                      value={endLine}
                      onChange={(e) => setEndLine(parseInt(e.target.value, 10) || 1)}
                      style={{
                        background: 'var(--s2)',
                        border: '1px solid var(--line)',
                        borderRadius: '8px',
                        color: 'var(--t1)',
                        padding: '8px 12px',
                        fontSize: '12px',
                        outline: 'none',
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    />
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Graph Node Selection */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '11px', color: 'var(--t3)', fontFamily: "'JetBrains Mono', monospace" }}>
                SELECT GRAPH NODE
              </label>
              {graphNodes.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--t4)' }}>
                    No nodes found in causality graph. Enter ID manually:
                  </span>
                  <input
                    type="text"
                    placeholder="e.g. e1, e2"
                    value={graphNodeId}
                    onChange={(e) => setGraphNodeId(e.target.value)}
                    style={{
                      background: 'var(--s2)',
                      border: '1px solid var(--line)',
                      borderRadius: '8px',
                      color: 'var(--t1)',
                      padding: '8px 12px',
                      fontSize: '12px',
                      fontFamily: "'JetBrains Mono', monospace",
                      outline: 'none',
                    }}
                  />
                </div>
              ) : (
                <select
                  value={graphNodeId}
                  onChange={(e) => setGraphNodeId(e.target.value)}
                  style={{
                    background: 'var(--s2)',
                    border: '1px solid var(--line)',
                    borderRadius: '8px',
                    color: 'var(--t1)',
                    padding: '8px 12px',
                    fontSize: '12px',
                    fontFamily: "'JetBrains Mono', monospace",
                    width: '100%',
                    outline: 'none',
                  }}
                >
                  {graphNodes.map(node => (
                    <option key={node.id} value={node.id}>
                      [{node.type.toUpperCase()}] {node.label} (ID: {node.id})
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Footer buttons */}
          <div style={{ display: 'flex', gap: '12px', marginTop: '10px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: '1px solid var(--line)',
                background: 'transparent',
                color: 'var(--t3)',
                fontSize: '12px',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                background: 'var(--lime)',
                color: '#121212',
                fontSize: '12px',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              Apply Link
            </button>
          </div>
        </form>
      </div>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
};

export default LinkToCodeModal;

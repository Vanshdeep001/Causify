/*
 * BinaryFilePreview.jsx — Shown in place of the code editor for binary assets.
 *
 * Images/fonts are stored as base64 data URLs, not editable text. Rendering that
 * string in Monaco would be meaningless (and risk corrupting it on save), so we
 * show an image preview or a neutral "binary file" card instead.
 */
import React from 'react';
import useEditorStore from '../../store/useEditorStore';
import { isImagePath, isDataUrl } from '../../utils/binaryAssets';

const BinaryFilePreview = () => {
  const activePath = useEditorStore((s) => s.activePath);
  const content = useEditorStore((s) => s.code);

  const fileName = activePath ? activePath.split('/').pop() : '';
  const canShowImage = isImagePath(activePath || '') && isDataUrl(content);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '18px',
        padding: '32px',
        background: 'var(--s0, #0d0d0d)',
        overflow: 'auto',
      }}
    >
      {canShowImage ? (
        <img
          src={content}
          alt={fileName}
          style={{
            maxWidth: '100%',
            maxHeight: '70%',
            objectFit: 'contain',
            borderRadius: '8px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            background:
              'repeating-conic-gradient(#2a2a2a 0% 25%, #1e1e1e 0% 50%) 50% / 20px 20px',
          }}
        />
      ) : (
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--t3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <polyline points="13 2 13 9 20 9" />
        </svg>
      )}

      <div style={{ textAlign: 'center', color: 'var(--t2)', fontFamily: 'var(--font-mono, monospace)' }}>
        <div style={{ fontSize: '0.9rem', color: 'var(--t1)', fontWeight: 600 }}>{fileName}</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--t3)', marginTop: '4px' }}>
          Binary asset — not editable as text. Served as-is to the dev server.
        </div>
      </div>
    </div>
  );
};

export default BinaryFilePreview;

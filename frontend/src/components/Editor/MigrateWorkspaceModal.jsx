/* -------------------------------------------------------
 * MigrateWorkspaceModal.jsx — One-time move to disk
 *
 * Workspaces created before Causify kept files on disk live nowhere but inside
 * the app: in browser storage, and in the local database. That is what let the
 * database grow until it ran out of memory, and it is why edits never showed up
 * in any other editor.
 *
 * This asks once, on launch, for somewhere real to put those files. Afterwards
 * the folder is the source of truth like any other project, and the old copy is
 * deleted.
 * ------------------------------------------------------- */

import React, { useState } from 'react';

const MigrateWorkspaceModal = ({ fileCount, workspaceName, onMigrate, onSkip }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleChoose = async () => {
    setBusy(true);
    setError('');
    try {
      const ok = await onMigrate();
      if (!ok) setBusy(false); // cancelled the folder picker — leave the modal up
    } catch (err) {
      setError(err.message || 'Could not save the files');
      setBusy(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px',
    }}>
      <div style={{
        width: '100%', maxWidth: '460px',
        background: 'var(--s1, #101010)',
        border: '1px solid var(--line-strong, #2E2E2E)',
        borderRadius: '6px',
        padding: '24px',
        color: 'var(--t1, #FFFFFF)',
        fontFamily: 'var(--font-body)',
      }}>
        <div style={{
          fontFamily: 'var(--font-header)',
          fontSize: '1rem', fontWeight: 900,
          letterSpacing: '-0.01em', marginBottom: '10px',
        }}>
          Save your work to a folder
        </div>

        <p style={{ fontSize: '0.72rem', lineHeight: 1.65, color: 'var(--t2, #B4B4B4)', margin: '0 0 12px' }}>
          {workspaceName ? <><strong>{workspaceName}</strong> is</> : 'Your workspace is'}
          {' '}currently stored inside Causify
          {typeof fileCount === 'number' ? ` (${fileCount} file${fileCount === 1 ? '' : 's'})` : ''}.
          Choose a folder on your computer to keep it in.
        </p>

        <p style={{ fontSize: '0.68rem', lineHeight: 1.65, color: 'var(--t3, #6E6E6E)', margin: '0 0 18px' }}>
          From then on Causify edits those files directly, so your changes show up
          in any other editor — and nothing is stored in the app's database.
        </p>

        {error && (
          <div style={{
            fontSize: '0.66rem', color: '#E5484D', marginBottom: '12px',
            padding: '8px 10px', borderRadius: '4px',
            background: 'rgba(229,72,77,0.08)', border: '1px solid rgba(229,72,77,0.28)',
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button
            onClick={handleChoose}
            disabled={busy}
            style={{
              background: '#FFFFFF', border: 'none', borderRadius: '3px',
              color: '#000000', fontFamily: 'var(--font-header)',
              fontSize: '0.66rem', fontWeight: 900, padding: '11px 14px',
              cursor: busy ? 'default' : 'pointer', letterSpacing: '0.04em',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? 'SAVING…' : 'CHOOSE FOLDER'}
          </button>

          <button
            onClick={onSkip}
            disabled={busy}
            style={{
              background: 'transparent',
              border: '1px solid var(--line-strong, #2E2E2E)',
              borderRadius: '3px', color: 'var(--t2, #B4B4B4)',
              fontFamily: 'var(--font-number)', fontSize: '0.6rem',
              fontWeight: 900, padding: '10px 14px',
              cursor: busy ? 'default' : 'pointer', letterSpacing: '0.06em',
            }}
          >
            NOT NOW
          </button>
        </div>

        <p style={{ fontSize: '0.6rem', lineHeight: 1.6, color: 'var(--t4, #4A4A4A)', margin: '14px 0 0' }}>
          Choosing "Not now" keeps the files where they are and asks again next time.
        </p>
      </div>
    </div>
  );
};

export default MigrateWorkspaceModal;

/* -------------------------------------------------------
 * AiKeySetupCard.jsx — Activate a Gemini key without leaving the panel
 *
 * Lives in its own file because two places need it: the diagnosis report,
 * and the auto-fix agent when it reports NO_AI_KEY. Telling someone a key is
 * required and then not offering anywhere to put one sends them hunting
 * through a collapsed panel for the field.
 *
 * The key is posted to the backend, which verifies it with a real generation
 * call before activating. It never touches a file on the way through.
 * ------------------------------------------------------- */

import React, { useState, useEffect } from 'react';
import { getAiStatus, saveAiKey } from '../../services/api';

/**
 * @param {boolean} [forceVisible] Skip the "is a key already configured?"
 *   probe. The auto-fix agent already got NO_AI_KEY straight from the backend,
 *   so re-asking would only add a round-trip before the input appears.
 * @param {string}  [context] Tailors the copy to where the card is shown.
 */
const AiKeySetupCard = ({ forceVisible = false, context = 'diagnosis' }) => {
  const [visible, setVisible] = useState(forceVisible);
  const [keyInput, setKeyInput] = useState('');
  const [status, setStatus] = useState('idle'); // 'idle' | 'saving' | 'success' | 'error'
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (forceVisible) return;
    let cancelled = false;
    getAiStatus()
      .then((res) => {
        if (!cancelled && res && res.configured === false) setVisible(true);
      })
      .catch(() => { /* backend unreachable — keep the card hidden */ });
    return () => { cancelled = true; };
  }, [forceVisible]);

  if (!visible) return null;

  const handleActivate = async () => {
    const key = keyInput.trim();
    if (!key || status === 'saving') return;
    setStatus('saving');
    setErrorMsg('');
    try {
      const res = await saveAiKey(key);
      if (res && res.success) {
        // On desktop, also persist encrypted (OS keychain) so the key
        // is re-injected into the backend on every future launch.
        if (window.electronAPI?.setApiKey) {
          try { await window.electronAPI.setApiKey(key); } catch { /* non-fatal */ }
        }
        setStatus('success');
      } else {
        setStatus('error');
        setErrorMsg(res?.error || 'Google rejected this key.');
      }
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.response?.data?.error || 'Could not verify the key. Check your connection.');
    }
  };

  if (status === 'success') {
    return (
      <div className="rca2-keysetup is-success">
        <div className="rca2-keysetup-head">
          <span className="rca2-keysetup-check">✓</span>
          <span className="rca2-keysetup-title">Gemini Activated</span>
        </div>
        <div className="rca2-keysetup-sub">
          {context === 'autofix'
            ? 'Your key is verified and live. Press Try again to run the auto-fix agent.'
            : 'Your key is verified and live. Run your code again to generate a full AI-powered diagnosis.'}
        </div>
      </div>
    );
  }

  return (
    <div className="rca2-keysetup">
      <div className="rca2-keysetup-head">
        <span className="rca2-keysetup-title">
          {context === 'autofix' ? 'Unlock the Auto-Fix Agent' : 'Unlock AI Diagnosis'}
        </span>
        <span className="rca2-keysetup-badge">API Key Required</span>
      </div>
      <div className="rca2-keysetup-sub">
        {context === 'autofix'
          ? 'The agent needs a Google Gemini API key to write and verify fixes.'
          : 'This report used rule-based analysis only. Add a Google Gemini API key to unlock AI-powered explanations, cause chains, and the auto-fix agent.'}{' '}
        <a
          className="rca2-keysetup-link"
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noreferrer"
        >
          Get a free key at aistudio.google.com →
        </a>
      </div>
      <div className="rca2-keysetup-row">
        <input
          type="password"
          className="rca2-keysetup-input"
          placeholder="Gemini API key…"
          value={keyInput}
          onChange={(e) => {
            setKeyInput(e.target.value);
            if (status === 'error') { setStatus('idle'); setErrorMsg(''); }
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleActivate(); }}
          spellCheck={false}
        />
        <button
          className="rca2-keysetup-btn"
          onClick={handleActivate}
          disabled={!keyInput.trim() || status === 'saving'}
        >
          {status === 'saving' ? 'Verifying…' : 'Activate'}
        </button>
      </div>
      {status === 'error' && <div className="rca2-keysetup-error">{errorMsg}</div>}
      <div className="rca2-keysetup-note">
        {window.electronAPI
          ? 'Verified against Gemini · Stored encrypted on this device · Never shared'
          : 'Verified against Gemini · Held by your local backend for this session'}
      </div>
    </div>
  );
};

export default AiKeySetupCard;

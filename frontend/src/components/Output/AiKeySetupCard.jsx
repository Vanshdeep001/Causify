/* -------------------------------------------------------
 * AiKeySetupCard.jsx — Bring your own AI provider
 *
 * Any key from any provider: OpenRouter, Groq, Gemini, Bedrock, OpenAI, or any
 * OpenAI-compatible endpoint via a base URL.
 *
 * The design goal is that the common case needs no decisions. Paste a key and
 * the provider is recognised from its own shape (sk-or- → OpenRouter, gsk_ →
 * Groq, and so on), so most people never open the dropdown. The dropdown is
 * there for the rest: an unrecognised key, or a deliberate override.
 *
 * The key is posted to the backend, which verifies it with a real generation
 * call before activating — a key that authenticates but cannot generate is
 * rejected here rather than failing on the first real request. It never
 * touches a file on the way through.
 * ------------------------------------------------------- */

import React, { useState, useEffect, useRef } from 'react';
import { getAiStatus, getAiProviders, detectAiProvider, saveAiKey, clearAiKey } from '../../services/api';
import { PixelSprite, Coin, MARIO_JUMP } from './MarioSprites';

/**
 * @param {'diagnosis'|'autofix'} context  tailors the copy
 * @param {'card'|'arcade'|'compact'} variant
 *   'arcade' drops the heading, the badge and the explanatory paragraph and
 *   attaches the form to the level above it. Inside the agent panel the scene
 *   already says INSERT COIN and "an api key is needed to play" — repeating
 *   that in a titled card was three statements of one fact stacked vertically.
 *
 *   'compact' is the same idea for a panel that is 380px wide and already has a
 *   title bar. The full card led with "Unlock the Auto-Fix Agent", a red API
 *   KEY REQUIRED badge and two sentences of pitch — three restatements of a
 *   heading the panel had already written, above the one field anyone came for.
 *   At that width it filled the frame with preamble. This is the field, the
 *   button, and the options behind a disclosure.
 * @param {() => void} [onActivated]
 *   Fired once the key is verified and live, after a beat so the confirmation
 *   is readable. Lets the caller carry straight on with whatever the missing
 *   key was blocking, instead of leaving a button for the user to press next.
 */
const AiKeySetupCard = ({ forceVisible = false, context = 'diagnosis', variant = 'card', onActivated }) => {
  const [providers, setProviders] = useState([]);
  /* What the backend currently holds. Null until the first status call answers,
   * so the card renders nothing rather than flashing "no key" at someone who
   * has one. */
  const [current, setCurrent] = useState(null);
  // True once the user asks to replace a working key.
  const [editing, setEditing] = useState(false);

  const [keyInput, setKeyInput] = useState('');
  const [provider, setProvider] = useState('');      // '' = detect from the key
  const [detected, setDetected] = useState(null);    // what the backend recognised
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [status, setStatus] = useState('idle');      // idle | saving | success | error
  const [errorMsg, setErrorMsg] = useState('');
  const [activated, setActivated] = useState(null);  // { providerName, model }
  // True once a key has been typed that nothing recognised — the only time the
  // provider has to be asked for rather than worked out.
  const [unrecognised, setUnrecognised] = useState(false);

  const detectTimer = useRef(null);
  const handoffTimer = useRef(null);

  // A pending hand-off must not fire into a component that has gone away.
  useEffect(() => () => clearTimeout(handoffTimer.current), []);

  useEffect(() => {
    let cancelled = false;

    getAiProviders()
      .then((res) => { if (!cancelled && res?.providers) setProviders(res.providers); })
      .catch(() => { /* the form still works; the dropdown is just empty */ });

    if (!forceVisible) {
      getAiStatus()
        .then((res) => { if (!cancelled && res) setCurrent(res); })
        .catch(() => { /* backend unreachable — keep the card hidden */ });
    }

    return () => { cancelled = true; };
  }, [forceVisible]);

  /* Recognise the provider as the key is pasted. Debounced so a fast typist
   * does not generate a request per character, and only when the user has not
   * already made the choice themselves. */
  useEffect(() => {
    const key = keyInput.trim();
    if (!key || provider) { setDetected(null); setUnrecognised(false); return; }

    clearTimeout(detectTimer.current);
    detectTimer.current = setTimeout(() => {
      detectAiProvider(key)
        .then((res) => {
          const found = res?.provider ? res : null;
          setDetected(found);
          /* Nothing matched. This is the one case where the user has to be
             asked, so the options open themselves rather than leaving them to
             find a disclosure they had no reason to look for. */
          if (!found) {
            setUnrecognised(true);
            setShowAdvanced(true);
          } else {
            setUnrecognised(false);
          }
        })
        .catch(() => setDetected(null));
    }, 350);

    return () => clearTimeout(detectTimer.current);
  }, [keyInput, provider]);

  // Nothing to say until the backend has told us what it holds.
  if (!forceVisible && !current) return null;

  const chosen = providers.find((p) => p.id === (provider || detected?.provider));
  const needsBaseUrl = Boolean(chosen?.needsBaseUrl);
  const modelPlaceholder = chosen?.defaultModel
    ? `${chosen.defaultModel}  (default)`
    : 'model name';

  const handleActivate = async () => {
    const key = keyInput.trim();
    if (!key || status === 'saving') return;

    if (needsBaseUrl && !baseUrl.trim()) {
      setStatus('error');
      setErrorMsg('A custom endpoint needs a base URL, e.g. https://api.together.xyz/v1');
      return;
    }

    setStatus('saving');
    setErrorMsg('');
    try {
      const res = await saveAiKey(key, {
        provider: provider || detected?.provider || '',
        model: model.trim(),
        baseUrl: baseUrl.trim(),
      });

      if (res && res.success) {
        // On desktop, also persist encrypted (OS keychain) so the key is
        // re-injected into the backend on every future launch.
        if (window.electronAPI?.setApiKey) {
          try { await window.electronAPI.setApiKey(key); } catch { /* non-fatal */ }
        }
        setActivated({ providerName: res.providerName, model: res.model });
        // Keep the managed view in step, so dismissing the confirmation lands
        // on the new provider rather than the one it replaced.
        setCurrent({ configured: true, providerName: res.providerName, model: res.model });
        setEditing(false);
        setKeyInput('');
        setStatus('success');
        // Long enough to read the confirmation, short enough that it feels like
        // one action rather than two.
        if (onActivated) {
          handoffTimer.current = setTimeout(() => onActivated(), 1100);
        }
      } else {
        setStatus('error');
        setErrorMsg(res?.error || 'That key was rejected.');
      }
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.response?.data?.error || 'Could not verify the key. Check your connection.');
    }
  };

  const clearError = () => {
    if (status === 'error') { setStatus('idle'); setErrorMsg(''); }
  };

  /* Forget the key everywhere it lives: the running backend, and on desktop the
   * encrypted keychain copy too — clearing only the backend would look like it
   * worked until the next launch re-injected the old key. */
  const handleRemove = async () => {
    setStatus('saving');
    try {
      await clearAiKey();
      if (window.electronAPI?.clearApiKey) {
        try { await window.electronAPI.clearApiKey(); } catch { /* non-fatal */ }
      }
      setCurrent({ configured: false });
      setActivated(null);
      setKeyInput('');
      setProvider('');
      setModel('');
      setBaseUrl('');
      setEditing(false);
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.response?.data?.error || 'Could not remove the key.');
    }
  };

  /* ── A key is already in place ──
   * Shown instead of the form so the panel answers the questions someone with
   * a working key actually has: which provider is this, and how do I swap it
   * when the credit runs out. */
  const showManage = !forceVisible && current?.configured && !editing && status !== 'success';

  if (showManage) {
    return (
      <div className="ai-status">
        <div className="ai-status-main">
          <div className="ai-status-label">
            <span className="ai-status-dot" />
            Active provider
          </div>

          <div className="ai-status-value">{current.providerName || 'Connected'}</div>

          {/* Omitted rather than left as an empty chip when the backend has not
              reported a model. */}
          {current.model && <div className="ai-status-model">{current.model}</div>}
        </div>

        <div className="ai-status-side">
          {/* Not "for this session" any more. The backend writes the verified
              settings to the user's data directory and restores them on the
              next launch, so a note promising nothing beyond this session now
              understates it — and would have people re-pasting a key they no
              longer need to. */}
          <div className="ai-status-note">
            {window.electronAPI ? 'Encrypted on this device' : 'Saved on this machine'}
          </div>
          <div className="ai-status-actions">
            <button className="ai-btn" onClick={() => { setEditing(true); setStatus('idle'); }}>
              Replace key
            </button>
            <button className="ai-btn is-danger" onClick={handleRemove} disabled={status === 'saving'}>
              {status === 'saving' ? 'Removing…' : 'Remove'}
            </button>
          </div>
        </div>

        {status === 'error' && <div className="ai-status-error">{errorMsg}</div>}
      </div>
    );
  }

  const arcade = variant === 'arcade';
  const compact = variant === 'compact';

  /* ── Compact: the form, and nothing that is not the form ── */
  if (compact) {
    return (
      <div className="aik">
        {status === 'success' ? (
          <div className="aik-done">
            <span className="aik-done-mark">✓</span>
            <span className="aik-done-text">
              {activated?.providerName || 'Provider'} is live
              {activated?.model ? <> on <b>{activated.model}</b></> : null}
            </span>
            <button className="aik-btn is-ghost" onClick={() => setStatus('idle')}>Done</button>
          </div>
        ) : (
          <>
            <div className="aik-row">
              <input
                type="password"
                className="aik-input"
                placeholder={chosen?.keyHint || 'Paste your API key'}
                value={keyInput}
                onChange={(e) => { setKeyInput(e.target.value); clearError(); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleActivate(); }}
                spellCheck={false}
                autoFocus
              />
              <button
                className="aik-btn is-primary"
                onClick={handleActivate}
                disabled={!keyInput.trim() || status === 'saving'}
              >
                {status === 'saving' ? 'Checking' : 'Activate'}
              </button>
            </div>

            {status === 'error' && <div className="aik-error">{errorMsg}</div>}

            {/* The provider, once something recognises the key. Confirmation
                that the paste landed, without asking a question the key has
                already answered. */}
            <div className="aik-meta">
              <button
                type="button"
                className="aik-toggle"
                onClick={() => setShowAdvanced((v) => !v)}
              >
                {showAdvanced ? '▾' : '▸'} provider &amp; model
              </button>
              <span className={`aik-detected ${detected ? 'is-on' : ''}`}>
                {detected?.providerName || (unrecognised ? 'not recognised' : '')}
              </span>
            </div>

            {showAdvanced && (
              <div className="aik-options">
                {unrecognised && (
                  <div className="aik-note">
                    That key isn’t one we recognise — pick its provider.
                  </div>
                )}

                <label className="aik-field">
                  <span className="aik-label">Provider</span>
                  <select
                    className="aik-select"
                    value={provider}
                    onChange={(e) => { setProvider(e.target.value); setModel(''); clearError(); }}
                  >
                    <option value="">
                      {detected?.providerName ? `Detected: ${detected.providerName}` : 'Detect from key'}
                    </option>
                    {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>

                {needsBaseUrl && (
                  <label className="aik-field">
                    <span className="aik-label">Base URL</span>
                    <input
                      type="text"
                      className="aik-input is-plain"
                      placeholder="https://api.together.xyz/v1"
                      value={baseUrl}
                      onChange={(e) => { setBaseUrl(e.target.value); clearError(); }}
                      spellCheck={false}
                    />
                  </label>
                )}

                <label className="aik-field">
                  <span className="aik-label">Model</span>
                  <input
                    type="text"
                    className="aik-input is-plain"
                    placeholder={modelPlaceholder}
                    value={model}
                    onChange={(e) => { setModel(e.target.value); clearError(); }}
                    spellCheck={false}
                  />
                </label>

                {chosen?.consoleUrl && (
                  <a className="aik-link" href={chosen.consoleUrl} target="_blank" rel="noreferrer">
                    Get a {chosen.name} key →
                  </a>
                )}
              </div>
            )}

            <p className="aik-foot">
              Checked with a live call, then remembered on this machine.
            </p>
          </>
        )}
      </div>
    );
  }

  /* ── Coin accepted ── */
  if (status === 'success') {
    if (arcade) {
      return (
        <div className="afx-slot is-success">
          <PixelSprite rows={MARIO_JUMP} px={2} className="afx-slot-sprite" />
          <div className="afx-slot-success-text">
            <div className="afx-slot-success-title">
              1-UP · {activated?.providerName || 'AI'} READY
            </div>
            <div className="afx-slot-success-sub">
              {activated?.model && <code className="afx-inline-code">{activated.model}</code>}
              {' '}Starting the agent…
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="rca2-keysetup is-success">
        <div className="rca2-keysetup-head">
          <span className="rca2-keysetup-check">✓</span>
          <span className="rca2-keysetup-title">
            {activated?.providerName ? `${activated.providerName} Activated` : 'AI Activated'}
          </span>
        </div>
        <div className="rca2-keysetup-sub">
          Verified and live{activated?.model ? <> on <code className="afx-inline-code">{activated.model}</code></> : null}.{' '}
          Run your code again for a full AI-powered diagnosis.
        </div>
        {!forceVisible && (
          <div className="rca2-keysetup-actions">
            <button className="rca2-keysetup-btn is-ghost" onClick={() => setStatus('idle')}>
              Done
            </button>
          </div>
        )}
      </div>
    );
  }

  /* ── Arcade: the coin slot on the front of the cabinet ── */
  if (arcade) {
    return (
      <div className="afx-slot">
       {/* Capped and centred. A control panel does not get wider because the
           terminal does — stretched to full bleed, a 40-character key sat in a
           thousand-pixel box. */}
       <div className="afx-slot-inner">
        {/* Nothing but the slot. Anyone holding a key knows where it came from,
            so asking them to name the provider was a question with a known
            answer — it is worked out from the key instead. */}
        {/* ── The HUD ──
            Mario's status bar, which is the one piece of that game's interface
            that is genuinely structural rather than decorative: four labelled
            columns, small caps over big values, running the width of the
            screen. A heading with a counter tucked in the corner was a web
            card header wearing a pixel font; this is a layout the game
            actually has.

            It also carries more than the old heading did. COINS ticks as the
            key lands, STATUS is the plain-language answer to "is this thing
            working", and both update live — so the strip is a readout, not a
            title. */}
        <div className="afx-hud-strip">
          <span className="afx-hud-col">
            <span className="afx-hud-k">Player</span>
            <span className="afx-hud-v">CAUSIFY</span>
          </span>
          <span className="afx-hud-col">
            <span className="afx-hud-k">Coins</span>
            <span className={`afx-hud-v ${keyInput.trim() ? 'is-coin' : ''}`}>
              ×{keyInput.trim() ? 1 : 0}
            </span>
          </span>
          <span className="afx-hud-col">
            <span className="afx-hud-k">World</span>
            <span className="afx-hud-v">1-1</span>
          </span>
          <span className="afx-hud-col is-right">
            <span className="afx-hud-k">Status</span>
            <span className={`afx-hud-v ${keyInput.trim() ? 'is-ready' : 'is-locked'}`}>
              {status === 'saving' ? 'CHECKING' : keyInput.trim() ? 'READY' : 'NO KEY'}
            </span>
          </span>
        </div>

        {/* ── The control deck ──
            A cabinet's panel has exactly two things on it: a slot you drop a
            coin into, and a button you hit afterwards. Both are objects, not
            form fields — which is the whole reason this reads as a machine
            rather than as a login box with a retro typeface. They share one
            row at one height, the way they would on real hardware. */}
        <div className="afx-deck">
          <span className={`afx-slot-coin ${status === 'saving' ? 'is-dropping' : ''}`}>
            <Coin px={2} />
          </span>

          {/* The slot: milled into the plate, lit along its lower lip. */}
          <span className="afx-mouth">
            <input
              type="password"
              className="afx-slot-input is-key"
              placeholder={chosen?.keyHint || 'paste your api key'}
              value={keyInput}
              onChange={(e) => { setKeyInput(e.target.value); clearError(); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleActivate(); }}
              spellCheck={false}
            />
          </span>

          {/* START is round because arcade buttons are round. A rectangle here
              is the single thing that made the whole panel read as a web form
              wearing a pixel font — the shape is doing more work than any
              amount of styling on a slab could. */}
          <button
            className={`afx-start-btn ${keyInput.trim() && status !== 'saving' ? 'is-live' : ''}`}
            onClick={handleActivate}
            disabled={!keyInput.trim() || status === 'saving'}
            title={status === 'saving' ? 'Checking…' : 'Start'}
          >
            <span className="afx-start-face">
              <span className="afx-start-label">
                {status === 'saving' ? '···' : 'START'}
              </span>
            </span>
          </button>
        </div>

        {status === 'error' && <div className="afx-slot-error">{errorMsg}</div>}

        {/* Below the slot, not above it.
            As a preamble this was three lines standing between the user and the
            one field they came here to fill. It is reassurance about where the
            key goes — which matters, but matters *after* you have seen what is
            being asked for, not before. */}
        <p className="afx-slot-sub">
          Stored on this machine. Sent only to the provider it belongs to.
        </p>

        <div className="afx-slot-foot">
          <button type="button" className="afx-slot-toggle" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? '▼' : '▶'} options
          </button>
          {/* Recognition, confirmed without a form row */}
          <span className={`afx-slot-hint ${detected ? 'is-detected' : ''}`}>
            {detected?.providerName
              ? `◉ ${detected.providerName}`
              : (providers.map((p) => p.name).join(' · ') || 'any provider')}
          </span>
        </div>

        {showAdvanced && (
          <div className="afx-slot-options">
            {unrecognised && (
              <div className="afx-slot-note">
                That key isn’t one we recognise — pick its provider below.
              </div>
            )}

            <div className="afx-slot-row">
              <span className="afx-slot-label">Provider</span>
              <select
                className="afx-slot-select"
                value={provider}
                onChange={(e) => { setProvider(e.target.value); setModel(''); clearError(); }}
              >
                <option value="">
                  {detected?.providerName ? `Detected: ${detected.providerName}` : 'Detect from key'}
                </option>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {chosen?.consoleUrl && (
                <a className="afx-slot-link" href={chosen.consoleUrl} target="_blank" rel="noreferrer">
                  get one →
                </a>
              )}
            </div>

            {needsBaseUrl && (
              <div className="afx-slot-row">
                <span className="afx-slot-label">Base URL</span>
                <input
                  type="text"
                  className="afx-slot-input"
                  placeholder="https://api.together.xyz/v1"
                  value={baseUrl}
                  onChange={(e) => { setBaseUrl(e.target.value); clearError(); }}
                  spellCheck={false}
                />
              </div>
            )}

            <div className="afx-slot-row">
              <span className="afx-slot-label">Model</span>
              <input
                type="text"
                className="afx-slot-input"
                placeholder={modelPlaceholder}
                value={model}
                onChange={(e) => { setModel(e.target.value); clearError(); }}
                spellCheck={false}
              />
            </div>
          </div>
        )}
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
          ? 'The agent needs an AI provider to write and verify fixes.'
          : 'This report used rule-based analysis only. Add an AI provider to unlock explanations, cause chains, and the auto-fix agent.'}
        {' '}Bring a key from whichever provider you already use.
        {chosen?.consoleUrl && (
          <>
            {' '}
            <a className="rca2-keysetup-link" href={chosen.consoleUrl} target="_blank" rel="noreferrer">
              Get a {chosen.name} key →
            </a>
          </>
        )}
      </div>

      <div className="rca2-keysetup-row">
        <input
          type="password"
          className="rca2-keysetup-input"
          placeholder={chosen?.keyHint || 'Paste your API key'}
          value={keyInput}
          onChange={(e) => { setKeyInput(e.target.value); clearError(); }}
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
        {/* A way back out, so replacing a key is not a one-way door. */}
        {editing && (
          <button className="rca2-keysetup-btn is-ghost" onClick={() => { setEditing(false); clearError(); }}>
            Cancel
          </button>
        )}
      </div>

      {/* Provider and model are both overrides — the key names its own provider,
          and each provider has a sensible default model. Neither is asked for
          unless the user opens this or the key turns out to be unrecognised. */}
      <div className="rca2-keysetup-advanced">
        <button
          type="button"
          className="rca2-keysetup-toggle"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? '▼' : '▶'} Provider &amp; model
          {detected?.providerName && !showAdvanced && (
            <span className="rca2-keysetup-detected">◉ {detected.providerName}</span>
          )}
        </button>

        {showAdvanced && (
          <>
            {unrecognised && (
              <div className="rca2-keysetup-note-inline">
                That key isn’t one we recognise — pick its provider below.
              </div>
            )}

            <div className="rca2-keysetup-field">
              <label className="rca2-keysetup-label" htmlFor="ai-provider">Provider</label>
              <select
                id="ai-provider"
                className="rca2-keysetup-select"
                value={provider}
                onChange={(e) => { setProvider(e.target.value); setModel(''); clearError(); }}
              >
                <option value="">
                  {detected?.providerName ? `Detected: ${detected.providerName}` : 'Detect from key'}
                </option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {needsBaseUrl && (
              <div className="rca2-keysetup-field">
                <label className="rca2-keysetup-label" htmlFor="ai-baseurl">Base URL</label>
                <input
                  id="ai-baseurl"
                  type="text"
                  className="rca2-keysetup-input"
                  placeholder="https://api.together.xyz/v1"
                  value={baseUrl}
                  onChange={(e) => { setBaseUrl(e.target.value); clearError(); }}
                  spellCheck={false}
                />
              </div>
            )}

            <div className="rca2-keysetup-field">
              <label className="rca2-keysetup-label" htmlFor="ai-model">Model</label>
              <input
                id="ai-model"
                type="text"
                className="rca2-keysetup-input"
                placeholder={modelPlaceholder}
                value={model}
                onChange={(e) => { setModel(e.target.value); clearError(); }}
                spellCheck={false}
              />
            </div>
          </>
        )}
      </div>

      {status === 'error' && <div className="rca2-keysetup-error">{errorMsg}</div>}

      <div className="rca2-keysetup-note">
        {window.electronAPI
          ? 'Verified with a live call · Stored encrypted on this device · Never shared'
          : 'Verified with a live call · Saved on this machine · Never shared'}
      </div>
    </div>
  );
};

export default AiKeySetupCard;

/**
 * A always-visible readout of which provider is live, with a way in to change
 * it.
 *
 * The management card itself sits inside the diagnostic report, which is
 * collapsed by default — fine for first-time setup, useless at the moment a
 * key stops working, because that is exactly when someone needs it and has no
 * reason to think of opening a report to find it. This chip puts the state on
 * screen at all times and is the door to the card.
 */
export const AiProviderChip = ({ onManage, refreshToken }) => {
  const [status, setStatus] = useState(null);

  /* Re-asked whenever `refreshToken` changes, which the caller flips when the
     settings close. Without it the chip keeps reporting whatever was true when
     it mounted — so activating a key left it still reading "Add AI key", which
     looks exactly like the key not having worked. */
  useEffect(() => {
    let cancelled = false;
    getAiStatus()
      .then((res) => { if (!cancelled) setStatus(res); })
      .catch(() => { /* backend unreachable — say nothing rather than guess */ });
    return () => { cancelled = true; };
  }, [refreshToken]);

  if (!status) return null;

  const configured = Boolean(status.configured);

  return (
    <button
      type="button"
      className={`rca2-provider-chip ${configured ? 'is-live' : ''}`}
      title={configured
        ? `${status.providerName || 'AI provider'} · ${status.model || 'default model'} — click to change or remove`
        : 'Add an AI provider key'}
      onClick={(e) => {
        // The chip lives inside the report's toggle row, which would otherwise
        // collapse the very panel the card is in.
        e.stopPropagation();
        onManage?.();
      }}
    >
      <span className="rca2-provider-dot" />
      {configured ? (status.providerName || 'AI connected') : 'Add AI key'}
    </button>
  );
};

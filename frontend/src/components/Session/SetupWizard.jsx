/* -------------------------------------------------------
 * SetupWizard.jsx — First-Launch Setup Wizard
 *
 * Shows on first Electron launch to collect:
 *   Step 1: OpenRouter API key (with validation)
 *   Step 2: Backend connectivity check
 *
 * After completion, calls electronAPI.completeSetup()
 * so it never shows again.
 * ------------------------------------------------------- */

import React, { useState, useEffect, useCallback } from 'react';

const STEPS = ['api-key', 'backend', 'complete'];

const SetupWizard = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState(0);

  // Step 1 state
  const [apiKey, setApiKey] = useState('');
  const [keyStatus, setKeyStatus] = useState(null); // null | 'testing' | 'success' | 'error'
  const [keyError, setKeyError] = useState('');

  // Step 2 state
  const [backendStatus, setBackendStatus] = useState('checking'); // 'checking' | 'ready' | 'error'
  const [backendLogs, setBackendLogs] = useState([]);

  /* ── Step 1: Test API Key ── */
  const handleTestKey = useCallback(async () => {
    if (!apiKey.trim()) return;
    setKeyStatus('testing');
    setKeyError('');

    try {
      if (window.electronAPI) {
        // In Electron: use secure IPC
        await window.electronAPI.setApiKey(apiKey.trim());
        const result = await window.electronAPI.makeAIRequest(
          'Reply with exactly: "OK"',
          { max_tokens: 5 }
        );
        if (result && !result.error) {
          setKeyStatus('success');
        } else {
          setKeyStatus('error');
          setKeyError(result?.error || 'API returned an unexpected response.');
          await window.electronAPI.clearApiKey();
        }
      } else {
        // In browser dev mode: simulate validation via direct fetch
        const res = await fetch('https://openrouter.ai/api/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey.trim()}` },
        });
        if (res.ok) {
          setKeyStatus('success');
        } else {
          setKeyStatus('error');
          setKeyError(`API returned status ${res.status}. Check your key.`);
        }
      }
    } catch (err) {
      setKeyStatus('error');
      setKeyError(err.message || 'Connection failed.');
    }
  }, [apiKey]);

  /* ── Step 2: Check Backend ── */
  const checkBackend = useCallback(async () => {
    setBackendStatus('checking');
    setBackendLogs([]);

    try {
      if (window.electronAPI) {
        const status = await window.electronAPI.getBackendStatus();
        if (status === 'running') {
          setBackendStatus('ready');
        } else {
          const logs = await window.electronAPI.getBackendLogs();
          setBackendLogs(logs || []);
          setBackendStatus('error');
        }
      } else {
        // In browser dev mode: check if Spring Boot is reachable
        const res = await fetch('/api/session/health-check', {
          signal: AbortSignal.timeout(5000),
        }).catch(() => null);

        // Even a 404 means the server is running
        if (res) {
          setBackendStatus('ready');
        } else {
          // Try direct port check
          const directRes = await fetch('http://localhost:8080/api/session/health-check', {
            signal: AbortSignal.timeout(3000),
          }).catch(() => null);
          if (directRes) {
            setBackendStatus('ready');
          } else {
            setBackendStatus('error');
            setBackendLogs(['Could not reach backend on port 8080.', 'Make sure Spring Boot is running.']);
          }
        }
      }
    } catch (err) {
      setBackendStatus('error');
      setBackendLogs([err.message || 'Backend check failed.']);
    }
  }, []);

  // Auto-check backend when entering step 2
  useEffect(() => {
    if (currentStep === 1) {
      checkBackend();
    }
  }, [currentStep, checkBackend]);

  /* ── Step 3: Complete Setup ── */
  const handleComplete = async () => {
    if (window.electronAPI) {
      await window.electronAPI.completeSetup();
    }
    onComplete();
  };

  /* ── Advance to next step ── */
  const goNext = () => setCurrentStep((s) => Math.min(s + 1, STEPS.length - 1));

  /* ── Render ── */
  return (
    <div className="setup-wizard-overlay">
      <div className="setup-wizard-card">
        {/* Top accent bar */}
        <div className="setup-accent-bar" />

        {/* Progress indicator */}
        <div className="setup-progress">
          {STEPS.map((step, idx) => (
            <div
              key={step}
              className={`setup-progress-dot ${idx <= currentStep ? 'active' : ''} ${idx < currentStep ? 'done' : ''}`}
            />
          ))}
        </div>

        {/* ───── Step 1: API Key ───── */}
        {currentStep === 0 && (
          <div className="setup-step" style={{ animation: 'setup-fade-in 0.4s ease' }}>
            <div className="setup-step-icon">🔑</div>
            <h2 className="setup-title">OpenRouter API Key</h2>
            <p className="setup-subtitle">
              Causify uses OpenRouter for AI-powered root cause analysis.
              <br />
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noreferrer"
                className="setup-link"
              >
                Get your API key →
              </a>
            </p>

            <div className="setup-input-group">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setKeyStatus(null);
                  setKeyError('');
                }}
                placeholder="sk-or-v1-..."
                className="setup-input"
                spellCheck={false}
                autoFocus
              />
              <button
                onClick={handleTestKey}
                disabled={!apiKey.trim() || keyStatus === 'testing'}
                className="setup-btn-test"
              >
                {keyStatus === 'testing' ? (
                  <span className="setup-spinner" />
                ) : (
                  'Test Connection'
                )}
              </button>
            </div>

            {/* Status feedback */}
            {keyStatus === 'success' && (
              <div className="setup-status setup-status-success">
                <span>✓</span> API key is valid
              </div>
            )}
            {keyStatus === 'error' && (
              <div className="setup-status setup-status-error">
                <span>✗</span> {keyError}
              </div>
            )}

            <button
              onClick={goNext}
              disabled={keyStatus !== 'success'}
              className="setup-btn-primary"
            >
              Continue
            </button>
          </div>
        )}

        {/* ───── Step 2: Backend Check ───── */}
        {currentStep === 1 && (
          <div className="setup-step" style={{ animation: 'setup-fade-in 0.4s ease' }}>
            <div className="setup-step-icon">⚡</div>
            <h2 className="setup-title">Backend Connection</h2>
            <p className="setup-subtitle">
              Checking if the Causify backend is running...
            </p>

            <div className="setup-backend-status">
              {backendStatus === 'checking' && (
                <div className="setup-checking">
                  <span className="setup-spinner-large" />
                  <span>Connecting to backend...</span>
                </div>
              )}

              {backendStatus === 'ready' && (
                <div className="setup-status setup-status-success" style={{ fontSize: '1rem' }}>
                  <span>✓</span> Backend is ready on port 8080
                </div>
              )}

              {backendStatus === 'error' && (
                <>
                  <div className="setup-status setup-status-error" style={{ fontSize: '1rem' }}>
                    <span>✗</span> Backend not reachable
                  </div>
                  {backendLogs.length > 0 && (
                    <div className="setup-log-box">
                      {backendLogs.map((line, i) => (
                        <div key={i} className="setup-log-line">{line}</div>
                      ))}
                    </div>
                  )}
                  <button onClick={checkBackend} className="setup-btn-retry">
                    Retry
                  </button>
                </>
              )}
            </div>

            <button
              onClick={goNext}
              disabled={backendStatus !== 'ready'}
              className="setup-btn-primary"
            >
              Continue
            </button>
          </div>
        )}

        {/* ───── Step 3: All Set ───── */}
        {currentStep === 2 && (
          <div className="setup-step" style={{ animation: 'setup-fade-in 0.4s ease' }}>
            <div className="setup-step-icon" style={{ fontSize: '3.5rem' }}>🚀</div>
            <h2 className="setup-title">You're All Set</h2>
            <p className="setup-subtitle">
              Causify is configured and ready to go.
              <br />
              AI analysis, real-time collaboration, and causality graphs are all online.
            </p>

            <div className="setup-checklist">
              <div className="setup-checklist-item">
                <span className="setup-check">✓</span>
                OpenRouter API connected
              </div>
              <div className="setup-checklist-item">
                <span className="setup-check">✓</span>
                Backend running on port 8080
              </div>
              <div className="setup-checklist-item">
                <span className="setup-check">✓</span>
                H2 database ready (bundled)
              </div>
            </div>

            <button
              onClick={handleComplete}
              className="setup-btn-launch"
            >
              Launch Causify
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="setup-footer">
          <span>CAUSIFY</span>
          <span>v1.0.0</span>
        </div>
      </div>
    </div>
  );
};

export default SetupWizard;

/* -------------------------------------------------------
 * CreateServiceModal.jsx — Create a new Render web service
 *
 * Render builds backends from a Git repository (it does not accept
 * direct file uploads like Vercel). This modal creates a new Render
 * web service from the session's connected GitHub repo, prefilled
 * with the detected runtime, root directory and build/start commands
 * — everything stays editable before creation.
 * ------------------------------------------------------- */

import React, { useState, useEffect } from 'react';

const RENDER_MINT = '#46E3B7';

const RUNTIMES = [
  { value: 'node', label: 'Node.js' },
  { value: 'python', label: 'Python' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'elixir', label: 'Elixir' },
  { value: 'docker', label: 'Docker' },
];

/* ── Shared field styles ── */
const labelStyle = {
  fontFamily: 'var(--font-number)',
  fontSize: '0.54rem',
  color: 'var(--t3)',
  letterSpacing: '0.08em',
  fontWeight: 700,
};

const inputStyle = (focusable = true) => ({
  width: '100%',
  height: '32px',
  background: 'var(--s0)',
  border: '1px solid var(--line-strong)',
  borderRadius: '4px',
  color: 'var(--t1)',
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  fontSize: '0.64rem',
  padding: '0 10px',
  outline: 'none',
  boxSizing: 'border-box',
  ...(focusable ? {} : { color: 'var(--t3)' }),
});

const Field = ({ label, children, hint }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
    <label style={labelStyle}>{label}</label>
    {children}
    {hint && (
      <span style={{
        fontFamily: 'var(--font-number)', fontSize: '0.5rem',
        color: 'var(--t4)', letterSpacing: '0.03em', lineHeight: 1.5,
      }}>
        {hint}
      </span>
    )}
  </div>
);

const CreateServiceModal = ({ sessionId, detection, repoUrl, defaultName, onClose, onCreated }) => {
  const [name, setName] = useState(defaultName || '');
  const [repo, setRepo] = useState(repoUrl || '');
  const [branch, setBranch] = useState('main');
  const [runtime, setRuntime] = useState(detection?.runtime || 'node');
  const [rootDir, setRootDir] = useState(detection?.rootDir || '');
  const [buildCommand, setBuildCommand] = useState(detection?.buildCommand || '');
  const [startCommand, setStartCommand] = useState(detection?.startCommand || '');
  const [dockerfilePath, setDockerfilePath] = useState(detection?.dockerfilePath || './Dockerfile');
  const [owners, setOwners] = useState([]);
  const [ownerId, setOwnerId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState(null);

  const isDocker = runtime === 'docker';

  // Load the accounts (owners) this API key can create services under.
  useEffect(() => {
    const load = async () => {
      try {
        const res = await window.electronAPI?.listRenderOwners?.();
        if (res?.valid && res.owners?.length > 0) {
          setOwners(res.owners);
          setOwnerId(res.owners[0].id);
        } else {
          setError(res?.error || 'Could not load your Render account.');
        }
      } catch (err) {
        setError(err.message || 'Could not load your Render account.');
      }
    };
    load();
  }, []);

  const canSubmit = name.trim() && repo.trim() && ownerId && !isCreating &&
    (isDocker || startCommand.trim());

  const handleCreate = async () => {
    if (!canSubmit) return;
    setIsCreating(true);
    setError(null);
    try {
      const res = await window.electronAPI.createRenderService({
        sessionId,
        name: name.trim(),
        ownerId,
        repo: repo.trim(),
        branch: branch.trim() || undefined,
        runtime,
        rootDir: rootDir.trim() || undefined,
        buildCommand: buildCommand.trim(),
        startCommand: startCommand.trim(),
        dockerfilePath: isDocker ? (dockerfilePath.trim() || './Dockerfile') : undefined,
        plan: 'free',
      });
      if (res?.success) {
        onCreated?.(res.service.name, res.service.url);
      } else {
        setError(res?.error || 'Failed to create the service');
        setIsCreating(false);
      }
    } catch (err) {
      setError(err.message || 'Failed to create the service');
      setIsCreating(false);
    }
  };

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
        width: '520px',
        maxHeight: '86vh',
        overflowY: 'auto',
        background: 'var(--s1)',
        border: '1px solid var(--line-strong)',
        borderRadius: '6px',
        padding: '28px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        animation: 'slide-up 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '36px', height: '36px',
            border: '1px solid var(--line-strong)',
            borderRadius: '4px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={RENDER_MINT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="16" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
          </div>
          <div>
            <h2 style={{
              fontFamily: 'var(--font-header)',
              fontSize: '1.05rem',
              fontWeight: 900,
              letterSpacing: '0.04em',
              margin: 0,
              color: 'var(--t1)',
            }}>
              CREATE NEW SERVICE
            </h2>
            <div style={{
              fontFamily: 'var(--font-number)',
              fontSize: '0.58rem',
              color: 'var(--t3)',
              marginTop: '2px',
              letterSpacing: '0.06em',
            }}>
              SPIN UP YOUR BACKEND ON RENDER FROM YOUR GIT REPO
            </div>
          </div>
        </div>

        {/* Repo access note */}
        <div style={{
          fontFamily: 'var(--font-number)',
          fontSize: '0.54rem',
          color: 'var(--t3)',
          letterSpacing: '0.03em',
          lineHeight: 1.6,
          padding: '10px 12px',
          background: 'rgba(70, 227, 183, 0.04)',
          border: '1px solid rgba(70, 227, 183, 0.15)',
          borderRadius: '4px',
        }}>
          Render builds from Git — this repository must be accessible to your Render
          account. If it's private, connect GitHub to Render first
          (Dashboard → Account Settings → Git Providers).
        </div>

        {/* Form */}
        <Field label="SERVICE NAME">
          <input style={inputStyle()} value={name} onChange={(e) => setName(e.target.value)}
            placeholder="my-backend" autoFocus
            onFocus={e => e.currentTarget.style.borderColor = RENDER_MINT}
            onBlur={e => e.currentTarget.style.borderColor = 'var(--line-strong)'} />
        </Field>

        <Field label="REPOSITORY URL" hint="The session's connected GitHub repo is prefilled.">
          <input style={inputStyle()} value={repo} onChange={(e) => setRepo(e.target.value)}
            placeholder="https://github.com/you/your-backend"
            onFocus={e => e.currentTarget.style.borderColor = RENDER_MINT}
            onBlur={e => e.currentTarget.style.borderColor = 'var(--line-strong)'} />
        </Field>

        <div style={{ display: 'flex', gap: '12px' }}>
          <div style={{ flex: 1 }}>
            <Field label="BRANCH">
              <input style={inputStyle()} value={branch} onChange={(e) => setBranch(e.target.value)}
                placeholder="main"
                onFocus={e => e.currentTarget.style.borderColor = RENDER_MINT}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--line-strong)'} />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="RUNTIME">
              <select
                value={runtime}
                onChange={(e) => setRuntime(e.target.value)}
                style={{ ...inputStyle(), appearance: 'none', cursor: 'pointer' }}
              >
                {RUNTIMES.map((r) => (
                  <option key={r.value} value={r.value} style={{ background: '#111', color: '#fff' }}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <div style={{ flex: 1 }}>
            <Field label="ROOT DIRECTORY" hint="Leave empty if the backend sits at the repo root.">
              <input style={inputStyle()} value={rootDir} onChange={(e) => setRootDir(e.target.value)}
                placeholder="backend"
                onFocus={e => e.currentTarget.style.borderColor = RENDER_MINT}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--line-strong)'} />
            </Field>
          </div>
          {owners.length > 1 && (
            <div style={{ flex: 1 }}>
              <Field label="ACCOUNT">
                <select
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  style={{ ...inputStyle(), appearance: 'none', cursor: 'pointer' }}
                >
                  {owners.map((o) => (
                    <option key={o.id} value={o.id} style={{ background: '#111', color: '#fff' }}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
        </div>

        {isDocker ? (
          <Field label="DOCKERFILE PATH">
            <input style={inputStyle()} value={dockerfilePath} onChange={(e) => setDockerfilePath(e.target.value)}
              placeholder="./Dockerfile"
              onFocus={e => e.currentTarget.style.borderColor = RENDER_MINT}
              onBlur={e => e.currentTarget.style.borderColor = 'var(--line-strong)'} />
          </Field>
        ) : (
          <>
            <Field label="BUILD COMMAND">
              <input style={inputStyle()} value={buildCommand} onChange={(e) => setBuildCommand(e.target.value)}
                placeholder="npm install"
                onFocus={e => e.currentTarget.style.borderColor = RENDER_MINT}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--line-strong)'} />
            </Field>
            <Field label="START COMMAND" hint="Your server must listen on the PORT env variable Render provides.">
              <input style={inputStyle()} value={startCommand} onChange={(e) => setStartCommand(e.target.value)}
                placeholder="npm start"
                onFocus={e => e.currentTarget.style.borderColor = RENDER_MINT}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--line-strong)'} />
            </Field>
          </>
        )}

        {/* Plan note */}
        <div style={{
          fontFamily: 'var(--font-number)', fontSize: '0.52rem',
          color: 'var(--t4)', letterSpacing: '0.04em',
        }}>
          PLAN: FREE — SPINS DOWN AFTER 15 MIN OF INACTIVITY. UPGRADE ANYTIME ON RENDER.
        </div>

        {/* Error */}
        {error && (
          <div style={{
            fontFamily: 'var(--font-number)',
            fontSize: '0.58rem',
            color: 'var(--crimson)',
            fontWeight: 600,
            letterSpacing: '0.02em',
            lineHeight: 1.5,
            wordBreak: 'break-word',
          }}>
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              height: '34px',
              padding: '0 20px',
              background: 'transparent',
              color: 'var(--t3)',
              border: '1px solid var(--line-strong)',
              borderRadius: '4px',
              fontFamily: 'var(--font-header)',
              fontWeight: 800,
              fontSize: '0.58rem',
              letterSpacing: '0.06em',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--t1)'; e.currentTarget.style.borderColor = 'var(--t2)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--t3)'; e.currentTarget.style.borderColor = 'var(--line-strong)'; }}
          >
            CANCEL
          </button>
          <button
            onClick={handleCreate}
            disabled={!canSubmit}
            style={{
              height: '34px',
              padding: '0 24px',
              background: isCreating ? 'rgba(70, 227, 183, 0.15)' : `linear-gradient(135deg, ${RENDER_MINT} 0%, #1BA57B 100%)`,
              color: '#06251C',
              border: 'none',
              borderRadius: '4px',
              fontFamily: 'var(--font-header)',
              fontWeight: 800,
              fontSize: '0.58rem',
              letterSpacing: '0.06em',
              cursor: canSubmit ? 'pointer' : 'default',
              transition: 'all 0.2s ease',
              opacity: canSubmit || isCreating ? 1 : 0.4,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            {isCreating ? (
              <>
                <span style={{
                  width: '10px', height: '10px',
                  border: '2px solid rgba(6,37,28,0.3)',
                  borderTop: '2px solid #06251C',
                  borderRadius: '50%',
                  animation: 'spin-slow 0.8s linear infinite',
                }} />
                CREATING...
              </>
            ) : (
              'CREATE SERVICE'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateServiceModal;

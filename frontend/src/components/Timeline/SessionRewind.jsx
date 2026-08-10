/* -------------------------------------------------------
 * SessionRewind.jsx — take the whole project back to a moment
 *
 * Git can return you to your last commit. During a sprint nobody has committed
 * for hours, so that is rarely where you want to be. This scrubs a continuous
 * history of the entire project and puts it back — for everyone at once.
 *
 * Preview deliberately does NOT go through the editor. Writing history into
 * Monaco would push it out through the CRDT binding and show the past on every
 * collaborator's screen, so looking becomes indistinguishable from restoring.
 * Preview renders here, read-only, and touches nothing shared. Only Restore
 * changes anything, and it says so first.
 * ------------------------------------------------------- */

import React, { useState, useMemo, useEffect } from 'react';
import useEditorStore from '../../store/useEditorStore';

const clock = (ts) =>
  new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const SessionRewind = () => {
  const rewindLog = useEditorStore((s) => s.rewindLog);
  const rewindIndex = useEditorStore((s) => s.rewindIndex);
  const rewindBusy = useEditorStore((s) => s.rewindBusy);
  const rewindNotice = useEditorStore((s) => s.rewindNotice);
  const setRewindIndex = useEditorStore((s) => s.setRewindIndex);
  const clearRewindNotice = useEditorStore((s) => s.clearRewindNotice);
  const restoreRewindPoint = useEditorStore((s) => s.restoreRewindPoint);
  const projectAtRewind = useEditorStore((s) => s.projectAtRewind);
  const fileContributors = useEditorStore((s) => s.fileContributors);
  const undoUserChanges = useEditorStore((s) => s.undoUserChanges);
  const activePath = useEditorStore((s) => s.activePath);
  // Subscribed so the author list re-renders as attribution changes.
  useEditorStore((s) => s.remoteLineChanges);
  const lastGoodRewindIndex = useEditorStore((s) => s.lastGoodRewindIndex);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPath, setPreviewPath] = useState(null);
  const [confirming, setConfirming] = useState(false);

  const count = rewindLog.length;
  // Default to the newest point so the slider starts where the user is.
  const index = rewindIndex == null ? count - 1 : rewindIndex;
  const point = rewindLog[index];

  const lastGood = lastGoodRewindIndex();

  // Rebuilding the project walks the whole delta chain, so only do it when the
  // preview is actually open and only for the point being looked at.
  const previewFiles = useMemo(
    () => (previewOpen && point ? projectAtRewind(index) : null),
    [previewOpen, index, point, projectAtRewind]
  );

  useEffect(() => {
    if (!previewFiles) return;
    const paths = Object.keys(previewFiles).sort();
    if (paths.length && (!previewPath || !paths.includes(previewPath))) {
      setPreviewPath(paths[0]);
    }
  }, [previewFiles, previewPath]);

  const contributors = activePath ? fileContributors(activePath) : [];
  const fileName = activePath ? activePath.split('/').pop() : '';

  /* Rendered even with no history yet: attribution is live from the moment a
   * collaborator types, and is useful long before the first checkpoint. */
  const authorSection = contributors.length > 0 && (
    <div className="rw-authors">
      <div className="rw-authors-head">
        Undo one person&rsquo;s changes <span className="rw-authors-file">{fileName}</span>
      </div>
      <div className="rw-authors-sub">
        Takes back only their lines and leaves everyone else&rsquo;s alone — the thing
        a git revert cannot do.
      </div>
      {contributors.map((c) => (
        <div key={c.userId} className="rw-author">
          <span className="rw-author-dot" style={{ background: c.color }} />
          <span className="rw-author-name">{c.username}</span>
          <span className="rw-author-lines">
            {c.lines} line{c.lines === 1 ? '' : 's'}
          </span>
          <button
            className="rw-btn rw-author-btn"
            disabled={rewindBusy}
            onClick={async () => {
              const res = await undoUserChanges(activePath, c.userId);
              if (!res.ok) useEditorStore.setState({ rewindNotice: res.reason });
            }}
          >
            Undo their changes
          </button>
        </div>
      ))}
    </div>
  );

  if (count === 0) {
    return (
      <div className="rw-empty">
        <div className="rw-empty-title">Session Rewind</div>
        <div className="rw-empty-sub">
          History starts as soon as there are files open. Every few seconds, and
          on every run, the whole project is checkpointed — so you can come back
          to any moment, not just to a commit.
        </div>
        {authorSection}
      </div>
    );
  }

  /* Evenly spaced hour labels across the span the history covers. */
  const first = rewindLog[0].at;
  const last = rewindLog[count - 1].at;
  const ticks = [];
  const span = Math.max(1, last - first);
  for (let i = 0; i < 4; i++) {
    ticks.push(clock(first + (span * i) / 3));
  }

  const handleRestore = async () => {
    if (!confirming) { setConfirming(true); return; }
    setConfirming(false);
    setPreviewOpen(false);
    await restoreRewindPoint(index);
  };

  return (
    <div className="rw-panel">
      <div className="rw-head">
        <span className="rw-title">Session Rewind</span>
        {lastGood >= 0 && (
          <button
            type="button"
            className="rw-lastgood"
            onClick={() => { setRewindIndex(lastGood); setConfirming(false); }}
            title="Jump the slider to the most recent run that worked"
          >
            <span className="rw-lastgood-dot" />
            Last working build · {clock(rewindLog[lastGood].at)}
          </button>
        )}
      </div>

      <div className="rw-ticks">
        {ticks.map((t, i) => <span key={i}>{t}</span>)}
      </div>

      <div className="rw-track">
        <input
          type="range"
          className="rw-range"
          min={0}
          max={count - 1}
          value={index}
          onChange={(e) => { setRewindIndex(Number(e.target.value)); setConfirming(false); }}
          aria-label="Point in session history"
        />
        {/* Runs marked along the track, so a bad patch is findable by eye. */}
        <div className="rw-marks">
          {rewindLog.map((p, i) => p.run && (
            <span
              key={p.id}
              className={`rw-mark ${p.run === 'ok' ? 'is-ok' : 'is-fail'}`}
              style={{ left: `${count === 1 ? 0 : (i / (count - 1)) * 100}%` }}
              title={`${p.run === 'ok' ? 'Ran clean' : 'Run failed'} at ${clock(p.at)}`}
            />
          ))}
        </div>
      </div>

      <div className="rw-selected">
        <span className="rw-selected-time">{clock(point.at)}</span>
        <span className="rw-selected-meta">
          {index === count - 1 ? 'now' : `${count - 1 - index} checkpoint${count - index === 2 ? '' : 's'} ago`}
          {point.run === 'ok' && ' · ran clean'}
          {point.run === 'fail' && ' · run failed'}
        </span>
      </div>

      <div className="rw-actions">
        <button
          className="rw-btn"
          onClick={() => setPreviewOpen((v) => !v)}
          disabled={rewindBusy}
        >
          {previewOpen ? 'Hide preview' : 'Preview'}
        </button>
        <button
          className={`rw-btn ${confirming ? 'is-confirm' : 'is-primary'}`}
          onClick={handleRestore}
          disabled={rewindBusy || index === count - 1}
          title={index === count - 1 ? 'This is the current state' : undefined}
        >
          {rewindBusy ? 'Restoring…' : confirming ? 'Confirm — restore for everyone' : 'Restore Everything'}
        </button>
        {confirming && (
          <button className="rw-btn" onClick={() => setConfirming(false)}>Cancel</button>
        )}
      </div>

      {confirming && (
        <div className="rw-warn">
          Every file goes back to {clock(point.at)} for everyone in the session.
          Anything written since is replaced — but this is itself checkpointed
          first, so it can be undone.
        </div>
      )}

      {rewindNotice && (
        <div className="rw-notice">
          {rewindNotice}
          <button className="rw-notice-x" onClick={clearRewindNotice} aria-label="Dismiss">×</button>
        </div>
      )}

      {authorSection}

      {previewOpen && previewFiles && (
        <div className="rw-preview">
          <div className="rw-preview-head">
            Project at {clock(point.at)} — read-only, nobody else sees this
          </div>
          <div className="rw-preview-body">
            <div className="rw-preview-files">
              {Object.keys(previewFiles).sort().map((path) => (
                <button
                  key={path}
                  className={`rw-preview-file ${path === previewPath ? 'is-active' : ''}`}
                  onClick={() => setPreviewPath(path)}
                  title={path}
                >
                  {path.split('/').pop()}
                </button>
              ))}
            </div>
            <pre className="rw-preview-code">
              {previewPath != null ? previewFiles[previewPath] : ''}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};

export default SessionRewind;

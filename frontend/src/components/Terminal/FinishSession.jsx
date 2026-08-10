/* -------------------------------------------------------
 * FinishSession.jsx — the one moment git is allowed back in
 *
 * The point of a live session is that nobody manages branches while they are
 * building. But the work still has to land somewhere, and if that is left as
 * "someone figure out git afterwards", the pain was not removed — it was moved
 * to 4am, when everyone is exhausted and the deadline is twenty minutes away.
 *
 * So the session gets an ending: one commit, everything in it, pushed, with
 * every participant named as a co-author.
 *
 * The co-authors are the part that cannot be reconstructed later. Normally one
 * person pushes and GitHub records the work as theirs alone; the other three
 * become invisible. This app is the only thing that knows who was actually in
 * the room, and that knowledge is thrown away the moment the session closes.
 * ------------------------------------------------------- */

import React, { useState } from 'react';
import useEditorStore from '../../store/useEditorStore';
import { executeGitCommit, gitPush } from '../../services/api';

/* Git's own convention. Trailers must sit at the very end of the message, one
 * per line, after a blank line — GitHub and most forges parse them positionally
 * and quietly ignore anything malformed. */
const coAuthorTrailers = (people) =>
  people.map((p) => {
    const handle = (p.username || 'collaborator').trim().replace(/\s+/g, '-').toLowerCase();
    return `Co-authored-by: ${p.username} <${handle}@causify.local>`;
  });

const FinishSession = () => {
  const sessionId = useEditorStore((s) => s.sessionId);
  const sessionName = useEditorStore((s) => s.sessionName);
  const files = useEditorStore((s) => s.files);
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const connectedUsers = useEditorStore((s) => s.connectedUsers);
  const currentUser = useEditorStore((s) => s.currentUser);
  const gitRepoConnected = useEditorStore((s) => s.gitRepoConnected);

  const [summary, setSummary] = useState('');
  const [state, setState] = useState('idle');   // idle | working | done | error
  const [detail, setDetail] = useState('');
  const [confirming, setConfirming] = useState(false);

  if (!sessionId) return null;

  const isLocalRepo = Boolean(workspaceRoot);

  /* Everyone who was here, the current user included — connectedUsers holds
   * peers, and the person pressing the button is just as much an author. */
  const participants = [
    ...(currentUser ? [currentUser] : []),
    ...connectedUsers.filter((u) => u.id !== currentUser?.id),
  ];

  const fileCount = Object.values(files || {}).filter((c) => typeof c === 'string').length;

  const buildMessage = () => {
    const headline = summary.trim() || `Session: ${sessionName || 'collaborative work'}`;
    const others = participants.filter((p) => p.id !== currentUser?.id);
    // The author of the commit is whoever pushes; the rest are trailers.
    const trailers = coAuthorTrailers(others);
    return trailers.length ? `${headline}\n\n${trailers.join('\n')}` : headline;
  };

  const handleFinish = async () => {
    if (!confirming) { setConfirming(true); return; }
    setConfirming(false);
    setState('working');
    setDetail('Committing…');

    try {
      const message = buildMessage();

      const commit = await executeGitCommit({
        sessionId,
        message,
        // Local repos commit the working tree as it stands; sending contents
        // would overwrite the user's own files with the editor's copy.
        files: isLocalRepo
          ? undefined
          : Object.entries(files)
              .filter(([, content]) => typeof content === 'string')
              .map(([path, content]) => ({ path, content })),
      });

      if (commit.success === false) {
        const nothing = commit.error && commit.error.includes('nothing to commit');
        if (!nothing) {
          setState('error');
          setDetail(commit.error || 'Commit failed.');
          return;
        }
        setDetail('Nothing new to commit — pushing what is already here…');
      } else {
        setDetail('Committed. Pushing…');
      }

      const push = await gitPush(sessionId);
      if (push.success === false) {
        // The commit is safe on disk even if the push failed, and saying so
        // stops anyone panicking and re-running the whole thing.
        setState('error');
        setDetail(`Committed locally, but the push failed: ${push.error || 'unknown error'}`);
        return;
      }

      setState('done');
      setDetail(`Pushed${participants.length > 1 ? ` with ${participants.length} authors` : ''}.`);
    } catch (err) {
      setState('error');
      setDetail(err.response?.data?.error || err.message || 'Something went wrong.');
    }
  };

  if (!gitRepoConnected) {
    return (
      <div className="fin-panel">
        <div className="fin-title">Finish &amp; push</div>
        <div className="fin-sub">
          Connect a repository above, and this will close the session with a single
          commit — everything in it, pushed, with everyone credited.
        </div>
      </div>
    );
  }

  if (state === 'done') {
    return (
      <div className="fin-panel is-done">
        <div className="fin-title">Session landed</div>
        <div className="fin-sub">{detail}</div>
        <div className="fin-authors">
          {participants.map((p) => (
            <span key={p.id} className="fin-author">
              <span className="fin-author-dot" style={{ background: p.color || '#6366f1' }} />
              {p.username}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="fin-panel">
      <div className="fin-title">Finish &amp; push</div>
      <div className="fin-sub">
        One commit with everything in it, pushed, and every person here recorded
        as an author — so the work is not filed under whoever happened to press
        the button.
      </div>

      <input
        className="fin-input"
        placeholder={`What did you build?  (default: "Session: ${sessionName || 'collaborative work'}")`}
        value={summary}
        onChange={(e) => { setSummary(e.target.value); setConfirming(false); }}
        onKeyDown={(e) => { if (e.key === 'Enter') handleFinish(); }}
        spellCheck={false}
        disabled={state === 'working'}
      />

      <div className="fin-meta">
        <span>{fileCount} file{fileCount === 1 ? '' : 's'}</span>
        <span className="fin-dot-sep">·</span>
        <span>{participants.length} author{participants.length === 1 ? '' : 's'}</span>
      </div>

      <div className="fin-authors">
        {participants.map((p) => (
          <span key={p.id} className="fin-author">
            <span className="fin-author-dot" style={{ background: p.color || '#6366f1' }} />
            {p.username}
          </span>
        ))}
      </div>

      <div className="fin-actions">
        <button
          className={`fin-btn ${confirming ? 'is-confirm' : 'is-primary'}`}
          onClick={handleFinish}
          disabled={state === 'working'}
        >
          {state === 'working' ? detail : confirming ? 'Confirm — commit & push' : 'Finish & push'}
        </button>
        {confirming && state !== 'working' && (
          <button className="fin-btn" onClick={() => setConfirming(false)}>Cancel</button>
        )}
      </div>

      {state === 'error' && <div className="fin-error">{detail}</div>}
    </div>
  );
};

export default FinishSession;

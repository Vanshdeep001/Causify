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
import { PixelSprite, QuestionBlock, MARIO_IDLE, GOOMBA } from '../Output/MarioSprites';

/* Sprite widths, so nothing walks out of the frame at either end. */
const MARIO_W = 24;   // 12 cols x px 2
const BLOCK_W = 16;   // 16 cols x px 1
const FLAG_W = 12;    // pennant width; the post below it is 2px
const ROWS_PREVIEW = 8;   // lines shown before one edit needs asking to open

/* A checkpoint flag — in Mario it is the thing you return to when a run ends
 * badly, which is exactly what "last working build" means. Gold rather than
 * the usual success green: the coin is this world's currency for "good". */
const CheckpointFlag = ({ h = 26 }) => (
  <svg
    width={(12 * h) / 26}
    height={h}
    viewBox="0 0 12 26"
    shapeRendering="crispEdges"
    aria-hidden="true"
  >
    <rect x="5" y="0" width="2" height="26" fill="#8A6A24" />
    <rect x="5" y="0" width="2" height="2" fill="#FFB224" />
    <path d="M5 3 h6 v3 h-6 z M5 6 h5 v3 h-5 z" fill="#FFB224" />
  </svg>
);

/* Transport glyphs. Drawn as pixels rather than typed as unicode: the ⏪ family
 * renders at different sizes and baselines depending on the font, and several
 * fall back to colour emoji, which would break the machine-panel look. */
const Glyph = ({ d, w = 11 }) => (
  <svg width={w} height={w} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true">
    {d}
  </svg>
);

const IconPlay = () => (
  <Glyph d={<path d="M3 1 L10 6 L3 11 Z" fill="currentColor" />} />
);

const IconRewind = () => (
  <Glyph d={<g fill="currentColor"><path d="M6 1 L6 11 L1 6 Z" /><path d="M11 1 L11 11 L6 6 Z" /></g>} />
);

const IconUndo = () => (
  <Glyph d={<g fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M2.5 6 a3.5 3.5 0 1 1 1.2 2.7" />
    <path d="M2.5 2.6 L2.5 6 L5.9 6" />
  </g>} />
);

const IconChevron = ({ open }) => (
  <svg
    width="9" height="9" viewBox="0 0 12 12" aria-hidden="true"
    style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }}
  >
    <path d="M4 2 L8 6 L4 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

/* One edit, as the rows a reader actually wants to see. A modification is two
   rows — what it was and what it is — because the first is the half you are
   deciding about. A deletion is one row per line it took away. */
const editRows = (e) => {
  if (e.kind === 'removed') {
    return String(e.removedText ?? '').split('\n')
      .map((text) => ({ sign: '−', cls: 'is-del', text }));
  }
  if (e.kind === 'added') {
    return [{ sign: '+', cls: 'is-add', text: e.newLine }];
  }
  return [
    { sign: '−', cls: 'is-del', text: e.oldLine },
    { sign: '+', cls: 'is-add', text: e.newLine },
  ];
};

/* Grouped by file, and inside a file by line number.
 *
 * Straight reverse-chronological order listed the same filename over and over
 * and walked the line numbers backwards (27, 28, 1, 2), which reads as four
 * unrelated events rather than one file's worth of changes. Files keep their
 * recency order — the one touched last is the one you are looking for — but
 * within a file it now runs top to bottom, the way the file does. */
const byFile = (edits) => {
  const m = new Map();
  edits.forEach((e) => {
    if (!m.has(e.path)) m.set(e.path, { path: e.path, edits: [], latest: 0 });
    const g = m.get(e.path);
    g.edits.push(e);
    g.latest = Math.max(g.latest, e.timestamp || 0);
  });
  return [...m.values()]
    .sort((a, b) => b.latest - a.latest)
    .map((g) => ({ ...g, edits: [...g.edits].sort((x, y) => x.line - y.line) }));
};

const clock = (ts) =>
  new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/* A deletion can carry several lines; the checkpoint index shows the first and
   says how many followed, because this is a list to scan rather than a diff. */
const firstLine = (text = '') => {
  const lines = String(text).split(/\r?\n/);
  return lines.length > 1 ? `${lines[0]}  …+${lines.length - 1}` : lines[0];
};

/* Lines in a file, tolerant of either line ending. */
const lineCount = (text) => String(text ?? '').split(/\r?\n/).length;

/* Marking the run state by hand.
 *
 * It used to be inferred from the last execution, which is only right when the
 * owner happens to save straight after pressing Run. The person saving knows
 * whether this state works — they may have just checked it in a browser, or be
 * deliberately marking a broken point so it can be found again later. Same two
 * sprites the legend uses, so the mark chosen here is the mark that appears on
 * the track. Pressing the active one clears it back to unmarked. */
const RunPicker = ({ value, onChange, disabled }) => (
  <span className="rw-runpick" role="group" aria-label="Mark this checkpoint">
    <button
      type="button"
      className={`rw-runpick-btn ${value === 'ok' ? 'is-on' : ''}`}
      onClick={() => onChange(value === 'ok' ? null : 'ok')}
      disabled={disabled}
      title={value === 'ok' ? 'Marked as ran clean — click to clear' : 'Mark as ran clean'}
      aria-pressed={value === 'ok'}
    >
      <QuestionBlock hit={false} px={1} />
    </button>
    <button
      type="button"
      className={`rw-runpick-btn ${value === 'fail' ? 'is-on' : ''}`}
      onClick={() => onChange(value === 'fail' ? null : 'fail')}
      disabled={disabled}
      title={value === 'fail' ? 'Marked as run failed — click to clear' : 'Mark as run failed'}
      aria-pressed={value === 'fail'}
    >
      <PixelSprite rows={GOOMBA} px={1} />
    </button>
  </span>
);

const SessionRewind = () => {
  const rewindLog = useEditorStore((s) => s.rewindLog);
  const rewindIndex = useEditorStore((s) => s.rewindIndex);
  const rewindBusy = useEditorStore((s) => s.rewindBusy);
  const rewindNotice = useEditorStore((s) => s.rewindNotice);
  const setRewindIndex = useEditorStore((s) => s.setRewindIndex);
  const clearRewindNotice = useEditorStore((s) => s.clearRewindNotice);
  const restoreRewindPoint = useEditorStore((s) => s.restoreRewindPoint);
  const projectAtRewind = useEditorStore((s) => s.projectAtRewind);
  const changesSince = useEditorStore((s) => s.changesSince);
  const pruneAttribution = useEditorStore((s) => s.pruneAttribution);
  const undoChangesSince = useEditorStore((s) => s.undoChangesSince);
  const revertEdit = useEditorStore((s) => s.revertEdit);
  const canRewind = useEditorStore((s) => s.canRewind);
  const sessionId = useEditorStore((s) => s.sessionId);
  const userRole = useEditorStore((s) => s.userRole);
  // Subscribed so the author list re-renders as attribution changes.
  useEditorStore((s) => s.remoteLineChanges);
  useEditorStore((s) => s.remoteLineDeletions);
  const lastGoodRewindIndex = useEditorStore((s) => s.lastGoodRewindIndex);

  const captureCheckpoint = useEditorStore((s) => s.captureCheckpoint);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPath, setPreviewPath] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [draftLabel, setDraftLabel] = useState('');
  const [saving, setSaving] = useState(false);
  // null | 'ok' | 'fail' — what the owner is marking THIS save as.
  const [draftRun, setDraftRun] = useState(null);
  const [openAuthor, setOpenAuthor] = useState(null);
  // Individual edits that have been expanded past the preview cap.
  const [longOpen, setLongOpen] = useState(() => new Set());

  /* Read-only for everyone but the owner. Restoring rewrites every file on
     every screen, so it is one person's call — but scrubbing, previewing and
     reading who did what stay open to the whole room. */
  const mayChange = canRewind();
  const readOnlyWhy = sessionId && userRole !== 'owner'
    ? 'Only the session owner can change history. You can look anywhere.'
    : null;

  /* Declared above the empty-state return below, not beside the other handlers:
     that branch renders the save control too, and a `const` referenced before
     its declaration is in the temporal dead zone — it would throw on render for
     the one case the control exists to serve. */
  const handleCapture = () => {
    const result = captureCheckpoint({ label: draftLabel, run: draftRun });
    if (!result?.ok) return;
    setDraftLabel('');
    setDraftRun(null);
    setSaving(true);
    // "Saved" is a brief acknowledgement; the new point on the track is the
    // real confirmation.
    setTimeout(() => setSaving(false), 1600);
  };

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

  /* Once, on open. A client that has been running since before a fix to the
     attribution rules is still holding whatever it recorded then, and no amount
     of correctness in the writer clears what is already there. */
  useEffect(() => { pruneAttribution(); }, [pruneAttribution]);

  useEffect(() => {
    if (!previewFiles) return;
    const paths = Object.keys(previewFiles).sort();
    if (paths.length && (!previewPath || !paths.includes(previewPath))) {
      setPreviewPath(paths[0]);
    }
  }, [previewFiles, previewPath]);

  /* An empty history is a state of the panel, not a different screen.
   *
   * It used to return a separate placeholder, which meant the level — the whole
   * point of this panel — only appeared once a checkpoint already existed. The
   * owner was reading an explanation of a thing they could not see. The track
   * draws from the first render now: empty ground, Mario at the start line, and
   * the save control above it.
   */
  const isEmpty = count === 0;

  /* The level is drawn in TIME, not in checkpoint order.
   *
   * Checkpoints are only appended when something actually changed, so idle
   * stretches collapse and the two spaces disagree. Laying sprites out by index
   * under an axis labelled in clock time meant every label was describing a
   * position it did not own: a block under "11:42" might be a run from 11:47.
   * One shared projection now drives the labels, the blocks, the flag and
   * Mario, so what the axis says is what you are looking at. */
  const first = isEmpty ? Date.now() : rewindLog[0].at;
  const last = isEmpty ? first : rewindLog[count - 1].at;
  const span = Math.max(1, last - first);
  const atOf = (ts) => (count <= 1 ? 0 : (ts - first) / span);

  /* Four labels across a session two minutes old all read the same clock time,
     which is three repetitions of one fact dressed up as an axis. Duplicates
     collapse into the earliest position that carries them. An empty track gets
     no labels at all — there is no time to describe yet. */
  const ticks = [];
  if (!isEmpty) {
    for (let i = 0; i < 4; i++) {
      const f = i / 3;
      const label = clock(first + span * f);
      if (ticks.length && ticks[ticks.length - 1].label === label) continue;
      ticks.push({ label, f });
    }
  }

  const scrubAt = point ? atOf(point.at) : 0;
  const sinceList = point ? changesSince(point.at) : [];

  const handleRestore = async () => {
    if (!confirming) { setConfirming(true); return; }
    setConfirming(false);
    setPreviewOpen(false);
    await restoreRewindPoint(index);
  };

  return (
    <div className="rw-panel">
      <header className="rw-bar">
        <span className="rw-title">Session Rewind</span>
        {readOnlyWhy && <span className="rw-role" title={readOnlyWhy}>read-only</span>}
      </header>

      {/* Saving is the owner's call, so the control to do it lives at the top of
          their panel rather than hidden behind the scrubber. Collaborators get
          the same history without the button — they need to know the points are
          somebody's decision, not a clock's. */}
      {mayChange ? (
        <div className="rw-save">
          <input
            className="rw-save-input"
            placeholder="What is worth saving here?  (optional)"
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCapture(); }}
            spellCheck={false}
            maxLength={120}
            disabled={rewindBusy}
          />
          <RunPicker value={draftRun} onChange={setDraftRun} disabled={rewindBusy} />
          <button
            className="rw-save-btn"
            onClick={handleCapture}
            disabled={rewindBusy || saving}
          >
            {saving ? 'Saved' : 'Save state'}
          </button>
        </div>
      ) : (
        <div className="rw-save is-passive">
          <span className="rw-save-note">
            The session owner decides when the project is checkpointed.
          </span>
        </div>
      )}

      <div className="rw-stage">
      {/* Placed on the position each one names. `space-between` distributed the
          GAPS evenly, which left every label offset from its own tick by half
          its width — up to ~35px at the ends. */}
      <div className="rw-ticks">
        {ticks.map((t, i) => (
          <span
            key={i}
            style={{
              left: `${t.f * 100}%`,
              transform: `translateX(-${t.f * 100}%)`,
            }}
          >
            {t.label}
          </span>
        ))}
      </div>

      {/* The history as a level: blocks are runs that passed, Goombas are runs
          that failed, the flag is the last state that worked, and the slider
          thumb is the plumber himself walking back through the night. */}
      <div className="rwl">
        <div className="rwl-sky">
          {rewindLog.map((p, i) => {
            if (!p.run) return null;
            /* The flag stands on the last clean run, so that checkpoint would
               otherwise draw a block underneath it at the same offset. The flag
               already says "ran clean", and says more — it takes the spot. */
            if (i === lastGood) return null;
            const at = atOf(p.at);
            return (
              <span
                key={p.id}
                className={`rwl-marker ${p.run === 'ok' ? 'is-ok' : 'is-fail'}`}
                style={{ left: `calc(${at * 100}% - ${BLOCK_W * at}px)` }}
                title={`${p.run === 'ok' ? 'Ran clean' : 'Run failed'} at ${clock(p.at)}`}
              >
                {p.run === 'ok'
                  ? <QuestionBlock hit={false} px={1} />
                  : <PixelSprite rows={GOOMBA} px={1} />}
              </span>
            );
          })}

          {/* A landmark, not a sprite.
              Mario stands at the last clean run whenever it is also the newest
              checkpoint — which is the view this panel opens on — so the two
              share a coordinate by design and no amount of z-ordering makes two
              sprites legible in one 20x30 box. Drawn instead as a post running
              the height of the stage, behind everything, with its pennant up in
              the empty band above the sprites. Mario walks in front of it and
              both stay readable. */}
          {lastGood >= 0 && (() => {
            const at = atOf(rewindLog[lastGood].at);
            return (
              <span
                className="rwl-flag"
                style={{ left: `calc(${at * 100}% - ${FLAG_W * at}px)` }}
                title={`Last working build · ${clock(rewindLog[lastGood].at)}`}
              >
                <svg width="12" height="11" viewBox="0 0 12 11" shapeRendering="crispEdges" aria-hidden="true">
                  <rect x="0" y="0" width="2" height="11" fill="#FFB224" />
                  <path d="M2 1 h8 v3 h-8 z M2 4 h6 v3 h-6 z" fill="#FFB224" />
                </svg>
                <span className="rwl-flag-post" />
              </span>
            );
          })()}

          <span
            className="rwl-mario"
            style={{ left: `calc(${scrubAt * 100}% - ${MARIO_W * scrubAt}px)` }}
          >
            <PixelSprite rows={MARIO_IDLE} px={2} />
          </span>
        </div>

        <div className="rwl-ground" />

        {/* The real control, invisible on top: dragging, arrow keys and screen
            readers all keep working while the level does the drawing. */}
        <input
          type="range"
          className="rwl-range"
          min={0}
          max={Math.max(0, count - 1)}
          value={isEmpty ? 0 : index}
          disabled={isEmpty}
          onChange={(e) => { setRewindIndex(Number(e.target.value)); setConfirming(false); }}
          aria-label="Point in session history"
        />
      </div>

      <div className="rwl-legend">
        <span className="rwl-key">
          <QuestionBlock hit={false} px={1} /> ran clean
        </span>
        <span className="rwl-key">
          <PixelSprite rows={GOOMBA} px={1} /> run failed
        </span>
        <span className="rwl-key">
          <CheckpointFlag h={13} /> last working build
        </span>
        <span className="rwl-key">
          <PixelSprite rows={MARIO_IDLE} px={1} /> you are here — drag to travel
        </span>
      </div>
      </div>

      {/* Command deck: the moment on the left, the actions on the right. These
          were three stacked blocks that all described the same selection, so
          they read as unrelated rows rather than one decision. */}
      <div className="rw-deck">
        <div className="rw-counter">
          {isEmpty ? (
            <>
              <span className="rw-counter-time is-idle">--:--</span>
              <span className="rw-counter-meta">no checkpoints yet</span>
            </>
          ) : (
            <>
              <span className="rw-counter-time">{clock(point.at)}</span>
              <span className="rw-counter-meta">
                {index === count - 1 ? 'latest' : `${count - 1 - index} back`}
                {point.run === 'ok' && ' · ran clean'}
                {point.run === 'fail' && ' · run failed'}
                {point.kind === 'auto' && ' · auto, before an undo'}
              </span>
              {point.label && <span className="rw-counter-label">“{point.label}”</span>}
              {point.by?.username && (
                <span className="rw-counter-by">saved by {point.by.username}</span>
              )}
            </>
          )}
        </div>

        <div className="rw-deck-actions">
          {/* Nothing to look at or go back to until a point exists. Disabled
              rather than hidden, so the deck does not rearrange itself the
              moment the first checkpoint lands. */}
          <button
            className="rw-key"
            onClick={() => setPreviewOpen((v) => !v)}
            disabled={rewindBusy || isEmpty}
          >
            <span className="rw-key-icon"><IconPlay /></span>
            {previewOpen ? 'Hide' : 'Preview'}
          </button>
          {mayChange ? (
            <button
              className={`rw-key is-primary ${confirming ? 'is-confirm' : ''}`}
              onClick={handleRestore}
              disabled={rewindBusy || isEmpty || index === count - 1}
              title={isEmpty
                ? 'Save a checkpoint first'
                : index === count - 1 ? 'This is the current state' : undefined}
            >
              <span className="rw-key-icon"><IconRewind /></span>
              {rewindBusy ? 'Restoring…' : confirming ? 'Confirm' : 'Restore all'}
            </button>
          ) : (
            /* Told up front, not after the click. A key that looks live and
               then refuses is worse than one that never pretended. */
            <span className="rw-viewing" title={readOnlyWhy}>Viewing only</span>
          )}
          {confirming && (
            <button className="rw-key is-ghost" onClick={() => setConfirming(false)}>Cancel</button>
          )}
        </div>
      </div>

      {/* One line, under the deck, where the standalone placeholder used to be
          a whole screen. The track above already shows there is nothing on it. */}
      {isEmpty && (
        <div className="rw-hint">
          {mayChange
            ? 'The track is empty. Save a state whenever the project is somewhere worth coming back to — it is checkpointed for everyone, with a record of who changed what since the last one.'
            : 'The track is empty. The session owner decides when the project is checkpointed; every save shows up here for the whole room.'}
        </div>
      )}

      {confirming && point && (
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

      {/* What this checkpoint is a record OF: the work that landed between the
          previous save and this one, per person, per file. Frozen when the point
          was taken — attribution keeps moving as people work, and a record of a
          moment has to stop moving with it. Distinct from the block below, which
          answers the opposite question: what has happened SINCE here. */}
      {/* Uploading a folder is not somebody's work. When a checkpoint records no
          human edits it says so, rather than rendering nothing and leaving the
          reader unsure whether it found nothing or failed to look. */}
      {point && point.kind === 'manual' && !(point.credits?.length > 0) && (
        <div className="rw-cap">
          <div className="rw-cap-head">
            <span>In this checkpoint</span>
            <span className="rw-cap-rule" />
            <span className="rw-cap-total is-none">nothing</span>
          </div>
          <div className="rwc-none">
            No edits by anyone since the previous checkpoint. Files that merely
            arrived — an upload, an import, a project handed to a joiner — are
            not counted as anybody's changes.
          </div>

          {/* With no changes to list, the useful thing is what was actually
              saved. The whole project, not the one or two files somebody
              happened to have open. */}
          {(() => {
            const snap = projectAtRewind(index);
            const paths = Object.keys(snap).sort();
            if (paths.length === 0) return null;
            const total = paths.reduce(
              (n, p2) => n + lineCount(snap[p2]), 0);
            return (
              <div className="rw-snap">
                <div className="rw-snap-head">
                  <span>Saved in this checkpoint</span>
                  <span className="rw-cap-rule" />
                  <span className="rw-snap-total">
                    {paths.length} file{paths.length === 1 ? '' : 's'} · {total} lines
                  </span>
                </div>
                {paths.map((p2) => (
                  <div key={p2} className="rw-snap-row">
                    <span className="rw-snap-path" title={p2}>{p2}</span>
                    <span className="rw-snap-lines">
                      {lineCount(snap[p2])}
                    </span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {point?.credits?.length > 0 && (
        <div className="rw-cap">
          <div className="rw-cap-head">
            <span>In this checkpoint</span>
            <span className="rw-cap-rule" />
            <span className="rw-cap-total">
              {point.credits.reduce((n, c) => n + (c.lines || 0), 0)} lines
            </span>
          </div>

          {point.credits.map((c) => (
            <React.Fragment key={c.userId}>
            <div className="rw-cap-row">
              <span className="rw-cap-dot" style={{ background: c.color || '#FFFFFF' }} />
              <span className="rw-cap-name">{c.username}</span>
              <span className="rw-cap-lines">{c.lines} {c.lines === 1 ? 'line' : 'lines'}</span>
              <span className="rw-cap-files">
                {(c.files || []).map((f) => (
                  <span key={f.path} className="rw-cap-file" title={f.path}>
                    {f.path.split('/').pop()}
                    <b>{f.lines}</b>
                  </span>
                ))}
              </span>
            </div>

            {/* The lines themselves. A count is a claim; these are the evidence
                for it, so a wrong number is visible as a wrong line rather than
                being taken on trust. */}
            {(c.edits || []).length > 0 && (
              <div className="rw-cap-lines-list">
                {c.edits.map((e, i) => (
                  <div key={`${e.path}-${e.line}-${i}`} className="rw-cap-edit">
                    <span className="rw-cap-loc" title={e.path}>
                      {e.path.split('/').pop()}<b>:{e.line}</b>
                    </span>
                    {e.kind === 'removed' ? (
                      <span className="rw-cap-text is-del">− {firstLine(e.removedText)}</span>
                    ) : e.kind === 'added' ? (
                      <span className="rw-cap-text is-add">+ {e.newLine}</span>
                    ) : (
                      <>
                        <span className="rw-cap-text is-del">− {e.oldLine}</span>
                        <span className="rw-cap-text is-add">+ {e.newLine}</span>
                      </>
                    )}
                  </div>
                ))}
                {c.lines > c.edits.length && (
                  <div className="rw-cap-more">
                    +{c.lines - c.edits.length} more line{c.lines - c.edits.length === 1 ? '' : 's'}
                  </div>
                )}
              </div>
            )}
          </React.Fragment>
          ))}
        </div>
      )}

      {/* Anchored to the selected point: "the build was fine at 12:52 — what
          has happened since?" is the question worth answering, and it turns a
          vague contributor list into a short set of suspects.

          Each person opens into the changes themselves, because "Priya changed
          52 lines" is not actionable and "Priya deleted the <script> tag from
          index.html" is. Restoring the whole project and undoing a whole person
          are both far larger than the thing that actually went wrong. */}
      {index < count - 1 && (
        <div className="rwc">
          <div className="rwc-head">
            Changed since <b>{clock(point.at)}</b>
          </div>

          {sinceList.length === 0 ? (
            <div className="rwc-none">Nothing from anyone else after this point</div>
          ) : sinceList.map((u) => {
            const open = openAuthor === u.userId;
            const shown = open ? u.edits.slice(0, 12) : [];
            return (
              <div key={u.userId} className={`rwc-block ${open ? 'is-open' : ''}`}>
                <button
                  type="button"
                  className="rwc-row"
                  onClick={() => setOpenAuthor(open ? null : u.userId)}
                  aria-expanded={open}
                  title={open ? 'Hide the changes' : 'Show exactly what changed'}
                >
                  <span className="rwc-caret"><IconChevron open={open} /></span>
                  <span className="rwc-dot" style={{ background: u.color }} />
                  <span className="rwc-name">{u.username}</span>
                  <span className="rwc-count">
                    {u.lines} line{u.lines === 1 ? '' : 's'}
                  </span>
                  <span className="rwc-files">
                    {u.files.slice(0, 2).map((f) => f.path.split('/').pop()).join(', ')}
                    {u.files.length > 2 && ` +${u.files.length - 2}`}
                  </span>
                </button>

                {open && (
                  <div className="rwc-edits">
                    {byFile(shown).map((g) => (
                      <div key={g.path} className="rwf">
                        <div className="rwf-head">
                          <span className="rwf-name">{g.path.split('/').pop()}</span>
                          {g.path.includes('/') && (
                            <span className="rwf-dir">
                              {g.path.slice(0, g.path.lastIndexOf('/'))}
                            </span>
                          )}
                          <span className="rwf-n">
                            {g.edits.length} change{g.edits.length === 1 ? '' : 's'}
                          </span>
                        </div>

                        {g.edits.map((e, i) => (
                          <div key={`${e.line}:${i}`} className="rwr">
                            {/* The line number lives in a gutter, as it does in
                                the editor, so the eye reads down a column
                                instead of across a repeated filename. */}
                            <span className="rwr-ln">{e.line}</span>

<span className="rwr-body">
                              {(() => {
                                /* A whole-file deletion is one edit carrying
                                   sixty rows, which buries every other change
                                   under it. Show the head of it and let the
                                   reader ask for the rest. */
                                const key = `${e.path}:${e.line}:${e.id ?? e.kind}`;
                                const rows = editRows(e);
                                const full = longOpen.has(key);
                                const cut = full ? rows : rows.slice(0, ROWS_PREVIEW);
                                return (
                                  <>
                                    {cut.map((r, j) => (
                                      <span key={j} className={`rwr-line ${r.cls}`}>
                                        <i className="rwr-sign">{r.sign}</i>
                                        {r.text === '' || r.text == null
                                          ? <em className="rwr-empty">blank line</em>
                                          : r.text}
                                      </span>
                                    ))}
                                    {rows.length > ROWS_PREVIEW && (
                                      <button
                                        type="button"
                                        className="rwr-more"
                                        onClick={() => setLongOpen((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(key)) next.delete(key);
                                          else next.add(key);
                                          return next;
                                        })}
                                      >
                                        {full
                                          ? 'show less'
                                          : `${rows.length - ROWS_PREVIEW} more lines`}
                                      </button>
                                    )}
                                  </>
                                );
                              })()}
                            </span>

                            {mayChange && (
                              <button
                                className="rwr-undo"
                                disabled={rewindBusy}
                                onClick={async (ev) => {
                                  ev.stopPropagation();
                                  const res = await revertEdit(e);
                                  if (!res.ok) useEditorStore.setState({ rewindNotice: res.reason });
                                }}
                                title={e.kind === 'removed'
                                  ? `Put ${e.count > 1 ? `these ${e.count} lines` : 'this line'} back`
                                  : 'Return this line to what it was'}
                                aria-label={e.kind === 'removed' ? 'Put back' : 'Revert'}
                              >
                                <IconUndo />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}

                    {u.edits.length > shown.length && (
                      <div className="rwc-trunc">
                        {u.edits.length - shown.length} more not shown
                      </div>
                    )}

                    {mayChange && (
                      <button
                        className="rw-key is-small rwc-all"
                        disabled={rewindBusy}
                        onClick={async () => {
                          const res = await undoChangesSince(u.userId, point.at);
                          if (!res.ok) useEditorStore.setState({ rewindNotice: res.reason });
                        }}
                        title={`Take back everything ${u.username} did since ${clock(point.at)}`}
                      >
                        <span className="rw-key-icon"><IconUndo /></span>
                        Undo everything from {u.username}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

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

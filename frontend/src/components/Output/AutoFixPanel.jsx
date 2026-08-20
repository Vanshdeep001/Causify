/* -------------------------------------------------------
 * AutoFixPanel.jsx — Autonomous repair agent, played as a level
 *
 * The diagnosis above tells you what broke. This offers to fix it: the agent
 * patches the code, RUNS it, and only then shows you the result.
 *
 * The Mario staging is not decoration for its own sake — the agent's loop
 * genuinely is a side-scrolling level, and the metaphor carries real state:
 *
 *   ? block bumped  = one stage of the loop completed
 *   world 1-N       = attempt N
 *   goomba          = an attempt whose patch still threw
 *   flagpole        = the patched code ran clean
 *   another castle  = the fix didn't hold; the agent is trying a new route
 *
 * Everything the user must actually judge — the diff, the verdict, the two
 * buttons — stays plain and legible. Reviewing a patch is the serious part;
 * the level is the waiting room.
 * ------------------------------------------------------- */

import React, { useState, useEffect } from 'react';
import useEditorStore from '../../store/useEditorStore';
import AiKeySetupCard from './AiKeySetupCard';
import {
  PixelSprite, QuestionBlock, Flagpole, Coin,
  MARIO_IDLE, MARIO_RUN, MARIO_JUMP, GOOMBA,
} from './MarioSprites';

/* The stages the agent really moves through. The backend answers in one shot
 * rather than streaming, so these advance on a timer — an honest description
 * of the work, not a live trace of it. Mario holds at the last block instead
 * of looping, because looping would imply it had started over. */
const STAGES = [
  { label: 'READ THE FAILURE', hint: 'parsing the error' },
  { label: 'DRAFT A PATCH', hint: 'asking the model' },
  { label: 'APPLY TO A COPY', hint: 'your file is untouched' },
  { label: 'RUN IT', hint: 'executing the patched code' },
  { label: 'CHECK THE RESULT', hint: 'did it survive?' },
];

/* Sprite is 12 columns wide, drawn at px=3. */
const SPRITE_W = 36;

const VERDICT = {
  VERIFIED:   { color: '#3DD68C', label: 'COURSE CLEAR',     sub: 'the patched code ran clean' },
  UNVERIFIED: { color: '#FFB224', label: 'ANOTHER CASTLE',   sub: 'the fix did not hold' },
  NO_FIX:     { color: '#FF4F56', label: 'GAME OVER',        sub: 'no working patch found' },
  NO_AI_KEY:  { color: '#FF4F56', label: 'INSERT COIN',      sub: 'an API key is needed to play' },
  ERROR:      { color: '#FF4F56', label: 'GAME OVER',        sub: 'the agent could not run' },
};

/* ── Idle: the plumber waits under an unopened block ──
 *
 * The promise printed here has to match what will actually happen, because it
 * is what the user is agreeing to. Repairing a single file ends in running it;
 * repairing a project ends in restarting the dev server and watching it boot.
 * Saying "runs the patched code" in the second case would be a small lie about
 * the only thing that makes the verdict worth anything.
 */
const StartScene = ({ onStart, isProject }) => (
  <div className="afx-scene">
    <div className="afx-sky">
      <div className="afx-cloud afx-cloud-1" />
      <div className="afx-cloud afx-cloud-2" />

      <div className="afx-idle-block">
        <QuestionBlock hit={false} px={2} />
      </div>

      <div className="afx-idle-mario">
        <PixelSprite rows={MARIO_IDLE} px={3} />
      </div>
    </div>

    <div className="afx-ground" />

    <div className="afx-hud">
      <div className="afx-hud-text">
        <div className="afx-hud-title">FIX IT FOR ME</div>
        <div className="afx-hud-sub">
          {isProject
            ? 'The agent finds the failing file, rewrites the offending lines, restarts the dev server and checks it boots clean. You review the diff before anything is saved.'
            : 'The agent rewrites the failing lines, runs the patched code, and retries until it passes. You review the diff before anything is saved.'}
        </div>
      </div>
      <button className="afx-start-btn" onClick={onStart}>
        <span className="afx-start-btn-glyph">▶</span> START
      </button>
    </div>
  </div>
);

/* ── Working: he runs the level, bumping a block per stage ── */
const RunScene = () => {
  const [stage, setStage] = useState(0);
  const [frame, setFrame] = useState(0);
  const [bumping, setBumping] = useState(false);

  // Advance a stage, pausing to bump the block on arrival.
  useEffect(() => {
    const timer = setInterval(() => {
      setStage((s) => {
        if (s >= STAGES.length - 1) return s; // hold, don't loop
        setBumping(true);
        setTimeout(() => setBumping(false), 380);
        return s + 1;
      });
    }, 1600);
    return () => clearInterval(timer);
  }, []);

  // Leg cycle.
  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % 2), 130);
    return () => clearInterval(timer);
  }, []);

  /* The stages run out after ~8s, but a run with several attempts takes longer
   * than that. Without a clock the panel looked stuck on the last block with
   * no way to tell working from hung. This is the one honest signal available,
   * since the backend answers in a single response rather than streaming. */
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  const pct = (stage / (STAGES.length - 1)) * 100;
  const onLastStage = stage >= STAGES.length - 1;

  return (
    <div className="afx-scene">
      <div className="afx-sky">
        <div className="afx-cloud afx-cloud-1" />
        <div className="afx-cloud afx-cloud-2" />

        <div className="afx-blocks">
          {STAGES.map((s, i) => (
            <div className="afx-block-slot" key={s.label}>
              {i === stage && bumping && <span className="afx-coin-pop"><Coin px={2} /></span>}
              <QuestionBlock hit={i < stage || (i === stage && bumping)} px={2} />
            </div>
          ))}
        </div>

        {/* Offset by his own width in proportion to the distance travelled, so
            at the far end his right edge lands on the track's right edge
            instead of his left edge landing there and the rest hanging out. */}
        <div className="afx-runner-track">
          <div className="afx-runner" style={{ left: `calc(${pct}% - ${(SPRITE_W * pct) / 100}px)` }}>
            <PixelSprite rows={bumping ? MARIO_JUMP : (frame ? MARIO_RUN : MARIO_IDLE)} px={3} />
          </div>
        </div>
      </div>

      <div className="afx-ground is-scrolling" />

      <div className="afx-hud">
        <div className="afx-hud-text">
          <div className="afx-hud-title afx-blink">
            <span className="afx-stage-num">{String(stage + 1).padStart(2, '0')}</span>
            {STAGES[stage].label}
          </div>
          <div className="afx-hud-sub afx-mono">
            {STAGES[stage].hint}…
            {/* Only once the stages have run out — before that the stage text
                is itself the progress, and a clock would just add noise. */}
            {onLastStage && elapsed > 0 && (
              <span className="afx-elapsed">{elapsed}s</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ── Result banner: flagpole for a clear, castle sign otherwise ── */
const ResultScene = ({ status, attemptsUsed, confidence, attached }) => {
  const v = VERDICT[status] || VERDICT.ERROR;
  const cleared = status === 'VERIFIED';
  const coins = Math.round((confidence || 0) * 5);

  // `attached` squares off the bottom so the coin slot below reads as the same
  // cabinet rather than a second panel that happens to sit underneath.
  return (
    <div className={`afx-scene ${attached ? 'is-attached' : ''}`}>
      <div className="afx-sky afx-sky-short">
        {cleared ? (
          <>
            <div className="afx-flagpole">
              <Flagpole raised px={2} />
            </div>
            <div className="afx-winner">
              <PixelSprite rows={MARIO_JUMP} px={3} />
            </div>
          </>
        ) : (
          <div className="afx-castle-row">
            <PixelSprite rows={GOOMBA} px={3} className="afx-goomba" />
            <span className="afx-castle-sign">{v.sub}</span>
          </div>
        )}
      </div>

      <div className="afx-ground" />

      <div className="afx-scoreboard">
        <span className="afx-verdict-label" style={{ color: v.color }}>{v.label}</span>
        <span className="afx-score-item">
          WORLD <b>1-{Math.max(1, attemptsUsed || 1)}</b>
        </span>
        {confidence > 0 && (
          <span className="afx-score-item afx-coins">
            {[0, 1, 2, 3, 4].map((i) => <Coin key={i} px={1} dim={i >= coins} />)}
            <b>×{coins}</b>
          </span>
        )}
      </div>
    </div>
  );
};

/* The model writes identifiers in `backticks`. Rendered raw they show up as
 * stray punctuation mid-sentence, which was most of why this block read as
 * cluttered — the eye keeps catching on marks that carry no meaning. */
const renderInline = (text) => {
  if (!text) return null;
  return text.split(/(`[^`]+`)/g).map((part, i) =>
    part.length > 2 && part.startsWith('`') && part.endsWith('`')
      ? <code key={i} className="afx-inline-code">{part.slice(1, -1)}</code>
      : part
  );
};

/* A titled rule. Gives the panel visible joints instead of one long column of
 * text blocks at similar weight. */
const SectionHead = ({ label, meta }) => (
  <div className="afx-section">
    <span className="afx-section-label">{label}</span>
    <span className="afx-section-rule" />
    {meta && <span className="afx-section-meta">{meta}</span>}
  </div>
);

/* ── One line-range replacement ── */
const EditDiff = ({ edit }) => {
  const oldLines = edit.oldText ? edit.oldText.split('\n') : [];
  const newLines = edit.newText ? edit.newText.split('\n') : [];
  const range = edit.startLine === edit.endLine
    ? `LINE ${edit.startLine}`
    : `LINES ${edit.startLine}–${edit.endLine}`;

  return (
    <div className="afx-diff">
      <div className="afx-diff-head">{range}</div>
      <div className="afx-diff-body">
        {oldLines.map((line, i) => (
          <div key={`o-${i}`} className="afx-diff-line afx-diff-del">
            <span className="afx-diff-ln">{edit.startLine + i}</span>
            <span className="afx-diff-sign">−</span>
            <span className="afx-diff-code">{line || ' '}</span>
          </div>
        ))}
        {newLines.length > 0 ? newLines.map((line, i) => (
          <div key={`n-${i}`} className="afx-diff-line afx-diff-add">
            <span className="afx-diff-ln" />
            <span className="afx-diff-sign">+</span>
            <span className="afx-diff-code">{line || ' '}</span>
          </div>
        )) : (
          <div className="afx-diff-line afx-diff-add">
            <span className="afx-diff-ln" />
            <span className="afx-diff-sign">+</span>
            <span className="afx-diff-code afx-diff-empty">(lines removed)</span>
          </div>
        )}
      </div>
    </div>
  );
};

/* ── Every world the agent played, won or lost ── */
const AttemptTrail = ({ attempts }) => (
  <div className="afx-trail">
    {attempts.map((a) => (
      <div key={a.number} className={`afx-trail-row ${a.verified ? 'is-pass' : 'is-fail'}`}>
        <span className="afx-trail-world">1-{a.number}</span>
        {a.verified
          ? <span className="afx-trail-mark">★</span>
          : <PixelSprite rows={GOOMBA} px={1} className="afx-trail-goomba" />}
        <span className="afx-trail-body">
          {a.summary || 'no patch produced'}
          {!a.verified && a.rejectedBecause && (
            <span className="afx-trail-why">{a.rejectedBecause.split('\n')[0]}</span>
          )}
          {a.verified && <span className="afx-trail-why afx-pass">cleared — ran clean</span>}
        </span>
      </div>
    ))}
  </div>
);

const AutoFixPanel = () => {
  const rootCause = useEditorStore((s) => s.rootCause);
  const autoFix = useEditorStore((s) => s.autoFix);
  const autoFixState = useEditorStore((s) => s.autoFixState);
  const requestAutoFix = useEditorStore((s) => s.requestAutoFix);
  const applyAutoFix = useEditorStore((s) => s.applyAutoFix);
  const undoAutoFix = useEditorStore((s) => s.undoAutoFix);
  const clearAutoFix = useEditorStore((s) => s.clearAutoFix);
  const runCode = useEditorStore((s) => s.runCode);
  const devServers = useEditorStore((s) => s.devServers);

  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);

  /* A dev server that has fallen over is a failure worth offering to repair,
     even though nothing has produced a rootCause for it. */
  const serverFailing = Object.values(devServers || {}).some((s) => s?.state === 'ERROR');

  /* Which kind of repair this will be — the same test the store uses to pick a
     mode, so the promise on screen matches the work that follows. */
  const isProjectFix = Boolean(workspaceRoot) && !rootCause;

  const [notice, setNotice] = useState(null);
  const [showTrail, setShowTrail] = useState(false);

  /* Something to act on, or something to show.
   *
   * A diagnosis is the original trigger, and a proposal keeps the panel alive
   * after a fix is applied — applying clears the diagnosis, because it
   * described code that no longer exists, while the confirmation and the undo
   * still have to be reachable.
   *
   * A failing dev server is the third case and produces neither: nothing
   * parses a server log into a rootCause. Gating on that alone is what kept
   * the agent away from projects, so a crashed server counts as a reason to
   * offer him too.
   *
   * Checked after the hooks so hook order stays stable.
   */
  if (!rootCause && !autoFix && !serverFailing) return null;

  /* Async now: a project-mode fix can be for a file that is not open, and
     applying it opens that file first — which in local mode means reading it
     off disk before the write can land. */
  const handleApply = async () => {
    const result = await applyAutoFix();
    setNotice(result.ok ? null : result.reason);
  };

  const handleUndo = () => {
    const result = undoAutoFix();
    if (!result.ok && result.reason) setNotice(result.reason);
  };

  /* ── Applied — 1-UP ──
   *
   * The edits survive in state after applying, so they are shown rather than
   * discarded. Throwing them away left a single line of confirmation floating
   * in an otherwise empty pane, and it threw away the one thing worth having
   * at that moment: a record of what just changed in the file, sitting next to
   * the button that undoes it. */
  if (autoFix && autoFix.applied) {
    const appliedEdits = Array.isArray(autoFix.edits) ? autoFix.edits : [];

    return (
      <div className="afx-panel is-applied">
        <div className="afx-applied">
          <PixelSprite rows={MARIO_JUMP} px={2} className="afx-applied-sprite" />
          <div className="afx-applied-text">
            <div className="afx-applied-title">1-UP · FIX APPLIED</div>
            <div className="afx-applied-sub">
              {renderInline(autoFix.summary) || 'The agent edited your code.'}
            </div>
          </div>
          <div className="afx-applied-actions">
            <button className="afx-btn afx-btn-primary" onClick={runCode}>Run it</button>
            <button className="afx-btn afx-btn-ghost" onClick={handleUndo}>Undo</button>
          </div>
        </div>

        {notice && <div className="afx-notice">{notice}</div>}

        {appliedEdits.length > 0 && (
          <>
            <SectionHead
              label="What changed in your file"
              meta={`${appliedEdits.length} ${appliedEdits.length === 1 ? 'edit' : 'edits'}`}
            />
            <div className="afx-diffs">
              {appliedEdits.map((edit, i) => <EditDiff key={i} edit={edit} />)}
            </div>
          </>
        )}
      </div>
    );
  }

  /* ── Working ── */
  if (autoFixState === 'working') {
    return <div className="afx-panel is-bare"><RunScene /></div>;
  }

  /* ── Idle ── */
  if (!autoFix) {
    /* onStart is wired to a click, which hands requestAutoFix the event as its
       options argument. Harmless — it reads only `instruction`, which an event
       does not have — but passed explicitly so it stays harmless. */
    return (
      <div className="afx-panel is-bare">
        <StartScene onStart={() => requestAutoFix()} isProject={isProjectFix} />
      </div>
    );
  }

  /* ── A proposal came back ── */
  const hasPatch = Boolean(autoFix.fixedCode) && Array.isArray(autoFix.edits) && autoFix.edits.length > 0;
  const needsKey = autoFix.status === 'NO_AI_KEY';

  /* Bare while asking for a key: the coin slot below is the whole cabinet, so
     the panel adds nothing but a second border. */
  return (
    <div className={`afx-panel ${needsKey ? 'is-bare' : ''}`}>
      {/* No scene while asking for a key.
          It rendered a goomba, a brick course, a red INSERT COIN and a WORLD
          counter directly above a card that then said INSERT COIN again — the
          same sentence twice, in three accent colours, for a screen whose only
          job is to take one string. Missing a key is not a verdict on a run;
          there was nothing to run. */}
      {!needsKey && (
        <ResultScene
          status={autoFix.status}
          attemptsUsed={autoFix.attemptsUsed}
          confidence={hasPatch ? autoFix.confidence : 0}
        />
      )}

      {/* The coin slot on the front of the cabinet. Joined to the scene above
          it, which already says INSERT COIN — so the form carries no heading,
          badge or paragraph of its own. */}
      {needsKey && (
        <AiKeySetupCard
          forceVisible
          context="autofix"
          variant="arcade"
          /* Inserting the coin starts the game. There is no "Try again" button
             because there is nothing left for the user to decide once the key
             is live — the run they already asked for simply proceeds. */
          onActivated={requestAutoFix}
        />
      )}

      {/* Suppressed on a clean verdict: the scoreboard above already says
          COURSE CLEAR and WORLD 1-N, and the output block below proves it.
          Also suppressed while asking for a key, where the slot says it better.
          Kept everywhere else, where it carries a real warning. */}
      {autoFix.message && autoFix.status !== 'VERIFIED' && !needsKey && (
        <div className="afx-message">{autoFix.message}</div>
      )}

      {hasPatch && (
        <>
          <div className="afx-brief">
            {autoFix.summary && <h4 className="afx-summary">{renderInline(autoFix.summary)}</h4>}
            {autoFix.explanation && (
              <p className="afx-explanation">{renderInline(autoFix.explanation)}</p>
            )}
          </div>

          <SectionHead
            label="The patch"
            meta={`${autoFix.edits.length} ${autoFix.edits.length === 1 ? 'edit' : 'edits'}`}
          />
          <div className="afx-diffs">
            {autoFix.edits.map((edit, i) => <EditDiff key={i} edit={edit} />)}
          </div>

          {/* Evidence the patched code ran — the claim this all rests on */}
          {autoFix.status === 'VERIFIED' && autoFix.verifiedOutput && (
            <>
              <SectionHead label="Output after the fix" />
              <pre className="afx-evidence-pre">{autoFix.verifiedOutput}</pre>
            </>
          )}

          {autoFix.status === 'UNVERIFIED' && autoFix.remainingError && (
            <>
              <SectionHead label="Still failing with" />
              <pre className="afx-evidence-pre is-error">{autoFix.remainingError}</pre>
            </>
          )}
        </>
      )}

      {autoFix.attempts && autoFix.attempts.length > 0 && (
        <>
          <div className="afx-trail-toggle" onClick={() => setShowTrail((v) => !v)}>
            {showTrail ? '▼' : '▶'} WORLDS PLAYED
          </div>
          {showTrail && <AttemptTrail attempts={autoFix.attempts} />}
        </>
      )}

      {notice && <div className="afx-notice">{notice}</div>}

      {/* No actions while asking for a key: the slot is the only thing to do,
          and activating it runs the agent on its own. */}
      {!needsKey && (
        <div className="afx-actions">
          {hasPatch ? (
            <>
              <button className="afx-btn afx-btn-primary" onClick={handleApply}>
                Apply {autoFix.edits.length > 1 ? `${autoFix.edits.length} edits` : 'fix'}
              </button>
              <button className="afx-btn afx-btn-ghost" onClick={clearAutoFix}>Reject</button>
            </>
          ) : (
            <button className="afx-btn afx-btn-ghost" onClick={requestAutoFix}>Continue?</button>
          )}
        </div>
      )}
    </div>
  );
};

export default AutoFixPanel;

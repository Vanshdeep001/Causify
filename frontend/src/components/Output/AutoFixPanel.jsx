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

const VERDICT = {
  VERIFIED:   { color: '#3DD68C', label: 'COURSE CLEAR',     sub: 'the patched code ran clean' },
  UNVERIFIED: { color: '#FFB224', label: 'ANOTHER CASTLE',   sub: 'the fix did not hold' },
  NO_FIX:     { color: '#FF4F56', label: 'GAME OVER',        sub: 'no working patch found' },
  NO_AI_KEY:  { color: '#FF4F56', label: 'INSERT COIN',      sub: 'an API key is needed to play' },
  ERROR:      { color: '#FF4F56', label: 'GAME OVER',        sub: 'the agent could not run' },
};

/* ── Idle: the plumber waits under an unopened block ── */
const StartScene = ({ onStart }) => (
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
          The agent rewrites the failing lines, runs the patched code, and retries
          until it passes. You review the diff before anything is saved.
        </div>
      </div>
      <button className="afx-btn afx-btn-start" onClick={onStart}>
        <span className="afx-btn-start-glyph">▶</span> START
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

  const pct = (stage / (STAGES.length - 1)) * 100;

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

        <div className="afx-runner" style={{ left: `calc(${pct}% )` }}>
          <PixelSprite rows={bumping ? MARIO_JUMP : (frame ? MARIO_RUN : MARIO_IDLE)} px={3} />
        </div>
      </div>

      <div className="afx-ground is-scrolling" />

      <div className="afx-hud">
        <div className="afx-hud-text">
          <div className="afx-hud-title afx-blink">
            <span className="afx-stage-num">{String(stage + 1).padStart(2, '0')}</span>
            {STAGES[stage].label}
          </div>
          <div className="afx-hud-sub afx-mono">{STAGES[stage].hint}…</div>
        </div>
      </div>
    </div>
  );
};

/* ── Result banner: flagpole for a clear, castle sign otherwise ── */
const ResultScene = ({ status, attemptsUsed, confidence }) => {
  const v = VERDICT[status] || VERDICT.ERROR;
  const cleared = status === 'VERIFIED';
  const coins = Math.round((confidence || 0) * 5);

  return (
    <div className="afx-scene">
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

  const [notice, setNotice] = useState(null);
  const [showTrail, setShowTrail] = useState(false);

  // Needs a diagnosis to act on, or a proposal to show. The second case matters
  // after a fix is applied: that clears the diagnosis (it described code that
  // no longer exists) while the confirmation and undo must survive.
  // Checked after the hooks so hook order stays stable.
  if (!rootCause && !autoFix) return null;

  const handleApply = () => {
    const result = applyAutoFix();
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
    return <div className="afx-panel"><RunScene /></div>;
  }

  /* ── Idle ── */
  if (!autoFix) {
    return <div className="afx-panel"><StartScene onStart={requestAutoFix} /></div>;
  }

  /* ── A proposal came back ── */
  const hasPatch = Boolean(autoFix.fixedCode) && Array.isArray(autoFix.edits) && autoFix.edits.length > 0;

  return (
    <div className="afx-panel">
      <ResultScene
        status={autoFix.status}
        attemptsUsed={autoFix.attemptsUsed}
        confidence={hasPatch ? autoFix.confidence : 0}
      />

      {/* Suppressed on a clean verdict: the scoreboard above already says
          COURSE CLEAR and WORLD 1-N, and the output block below proves it.
          Repeating it in prose was a whole line that told you nothing new.
          Kept everywhere else, where it carries a real warning. */}
      {autoFix.message && autoFix.status !== 'VERIFIED' && (
        <div className="afx-message">{autoFix.message}</div>
      )}

      {/* Somewhere to actually put the key. Without this the panel states a
          requirement and leaves the field buried in the collapsed report. */}
      {autoFix.status === 'NO_AI_KEY' && (
        <div className="afx-keysetup">
          <AiKeySetupCard forceVisible context="autofix" />
        </div>
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

      <div className="afx-actions">
        {hasPatch ? (
          <>
            <button className="afx-btn afx-btn-primary" onClick={handleApply}>
              Apply {autoFix.edits.length > 1 ? `${autoFix.edits.length} edits` : 'fix'}
            </button>
            <button className="afx-btn afx-btn-ghost" onClick={clearAutoFix}>Reject</button>
          </>
        ) : (
          <button className="afx-btn afx-btn-ghost" onClick={requestAutoFix}>
            {autoFix.status === 'NO_AI_KEY' ? 'Try again' : 'Continue?'}
          </button>
        )}
      </div>
    </div>
  );
};

export default AutoFixPanel;

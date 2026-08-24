/* -------------------------------------------------------
 * useEditorStore.js — Zustand Global State Store
 * 
 * Manages all shared state for the Causify app:
 *   - Code content being edited
 *   - Execution output and errors
 *   - Session info and connected users
 *   - Timeline snapshots
 *   - Root cause analysis results
 *   - Causality graph data
 *   - UI Layout (Terminal & Split view)
 * ------------------------------------------------------- */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
// Aliased: the store exposes its own requestAutoFix action, and an identical
// name here would read like recursion even though it is not.
import { executeCode, createSnapshot, getTimeline, getDeployments, requestAutoFix as fetchAutoFix, createSession, uploadProject } from '../services/api';
import { analyzeImpact, summarizeImpacts } from '../utils/impactAnalyzer';
import { clearSymbolCache } from '../utils/impact/symbols';
import { sendCodeChange, sendRevert, sendFollowStart, sendFollowStop, sendCheckpoint } from '../services/socket';
import { replaceFileText } from '../services/collabDoc';
import { resetOrigin, setSessionToken, clearSessionToken } from '../services/backendHost';

/* How long a dropped socket is given to come back before the session is
 * treated as gone. Long enough that a brief network blink heals silently,
 * short enough that nobody writes much into a session that no longer exists. */
const CONNECTION_GRACE_MS = 15000;

/* How many checkpoints Session Rewind keeps. Entry 0 is a full copy of the
 * project and the rest are deltas, so this bounds memory at roughly one project
 * plus the churn since — not one copy per checkpoint. At the sampling interval
 * below this is several hours of history, which covers a hackathon. */
/* Written once here because a literal newline escape is easy to lose when this
 * file is edited by tooling, and losing it silently corrupts stored history. */
const NL = '\n';

/* Split text into lines, whatever it thinks a line ending is.
 *
 * The one rule every comparison in the attribution code has to agree on. A
 * project uploaded from a Windows disk arrives with CRLF; Monaco hands its
 * model back with LF; the two live side by side in `files` depending on whether
 * a file has been opened yet. Any check that splits on '\n' alone leaves a
 * trailing '\r' on the stored side and finds every line different from a record
 * that was written after normalising — text identical on screen, differing by
 * an invisible character.
 *
 * Written once and shared, because that is exactly how the two sides drifted
 * apart: recordLineDiff normalised, pruneAttribution did not, and every
 * attribution for a CRLF file was silently deleted the moment the rewind panel
 * opened. `\r\n?` rather than `\r\n` so a lone CR counts too. */
const splitLines = (text) => String(text ?? '').replace(/\r\n?/g, NL).split(NL);

/* Depth counter, not a boolean: restoring walks many files and each one may
 * take a different route into the store, so the guard has to survive nesting.
 *
 * A history operation rewrites files wholesale. Attributing that to whoever
 * pressed the button turns every rewind into "you changed 58 lines", which the
 * panel then offers to undo — history editing itself into the history. */
let historyOps = 0;
const asHistoryOp = async (fn) => {
  historyOps++;
  try { return await fn(); } finally { historyOps--; }
};

/* Checkpoints are deliberate now, so the ceiling is about memory rather than
 * about a timer outrunning it. 240 owner-pressed saves is a very long session. */
const MAX_REWIND_POINTS = 240;
/* Per author, per checkpoint. Enough to see what happened without turning a
   summary into a diff viewer, and without putting an unbounded payload on the
   wire for every participant. */
const MAX_CREDIT_EDITS = 12;

/* A personal save is meant to be READ back, so it keeps far more of the detail
 * than a credit line does — a summary that stops at twelve edits is no use as a
 * record of an afternoon. Still bounded, because it is persisted. */
const MAX_MINE_EDITS = 200;
const MAX_MY_CHECKPOINTS = 60;

/* ── Rewind history across a tab close ──
 *
 * The history used to live only in memory: close the tab, reopen it, and every
 * checkpoint the user had deliberately saved was gone — including the ones
 * labelled "last working build", which is exactly the thing somebody comes back
 * for. It is persisted now, and the only real question is how much of it.
 *
 * Entry 0 is a full copy of the project and the rest are deltas, so a long
 * session's log can be several megabytes. localStorage is a handful of
 * megabytes TOTAL and shared with the session identity and the workspace — and
 * the writer is all-or-nothing, so one oversized log does not lose the history,
 * it loses everything written in that same call. Hence a budget.
 */
const REWIND_STORAGE_BUDGET = 1_200_000; // characters, ~1.2 MB of JSON

/* Approximate, and deliberately so: a real JSON.stringify of the whole log on
 * every keystroke would cost more than the feature is worth. Path plus content
 * lengths track the serialised size closely enough to decide what to drop. */
const rewindWeight = (log) => log.reduce((total, point) => (
  total + Object.entries(point.files || {}).reduce(
    (n, [path, content]) => n + path.length + (content ? content.length : 0), 40)
), 0);

/* Memoised on the array's identity.
 *
 * partialize runs on EVERY state change — every keystroke, every cursor move —
 * while rewindLog is only replaced when a checkpoint is captured. Comparing the
 * reference makes all but those rare calls free, which is what keeps persisting
 * a multi-megabyte history off the typing path. */
let rewindStorageCache = { source: null, value: [] };

const rewindForStorage = (log) => {
  if (!Array.isArray(log) || log.length === 0) return [];
  if (rewindStorageCache.source === log) return rewindStorageCache.value;

  let next = log;
  /* Fold the oldest delta into the keyframe rather than dropping it — the same
   * operation captureRewindPoint uses for MAX_REWIND_POINTS, so a trimmed
   * history still starts from a state that genuinely existed. */
  while (next.length > 1 && rewindWeight(next) > REWIND_STORAGE_BUDGET) {
    const [keyframe, oldest, ...rest] = next;
    const merged = { ...keyframe.files };
    Object.entries(oldest.files).forEach(([path, content]) => {
      if (content === null) delete merged[path];
      else merged[path] = content;
    });
    next = [{ ...keyframe, at: oldest.at, files: merged }, ...rest];
  }

  /* A single copy of the project is still over budget — a very large project.
   * Storing nothing beats taking the whole persisted state down with it. */
  if (rewindWeight(next) > REWIND_STORAGE_BUDGET) next = [];

  rewindStorageCache = { source: log, value: next };
  return next;
};

/**
 * The credit list a checkpoint carries, in one known shape.
 *
 * changesSince already flattens each author's file Map into an array of
 * { path, count } before returning — spreading .entries() over that array a
 * second time yielded [index, value] pairs, so every path became the number 0,
 * 1, 2 and the panel died on path.split(). Converted in exactly one place now.
 *
 * It also runs over data arriving from another participant's client, which may
 * be a different build of the app. Nothing here trusts the sender: a malformed
 * credit is dropped rather than allowed to throw inside a render, because a
 * crash in the rewind panel takes the whole editor down with it.
 */
const normalizeCredits = (list) => {
  if (!Array.isArray(list)) return [];
  return list.map((c) => ({
    userId: String(c?.userId ?? ''),
    username: String(c?.username ?? 'Someone'),
    color: typeof c?.color === 'string' ? c.color : '#FFFFFF',
    lines: Number(c?.lines) || 0,
    files: Array.isArray(c?.files)
      ? c.files
        .filter((f) => f && typeof f.path === 'string')
        // changesSince calls it `count`; a checkpoint calls it `lines`.
        .map((f) => ({ path: f.path, lines: Number(f.lines ?? f.count) || 0 }))
      : [],
    /* The lines themselves, capped. "64 lines in app.js" is a number nobody can
     * check; "app.js:42  totalPrice -> total" is a fact someone can agree or
     * disagree with. Capped because a checkpoint is a summary, and because this
     * crosses the wire to every participant. */
    edits: Array.isArray(c?.edits)
      ? c.edits
        .filter((e) => e && typeof e.path === 'string')
        .slice(0, MAX_CREDIT_EDITS)
        .map((e) => ({
          kind: e.kind === 'added' || e.kind === 'removed' ? e.kind : 'modified',
          path: e.path,
          line: Number(e.line) || 0,
          oldLine: typeof e.oldLine === 'string' ? e.oldLine.slice(0, 200) : '',
          newLine: typeof e.newLine === 'string' ? e.newLine.slice(0, 200) : '',
          removedText: typeof e.removedText === 'string' ? e.removedText.slice(0, 400) : '',
        }))
      : [],
  }));
};
let connectionLostTimer = null;

const parseExecutionGraph = (code, language) => {
  if (!code) return { nodes: [], edges: [] };

  const lines = code.split('\n');
  let realLines = 0;
  const allLines = [];
  
  lines.forEach(l => {
    const trimmed = l.trim();
    if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')) {
      realLines++;
    }
    allLines.push(trimmed);
  });

  const isSmallCode = realLines < 40;
  const maxFunctions = isSmallCode ? 6 : 3;
  const maxVars = isSmallCode ? 4 : 0;

  const nodes = [];
  const edges = [];
  let nodeId = 1;

  // 1. Entry Point
  let entryLabel = 'Program Entry';
  if (language === 'java') {
    const mainClassMatch = code.match(/class\s+(\w+)/);
    if (mainClassMatch) {
      entryLabel = `${mainClassMatch[1]}.main()`;
    }
  }
  const entryNode = { id: `e${nodeId++}`, type: 'entry', label: entryLabel, detail: `${realLines} lines of code` };
  nodes.push(entryNode);

  // 2. Functions
  const functionNodes = new Map();
  const funcRegexes = [
    /function\s+([a-zA-Z_$][\w$]*)/g,
    /(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:\(|async)/g,
    /def\s+([a-zA-Z_][\w]*)\s*\(/g,
    /(?:public|private|protected|static|\s)+[\w<>\[\]]+\s+([a-zA-Z_][\w]*)\s*\(/g
  ];

  const allFuncNames = [];
  allLines.forEach((line, idx) => {
    funcRegexes.forEach(regex => {
      let match;
      regex.lastIndex = 0;
      while ((match = regex.exec(line)) !== null) {
        const name = match[1];
        if (name && !['main', 'if', 'for', 'while', 'switch', 'catch'].includes(name)) {
          if (!allFuncNames.includes(name)) {
            allFuncNames.push(name);
            if (functionNodes.size < maxFunctions) {
              const nid = `e${nodeId++}`;
              functionNodes.set(name, nid);
              nodes.push({ id: nid, type: 'function', label: `${name}()`, detail: `Line ${idx + 1}` });
              edges.push({ id: `${entryNode.id}-${nid}`, source: entryNode.id, target: nid, label: 'calls' });
            }
          }
        }
      }
    });
  });

  if (allFuncNames.length > maxFunctions) {
    const nid = `e${nodeId++}`;
    nodes.push({ id: nid, type: 'function', label: `+${allFuncNames.length - maxFunctions} more functions`, detail: 'Not all shown' });
    edges.push({ id: `${entryNode.id}-${nid}`, source: entryNode.id, target: nid, label: 'also defines' });
  }

  // 3. Variables (only for small code)
  if (maxVars > 0) {
    const varRegexes = [
      /(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=/g,
      /(?:int|double|float|bool|char|string|String|auto|string)\s+([a-zA-Z_][\w]*)\s*[=;\[]/g
    ];
    let varCount = 0;
    allLines.forEach((line, idx) => {
      if (varCount >= maxVars) return;
      varRegexes.forEach(regex => {
        let match;
        regex.lastIndex = 0;
        while ((match = regex.exec(line)) !== null) {
          if (varCount >= maxVars) return;
          const name = match[1];
          if (name && name.length > 1 && !['return', 'this', 'using', 'namespace', 'cout', 'cin', 'std'].includes(name)) {
            const nid = `e${nodeId++}`;
            nodes.push({ id: nid, type: 'variable', label: name, detail: `Line ${idx + 1}` });
            edges.push({ id: `${entryNode.id}-${nid}`, source: entryNode.id, target: nid, label: 'declares' });
            varCount++;
          }
        }
      });
    });
  }

  // 4. Loops (only for small code, max 2)
  if (isSmallCode) {
    let loopCount = 0;
    allLines.forEach((line, idx) => {
      if (loopCount >= 2) return;
      const trimmed = line.trim();
      if (trimmed.startsWith('for ') || trimmed.startsWith('for(') ||
          trimmed.startsWith('while ') || trimmed.startsWith('while(') ||
          trimmed.includes('.forEach(') || trimmed.includes('.map(')) {
        const loopType = trimmed.includes('for') ? 'for loop' : trimmed.includes('while') ? 'while loop' : 'iteration';
        const nid = `e${nodeId++}`;
        nodes.push({ id: nid, type: 'loop', label: loopType, detail: `Line ${idx + 1}` });
        
        // Find parent function
        let parentId = null;
        for (let i = idx; i >= 0; i--) {
          const match = allLines[i].match(/(?:function\s+(\w+))|(?:def\s+(\w+)\s*\()|(?:void|int|double|string)\s+(\w+)\s*\(/);
          if (match) {
            const name = match[1] || match[2] || match[3];
            if (name && functionNodes.has(name)) {
              parentId = functionNodes.get(name);
              break;
            }
          }
        }
        
        edges.push({ id: `${parentId || entryNode.id}-${nid}`, source: parentId || entryNode.id, target: nid, label: 'iterates' });
        loopCount++;
      }
    });
  }

  // 5. High-level features: Console Output, User Input, UI, etc.
  let hasOutput = false;
  let hasInput = false;
  allLines.forEach(line => {
    if (line.includes('console.log') || line.includes('System.out.print') || line.includes('print(') || line.includes('cout <<') || line.includes('std::cout')) {
      hasOutput = true;
    }
    if (line.includes('cin >>') || line.includes('std::cin') || line.includes('input(') || line.includes('Scanner') || line.includes('process.stdin') || line.includes('readline')) {
      hasInput = true;
    }
  });

  if (hasInput) {
    const nid = `e${nodeId++}`;
    nodes.push({ id: nid, type: 'condition', label: 'User Input', detail: 'Reads from stdin' });
    edges.push({ id: `${entryNode.id}-${nid}`, source: entryNode.id, target: nid, label: 'requests' });
  }

  if (hasOutput) {
    const nid = `e${nodeId++}`;
    nodes.push({ id: nid, type: 'output', label: 'Console Output', detail: 'Prints to stdout' });
    edges.push({ id: `${entryNode.id}-${nid}`, source: entryNode.id, target: nid, label: 'outputs' });
  }

  // 6. Success Node
  const successId = `e${nodeId++}`;
  const summary = `${allFuncNames.length} functions, ${realLines} lines`;
  nodes.push({ id: successId, type: 'success', label: '✓ Ran Successfully', detail: summary });
  
  if (functionNodes.size > 0) {
    const lastFnId = Array.from(functionNodes.values()).pop();
    edges.push({ id: `${lastFnId}-${successId}`, source: lastFnId, target: successId, label: 'completes' });
  } else {
    edges.push({ id: `${entryNode.id}-${successId}`, source: entryNode.id, target: successId, label: 'completes' });
  }

  return { nodes, edges };
};

// Keys that must live only in sessionStorage (per-window, dropped on close).
// Session identity used to live here so closing the app disconnected the
// session — but that meant the session id vanished on reopen, breaking
// deploy/link (which key off it) and forcing a new session every launch.
// Session identity now persists to localStorage and App.jsx verifies it
// against the backend on launch (reconnect if alive, recreate if gone), so
// nothing needs to be session-only anymore.
const SESSION_ONLY_KEYS = [];

// Keys that must always fall back to their initial value on launch, whatever is
// in storage. The terminal panel is one: its shell does not survive a restart,
// so reopening it would present an empty terminal rather than the one that was
// there. The user opens it again when they want it.
const NEVER_RESTORED_KEYS = ['isTerminalOpen'];

// Pending debounced disk writes for changes received from collaborators,
// keyed by path. Deliberately module-level: timer handles are transient
// machinery, so they must not land in persisted state or trigger re-renders.
const localPersistTimers = {};

// Debounce handle for writing a folder's history/whiteboard to app data, and the
// cap on how many points that history keeps.
let localStateSaveTimer = null;
const MAX_LOCAL_SNAPSHOTS = 200;

const useEditorStore = create(persist((set, get) => ({

  // ---- Session State ----
  sessionId: null,          // Current session ID
  sessionName: '',          // Display name of the session
  currentUser: null,        // Current user object { id, username, color }
  userRole: null,           // 'owner' or 'collaborator'
  connectedUsers: [],       // List of users currently connected
  lastChange: null,         // Most recent remote change: { userId, path, timestamp }
  fileActivity: {},         // { [path]: { userId, timestamp, username, color } } — recent EDIT ("LIVE")
  filePresence: {},         // { [userId]: { path, username, color, timestamp } } — who's OPEN in which file
  remoteCursors: {},        // { [userId]: { line, column, path, username, color } }
  changeNotifications: [],  // [ { id, username, path, linesChanged, timestamp, color } ]
  remoteLineChanges: {},    // { [path]: { [lineNumber]: { userId, username, color, timestamp, oldLine, newLine } } }
  /* Deletions cannot live in remoteLineChanges: that map is keyed by a line in
   * the CURRENT file, and a deleted line has no such key. So removing the
   * <script> tag from index.html produced no record anywhere — it was invisible
   * to the gutter, uncounted by "changed since", and impossible to revert.
   * Anchored instead to the line that closed over the gap. */
  remoteLineDeletions: {}, // { [path]: [{ id, anchor, anchorAfter, removedText, userId, username, color, timestamp }] }

  /* Files the owner has frozen: { [path]: { by, byId, at } }.
   *
   * Distinct from the per-user `permission` flag, which is about a person —
   * "you may not write anywhere". This is about a file: everyone else keeps
   * full access to the project and loses exactly one file, which is what you
   * want when the schema or the config is mid-surgery and the rest of the team
   * should carry on. Server-held, so it survives a refresh; see
   * CollaborationService.sessionLocks. */
  lockedFiles: {},

  /* People waiting at the door: [{ requestId, username, createdAt }].
   * Broadcast to the whole session, rendered only for the owner. */
  pendingAdmissions: [],

  /* True when this client is in a session it can no longer prove it belongs to.
   *
   * The only way in: a collaborator reopening the app. The session id is
   * persisted and the membership token is not, so the socket reconnects while
   * every endpoint that runs something on the host — Run, the dev server, git,
   * the agent — starts refusing them. Editing keeps working, which is what
   * makes it confusing rather than merely broken.
   *
   * Set by the reconnect in App.jsx, read by ConnectionBanner (which says so)
   * and FileExplorer (which reopens the join panel). Cleared by a completed
   * rejoin, which is the only thing that mints a new token. */
  reauthNeeded: false,

  // ---- Editor State ----
  files: {},                // Map of { path: content }
  projectRootPath: null,    // Real disk folder of the imported project (Electron) — terminal cwd
  activePath: '',           // Currently opened file path
  code: '',                 // Code content
  language: 'javascript',  // Editor language mode
  collisionWarning: null,   // { line: number, username: string } - active concurrency block
  collabReady: false,       // true once the CRDT (Yjs) session is initialized

  // ---- Local Workspace (disk is the source of truth) ----
  // When workspaceRoot is set the project lives on disk and `files` holds paths
  // with contents loaded on demand — nothing is copied into the database, and
  // saves go straight back to the real file so other editors see them.
  workspaceRoot: null,      // Absolute path of the opened folder; null = session/DB mode
  workspaceName: '',        // Folder name, for the explorer header
  workspaceTruncated: false,// true when the project exceeded the directory-walk cap
  loadedPaths: {},          // { [path]: true } — files whose contents have been read in

  // ---- Save State ----
  fileHandles: {},          // { [path]: FileSystemFileHandle } — for silent re-saves
  savedContents: {},        // { [path]: string } — last-saved content, for dirty detection
  fileSavedPaths: {},       // { [path]: string } — on-disk path chosen in Save dialog
  fileDiskPaths: {},        // { [path]: string } — absolute location of a saved untitled buffer

  // ---- Execution State ----
  output: '',               // Stdout from last execution
  error: '',                // Stderr from last execution
  missingTool: null,        // 'gcc' | 'g++' | 'python' | 'node' — toolchain the last run needed and could not find
  isRunning: false,         // Whether code is currently executing
  executionHistory: [],     // History of all executions

  // ---- Live State Cache (for Replay restoration) ----
  liveCode: '',
  liveOutput: '',
  liveError: '',
  liveRootCause: null,
  liveCausalityGraph: null,

  /* ── Session Rewind ──
   *
   * A continuous history of the WHOLE project, so a team can go back to a
   * moment rather than to a commit. Git only remembers what was committed, and
   * nobody commits mid-sprint — which is precisely when things break.
   *
   * Storage shape, chosen to stay bounded over a long session:
   *   entry 0        always holds a complete copy of the project
   *   entries 1..n   hold only what changed since the one before
   *
   * So the state at any point is entry 0 with the deltas after it applied. When
   * the log gets too long the oldest delta is folded into entry 0 and dropped,
   * which keeps that invariant true forever and keeps memory flat. Storing a
   * full copy per checkpoint would have grown without limit — a few hundred
   * copies of a real project is hundreds of megabytes.
   *
   * Each entry:
   *   { id, at, files: { path: content | null }, run: 'ok'|'fail'|null,
   *     kind: 'manual'|'auto', label, by: { id, username, color },
   *     credits: [{ userId, username, color, lines, files: [{ path, lines }] }] }
   *
   * A null content means the file did not exist at that point. `kind` separates
   * the checkpoints the owner asked for from the protective ones taken before a
   * revert or restore. `credits` is the account of who changed what since the
   * previous checkpoint, frozen at capture time — attribution keeps moving, and
   * a record of a moment has to stop moving with it.
   */
  rewindLog: [],

  /* ── A collaborator's own record of their own work ──
   *
   * Checkpointing the PROJECT is the owner's call and stays that way: it
   * rewrites every file on every screen, so one person has to own it. But that
   * left everybody else with no way to mark their own progress at all — and
   * "what had I written before I went down this road" is a question a
   * collaborator asks about their own code, not about the project.
   *
   * So this is the other half. Each entry freezes what THIS user changed since
   * their previous personal save: the lines, with what each one was and what
   * they made it. Enough to look back at, which is what it is for.
   *
   * Three deliberate limits, and they are the point rather than a shortcut:
   *
   *   - It holds line records, never file snapshots. A snapshot of the project
   *     is the owner's checkpoint under another name.
   *   - It is local to this client and never broadcast. It is a personal
   *     notebook, not a claim on the session's history.
   *   - Nothing here can be applied. Reading it back into the project is a
   *     merge, and merging is the owner's decision — see restoreRewindPoint,
   *     which every write path already goes through.
   *
   * Each entry:
   *   { id, at, label, lines, files: [{ path, lines }],
   *     edits: [{ kind, path, line, oldLine, newLine, removedText, count }] }
   */
  myCheckpoints: [],

  /* Verdict of the most recent run, waiting to be stamped onto the next
     checkpoint. Not history in itself. */
  lastRunStatus: null,
  rewindOpen: false,
  rewindIndex: null,     // which checkpoint is being previewed
  rewindBusy: false,
  rewindNotice: null,

  // ---- Timeline State ----
  snapshots: [],            // Array of { id, code, userId, timestamp, diff }
  currentSnapshotIndex: -1, // Which snapshot is currently being viewed (-1 = live)
  isReplaying: false,       // Whether user is in replay mode

  // ---- Root Cause State ----
  rootCause: null,          // Root cause analysis result
  /* Shape: {
    errorType: "TypeError",
    errorMessage: "Cannot read properties of null",
    errorLine: 6,
    steps: [
      { step: 1, label: "EXTRACT", detail: "Variables: users, i" },
      { step: 2, label: "TRACE", detail: "users = null (line 16)" },
      { step: 3, label: "MATCH", detail: "users set to null in recent change" },
      { step: 4, label: "RANK", detail: "users — score: 0.95 (recency + proximity)" }
    ],
    suspectedVariable: "users",
    suspectedChange: "...",
    explanation: "AI-generated explanation",
    confidence: 0.85
  } */

  // ---- Auto-Fix Agent State ----
  /* The agent proposes; the user disposes. `autoFix` holds a proposal that has
   * NOT been written to the file yet, plus enough context to apply it safely:
   *
   *   targetPath    which file it was generated for
   *   basedOnCode   the exact content it patched — checked again at apply time,
   *                 because line-numbered edits are meaningless against code
   *                 that has moved on since
   *   previousCode  set on apply, so the change can be undone in one click
   *
   * Shape: {
   *   status: 'VERIFIED' | 'UNVERIFIED' | 'NO_FIX' | 'NO_AI_KEY' | 'ERROR',
   *   summary, explanation, confidence, fixedCode, message,
   *   edits: [{ startLine, endLine, oldText, newText }],
   *   attempts: [{ number, summary, verified, rejectedBecause }],
   *   verifiedOutput, remainingError, verificationSupported,
   *   targetPath, basedOnCode, applied, previousCode
   * } */
  autoFix: null,
  autoFixState: 'idle',   // 'idle' | 'working' | 'ready' | 'failed'

  /* ── Mario ──
   *
   * The agent used to live inside the terminal's output panel, which only
   * exists after a run — so the one thing that can repair a project was
   * unreachable until something had already been run and failed. He is a
   * floating companion now: summoned from the header, dragged wherever he is
   * least in the way, and available whether or not anything has run.
   *
   * The position is remembered because it is a physical preference, like where
   * you leave a tool on a desk; resetting it every launch would be a small
   * daily annoyance. It is clamped back into view on mount, so a window that
   * shrinks since last time cannot strand him off-screen.
   */
  marioOpen: false,
  marioPos: null,          // { x, y } from the top-left; null = the default corner
  marioCollapsed: false,   // collapsed shows just the sprite

  setMarioOpen: (marioOpen) => set({ marioOpen }),
  toggleMario: () => set((s) => ({ marioOpen: !s.marioOpen, marioCollapsed: false })),
  setMarioPos: (marioPos) => set({ marioPos }),
  toggleMarioCollapsed: () => set((s) => ({ marioCollapsed: !s.marioCollapsed })),

  // ---- Causality Graph State ----
  causalityGraph: null,
  /* Shape: {
    nodes: [
      { id: "1", type: "change", label: "Set users=null", user: "Alice" },
      { id: "2", type: "variable", label: "users" },
      { id: "3", type: "function", label: "findUser()" },
      { id: "4", type: "error", label: "TypeError at line 6" }
    ],
    edges: [
      { source: "1", target: "2", label: "modifies" },
      { source: "2", target: "3", label: "used_in" },
      { source: "3", target: "4", label: "throws" }
    ]
  } */

  // ---- Impact Detection State ----
  impactWarnings: [],          // [{ id, changedBy, changedPath, impacts, summary, affectedFiles, oldContent, timestamp }]
  revertNotification: null,    // { username, path, reason }
  impactDebounceTimer: null,   // Timer for debouncing self-impact checks
  commitSuggestion: null,      // { type, message, files, confidence, reason }

  // ---- Git Workspace State ----
  gitRepoConnected: false,     // Whether a repo is cloned for this session
  gitRepoUrl: '',              // Display URL (token stripped)
  gitStatus: '',               // Parsed git status output string
  gitLog: '',                  // Recent commit log string
  gitLoading: false,           // Whether a git operation is in progress
  gitError: null,              // Last git operation error

  // ---- Dev Server State ----
  detectedProjects: [],          // Array of detected projects from upload
  devServers: {},                // { [type]: { state, logs, port, url, framework, displayName } }
  projectDetected: false,        // Whether detection has been run
  devServerNotification: null,   // Notification banner for project detection

  // ---- Deployment State ----
  deployStatus: 'idle',           // 'idle' | 'connecting' | 'env-confirm' | 'pushing-env' | 'deploying' | 'success' | 'error'
  deployLogs: [],                 // Array of log line strings
  deployUrl: null,                // Final deployment URL on success
  deployError: null,              // Error message on failure
  deployStartTime: null,          // Deployment start timestamp
  currentDeployId: null,          // Active deploy PTY ID
  deployHistory: [],              // [{id, url, timestamp, status, framework, snapshotId}]
  vercelConnected: false,         // Whether token is stored
  vercelUsername: null,           // Vercel account display name
  deployFramework: null,          // Detected framework for current deploy
  pendingRedeploy: false,         // Flag to trigger deployment from another tab
  deployTarget: 'frontend',       // 'frontend' (Vercel) | 'backend' (Render) — active Deploy HQ tab
  lastDeploySessionId: null,      // sessionId used for the last Vercel deploy (survives app restart)

  // ---- Render (backend) Deployment State ----
  renderDeployStatus: 'idle',     // 'idle' | 'connecting' | 'env-confirm' | 'pushing-env' | 'deploying' | 'success' | 'error'
  renderDeployLogs: [],           // Array of log line strings
  renderDeployUrl: null,          // Live service URL on success
  renderDeployError: null,        // Error message on failure
  renderDeployStartTime: null,    // Deploy start timestamp
  currentRenderDeployId: null,    // Active Render deploy ID
  renderConnected: false,         // Whether a Render API key is stored
  renderOwnerName: null,          // Render account display name
  renderRuntime: null,            // Detected backend runtime label
  lastRenderDeploySessionId: null, // sessionId used for the last Render deploy (survives app restart)

  // ---- UI Layout State ----
  activeView: 'code',               // 'code' | 'whiteboard'
  whiteboardElements: [],           // Elements on the whiteboard
  whiteboardCursors: {},            // Remote users' whiteboard cursors: { [userId]: { x, y, username, color, timestamp } }
  whiteboardPan: { x: 0, y: 0 },    // Canvas pan coordinate offset
  whiteboardZoom: 1,                 // Canvas zoom scale

  // ---- Voice Room State ----
  voiceRoomUsers: [],               // [{ id, username, color }] users currently in voice room
  isInVoiceRoom: false,             // Whether current user has joined voice
  isMuted: false,                   // Local microphone mute
  isDeafened: false,                // Local audio deafen (can't hear others)
  speakingUsers: {},                // { [userId]: true/false } — speaking indicators

  // ---- Follow Mode State ----
  followingUserId: null,            // ID of the user being followed (null = not following)
  followedByUsers: [],              // IDs of users following this user
  followState: null,                // Incoming leader state: { leaderId, file, scrollTop, cursorLine, cursorColumn, selectionRange }
  followToast: null,                // Toast message for follow mode events

  terminalActiveTab: 'output',      // Active tab in primary (left) pane
  terminalSecondActiveTab: 'graph', // Active tab in secondary (right) pane in split mode
  isTerminalOpen: false,            // Whether terminal is visible
  terminalHeight: 300,              // Height in pixels (normal mode)
  terminalLayoutMode: 'normal',      // 'normal' | 'split' | 'maximized'
  isFileExplorerOpen: true,    // File explorer visibility
  pendingTerminalCommand: null, // Command queued to run in PTY

  // ---- CodeShot State ----
  codeShotModal: null,         // null = closed, or { code, language, filePath, startLine, endLine, branch, timestamp }
  editorSelection: null,       // null = no selection, or { code, startLine, endLine }

  // ---- Actions: Session ----
  setSession: (sessionId, sessionName) => set({ sessionId, sessionName }),

  /* The single code the owner shares. Identical to the session id for a
   * session nobody outside this machine can reach; carries the host address
   * as a suffix once a tunnel is open, so a joiner needs nothing extra. */
  joinCode: '',
  setJoinCode: (joinCode) => set({ joinCode }),

  /* True when the tunnel handed out a new address after the invite had already
   * been shared, so the link everyone is holding no longer works. Forces the
   * share panel back on screen — it normally hides once somebody has joined,
   * which is exactly the moment this becomes important. */
  joinCodeStale: false,
  setJoinCodeStale: (joinCodeStale) => set({ joinCodeStale }),

  /* ── Connection health ──
   *
   *   connected     → normal
   *   reconnecting  → the socket dropped; the retry loop is running
   *   lost          → it has stayed down long enough to stop trusting it
   *
   * Two stages rather than one, because a three-second Wi-Fi blink and a dead
   * tunnel look identical at the moment they happen and deserve opposite
   * responses. While reconnecting, editing stays open: if the socket returns,
   * the CRDT merges everything typed in the gap, which is the whole point of
   * using one. Only once the grace period expires — by which time the tunnel
   * URL has most likely changed and those edits can never merge — does the
   * editor lock.
   *
   * Only ever armed inside a session. Local mode has no socket.
   */
  connectionState: 'connected',

  markSocketConnected: () => {
    clearTimeout(connectionLostTimer);
    connectionLostTimer = null;
    if (get().connectionState !== 'connected') {
      console.log('[Causify] Connection restored');
    }
    set({ connectionState: 'connected' });
  },

  markSocketDropped: () => {
    // No session, no socket to lose — and local mode must never be locked.
    if (!get().sessionId) return;

    /* Once given up on, stay given up on until a real reconnect.
     *
     * The retry loop keeps firing close events every few seconds for as long
     * as the host is unreachable. Without this the first one after the verdict
     * would find no timer running, flip the state back to 'reconnecting', and
     * start the countdown again — so the banner would alternate between
     * "Reconnecting…" and "Lost connection" and the editor would unlock and
     * re-lock every fifteen seconds, forever. */
    if (get().connectionState === 'lost') return;

    // Already counting down; restarting the timer on every retry attempt
    // would keep pushing the deadline away and it would never fire.
    if (connectionLostTimer) return;

    set({ connectionState: 'reconnecting' });

    connectionLostTimer = setTimeout(() => {
      connectionLostTimer = null;
      // Re-checked because the socket may have come back while we waited.
      if (get().connectionState === 'reconnecting') {
        set({ connectionState: 'lost' });
      }
    }, CONNECTION_GRACE_MS);
  },

  /* ── Take over hosting ──
   *
   * Everything routes through the host's machine, so their laptop closing ends
   * the session for everyone. That will happen at a long event — someone walks
   * away, a lid shuts, a battery dies.
   *
   * Nothing is actually lost when it does: local-first means every participant
   * already holds the files. Only the channel died. So recovery does not need
   * infrastructure, just permission for somebody else to open a new channel
   * from the copy they already have.
   *
   * Returns the new join code for the taker to share; the others rejoin with it.
   */
  reformSessionAsHost: async () => {
    const { files, sessionName, currentUser, workspaceRoot } = get();

    const toShare = Object.entries(files || {})
      .filter(([, content]) => typeof content === 'string')
      .map(([path, content]) => ({ path, content }));

    if (toShare.length === 0) {
      return { ok: false, reason: 'There are no files loaded here to host.' };
    }

    set({ connectionState: 'connected' });

    try {
      /* Point at this machine first. The origin still refers to the host that
       * just vanished, and the new session would otherwise be created on their
       * backend — which is exactly the one that is unreachable. */
      resetOrigin();
      clearSessionToken();

      const username = currentUser?.username || 'Host';
      const session = await createSession(
        sessionName || 'Recovered session',
        username,
        '0000'
      );

      await uploadProject(session.id, toShare);
      setSessionToken(session.token);

      set({
        sessionId: session.id,
        sessionName: session.name,
        currentUser: session.user,
        userRole: 'owner',
        connectedUsers: [],
        remoteCursors: {},
        filePresence: {},
        remoteLineChanges: {},
        remoteLineDeletions: {},
        // A brand new session inherits nothing, locks and lobby included.
        lockedFiles: {},
        pendingAdmissions: [],
        connectionState: 'connected',
        joinCodeStale: false,
      });

      return { ok: true, sessionId: session.id, keepWorkspace: Boolean(workspaceRoot) };
    } catch (err) {
      set({ connectionState: 'lost' });
      return { ok: false, reason: err.response?.data?.message || err.message || 'Could not start a new session.' };
    }
  },

  /* Whether this client still needs to prove its membership. Never granted
     locally — only a completed rejoin clears it, because only the server can
     issue the token that makes it false in fact rather than on screen. */
  setReauthNeeded: (reauthNeeded) => set({ reauthNeeded }),

  /* Ask the file panel to open its join form for the session already loaded.
   *
   * A counter rather than a flag: the user may dismiss the form and come back
   * to the banner, and a boolean that is already true produces no change for
   * the panel to react to. Incrementing always does. */
  openRejoinPanel: () => set((s) => ({ rejoinRequested: s.rejoinRequested + 1 })),
  rejoinRequested: 0,

  resetConnectionState: () => {
    clearTimeout(connectionLostTimer);
    connectionLostTimer = null;
    set({ connectionState: 'connected' });
  },

  // Reachability of a hosted session from outside this network.
  tunnelState: 'off',        // 'off' | 'starting' | 'on' | 'error'
  tunnelError: null,
  setTunnel: (tunnelState, tunnelError = null) => set({ tunnelState, tunnelError }),
  setProjectRootPath: (path) => set({ projectRootPath: path }),
  setCurrentUser: (user) => set({ currentUser: user }),
  setUserRole: (role) => set({ userRole: role }),
  isOwner: () => get().userRole === 'owner',
  setConnectedUsers: (users) => set((s) => {
    // Drop presence entries for users who are no longer connected.
    const ids = new Set((users || []).map(u => u.id));
    const filePresence = {};
    Object.entries(s.filePresence).forEach(([uid, p]) => {
      if (ids.has(uid)) filePresence[uid] = p;
    });
    return { connectedUsers: users, filePresence };
  }),

  // Record which file a remote user currently has open (persistent presence,
  // distinct from the transient "LIVE" edit flash in fileActivity).
  updateFilePresence: (userId, data) => set((s) => ({
    filePresence: {
      ...s.filePresence,
      [userId]: {
        path: data.path,
        username: data.username,
        color: data.color || '#6366f1',
        timestamp: Date.now(),
      },
    },
  })),

  setLockedFiles: (locks) => set({ lockedFiles: locks || {} }),

  setPendingAdmissions: (pending) => set({ pendingAdmissions: pending || [] }),

  /* Is this file closed to me right now?
   *
   * The owner is never locked out — the lock is theirs, and a control you
   * cannot escape from your own side is a trap rather than a tool. Outside a
   * session there is nobody to lock anything, so a local folder is unaffected.
   */
  isPathLockedForMe: (path) => {
    const { sessionId, userRole, lockedFiles } = get();
    if (!sessionId || !path || userRole === 'owner') return false;
    return Boolean(lockedFiles[path]);
  },

  // Can the current user edit? Owner always can; collaborators can unless the
  // owner set them to "viewer". Absent permission defaults to editable.
  canCurrentUserEdit: () => {
    const { userRole, currentUser, connectedUsers } = get();
    if (userRole === 'owner') return true;
    const me = connectedUsers.find(u => u.id === currentUser?.id);
    return !me || me.permission !== 'viewer';
  },
  addUser: (user) => set((s) => ({
    connectedUsers: [...s.connectedUsers.filter(u => u.id !== user.id), user]
  })),
  removeUser: (userId) => set((s) => ({
    connectedUsers: s.connectedUsers.filter(u => u.id !== userId)
  })),

  // Update a remote user's cursor position
  updateRemoteCursor: (userId, cursorData) => {
    set((s) => ({
      remoteCursors: { ...s.remoteCursors, [userId]: { ...cursorData, timestamp: Date.now() } }
    }));
    // Auto-remove stale cursors after 10s
    setTimeout(() => {
      const cursor = get().remoteCursors[userId];
      if (cursor && Date.now() - cursor.timestamp > 9000) {
        set((s) => {
          const newCursors = { ...s.remoteCursors };
          delete newCursors[userId];
          return { remoteCursors: newCursors };
        });
      }
    }, 10000);
  },

  // Add a change notification toast
  addChangeNotification: (notification) => {
    const id = Date.now() + Math.random();
    const notif = { ...notification, id };
    set((s) => ({
      changeNotifications: [...s.changeNotifications.slice(-2), notif] // Keep max 3
    }));
    // Auto-dismiss after 4s
    setTimeout(() => {
      set((s) => ({
        changeNotifications: s.changeNotifications.filter(n => n.id !== id)
      }));
    }, 4000);
  },

  // ---- Actions: Editor ----
  setProject: (fileArray) => {
    const fileMap = {};
    const savedMap = {};
    fileArray.forEach(f => {
      fileMap[f.path] = f.content;
      savedMap[f.path] = f.content; // Seed baseline for dirty tracking
    });
    const firstPath = fileArray.length > 0 ? fileArray[0].path : '';
    const firstContent = fileArray.length > 0 ? fileArray[0].content : '';
    const language = firstPath ? get().detectLanguage(firstPath) : 'javascript';
    set({
      files: fileMap,
      activePath: firstPath,
      code: firstContent,
      language,
      savedContents: savedMap,
      /* A project arriving is a new baseline: nobody has changed anything in it
       * yet. These maps used to survive it, so records about files that were
       * replaced — or about an entirely different project opened earlier in the
       * same window — were still sitting here when the first checkpoint asked
       * "what has changed?". That is how uploading a folder produced a
       * checkpoint crediting somebody with deleting a file they never saw. */
      remoteLineChanges: {},
      remoteLineDeletions: {},
      output: '',
      error: '',
      rootCause: null,
      causalityGraph: parseExecutionGraph(firstContent, language)
    });
  },

  /**
   * Fold a freshly fetched file list into the workspace.
   *
   * Used when a peer uploads a project into the session. Unlike setProject this
   * keeps whatever the user currently has open — replacing the whole workspace
   * would rip the file out from under someone mid-edit. Only opens a file if
   * nothing is open yet, which is the case for a collaborator who has been
   * waiting for the owner to share something.
   */
  mergeRemoteFiles: (fileArray) => {
    const incoming = fileArray || [];
    if (incoming.length === 0) return;

    set((s) => {
      const files = { ...s.files };
      const savedContents = { ...s.savedContents };
      incoming.forEach((f) => {
        if (!f || !f.path) return;
        files[f.path] = f.content ?? '';
        savedContents[f.path] = f.content ?? '';
      });

      const activePath = s.activePath || incoming[0].path || '';
      const code = activePath ? (files[activePath] ?? '') : '';
      const language = activePath ? get().detectLanguage(activePath) : s.language;

      return {
        files,
        savedContents,
        activePath,
        code,
        language,
        causalityGraph: activePath ? parseExecutionGraph(code, language) : s.causalityGraph,
      };
    });
  },

  openFile: (path) => {
    const { files, isReplaying, workspaceRoot, loadedPaths } = get();
    if (isReplaying) return;
    get().markFileOpened(path, files[path] || '');
    const code = files[path] || '';
    const language = get().detectLanguage(path);
    set({
      activePath: path,
      code,
      language,
      output: '',
      error: '',
      rootCause: null,
      autoFix: null,
      autoFixState: 'idle',
      causalityGraph: parseExecutionGraph(code, language)
    });

    // Local mode reads contents on demand: opening a folder costs a directory
    // listing, not a copy of the project. Fetch this file the first time it is
    // opened; the editor updates once it lands.
    if (workspaceRoot && !loadedPaths[path]) {
      get().loadLocalFile(path);
    }
  },

  /* ── Local Workspace ── */

  /**
   * How the desktop layer should identify this project.
   *
   * Deploy, Vercel/Render links and env detection all need a stable scope. In
   * local mode that is the folder path (the main process hashes it into a
   * workspace id); otherwise it is the session id. Returned as an object so
   * call sites can spread it straight into their IPC options.
   */
  getDeployScope: () => {
    const { workspaceRoot, sessionId } = get();
    return workspaceRoot ? { workspaceRoot } : { sessionId };
  },

  /**
   * Save a file that has no project folder behind it — an untitled buffer.
   *
   * The first save asks where it goes and remembers the answer, so subsequent
   * saves write straight there. This is the ordinary editor contract: a new file
   * exists as soon as you make it, and only acquires a location when saved.
   *
   * Returns true if it was written, false if the user backed out.
   */
  saveScratchFile: async (path, content) => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.workspace : null;
    if (!api?.saveAs || !path) return false;

    const known = get().fileDiskPaths[path];
    if (known) {
      await api.write(known, content);
      get().markFileSaved(path, content);
      get().recordLocalSnapshot(path, content);
      return true;
    }

    const saved = await api.saveAs(path.split('/').pop(), content);
    if (!saved) return false; // cancelled

    set((s) => ({ fileDiskPaths: { ...s.fileDiskPaths, [path]: saved.filePath } }));
    get().markFileSaved(path, content);
    get().setFileSavedPath(path, saved.fileName);
    get().recordLocalSnapshot(path, content);
    return true;
  },

  /** Absolute on-disk path for a project-relative path, or null outside local mode. */
  absolutePathFor: (relPath) => {
    const root = get().workspaceRoot;
    if (!root || !relPath) return null;
    const sep = root.includes('\\') ? '\\' : '/';
    return `${root}${sep}${relPath.split('/').join(sep)}`;
  },

  /**
   * Adopt a folder opened from disk. Only paths are seeded — contents stay null
   * until each file is opened, so a large project costs almost nothing to load.
   * projectRootPath is set alongside so integrated terminals open in the project.
   */
  openLocalWorkspace: ({ root, name, files: fileList, truncated }) => {
    const fileMap = {};
    (fileList || []).forEach((f) => { fileMap[f.path] = null; });
    set({
      workspaceRoot: root,
      workspaceName: name || '',
      workspaceTruncated: Boolean(truncated),
      loadedPaths: {},
      files: fileMap,
      projectRootPath: root,
      activePath: '',
      code: '',
      savedContents: {},
      fileSavedPaths: {},
      fileHandles: {},
      output: '',
      error: '',
      rootCause: null,
      causalityGraph: null,
      // Detection belongs to the previous project — re-run it for this folder.
      detectedProjects: [],
      devServers: {},
      projectDetected: false,
      // Attribution from a session that was open beforehand would otherwise
      // linger in this folder's gutter, pointing at lines it never described.
      remoteLineChanges: {},
      remoteLineDeletions: {},
      /* The rewind history belongs to the project that was open, and it is
         persisted now — so without this, opening a second folder would inherit
         the first one's checkpoints and offer to "restore" this project to a
         snapshot of a different one. */
      rewindLog: [],
      rewindIndex: null,
      rewindNotice: null,
      // Cleared here and repopulated below if this folder has been opened before.
      snapshots: [],
      currentSnapshotIndex: -1,
      isReplaying: false,
      whiteboardElements: [],
    });

    // Bring back this folder's own history and whiteboard.
    get().loadLocalWorkspaceState(root);
  },

  /** Return to session/DB mode, leaving the files on disk untouched. */
  closeLocalWorkspace: () => {
    const { workspaceRoot, snapshots, whiteboardElements } = get();

    // Flush any pending history/whiteboard write straight away. The debounced
    // save would otherwise still be waiting when the folder reference is torn
    // down, and anything drawn or saved in the last moment would be lost.
    const api = typeof window !== 'undefined' ? window.electronAPI?.workspace : null;
    if (workspaceRoot && api?.saveState) {
      clearTimeout(localStateSaveTimer);
      api.saveState(workspaceRoot, { snapshots, whiteboardElements })
        .catch((err) => console.warn('[Causify] Could not save workspace state:', err.message));
    }

    set({
      workspaceRoot: null,
      workspaceName: '',
      workspaceTruncated: false,
      loadedPaths: {},
      files: {},
      projectRootPath: null,
      activePath: '',
      code: '',
      savedContents: {},
      detectedProjects: [],
      devServers: {},
      projectDetected: false,
      // The whiteboard and history belong to the folder that just closed. They
      // are saved above and reloaded if it is opened again — leaving them on
      // screen over the welcome view would show one project's board with no
      // project open.
      activeView: 'code',
      whiteboardElements: [],
      snapshots: [],
      currentSnapshotIndex: -1,
      isReplaying: false,

      // Everything below described the folder that just closed. Left up, the
      // terminal would keep showing that project's repository and dev servers
      // over a welcome screen with nothing open — which is how a closed folder
      // ended up still looking connected.
      isTerminalOpen: false,
      terminalLayoutMode: 'normal',
      gitRepoConnected: false,
      gitRepoUrl: '',
      gitStatus: '',
      gitLog: '',
      gitLoading: false,
      gitError: null,
      commitSuggestion: null,
      output: '',
      error: '',
      rootCause: null,
      causalityGraph: null,
    });
  },

  /**
   * Read one file from disk into the store. Safe to call repeatedly; the editor
   * is only updated if the file is still the active one when the read returns,
   * so a fast click through several files can't leave stale content on screen.
   */
  loadLocalFile: async (path) => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.workspace : null;
    const absolute = get().absolutePathFor(path);
    if (!api || !absolute) return null;

    try {
      const result = await api.read(absolute);
      const content = result?.content ?? '';

      set((s) => ({
        files: { ...s.files, [path]: content },
        savedContents: { ...s.savedContents, [path]: content },
        loadedPaths: { ...s.loadedPaths, [path]: true },
      }));

      if (get().activePath === path) {
        const language = get().detectLanguage(path);
        set({ code: content, language, causalityGraph: parseExecutionGraph(content, language) });
      }
      return content;
    } catch (err) {
      console.error('[Causify] Could not read', path, err.message);
      return null;
    }
  },

  /* ── Local history ──
   * Sessions get their timeline from the backend. A folder opened from disk has
   * no session, so its history is captured here on each save and kept in the
   * app's data directory, keyed by the folder's path.
   */

  /** Load a folder's saved history and whiteboard, if it has been opened before. */
  loadLocalWorkspaceState: async (root) => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.workspace : null;
    if (!api?.loadState || !root) return;
    try {
      const state = await api.loadState(root);
      if (!state) return;
      set({
        snapshots: Array.isArray(state.snapshots) ? state.snapshots : [],
        whiteboardElements: Array.isArray(state.whiteboardElements) ? state.whiteboardElements : [],
      });
    } catch (err) {
      console.warn('[Causify] Could not load this folder\'s history:', err.message);
    }
  },

  /** Persist history and whiteboard for the open folder. Debounced by the caller. */
  saveLocalWorkspaceState: () => {
    const { workspaceRoot, snapshots, whiteboardElements } = get();
    const api = typeof window !== 'undefined' ? window.electronAPI?.workspace : null;
    if (!api?.saveState || !workspaceRoot) return;

    clearTimeout(localStateSaveTimer);
    localStateSaveTimer = setTimeout(() => {
      api.saveState(workspaceRoot, { snapshots, whiteboardElements })
        .catch((err) => console.warn('[Causify] Could not save workspace state:', err.message));
    }, 800);
  },

  /**
   * Record a point in the local history.
   *
   * Only meaningful changes are kept: saving a file whose content is identical to
   * the last snapshot would just pad the timeline. The list is capped so a long
   * session cannot grow the state file without bound.
   */
  recordLocalSnapshot: (path, code, { hasError = false } = {}) => {
    const { snapshots } = get();
    if (!path) return;
    // An untitled file has no folder to store history against, so its timeline
    // lives in memory for as long as it is open — saveLocalWorkspaceState below
    // is a no-op until there is a folder to write it beside.

    const previous = snapshots[snapshots.length - 1];
    if (previous && previous.code === code && previous.path === path) return;

    const snapshot = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      path,
      code: code ?? '',
      userId: 'local',
      timestamp: new Date().toISOString(),
      hasError,
      diff: null,
    };

    set({ snapshots: [...snapshots, snapshot].slice(-MAX_LOCAL_SNAPSHOTS) });
    get().saveLocalWorkspaceState();
  },

  /**
   * Debounced disk write, used for changes arriving from collaborators.
   *
   * Remote edits stream in continuously while someone types, so each path gets
   * its own timer and only the settled content is written. Timers live outside
   * the store state — they are transient machinery, not something to persist or
   * re-render on.
   */
  scheduleLocalPersist: (path, content) => {
    if (!path) return;
    clearTimeout(localPersistTimers[path]);
    localPersistTimers[path] = setTimeout(() => {
      delete localPersistTimers[path];
      get().writeLocalFile(path, content).catch((err) =>
        console.error('[Causify] Could not write a collaborator\'s change to disk:', err.message)
      );
    }, 1200);
  },

  /**
   * Write a file back to its real location on disk.
   *
   * This is the whole point of local mode: a save lands in the user's actual
   * file, so any other editor sees it immediately. Returns false when not in
   * local mode so callers can fall back to their existing behaviour.
   */
  writeLocalFile: async (path, content) => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.workspace : null;
    const absolute = get().absolutePathFor(path);
    if (!api || !absolute) return false;

    await api.write(absolute, content);
    set((s) => ({
      files: { ...s.files, [path]: content },
      loadedPaths: { ...s.loadedPaths, [path]: true },
    }));
    get().markFileSaved(path, content);
    // A save is the natural point in the local history — the same moment the
    // session flow records one.
    get().recordLocalSnapshot(path, content);
    return true;
  },

  addFile: (path, content = '') => {
    const language = get().detectLanguage(path);
    set((s) => ({
      files: { ...s.files, [path]: content },
      savedContents: { ...s.savedContents, [path]: content }, // Seed baseline
      activePath: path,
      code: content,
      language,
      output: '',
      error: '',
      rootCause: null,
      causalityGraph: parseExecutionGraph(content, language)
    }));
  },

  removeFile: (path) => {
    const { files, activePath } = get();
    const newFiles = { ...files };

    // Clean up save metadata for deleted files
    const newHandles = { ...get().fileHandles };
    const newSaved = { ...get().savedContents };
    const newDiskPaths = { ...get().fileSavedPaths };

    // Recursive delete: remove exact path or any path starting with "path/"
    Object.keys(newFiles).forEach(f => {
      if (f === path || f.startsWith(path + '/')) {
        delete newFiles[f];
        delete newHandles[f];
        delete newSaved[f];
        delete newDiskPaths[f];
      }
    });

    let newActive = activePath;
    let newCode = get().code;

    // If the active file was deleted or its parent folder was deleted
    if (activePath === path || activePath.startsWith(path + '/')) {
      const remainingPaths = Object.keys(newFiles);
      newActive = remainingPaths.length > 0 ? remainingPaths[0] : '';
      newCode = remainingPaths.length > 0 ? newFiles[newActive] : '';
      const language = get().detectLanguage(newActive);

      set({
        files: newFiles,
        activePath: newActive,
        code: newCode,
        language,
        fileHandles: newHandles,
        savedContents: newSaved,
        fileSavedPaths: newDiskPaths,
        output: '',
        error: '',
        rootCause: null,
        causalityGraph: parseExecutionGraph(newCode, language)
      });
    } else {
      set({
        files: newFiles,
        fileHandles: newHandles,
        savedContents: newSaved,
        fileSavedPaths: newDiskPaths,
      });
    }
  },

  detectLanguage: (path) => {
    if (!path) return 'plaintext';
    const lower = path.toLowerCase();
    if (lower.endsWith('.java')) return 'java';
    if (lower.endsWith('.py') || lower.endsWith('.pyw')) return 'python';
    if (lower.endsWith('.c') || lower.endsWith('.h')) return 'c';
    if (lower.endsWith('.cpp') || lower.endsWith('.cc') || lower.endsWith('.cxx') || lower.endsWith('.hpp')) return 'cpp';
    if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
    if (lower.endsWith('.css')) return 'css';
    if (lower.endsWith('.json')) return 'json';
    if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
    if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript';
    if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
    // Unrecognized / malformed extensions (e.g. ".cp", or a stray typo) fall back
    // to plain text — never JavaScript. This keeps unknown files neutral instead
    // of mislabeling them as JS.
    return 'plaintext';
  },

  recordLineDiff: (path, oldContent, newContent, userId, username, color) => {
    if (!path || oldContent === newContent) return;

    /* Line attribution answers "who changed this line", which is only a
     * question when more than one person can. A folder opened from disk has a
     * single author, so every marker read "You" — a gutter full of icons and a
     * hover card describing the line you had just finished typing.
     *
     * Guarded here rather than at the call sites so no future caller can
     * reintroduce it. Sessions are untouched: they always carry a sessionId,
     * and both callers (local typing via setCode, collaborators via
     * updateRemoteFile) behave exactly as before inside one. */
    if (!get().sessionId) return;
    // Restoring, reverting and undoing are not authorship — see asHistoryOp.
    if (historyOps > 0) return;

    /* A file appearing or blanking wholesale is the editor, not a person.
     *
     * Opening a file binds an empty CRDT document, mirrors it into the store,
     * then fills it — so the store briefly goes "whole file" -> "" -> "whole
     * file". Recorded literally, that is a deletion of every line followed by
     * an addition of every line, credited to whoever opened it. It is why a
     * checkpoint taken straight after an upload listed the two files somebody
     * had merely clicked on.
     *
     * The trade is deliberate and worth stating: a human who really does select
     * all and delete a file's contents is not credited either. That is rare, it
     * is undoable in the editor, and the file still changes for everyone — an
     * occasional missing record is a far smaller lie than routinely inventing
     * one for every file anybody opens. */
    const before = String(oldContent || '');
    const after = String(newContent || '');
    if (before.trim() === '' || after.trim() === '') return;

    /* Line endings are not edits.
     *
     * A project uploaded from a Windows disk arrives with CRLF; Monaco
     * normalises its model to LF. Splitting on \n alone left a stray \r on every
     * line of the stored copy, so the first comparison found all of them
     * different and credited whoever opened the file with authoring the whole
     * thing — text that looked identical on screen, because the difference was
     * an invisible character. Nobody typed a line ending; it is not a fact about
     * a person and must not be recorded as one. */
    const oldLines = splitLines(oldContent);
    const newLines = splitLines(newContent);
    const now = Date.now();
    let existingPathChanges = { ...(get().remoteLineChanges[path] || {}) };

    let top = 0;
    while (top < oldLines.length && top < newLines.length && oldLines[top] === newLines[top]) {
      top++;
    }

    let bottomOld = oldLines.length - 1;
    let bottomNew = newLines.length - 1;
    while (bottomOld >= top && bottomNew >= top && oldLines[bottomOld] === newLines[bottomNew]) {
      bottomOld--;
      bottomNew--;
    }

    /* ── Follow the lines that moved ──
     *
     * Every record says "line N holds this text". Adding or removing a line
     * shifts everything below it, so those records now name the wrong line —
     * and the sweep at the bottom of this function DELETES anything whose text
     * no longer matches its line.
     *
     * That is why a checkpoint could report "no edits by anyone" over an
     * afternoon of work: press Enter once near the top of a file and every
     * earlier attribution below the cursor was thrown away, silently, because
     * it had moved down by one. The record was never wrong — only its index
     * was, and an index is something we can recompute.
     *
     * The edit replaced old lines [top..bottomOld] with new lines
     * [top..bottomNew], so everything after the replaced region moves by the
     * difference. Records inside the region are left alone: they describe text
     * the edit has just rewritten, and the sweep is right to drop those. */
    const shift = bottomNew - bottomOld;
    if (shift !== 0) {
      const firstMoved = bottomOld + 2; // 1-based line after the changed region
      const shifted = {};
      Object.entries(existingPathChanges).forEach(([ln, rec]) => {
        const n = Number(ln);
        shifted[n >= firstMoved ? n + shift : n] = rec;
      });
      existingPathChanges = shifted;
    }

    // Range [top, bottomNew] in the NEW file is what changed
    for (let i = top; i <= bottomNew; i++) {
      const lineNum = i + 1;
      const prevRecord = existingPathChanges[lineNum];

      const rawOldLine = i <= bottomOld ? oldLines[i] : undefined;
      const newLineVal = newLines[i] ?? '';

      /* The baseline is what this line held before ANYONE started on it, and it
       * is carried across authors rather than only across repeat edits by the
       * same one. Without that, person B putting person A's line back reads as
       * a fresh change BY B — from A's text to the original — so undoing work
       * left a record behind under a different name, and the panel went on
       * reporting changes that no longer existed. It also means a revert
       * returns the line to how it really started, not to an intermediate
       * state somebody else passed through. */
      const initialOldLine = prevRecord ? prevRecord.oldLine : (rawOldLine ?? '(line added)');

      /* Identical on both sides: this line sits inside the changed region but
       * was not touched by the edit. [top, bottomNew] spans the FIRST to the
       * LAST differing line, so editing the top of a file and the bottom of it
       * swept every untouched line between them into the record — producing
       * entries whose "was" and "is" were the same text, and inflating one
       * small edit into a claim on most of the file. */
      if (rawOldLine === newLineVal && !prevRecord) continue;

      // The type belongs to the baseline too: a line someone else added and
      // this person then edited is still, against the baseline, an addition.
      let changeType;
      if (prevRecord) changeType = prevRecord.type;
      else if (rawOldLine === undefined || rawOldLine === '' || i > bottomOld) changeType = 'added';
      else changeType = 'modified';

      /* Back to what it was, so there is nothing left to attribute or revert.
       * This used to require the same author, so a change and its undo arriving
       * under different identities left the record standing for good. */
      if (newLineVal === initialOldLine || (initialOldLine === '(line added)' && newLineVal === '')) {
        delete existingPathChanges[lineNum];
        continue;
      }

      existingPathChanges[lineNum] = {
        userId: userId || 'local',
        username: username || 'You',
        color: color || '#FFB224',
        timestamp: now,
        oldLine: initialOldLine,
        newLine: newLineVal,
        type: changeType,
      };
    }

    /* Every record claims "line N currently holds newLine". Inserting or
     * deleting a line shifts everything below it, so records left pointing at
     * text that has moved are simply wrong: they still count toward the totals
     * and fill the panel, yet both revert paths refuse them — they check this
     * very condition before touching anything. Dropped here, so the number the
     * panel reports is the number of changes it can actually act on. */
    Object.keys(existingPathChanges).forEach((ln) => {
      const n = parseInt(ln, 10);
      const rec = existingPathChanges[ln];
      /* `oldLine === newLine` is a record of nothing having happened. It passes
       * the check above — its newLine does match the file — so it survived every
       * sweep and went on being counted. */
      const noop = rec.oldLine === rec.newLine;
      if (n > newLines.length || rec.newLine !== newLines[n - 1] || noop) {
        delete existingPathChanges[ln];
      }
    });

    /* ── Deletions ──
     *
     * The loop above walks [top, bottomNew] — a range in the NEW file — so a
     * line that no longer exists is never visited. Deleting one `<script>` tag
     * therefore produced no record of any kind, and "who changed what" reported
     * nothing at all for the edit most likely to have broken the page.
     *
     * The removed text is kept whole and anchored to the line that closed over
     * the gap, which is what a revert needs: put these lines back, here.
     */
    const oldCount = bottomOld - top + 1;
    const newCount = Math.max(0, bottomNew - top + 1);
    let deletions = get().remoteLineDeletions[path] || [];

    if (oldCount > newCount) {
      const cutFrom = top + newCount;
      const removed = oldLines.slice(cutFrom, bottomOld + 1);

      // A trailing newline reads as one empty line vanishing. Not worth a card.
      if (removed.some((l) => l.trim() !== '')) {
        deletions = [...deletions, {
          id: `del-${now}-${Math.random().toString(36).slice(2, 7)}`,
          anchor: cutFrom + 1,                       // 1-based line it collapsed onto
          anchorAfter: newLines[cutFrom] ?? null,    // what sits there now (null = EOF)
          removedText: removed.join(NL),
          userId: userId || 'local',
          username: username || 'You',
          color: color || '#FFB224',
          timestamp: now,
        }];
      }
    }

    set((s) => ({
      remoteLineChanges: { ...s.remoteLineChanges, [path]: existingPathChanges },
      remoteLineDeletions: { ...s.remoteLineDeletions, [path]: deletions },
    }));
  },

  /* @param opts.attribute  false when the text arrived rather than being
   *   written — a CRDT seed, or mirroring the shared document into the store
   *   after binding. The content is still stored and still persisted; it simply
   *   has no author. Recording it as one is what made an uploaded project look
   *   like it had been typed, line by line, by whoever opened it first. */
  setCode: (code, opts = {}) => {
    const attribute = opts.attribute !== false;
    const { activePath, language, isReplaying, files, currentUser } = get();
    if (isReplaying || !activePath) return;

    /* The read-only editor stops typing, but not every write comes from a
     * keystroke. Everything a collaborator can do to a file funnels through
     * here, so this is the one place that has to hold. Remote edits arrive via
     * updateRemoteFile and are unaffected — the owner can still work in the
     * file they locked, and everyone still sees it. */
    if (get().isPathLockedForMe(activePath)) return;

    const oldContent = files[activePath] || '';
    if (attribute && oldContent !== code) {
      get().recordLineDiff(
        activePath,
        oldContent,
        code,
        currentUser?.id || 'local',
        currentUser?.username || 'You',
        currentUser?.color || '#FFB224'
      );
    }

    set((s) => ({
      code,
      files: { ...s.files, [activePath]: code },
      output: '',
      error: '',
      rootCause: null,
      // A proposal is a set of line edits against the text as it was. Once that
      // text changes the proposal is scrap. applyAutoFix re-sets it when the
      // change was the fix itself being applied.
      autoFix: null,
      autoFixState: 'idle',
      causalityGraph: parseExecutionGraph(code, language)
    }));
  },

  setCollisionWarning: (warning) => set({ collisionWarning: warning }),

  // Update a specific file from a remote event.
  //
  // `bulk` marks content that ARRIVED rather than content someone typed: the
  // project handed to a joiner, a file seeded into the shared doc for the first
  // time, an upload. It still updates the file — it just does not make anyone
  // its author.
  updateRemoteFile: (path, content, userId, bulk = false) => {
    if (!userId) return; // Ignore own changes echoed back from socket to prevent typing glitch

    // A collaborator's edit has to reach this machine's disk too, or the folder
    // silently falls behind what everyone is looking at. Debounced, because this
    // fires per keystroke batch and a write per keystroke would hammer the disk.
    if (get().workspaceRoot) get().scheduleLocalPersist(path, content || '');
    const { activePath, files, connectedUsers } = get();
    const oldContent = files[path] || '';
    const newContent = content || '';

    // ── Compute line-level diff (Anchor-based search) ──
    if (oldContent !== newContent && !bulk) {
      const user = connectedUsers.find((u) => u.id === userId);
      get().recordLineDiff(
        path,
        oldContent,
        newContent,
        userId,
        user?.username || userId,
        user?.color || '#6366f1'
      );
    }

    set((s) => ({
      files: { ...s.files, [path]: content },
      code: path === activePath ? content : s.code
    }));

    if (userId) {
      get().registerRemoteChange(userId, path);

      /* Cross-file impact analysis on remote changes.
       *
       * Every client receives the change and reaches the same conclusion, so
       * without a check the whole room gets the same red banner — including
       * people working in files that were not touched. An alarm that fires for
       * everyone is one nobody reads.
       *
       * It is raised for the person whose work actually broke: the file open in
       * front of them is one the change affects. Everyone else is left alone,
       * and they are the one placed to tell the author what happened.
       */
      const updatedFiles = get().files;
      const result = analyzeImpact(path, oldContent, newContent, updatedFiles);
      const myFile = get().activePath;
      const affectsMyWork = Boolean(myFile) && result.affectedFiles.includes(myFile);

      if (result.impacts.length > 0 && affectsMyWork) {
        const user = connectedUsers.find(u => u.id === userId);
        // Narrowed to this file: the banner speaks to what broke in front of
        // you, not to every consequence the change had elsewhere. The headline
        // is rebuilt from the same narrowed list so it cannot claim more than
        // the rows beneath it show.
        const mine = result.impacts.filter((i) => i.file === myFile);
        get().addImpactWarning({
          changedBy: user?.username || userId,
          changedPath: path,
          impacts: mine,
          summary: summarizeImpacts(mine),
          affectedFiles: result.affectedFiles,
          oldContent: oldContent,
        });
      }
    }
  },

  /* Who is mid-edit right now, so their cursor can be drawn as active work
   * rather than a parked marker. Keyed by user, cleared on a short timer. */
  remoteTyping: {},
  markRemoteTyping: (userId) => {
    if (!userId) return;
    const now = Date.now();
    set((s) => ({ remoteTyping: { ...s.remoteTyping, [userId]: now } }));
    setTimeout(() => {
      if (get().remoteTyping[userId] !== now) return; // superseded by a newer edit
      set((s) => {
        const next = { ...s.remoteTyping };
        delete next[userId];
        return { remoteTyping: next };
      });
    }, 1800);
  },

  /**
   * Remote edits, wherever they landed.
   *
   * The Monaco binding only ever reported changes to the file on screen, so
   * edits to any other file updated the shared document and nothing else: this
   * client kept stale text for them, cross-file impact analysis compared
   * against content that was no longer true, and in a local workspace they
   * never reached disk. Everything downstream of a change now runs for every
   * file, not just the visible one.
   *
   * @param {{path: string, text: string}[]} edits
   * @param {string|null} userId author of the change
   */
  applyRemoteFileEdits: (edits, userId, bulk = false) => {
    const { activePath } = get();
    edits.forEach(({ path, text }) => {
      // The open file is already mirrored by the binding's own observer;
      // repeating it here would raise a second impact warning for one change.
      if (path === activePath) return;
      if (get().files[path] === text) return;
      get().updateRemoteFile(path, text, userId, bulk);
    });
    if (!bulk) get().markRemoteTyping(userId);
  },

  // Clear remote line changes for a specific path
  clearRemoteLineChanges: (path) => {
    set((s) => {
      const updated = { ...s.remoteLineChanges };
      const updatedDeletions = { ...s.remoteLineDeletions };
      delete updated[path];
      delete updatedDeletions[path];
      return { remoteLineChanges: updated, remoteLineDeletions: updatedDeletions };
    });
  },

  registerRemoteChange: (userId, path) => {
    const { connectedUsers } = get();
    const user = connectedUsers.find(u => u.id === userId);
    if (!user) return;

    const now = Date.now();
    const change = { userId, path, timestamp: now, username: user.username, color: user.color };

    set((s) => ({
      lastChange: change,
      fileActivity: { ...s.fileActivity, [path]: change }
    }));

    // Clear activity after 5 seconds of no updates for this file
    setTimeout(() => {
      const current = get().fileActivity[path];
      if (current && current.timestamp === now) {
        set((s) => {
          const newActivity = { ...s.fileActivity };
          delete newActivity[path];
          return { fileActivity: newActivity };
        });
      }
    }, 5000);
  },

  setLanguage: (language) => set({ language }),
  setFileExplorerOpen: (isOpen) => set({ isFileExplorerOpen: isOpen }),
  // Welcome-screen actions: open the explorer and optionally ask it to
  // run one of its flows (e.g. 'import-project' clicks the folder picker)
  pendingExplorerAction: null,
  requestExplorerAction: (action) => set({ pendingExplorerAction: action, isFileExplorerOpen: true }),
  clearPendingExplorerAction: () => set({ pendingExplorerAction: null }),
  setActiveView: (activeView) => set({ activeView }),
  setWhiteboardElements: (val) => {
    set((s) => ({
      whiteboardElements: typeof val === 'function' ? val(s.whiteboardElements) : val
    }));
    // A session syncs the board to the backend; a folder keeps it in app data
    // alongside its history, so it is still there next time it is opened.
    if (get().workspaceRoot) get().saveLocalWorkspaceState();
  },
  setWhiteboardPan: (whiteboardPan) => set({ whiteboardPan }),
  setWhiteboardZoom: (whiteboardZoom) => set({ whiteboardZoom }),
  updateWhiteboardCursor: (userId, cursorData) => {
    set((s) => ({
      whiteboardCursors: { ...s.whiteboardCursors, [userId]: { ...cursorData, timestamp: Date.now() } }
    }));
    // Auto-remove stale whiteboard cursors after 10s
    setTimeout(() => {
      const cursor = get().whiteboardCursors[userId];
      if (cursor && Date.now() - cursor.timestamp > 9000) {
        set((s) => {
          const newCursors = { ...s.whiteboardCursors };
          delete newCursors[userId];
          return { whiteboardCursors: newCursors };
        });
      }
    }, 10000);
  },
  removeWhiteboardCursor: (userId) => {
    set((s) => {
      const newCursors = { ...s.whiteboardCursors };
      delete newCursors[userId];
      return { whiteboardCursors: newCursors };
    });
  },

  // ---- Actions: Voice Room ----
  setVoiceRoomUsers: (users) => set({ voiceRoomUsers: users }),
  joinVoiceRoom: () => set({ isInVoiceRoom: true }),
  leaveVoiceRoom: () => set({ isInVoiceRoom: false, isMuted: false, isDeafened: false }),
  toggleMute: () => set((s) => ({ isMuted: !s.isMuted })),
  toggleDeafen: () => set((s) => ({
    isDeafened: !s.isDeafened,
    // When deafening, also mute (standard behavior)
    isMuted: !s.isDeafened ? true : s.isMuted,
  })),
  setSpeakingUser: (userId, isSpeaking) => {
    set((s) => ({
      speakingUsers: { ...s.speakingUsers, [userId]: isSpeaking }
    }));
  },
  addVoiceUser: (user) => {
    set((s) => {
      if (s.voiceRoomUsers.find(u => u.id === user.id)) return {};
      return { voiceRoomUsers: [...s.voiceRoomUsers, user] };
    });
  },
  removeVoiceUser: (userId) => {
    set((s) => ({
      voiceRoomUsers: s.voiceRoomUsers.filter(u => u.id !== userId),
      speakingUsers: (() => { const c = { ...s.speakingUsers }; delete c[userId]; return c; })(),
    }));
  },

  // ---- Actions: Follow Mode ----
  startFollowing: (leaderId) => {
    const { sessionId, currentUser, followingUserId } = get();
    // Stop following previous leader if any
    if (followingUserId && sessionId && currentUser) {
      sendFollowStop(sessionId, currentUser.id, followingUserId);
    }
    set({ followingUserId: leaderId, followState: null });
    if (sessionId && currentUser) {
      sendFollowStart(sessionId, currentUser.id, leaderId);
    }
  },
  stopFollowing: () => {
    const { sessionId, currentUser, followingUserId } = get();
    if (followingUserId && sessionId && currentUser) {
      sendFollowStop(sessionId, currentUser.id, followingUserId);
    }
    set({ followingUserId: null, followState: null });
  },
  setFollowState: (state) => set({ followState: state }),
  addFollower: (followerId) => {
    set((s) => {
      if (s.followedByUsers.includes(followerId)) return {};
      return { followedByUsers: [...s.followedByUsers, followerId] };
    });
  },
  removeFollower: (followerId) => {
    set((s) => ({
      followedByUsers: s.followedByUsers.filter(id => id !== followerId)
    }));
  },
  setFollowToast: (msg) => {
    set({ followToast: msg });
    if (msg) {
      setTimeout(() => set({ followToast: null }), 3000);
    }
  },

  // ---- Actions: CodeShot ----
  openCodeShotModal: (data) => set({ codeShotModal: data }),
  closeCodeShotModal: () => set({ codeShotModal: null }),
  setEditorSelection: (sel) => set({ editorSelection: sel }),

  // ---- Actions: File Save ----

  /** Store a FileSystemFileHandle for silent future saves */
  setFileHandle: (path, handle) => {
    set((s) => ({
      fileHandles: { ...s.fileHandles, [path]: handle }
    }));
  },

  /** Mark a file as "just saved" — snapshot its content for dirty tracking */
  markFileSaved: (path, content) => {
    set((s) => ({
      savedContents: { ...s.savedContents, [path]: content }
    }));
  },

  /** When a file is first opened/created, seed its savedContents baseline */
  markFileOpened: (path, content) => {
    set((s) => {
      // Only seed if not already tracked
      if (s.savedContents[path] !== undefined) return {};
      return { savedContents: { ...s.savedContents, [path]: content } };
    });
  },

  /** Store the on-disk path (for display in toolbar after Save) */
  setFileSavedPath: (path, diskPath) => {
    set((s) => ({
      fileSavedPaths: { ...s.fileSavedPaths, [path]: diskPath }
    }));
  },

  /** Check if a specific file has unsaved changes */
  isFileDirty: (path) => {
    const { files, savedContents } = get();
    const current = files[path];
    const saved = savedContents[path];
    if (saved === undefined) return false; // never tracked — treat as clean
    return current !== saved;
  },

  /** Return list of paths that have unsaved changes */
  getAnyDirtyFiles: () => {
    const { files, savedContents } = get();
    return Object.keys(files).filter((path) => {
      const saved = savedContents[path];
      return saved !== undefined && files[path] !== saved;
    });
  },

  // ---- Actions: Execution ----
  setOutput: (output) => set({ output }),
  setError: (error) => set({ error }),
  setIsRunning: (isRunning) => set({ isRunning }),
  addExecution: (execution) => set((s) => ({
    executionHistory: [...s.executionHistory, execution]
  })),

  // ---- Actions: Timeline ----
  setSnapshots: (snapshots) => set({ snapshots }),
  addSnapshot: (snapshot) => set((s) => ({
    snapshots: [...s.snapshots, snapshot]
  })),
  setCurrentSnapshotIndex: (index) => set({ currentSnapshotIndex: index }),
  setIsReplaying: (isReplaying) => set({ isReplaying }),

  /* ── Session Rewind: capture ──
   *
   * A checkpoint is now something the owner decides, not something a clock
   * decides. The timer version produced a history nobody had an opinion about:
   * a hundred indistinguishable points fifteen seconds apart, none of which
   * meant "this is the state that worked". Restoring meant guessing which
   * anonymous moment you wanted.
   *
   * So the entries here are the ones somebody chose, each carrying what it was
   * for and who had contributed since the last one. The only automatic captures
   * left are protective: reverting, undoing a person's work and restoring all
   * snapshot the present first, because otherwise those three would be the only
   * operations in the app with no way back.
   */
  captureRewindPoint: ({ run = null, force = false, kind = 'auto', label = null, by = null, credits = null } = {}) => {
    const { files, rewindLog } = get();

    // Only real, loaded content. Local mode leaves unopened files as null, and
    // recording those would later "restore" a file into emptiness.
    const current = {};
    Object.entries(files || {}).forEach(([path, content]) => {
      if (typeof content === 'string') current[path] = content;
    });
    if (Object.keys(current).length === 0) return;

    // First checkpoint is the keyframe every later delta is measured from.
    if (rewindLog.length === 0) {
      set({
        rewindLog: [{
          id: `rw-${Date.now()}`,
          at: Date.now(),
          files: current,
          run,
          kind,
          label,
          by,
          credits,
        }],
      });
      return;
    }

    const previous = get().projectAtRewind(rewindLog.length - 1);

    const delta = {};
    Object.entries(current).forEach(([path, content]) => {
      if (previous[path] !== content) delta[path] = content;
    });
    // A file that has gone is recorded as null so a restore can bring it back.
    Object.keys(previous).forEach((path) => {
      if (!(path in current)) delta[path] = null;
    });

    if (Object.keys(delta).length === 0 && !force) return;

    let next = [...rewindLog, {
      id: `rw-${Date.now()}`,
      at: Date.now(),
      files: delta,
      run,
      kind,
      label,
      by,
      credits,
    }];

    /* Fold the oldest delta into the keyframe rather than dropping it, or the
     * history would start from a state that never existed. */
    while (next.length > MAX_REWIND_POINTS) {
      const [keyframe, oldest, ...rest] = next;
      const merged = { ...keyframe.files };
      Object.entries(oldest.files).forEach(([path, content]) => {
        if (content === null) delete merged[path];
        else merged[path] = content;
      });
      next = [{ ...keyframe, at: oldest.at, files: merged }, ...rest];
    }

    set({ rewindLog: next });
  },

  /** The complete project as it stood at a checkpoint. */
  projectAtRewind: (index) => {
    const { rewindLog } = get();
    if (index < 0 || index >= rewindLog.length) return {};

    const state = { ...rewindLog[0].files };
    for (let i = 1; i <= index; i++) {
      Object.entries(rewindLog[i].files).forEach(([path, content]) => {
        if (content === null) delete state[path];
        else state[path] = content;
      });
    }
    return state;
  },

  /** Most recent checkpoint whose run succeeded — the "last working build". */
  lastGoodRewindIndex: () => {
    const { rewindLog } = get();
    for (let i = rewindLog.length - 1; i >= 0; i--) {
      if (rewindLog[i].run === 'ok') return i;
    }
    return -1;
  },

  /* ── The owner saves the state ──
   *
   * One press, one point in the history, for everybody in the room.
   *
   * The credit list is computed here rather than on each client so the whole
   * session reads the same account of who did what — attribution is per-client
   * bookkeeping, and two clients that joined at different times hold slightly
   * different amounts of it. The owner's copy is the one that has seen the whole
   * session, so the owner's copy is the record.
   *
   * The file contents are NOT broadcast. Everyone already holds the same
   * project — that is what the CRDT is for — so each client captures its own
   * delta locally and only the metadata travels. A checkpoint of a large project
   * would otherwise put a full copy of it on the wire for every participant.
   */
  captureCheckpoint: ({ label = '', run } = {}) => {
    const { sessionId, currentUser, rewindLog, lastRunStatus } = get();

    if (sessionId && !get().canRewind()) {
      return { ok: false, reason: 'Only the session owner can save a checkpoint.' };
    }
    if (get().isReplaying) {
      return { ok: false, reason: 'Exit replay mode before saving a checkpoint.' };
    }

    const since = rewindLog.length ? rewindLog[rewindLog.length - 1].at : 0;
    const credits = normalizeCredits(get().changesSince(since));

    const meta = {
      at: Date.now(),
      label: (label || '').trim().slice(0, 120) || null,
      by: currentUser
        ? { id: currentUser.id, username: currentUser.username, color: currentUser.color }
        : null,
      /* The verdict this point carries. The owner's own mark wins when they
         made one — they know whether the state works, and may be flagging a
         broken point deliberately so it can be found again. Absent a mark, the
         last run's result stands in, which keeps "last working build"
         answerable without anyone having to think about it. */
      run: run !== undefined ? run : lastRunStatus,
      credits,
    };

    get().captureRewindPoint({ ...meta, kind: 'manual', force: true });

    if (sessionId) sendCheckpoint(sessionId, meta);

    return { ok: true, at: meta.at };
  },

  /* ── Save what I have changed ──
   *
   * The collaborator's counterpart to captureCheckpoint. Same gesture, a
   * deliberately smaller subject: not "the project as it stands" but "the work
   * I have done since I last marked it".
   *
   * Open to everyone, including the owner — a person's own record of their own
   * edits is not a permission question. What stays owner-only is putting any of
   * it back, which lives in restoreRewindPoint and is untouched by this.
   *
   * Nothing is broadcast. The owner's checkpoint publishes its metadata because
   * the whole room shares one history; this is one person's notebook and the
   * room has no stake in it.
   */
  captureMyChanges: ({ label = '' } = {}) => {
    const { currentUser, myCheckpoints, isReplaying, sessionId } = get();

    if (isReplaying) {
      return { ok: false, reason: 'Exit replay mode before saving your changes.' };
    }

    const meId = currentUser?.id || 'local';
    /* Since the last one of MINE, not the last checkpoint the owner took. The
       two histories run independently — the owner saving the project says
       nothing about where this person's own work begins. */
    const since = myCheckpoints.length ? myCheckpoints[myCheckpoints.length - 1].at : 0;
    const mine = get().changesSince(since).find((u) => u.userId === meId);

    if (!mine || !Array.isArray(mine.edits) || mine.edits.length === 0) {
      return { ok: false, reason: 'Nothing of yours has changed since your last save.' };
    }

    const at = Date.now();
    const point = {
      id: `mine-${at}`,
      at,
      /* Stamped so leaving a session and coming back to it finds the notebook
         intact, while a DIFFERENT session never inherits it. Filtering on the
         way out beats clearing on the way through: the same collaborator
         rejoining the same room is the case this feature exists for. */
      sessionId: sessionId || null,
      label: (label || '').trim().slice(0, 120) || null,
      lines: mine.lines,
      // changesSince calls it `count`; everything downstream reads `lines`.
      files: (mine.files || []).map((f) => ({ path: f.path, lines: f.lines ?? f.count ?? 0 })),
      edits: mine.edits.slice(0, MAX_MINE_EDITS).map((e) => ({
        kind: e.kind,
        path: e.path,
        line: e.line,
        // Capped: this is persisted, and one pasted minified line should not be
        // able to fill the whole store on its own.
        oldLine: typeof e.oldLine === 'string' ? e.oldLine.slice(0, 400) : '',
        newLine: typeof e.newLine === 'string' ? e.newLine.slice(0, 400) : '',
        removedText: typeof e.removedText === 'string' ? e.removedText.slice(0, 800) : '',
        count: e.count || 1,
      })),
      // So the panel can say "and 40 more" rather than quietly losing them.
      truncated: Math.max(0, mine.edits.length - MAX_MINE_EDITS),
    };

    set({ myCheckpoints: [...myCheckpoints, point].slice(-MAX_MY_CHECKPOINTS) });
    return { ok: true, at, lines: point.lines };
  },

  /** Drop one of my own saves. Mine to make, mine to discard. */
  deleteMyCheckpoint: (id) => set((s) => ({
    myCheckpoints: s.myCheckpoints.filter((p) => p.id !== id),
  })),

  /* The same checkpoint, on everyone else's screen. Their own files, the
   * owner's account of who changed them. */
  applyRemoteCheckpoint: (meta) => {
    if (!meta) return;
    get().captureRewindPoint({
      kind: 'manual',
      force: true,
      label: meta.label || null,
      by: meta.by || null,
      run: meta.run || null,
      // Sanitised at the boundary: this arrived over the network from a client
      // whose version we do not control.
      credits: normalizeCredits(meta.credits),
    });
  },

  /* ── Who changed what, since a point in time ──
   *
   * The question worth answering is not "who has touched this file" — it is
   * "the build was fine at 12:52, so what has happened since?". Anchoring to a
   * checkpoint turns a vague list of contributors into a short, reviewable set
   * of suspects, and makes reverting a decision rather than a guess.
   *
   * Built on the line attribution that already drives the gutter markers: each
   * record carries its author, its timestamp, and `oldLine` — what the line
   * held before that person started on it — so a revert is a lookup.
   */
  changesSince: (since) => {
    const { remoteLineChanges, remoteLineDeletions } = get();
    const byUser = new Map();

    const bucket = (rec) => {
      const entry = byUser.get(rec.userId) || {
        userId: rec.userId,
        username: rec.username,
        color: rec.color,
        lines: 0,
        latest: 0,
        files: new Map(),
        edits: [],
      };
      byUser.set(rec.userId, entry);
      return entry;
    };

    Object.entries(remoteLineChanges).forEach(([path, lines]) => {
      Object.entries(lines).forEach(([lineNo, rec]) => {
        if ((rec.timestamp || 0) < since) return;
        // Says the line went from X to X. Nothing changed, nothing to revert.
        if (rec.oldLine === rec.newLine) return;
        const entry = bucket(rec);
        entry.lines += 1;
        entry.latest = Math.max(entry.latest, rec.timestamp || 0);
        entry.files.set(path, (entry.files.get(path) || 0) + 1);
        /* The edit itself travels with the summary. Answering "who changed
         * something" and then making you go hunting for WHAT they changed is
         * half an answer — and the half that matters least. */
        entry.edits.push({
          kind: rec.type === 'added' || rec.oldLine === '(line added)' ? 'added' : 'modified',
          path,
          line: Number(lineNo),
          oldLine: rec.oldLine,
          newLine: rec.newLine,
          timestamp: rec.timestamp || 0,
        });
      });
    });

    Object.entries(remoteLineDeletions).forEach(([path, dels]) => {
      (dels || []).forEach((rec) => {
        if ((rec.timestamp || 0) < since) return;
        const entry = bucket(rec);
        const count = rec.removedText.split(NL).length;
        entry.lines += count;
        entry.latest = Math.max(entry.latest, rec.timestamp || 0);
        entry.files.set(path, (entry.files.get(path) || 0) + count);
        entry.edits.push({
          kind: 'removed',
          path,
          id: rec.id,
          line: rec.anchor,
          removedText: rec.removedText,
          count,
          timestamp: rec.timestamp || 0,
        });
      });
    });

    return [...byUser.values()]
      .map((u) => ({
        ...u,
        files: [...u.files.entries()]
          .map(([path, count]) => ({ path, count }))
          .sort((a, b) => b.count - a.count),
        // Newest first: the change most likely to have broken things is the
        // one that just happened.
        edits: u.edits.sort((a, b) => b.timestamp - a.timestamp),
      }))
      .sort((a, b) => b.lines - a.lines);
  },

  /* ── Permission to change history ──
   *
   * Rewinding rewrites every participant's files at once, so it is the session
   * owner's call and nobody else's. Collaborators keep the whole panel: they
   * can scrub, preview any past moment, and read exactly who changed what.
   * They simply cannot make it happen — which is the difference between a
   * shared history and a shared undo button.
   *
   * Outside a session there is no one to ask, so local work is never blocked.
   */
  canRewind: () => {
    const { sessionId, userRole } = get();
    if (!sessionId) return true;
    return userRole === 'owner';
  },

  /* ── Revert exactly one change ──
   *
   * The missing rung on the ladder. Restoring a checkpoint takes back the whole
   * project and undoing a person takes back everything they did — but the thing
   * that actually happens is "someone deleted the script tag and the page went
   * blank", and neither of those is the right size for it.
   */
  revertEdit: async (edit) => asHistoryOp(async () => {
    if (!edit || !edit.path) return { ok: false, reason: 'Nothing to revert.' };
    if (get().isReplaying) return { ok: false, reason: 'Exit replay mode first.' };
    if (!get().canRewind()) {
      return { ok: false, reason: 'Only the session owner can change the project’s history.' };
    }

    const content = get().files[edit.path];
    if (typeof content !== 'string') return { ok: false, reason: 'That file is not open here.' };

    // Reverting is itself a change worth being able to take back.
    get().captureRewindPoint({ force: true });

    /* Normalised, like every other comparison against a record. On a CRLF file
       the raw split made `anchorNow === rec.anchorAfter` and the newLine checks
       below fail on the invisible '\r', so reverting a single edit reported
       that the surrounding lines had moved and refused to act. The join below
       writes LF back, which is what the editor holds anyway. */
    const split = splitLines(content);
    let summary = '';

    if (edit.kind === 'removed') {
      const idx = edit.line - 1;
      const anchorNow = split[idx];
      const dels = get().remoteLineDeletions[edit.path] || [];
      const rec = dels.find((d) => d.id === edit.id);
      if (!rec) return { ok: false, reason: 'That deletion is no longer on record.' };

      /* The gap has to still be where it was. If the surrounding lines have
       * moved on, putting the text back blind would drop it into the middle of
       * somebody else's work. */
      const anchorMatches = rec.anchorAfter === null
        ? idx >= split.length
        : anchorNow === rec.anchorAfter;
      if (!anchorMatches) {
        return { ok: false, reason: 'The lines around that deletion have changed since — put it back by hand so nothing else is disturbed.' };
      }

      const restored = rec.removedText.split(NL);
      split.splice(idx, 0, ...restored);
      summary = `Put back ${restored.length} line${restored.length === 1 ? '' : 's'} in ${edit.path.split('/').pop()}`;

      set((st) => ({
        remoteLineDeletions: {
          ...st.remoteLineDeletions,
          [edit.path]: (st.remoteLineDeletions[edit.path] || []).filter((d) => d.id !== edit.id),
        },
      }));
    } else {
      const idx = edit.line - 1;
      if (split[idx] !== edit.newLine) {
        return { ok: false, reason: 'That line has been edited since — reverting it now would discard the newer change.' };
      }
      if (edit.kind === 'added') {
        split.splice(idx, 1);
        summary = `Removed the added line ${edit.line} in ${edit.path.split('/').pop()}`;
      } else {
        split[idx] = edit.oldLine;
        summary = `Reverted line ${edit.line} in ${edit.path.split('/').pop()}`;
      }

      set((st) => {
        const forPath = { ...(st.remoteLineChanges[edit.path] || {}) };
        delete forPath[edit.line];
        return { remoteLineChanges: { ...st.remoteLineChanges, [edit.path]: forPath } };
      });
    }

    const next = split.join(NL);
    if (edit.path === get().activePath) {
      get().setCode(next);
    } else {
      const propagated = replaceFileText(edit.path, next);
      if (!propagated) set((st) => ({ files: { ...st.files, [edit.path]: next } }));
    }
    if (get().workspaceRoot) {
      await get().writeLocalFile(edit.path, next).catch(() => { /* surfaced below */ });
    }

    set({ rewindNotice: summary + '.' });
    return { ok: true };
  }),

  /**
   * Take back one person's work since a moment.
   *
   * The thing git structurally cannot do: a revert undoes commits, which bundle
   * everyone together. This undoes a person.
   *
   * @param {string}  userId
   * @param {number}  since
   * @param {object}  [opts]
   * @param {string}  [opts.path]
   *   Confine it to one file. Between "revert this one line" and "take back
   *   everything this person did today" there was nothing, and the middle is
   *   where the real request lives: someone's work in ONE file went wrong and
   *   the rest of what they did that afternoon is fine. Without this the owner
   *   had to choose between clicking twenty individual lines and throwing away
   *   work in four other files to fix a problem in one.
   */
  undoChangesSince: async (userId, since, opts = {}) => asHistoryOp(async () => {
    const { remoteLineChanges, remoteLineDeletions, files, isReplaying } = get();
    const onlyPath = typeof opts.path === 'string' && opts.path ? opts.path : null;
    if (isReplaying) return { ok: false, reason: 'Exit replay mode first.' };
    // This had no permission check of any kind: any collaborator could take
    // back any other collaborator's work, including the owner's.
    if (!get().canRewind()) {
      return { ok: false, reason: 'Only the session owner can undo someone’s changes.' };
    }

    // Restoring is itself a change worth being able to take back.
    get().captureRewindPoint({ force: true });

    let reverted = 0;
    let skipped = 0;
    const touched = [];
    let username = '';

    /* The union, not just the edited files: a file whose only change was a
     * deletion has no entry in remoteLineChanges to iterate over. */
    const paths = new Set([
      ...Object.keys(remoteLineChanges),
      ...Object.keys(remoteLineDeletions),
    ]);

    for (const path of paths) {
      // Scoped to one file when asked. Everything below is unchanged, so the
      // whole-person undo and the single-file one cannot drift apart.
      if (onlyPath && path !== onlyPath) continue;
      const lines = remoteLineChanges[path] || {};
      const content = files[path];
      if (typeof content !== 'string') continue;

      const records = Object.entries(lines)
        .map(([line, rec]) => ({ line: Number(line), ...rec }))
        .filter((r) => r.userId === userId && (r.timestamp || 0) >= since);
      const hasDeletions = (remoteLineDeletions[path] || [])
        .some((d) => d.userId === userId && (d.timestamp || 0) >= since);
      if (records.length === 0 && !hasDeletions) continue;
      if (records.length) username = records[0].username || username;

      // Normalised for the same reason as revertEdit above: a raw split makes
      // every record on a CRLF file look inapplicable.
      const split = splitLines(content);

      /* Only lines that still hold exactly what was recorded. If someone has
       * edited the same line since, it is no longer purely this person's work
       * and reverting it would discard the other person's edit — the precise
       * thing this feature exists to prevent. */
      const applicable = records.filter((r) => split[r.line - 1] === r.newLine);
      skipped += records.length - applicable.length;

      // Descending, so removing a line cannot shift the ones not yet handled.
      applicable.sort((a, b) => b.line - a.line).forEach((r) => {
        const idx = r.line - 1;
        if (r.type === 'added' || r.oldLine === '(line added)') split.splice(idx, 1);
        else split[idx] = r.oldLine;
      });

      /* Their deletions too, or "undo everything this person did" quietly means
       * "everything except the part where they deleted your code" — the one
       * kind of change most worth taking back. Descending for the same reason,
       * and only where the gap is still where they left it. */
      const theirDeletions = (remoteLineDeletions[path] || [])
        .filter((d) => d.userId === userId && (d.timestamp || 0) >= since)
        .sort((a, b) => b.anchor - a.anchor);
      const restoredIds = [];
      theirDeletions.forEach((d) => {
        const idx = d.anchor - 1;
        const fits = d.anchorAfter === null ? idx >= split.length : split[idx] === d.anchorAfter;
        if (!fits) { skipped += 1; return; }
        const lines = d.removedText.split(NL);
        split.splice(idx, 0, ...lines);
        reverted += lines.length;
        restoredIds.push(d.id);
        username = d.username || username;
      });
      if (restoredIds.length) {
        set((st) => ({
          remoteLineDeletions: {
            ...st.remoteLineDeletions,
            [path]: (st.remoteLineDeletions[path] || []).filter((d) => !restoredIds.includes(d.id)),
          },
        }));
      }

      if (applicable.length === 0 && restoredIds.length === 0) continue;

      const next = split.join(NL);
      if (path === get().activePath) {
        get().setCode(next);
      } else {
        const propagated = replaceFileText(path, next);
        if (!propagated) set((st) => ({ files: { ...st.files, [path]: next } }));
      }
      if (get().workspaceRoot) {
        await get().writeLocalFile(path, next).catch(() => { /* surfaced below */ });
      }

      // Those lines are no longer theirs, so the markers go with them.
      set((st) => {
        const forPath = { ...(st.remoteLineChanges[path] || {}) };
        applicable.forEach((r) => delete forPath[r.line]);
        return { remoteLineChanges: { ...st.remoteLineChanges, [path]: forPath } };
      });

      reverted += applicable.length;
      touched.push(path);
    }

    if (reverted === 0) {
      return {
        ok: false,
        reason: onlyPath
          ? `Nothing safe to undo in ${onlyPath.split('/').pop()} — those lines have been edited since.`
          : 'Those lines have been edited since — nothing safe to undo.',
      };
    }

    // Tell the room, so work vanishing from their screen has a reason.
    const { sessionId, currentUser } = get();
    if (sessionId && currentUser) {
      sendRevert(sessionId, currentUser.id, touched[0], currentUser.username, username);
    }

    // Names the file when that is what was undone. "across 1 file" is a worse
    // answer than the file's name when the owner just picked it deliberately.
    const scope = onlyPath
      ? `in ${onlyPath.split('/').pop()}`
      : `across ${touched.length} file${touched.length === 1 ? '' : 's'}`;

    set({
      rewindNotice: `Undid ${reverted} line${reverted === 1 ? '' : 's'} from ${username} ${scope}`
        + (skipped ? ` — ${skipped} left alone because someone edited them since.` : '.'),
    });

    return { ok: true, reverted, skipped, files: touched.length };
  }),

  /* Attribution accumulates for the life of a session, so a client that has
   * been open since before a fix to recordLineDiff keeps serving whatever it
   * recorded back then. Run once when the panel mounts: drop records that
   * describe no change, or that point at text no longer on their line. */
  pruneAttribution: () => {
    const { remoteLineChanges, files } = get();
    let removed = 0;
    const next = {};

    Object.entries(remoteLineChanges).forEach(([path, lines]) => {
      const content = files[path];
      /* splitLines, not content.split(NL).
       *
       * This is the line that broke Session Rewind. Records are written with
       * their line endings normalised; this compared them against the raw
       * stored text. For any file with CRLF — i.e. any project uploaded from a
       * Windows machine — every record failed the comparison by one invisible
       * character and the entire map was wiped. Because this runs when the
       * rewind panel mounts, the wipe happened at precisely the moment the
       * user opened the panel to save a checkpoint, so the checkpoint recorded
       * "no edits by anyone" over work that had definitely happened. */
      const split = typeof content === 'string' ? splitLines(content) : null;
      const kept = {};
      Object.entries(lines).forEach(([ln, rec]) => {
        if (rec.oldLine === rec.newLine) { removed++; return; }
        if (split && split[Number(ln) - 1] !== rec.newLine) { removed++; return; }
        kept[ln] = rec;
      });
      next[path] = kept;
    });

    if (removed > 0) set({ remoteLineChanges: next });
    return removed;
  },

  setRewindOpen: (rewindOpen) => set({ rewindOpen, rewindNotice: null }),
  setRewindIndex: (rewindIndex) => set({ rewindIndex }),
  clearRewindNotice: () => set({ rewindNotice: null }),

  /* ── Session Rewind: restore ──
   *
   * Puts every file back to how it stood, for everyone. Deliberately routed
   * through the same channels a human edit uses, so collaborators converge on
   * the result instead of quietly drifting out of step with the host.
   */
  restoreRewindPoint: async (index) => asHistoryOp(async () => {
    const { rewindLog, isReplaying } = get();
    if (index < 0 || index >= rewindLog.length) return { ok: false, reason: 'That point is no longer in history.' };
    if (isReplaying) return { ok: false, reason: 'Exit replay mode before restoring.' };

    /* Owner-only. This rewrites every file on every participant's screen at
     * once, so a collaborator with edit rights is still the wrong person to
     * decide it — edit rights mean "you may change your own work", not "you may
     * replace everyone's". */
    if (!get().canRewind()) {
      return { ok: false, reason: 'Only the session owner can restore the project. You can still preview any moment.' };
    }

    set({ rewindBusy: true });

    try {
      /* Snapshot the present first, so restoring is itself undoable. Going back
       * an hour by mistake must not be the one action with no way out. */
      get().captureRewindPoint({ force: true });

      const target = get().projectAtRewind(index);
      const currentFiles = get().files || {};
      const activePath = get().activePath;

      const changed = [];
      const removed = [];

      // Files that existed then — put their content back.
      for (const [path, content] of Object.entries(target)) {
        if (currentFiles[path] === content) continue;
        changed.push(path);

        if (path === activePath) {
          // Through setCode so Monaco, the CRDT and the collaborators all move
          // together, exactly as if it had been typed.
          get().setCode(content);
        } else {
          const propagated = replaceFileText(path, content);
          if (!propagated) {
            // No live session (or no shared text yet) — update in place.
            set((s) => ({ files: { ...s.files, [path]: content } }));
          }
        }
        if (get().workspaceRoot) {
          await get().writeLocalFile(path, content).catch(() => { /* reported below */ });
        }
      }

      /* Files created after that moment — restoring means they were not there.
       * removeFile is reused rather than deleting the map entry directly: it
       * also clears the save metadata and moves the active tab if the open file
       * is the one going away. */
      for (const path of Object.keys(currentFiles)) {
        if (path in target) continue;
        removed.push(path);
        get().removeFile(path);
      }

      const when = new Date(rewindLog[index].at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      set({
        rewindBusy: false,
        rewindIndex: null,
        rewindNotice: `Restored the project to ${when} — ${changed.length} file${changed.length === 1 ? '' : 's'} changed`
          + (removed.length ? `, ${removed.length} removed` : '') + '.',
      });
      return { ok: true };
    } catch (err) {
      set({ rewindBusy: false, rewindNotice: `Restore failed: ${err.message}` });
      return { ok: false, reason: err.message };
    }
  }),

  // Go to a specific snapshot (replay mode)
  goToSnapshot: (index) => {
    const { snapshots } = get();
    if (index >= 0 && index < snapshots.length) {
      const snap = snapshots[index];
      
      // Save current live state if not already replaying
      const isCurrentlyReplaying = get().isReplaying;
      const liveStateUpdate = isCurrentlyReplaying ? {} : {
        liveCode: get().code,
        liveOutput: get().output,
        liveError: get().error,
        liveRootCause: get().rootCause,
        liveCausalityGraph: get().causalityGraph
      };

      set({
        ...liveStateUpdate,
        currentSnapshotIndex: index,
        isReplaying: true,
        code: snap.code,
        output: snap.output || '',
        error: snap.error || '',
        rootCause: snap.rootCause || null,
        causalityGraph: snap.causalityGraph || null,
        commitSuggestion: snap.suggestion || null
      });
    }
  },

  // Return to live editing (exit replay)
  goToLive: () => {
    set({
      currentSnapshotIndex: -1,
      isReplaying: false,
      code: get().liveCode !== undefined ? get().liveCode : get().code,
      output: get().liveOutput !== undefined ? get().liveOutput : '',
      error: get().liveError !== undefined ? get().liveError : '',
      rootCause: get().liveRootCause !== undefined ? get().liveRootCause : null,
      causalityGraph: get().liveCausalityGraph !== undefined ? get().liveCausalityGraph : null,
    });
  },

  // Restore a specific snapshot code as the live code
  restoreSnapshot: (index) => {
    const { snapshots, sessionId, currentUser, activePath } = get();
    if (index >= 0 && index < snapshots.length) {
      const snap = snapshots[index];
      
      set({
        code: snap.code,
        liveCode: snap.code,
        isReplaying: false,
        currentSnapshotIndex: -1,
        output: snap.output || '',
        error: snap.error || '',
        rootCause: snap.rootCause || null,
        causalityGraph: snap.causalityGraph || null
      });

      // Broadcast the restored code to all collaborators
      if (sessionId && currentUser && activePath) {
        sendCodeChange(sessionId, currentUser.id, activePath, snap.code);
      }
    }
  },

  // ---- Actions: Root Cause ----
  setRootCause: (rootCause) => set({ rootCause }),
  clearRootCause: () => set({ rootCause: null }),

  /* ---- Actions: Auto-Fix Agent ----
   *
   * Three steps, deliberately separate: ask, apply, undo. The agent never
   * reaches the file on its own — requestAutoFix only fetches a proposal, and
   * applyAutoFix is the one place a fix becomes real.
   */

  /**
   * Ask the agent to repair the current error, or to make a change you describe.
   * Leaves the file untouched either way — this only fetches a proposal.
   *
   * Two modes, and which one runs is decided here rather than by the caller:
   *
   *   FILE     a single program was run, it failed, and we have the diagnosis.
   *            Verified by re-running it. This is the original behaviour and is
   *            chosen whenever its exact preconditions hold, so nothing about
   *            the existing flow changes.
   *
   *   PROJECT  everything else inside an opened folder: a dev server crashed, or
   *            the user asked for something in a project. The agent finds the
   *            failing file from the server log itself and verifies by booting
   *            the server rather than by running one file.
   *
   * @param {{instruction?: string}} [options] free-form request typed by the user
   */
  requestAutoFix: async (options = {}) => {
    const {
      code, language, sessionId, activePath, rootCause, autoFixState,
      workspaceRoot, devServers,
    } = get();
    if (autoFixState === 'working') return;

    const instruction = (options.instruction || '').trim();

    /* The classic path, kept exactly as it was: a diagnosis in hand and no
       instruction to complicate it. Anything else falls through to project
       mode, which needs a folder on disk to read and verify against. */
    const isClassicFileFix = Boolean(rootCause) && !instruction;

    if (isClassicFileFix && !code) return;

    /* What counts as "something to work on".
     *
     * An open file does, even an empty one. This used to require `code` as well
     * as `activePath`, which meant a brand-new file — the single most obvious
     * moment to ask an agent to write something — was rejected as nothing at
     * all, with a message telling the user to open a file they already had
     * open. Emptiness is a state of the file, not an absence of one.
     *
     * A folder still qualifies on its own: in project mode the agent finds the
     * file itself, so nothing needs to be open. */
    if (!isClassicFileFix && !workspaceRoot && !activePath) {
      set({
        autoFix: {
          status: 'NO_FIX',
          // Carried so the panel knows this answers a typed request and renders
          // it as one — without it, "no file open" arrives dressed as GAME OVER.
          instruction: instruction || null,
          message: 'Open a file or a project folder first — the agent needs something to work on.',
        },
        autoFixState: 'failed',
      });
      return;
    }

    const useProject = !isClassicFileFix && Boolean(workspaceRoot);

    /* Which server is complaining. A failed one is the interesting one; falling
       back to whichever is running keeps "restart and see" available when the
       user is asking for a change rather than reporting a crash. */
    const servers = Object.entries(devServers || {});
    const failing = servers.find(([, s]) => s?.state === 'ERROR')
      || servers.find(([, s]) => s?.state === 'RUNNING')
      || servers[0];
    const [serverType, serverState] = failing || [null, null];
    const serverLog = serverState
      ? (serverState.recentLogs || serverState.logs || []).slice(-120).join('\n')
      : '';

    set({ autoFixState: 'working', autoFix: null });

    try {
      const result = await fetchAutoFix({
        mode: useProject ? 'PROJECT' : 'FILE',
        sessionId: sessionId || '',
        code,
        language,
        filePath: activePath || '',
        userInstruction: instruction || null,
        projectPath: useProject ? workspaceRoot : null,
        serverType: useProject ? serverType : null,
        errorLog: useProject ? serverLog : null,
        errorType: rootCause?.errorType,
        errorMessage: rootCause?.errorMessage,
        errorLine: rootCause?.errorLine,
        suspectedVariable: rootCause?.suspectedVariable,
        semanticContext: rootCause?.semanticContext || null,
      });

      /* In project mode the agent chose the file, so it is the one that says
         which. Falling back to activePath keeps file mode identical. */
      const targetPath = result?.targetPath || activePath;

      set({
        autoFix: {
          ...result,
          // Pin the proposal to what it was generated against. Without this a
          // fix could be applied minutes later onto edited code, and its line
          // numbers would land somewhere else entirely.
          targetPath,
          /* What the patch was computed from. In project mode the agent read
             the file off disk, so the copy in `files` may not match — and
             comparing against the wrong text is what would make a good fix look
             stale. Only claim a baseline when we know it is the right one. */
          basedOnCode: targetPath === activePath ? code : null,
          applied: false,
          previousCode: null,
          instruction: instruction || null,
        },
        autoFixState: result && result.fixedCode ? 'ready' : 'failed',
      });
    } catch (err) {
      set({
        autoFix: {
          status: 'ERROR',
          message: err.request?.status === 0
            ? 'Backend server unavailable.'
            : (err.response?.data?.message || err.message || 'The auto-fix agent failed.'),
        },
        autoFixState: 'failed',
      });
    }
  },

  /**
   * Write the proposed fix into the file.
   *
   * Goes through setCode so the change travels the same road a human edit does:
   * into Monaco, out through the CRDT binding to every collaborator, and onto
   * the debounced save. Anything that bypassed that would leave the agent's fix
   * visible on one screen only.
   *
   * @returns {{ok: boolean, reason?: string}}
   */
  applyAutoFix: async () => {
    const { autoFix, userRole, connectedUsers, currentUser, isReplaying } = get();

    if (!autoFix || !autoFix.fixedCode) return { ok: false, reason: 'There is no fix to apply.' };
    if (autoFix.applied) return { ok: false, reason: 'This fix has already been applied.' };
    if (isReplaying) return { ok: false, reason: 'Exit replay mode before applying a fix.' };

    // Viewers get a read-only editor; the agent must not be a way around that.
    const canEdit = userRole === 'owner'
      || connectedUsers.find((u) => u.id === currentUser?.id)?.permission !== 'viewer';
    if (!canEdit) return { ok: false, reason: 'You have view-only access to this session.' };

    /* The fix may be for a file the user never opened — in project mode the
       agent picked it out of a stack trace. Open it rather than refusing:
       "this fix is for a file you don't have open" is a chore, not a safeguard,
       and the checks that actually matter are all applied below either way.
       Opening also loads the contents in local mode, which the compare needs. */
    const wanted = autoFix.targetPath;
    if (wanted && wanted !== get().activePath) {
      if (!get().files || !(wanted in get().files)) {
        return { ok: false, reason: `${wanted} is no longer in this project.` };
      }
      get().openFile(wanted);
      /* In local mode openFile only *starts* the read, so `code` is still the
         previous file for a tick. Awaiting the same load it kicked off is what
         makes the write below land on the file we actually mean. */
      if (get().workspaceRoot && !get().loadedPaths?.[wanted]) {
        await get().loadLocalFile(wanted);
      }
    }

    const activePath = get().activePath;

    // Same reasoning for a locked file: the agent writes through setCode, so
    // without this it becomes the one hand that can still edit a frozen file.
    if (get().isPathLockedForMe(activePath)) {
      const by = get().lockedFiles[activePath]?.by || 'the owner';
      return { ok: false, reason: `${activePath} is locked by ${by}.` };
    }

    // setCode is a no-op without an active file, which would leave us reporting
    // a success that never touched anything.
    if (!activePath) return { ok: false, reason: 'Open the file before applying a fix.' };

    if (wanted && wanted !== activePath) {
      return { ok: false, reason: `Could not open ${wanted} to apply this fix.` };
    }

    const current = get().files[activePath] ?? '';
    if (autoFix.basedOnCode != null && current !== autoFix.basedOnCode) {
      return { ok: false, reason: 'The file changed after this fix was generated. Run again for a fresh fix.' };
    }

    const previousCode = current;
    get().setCode(autoFix.fixedCode);

    // setCode clears rootCause — the old diagnosis describes code that no longer
    // exists. The proposal is re-set afterwards so the panel can still show what
    // was applied and offer the undo.
    set({
      autoFix: { ...autoFix, applied: true, previousCode },
      autoFixState: 'ready',
    });

    return { ok: true };
  },

  /** Put the file back the way it was before the agent touched it. */
  undoAutoFix: () => {
    const { autoFix, files, activePath } = get();
    if (!autoFix || !autoFix.applied || autoFix.previousCode == null) return { ok: false };

    // Only revert what the agent actually wrote. If the user has typed since,
    // their work outranks the undo.
    const current = files[activePath] ?? '';
    if (current !== autoFix.fixedCode) {
      return { ok: false, reason: 'You have edited the file since the fix was applied.' };
    }

    get().setCode(autoFix.previousCode);
    set({ autoFix: null, autoFixState: 'idle' });
    return { ok: true };
  },

  clearAutoFix: () => set({ autoFix: null, autoFixState: 'idle' }),

  // ---- Actions: Causality Graph ----
  setCausalityGraph: (causalityGraph) => set({ causalityGraph }),
  clearCausalityGraph: () => set({ causalityGraph: null }),

  // ---- Compound Actions ----
  runCode: async () => {
    const { code, language, sessionId, isRunning, isReplaying, files } = get();
    if (isRunning || isReplaying) return;

    // Detect if the code requires interactive user input (cin, input(), Scanner, etc.)
    const inputPatterns = {
      cpp: /(std\s*::\s*)?cin\s*>>|scanf\s*\(|std\s*::\s*getline|getchar\s*\(/i,
      c: /scanf\s*\(|gets\s*\(|getchar\s*\(/i,
      python: /\binput\s*\(|sys\s*\.\s*stdin\s*\.\s*read/i,
      java: /Scanner\b|System\s*\.\s*in|BufferedReader\b|console\s*\(\s*\)\s*\.\s*readLine/i,
      javascript: /readline\b|prompt\s*\(|process\s*\.\s*stdin/i,
      typescript: /readline\b|prompt\s*\(|process\s*\.\s*stdin/i,
      csharp: /Console\s*\.\s*Read/i
    };
    const lang = language ? language.toLowerCase() : '';
    const needsInput = inputPatterns[lang] 
      ? inputPatterns[lang].test(code)
      : Object.values(inputPatterns).some(regex => regex.test(code));

    // If Electron is running and the program needs user input, run it in the native interactive CLI terminal
    if (window.electronAPI && needsInput) {
      try {
        const extMap = { python: '.py', java: '.java', cpp: '.cpp', 'c++': '.cpp', c: '.c', javascript: '.js', typescript: '.ts' };
        const ext = extMap[lang] || '.txt';
        const filename = `temp_${Date.now()}${ext}`;
        
        // Write the editor code to a temporary file in the local filesystem
        const filePath = await window.electronAPI.saveTempFile({ content: code, filename });
        
        const isWindows = window.navigator.userAgent.toLowerCase().includes('win');
        let runCommand = '';
        
        if (lang === 'python') {
          runCommand = `python -u "${filePath}"`;
        } else if (lang === 'cpp' || lang === 'c++') {
          const exePath = filePath.replace(/\.cpp$/, isWindows ? '.exe' : '');
          runCommand = `g++ "${filePath}" -o "${exePath}" && "${exePath}"`;
        } else if (lang === 'c') {
          const exePath = filePath.replace(/\.c$/, isWindows ? '.exe' : '');
          runCommand = `gcc "${filePath}" -o "${exePath}" && "${exePath}"`;
        } else if (lang === 'java') {
          runCommand = `java "${filePath}"`;
        } else {
          runCommand = `node "${filePath}"`;
        }

        // Switch active tab to 'terminal' and queue the run command to execute in PTY
        const parsedGraph = parseExecutionGraph(code, language);
        
        // Create a snapshot for this interactive PTY run so it is saved in timeline history
        let snapData = null;
        if (sessionId) {
          try {
            snapData = await createSnapshot(sessionId, code, 'system');
          } catch (e) {
            console.error('[EditorStore] Failed to create snapshot on backend:', e);
          }
        }
        
        const snapshotId = snapData?.id || `local-${Date.now()}`;
        const newSnapshot = {
          id: snapshotId,
          code,
          userId: 'system',
          timestamp: snapData?.timestamp || new Date().toISOString(),
          diff: snapData?.diff || '',
          hasError: false,
          output: '',
          error: '',
          rootCause: null,
          causalityGraph: parsedGraph
        };
        get().addSnapshot(newSnapshot);

        set({
          output: '',
          error: '',
          rootCause: null,
          causalityGraph: parsedGraph,
          terminalActiveTab: 'terminal',
          isTerminalOpen: true,
          pendingTerminalCommand: runCommand
        });
        return;
      } catch (err) {
        console.error('[EditorStore] Failed to save/run interactive code in terminal:', err);
      }
    }

    const isStaticWebProject = files && Object.keys(files).some(p => p.toLowerCase().endsWith('.html'));

    set({
      isRunning: true,
      isTerminalOpen: true,
      terminalHeight: isStaticWebProject ? 400 : 280,
      terminalActiveTab: 'output',
      layoutMode: 'default',
      error: '',
      // A new run re-asks the question; the last answer must not linger.
      missingTool: null
    });

    try {
      // For static projects, send ALL files combined so the graph can analyze JS/CSS too
      let codeToSend = code;
      if (isStaticWebProject && files && Object.keys(files).length > 1) {
        codeToSend = Object.entries(files)
          .map(([path, content]) => `// ── FILE: ${path} ──\n${content}`)
          .join('\n\n');
      }

      const result = await executeCode(sessionId, codeToSend, language);
      get().handleExecutionResult(result);
      // Keep output tab active for static files
      if (isStaticWebProject) {
        set({ terminalActiveTab: 'output' });
      }
    } catch (err) {
      set({
        error: err.request?.status === 0 ? "Backend server unavailable." : (err.response?.data?.message || err.message || 'Execution failed'),
        isRunning: false
      });
    }
  },
  loadSessionHistory: async (sessionId) => {
    if (!sessionId) return;
    try {
      const timelineData = await getTimeline(sessionId);
      if (timelineData && timelineData.snapshots) {
        set({ snapshots: timelineData.snapshots });
      }
      const deployData = await getDeployments(sessionId);
      if (deployData && deployData.deployments) {
        set({ deployHistory: deployData.deployments });
      }
    } catch (err) {
      console.error('[EditorStore] Failed to load session history:', err);
    }
  },
  setTerminalActiveTab: (tab) => {
    set({
      terminalActiveTab: tab,
      isTerminalOpen: true
    });
  },
  setTerminalSecondActiveTab: (tab) => {
    set({
      terminalSecondActiveTab: tab,
      isTerminalOpen: true,
      terminalLayoutMode: 'split'
    });
  },
  toggleTerminal: () => set((s) => ({
    isTerminalOpen: !s.isTerminalOpen,
  })),
  setTerminalOpen: (isOpen) => set({ isTerminalOpen: isOpen }),
  setTerminalHeight: (height) => set({ terminalHeight: height }),
  setTerminalLayoutMode: (mode) => set({ terminalLayoutMode: mode }),
  clearPendingTerminalCommand: () => set({ pendingTerminalCommand: null }),

  // ---- Compound Actions ----

  // Called after successful execution
  handleExecutionResult: (result) => {
    const files = get().files;
    const isStaticWebProject = files && Object.keys(files).some(p => p.toLowerCase().endsWith('.html'));

    let finalOutput = result.output || '';
    let finalError = result.error || '';
    let finalRootCause = result.rootCause || null;
    let finalGraph = result.causalityGraph ? JSON.parse(JSON.stringify(result.causalityGraph)) : null;

    // For HTML/CSS, ignore Node.js execution errors (like ReferenceError: document is not defined)
    // because execution happens in the Preview iframe browser context instead.
    if (isStaticWebProject) {
      finalError = '';
      finalRootCause = null;
      if (finalGraph && finalGraph.nodes) {
        // Strip out false-positive error nodes
        finalGraph.nodes = finalGraph.nodes.filter(n => n.type !== 'error');
        const validNodeIds = new Set(finalGraph.nodes.map(n => n.id));
        if (finalGraph.edges) {
          finalGraph.edges = finalGraph.edges.filter(e => validNodeIds.has(e.source) && validNodeIds.has(e.target));
        }
      }
    }

    set({
      output: finalOutput,
      error: finalError,
      /* Not an error, and deliberately not folded into one: the code never ran,
         because the compiler it needs is not on this machine. The panel renders
         its own explanation rather than a stack trace. */
      missingTool: result.missingTool || null,
      isRunning: false,
      /* Remembered rather than checkpointed. A run is the only moment we learn
         whether the project actually works, and the next checkpoint stamps that
         verdict onto itself — so "last working build" survives even though runs
         no longer create history of their own. */
      lastRunStatus: result.missingTool ? null : (finalError ? 'fail' : 'ok'),
      rootCause: finalRootCause,
      // A new run supersedes any fix the agent was offering for the old one.
      autoFix: null,
      autoFixState: 'idle',
      causalityGraph: finalGraph,
      commitSuggestion: result.commitSuggestion || null,
      // Auto-open terminal on result
      isTerminalOpen: true,
      terminalActiveTab: 'output',
      terminalLayoutMode: 'normal'
    });
    /* No checkpoint here. Pressing Run is not a decision to save the project,
     * and treating it as one is what filled the history with points nobody
     * chose. The verdict is kept in lastRunStatus for the next real checkpoint
     * to carry. */

    if (result.snapshot) {
      const files = get().files;
      const isStaticWebProject = files && Object.keys(files).some(p => p.toLowerCase().endsWith('.html'));
      if (isStaticWebProject) {
        result.snapshot.hasError = false;
        result.snapshot.error = '';
      }
      
      const snapshotWithState = {
        ...result.snapshot,
        output: finalOutput,
        error: finalError,
        rootCause: finalRootCause,
        causalityGraph: finalGraph
      };
      get().addSnapshot(snapshotWithState);
    }
  },

  setCommitSuggestion: (suggestion) => set({ commitSuggestion: suggestion }),

  // ---- Actions: Git Workspace ----
  setGitRepoConnected: (connected, url) => set({
    gitRepoConnected: connected,
    gitRepoUrl: url || ''
  }),
  setGitStatus: (status) => set({ gitStatus: status }),
  setGitLog: (log) => set({ gitLog: log }),
  setGitLoading: (loading) => set({ gitLoading: loading }),
  setGitError: (error) => {
    set({ gitError: error });
    if (error) {
      setTimeout(() => set({ gitError: null }), 8000);
    }
  },
  resetGit: () => set({
    gitRepoConnected: false, gitRepoUrl: '',
    gitStatus: '', gitLog: '', gitLoading: false, gitError: null
  }),

  // ---- Actions: Dev Server ----
  setDetectedProjects: (projects) => set({ detectedProjects: projects, projectDetected: true }),
  updateDevServer: (type, data) => {
    set((s) => ({
      devServers: { ...s.devServers, [type]: { ...(s.devServers[type] || {}), ...data } }
    }));
  },
  clearDevServers: () => set({ devServers: {}, detectedProjects: [], projectDetected: false }),
  setDevServerNotification: (notif) => {
    set({ devServerNotification: notif });
    if (notif) {
      setTimeout(() => set({ devServerNotification: null }), 8000);
    }
  },

  // ---- Actions: Deployment ----
  setDeployStatus: (status) => set({ deployStatus: status }),
  addDeployLog: (line) => set((s) => ({ deployLogs: [...s.deployLogs, line] })),
  clearDeployLogs: () => set({ deployLogs: [] }),
  setDeployUrl: (url) => set({ deployUrl: url }),
  setDeployError: (error) => set({ deployError: error }),
  setDeployStartTime: (time) => set({ deployStartTime: time }),
  setCurrentDeployId: (id) => set({ currentDeployId: id }),
  setVercelConnected: (connected, username) => set({ vercelConnected: connected, vercelUsername: username }),
  setDeployFramework: (framework) => set({ deployFramework: framework }),
  addDeploymentRecord: (record) => set((s) => ({ deployHistory: [...s.deployHistory, record] })),
  setDeployHistory: (history) => set({ deployHistory: history }),
  setPendingRedeploy: (pending) => set({ pendingRedeploy: pending }),
  resetDeploy: () => set({
    deployStatus: 'idle', deployLogs: [], deployUrl: null,
    deployError: null, currentDeployId: null, deployStartTime: null,
    deployFramework: null,
  }),
  setDeployTarget: (target) => set({ deployTarget: target }),
  setLastDeploySessionId: (id) => set({ lastDeploySessionId: id }),

  // ---- Actions: Render (backend) Deployment ----
  setRenderDeployStatus: (status) => set({ renderDeployStatus: status }),
  addRenderDeployLog: (line) => set((s) => ({ renderDeployLogs: [...s.renderDeployLogs, line] })),
  clearRenderDeployLogs: () => set({ renderDeployLogs: [] }),
  setRenderDeployUrl: (url) => set({ renderDeployUrl: url }),
  setRenderDeployError: (error) => set({ renderDeployError: error }),
  setRenderDeployStartTime: (time) => set({ renderDeployStartTime: time }),
  setCurrentRenderDeployId: (id) => set({ currentRenderDeployId: id }),
  setRenderConnected: (connected, ownerName) => set({ renderConnected: connected, renderOwnerName: ownerName }),
  setRenderRuntime: (runtime) => set({ renderRuntime: runtime }),
  resetRenderDeploy: () => set({
    renderDeployStatus: 'idle', renderDeployLogs: [], renderDeployUrl: null,
    renderDeployError: null, currentRenderDeployId: null, renderDeployStartTime: null,
    renderRuntime: null,
  }),
  setLastRenderDeploySessionId: (id) => set({ lastRenderDeploySessionId: id }),

  // ---- Actions: Impact Detection ----
  addImpactWarning: (warning) => {
    const id = Date.now() + Math.random();
    set((s) => ({
      impactWarnings: [
        ...s.impactWarnings.slice(-2), // Keep max 3 warnings
        { ...warning, id, timestamp: Date.now() }
      ]
    }));
  },

  dismissImpactWarning: (id) => {
    set((s) => ({
      impactWarnings: s.impactWarnings.filter(w => w.id !== id)
    }));
  },

  revertChange: (warningId) => {
    const { impactWarnings, sessionId, currentUser, files } = get();
    const warning = impactWarnings.find(w => w.id === warningId);
    if (!warning || !warning.oldContent === undefined) return;

    const { changedPath, oldContent, changedBy } = warning;

    // Restore the old content locally
    set((s) => ({
      files: { ...s.files, [changedPath]: oldContent },
      code: s.activePath === changedPath ? oldContent : s.code,
      impactWarnings: s.impactWarnings.filter(w => w.id !== warningId),
    }));

    // Broadcast the revert to all collaborators
    if (sessionId && currentUser) {
      sendCodeChange(sessionId, currentUser.id, changedPath, oldContent);
      sendRevert(sessionId, currentUser.id, changedPath, currentUser.username, changedBy);
    }
  },

  setRevertNotification: (notif) => {
    set({ revertNotification: notif });
    // Auto-clear after 6s
    setTimeout(() => {
      set({ revertNotification: null });
    }, 6000);
  },

  // Reset entire session state
  resetSession: () => {
    // Symbol extraction is cached per file path; the next project would
    // otherwise inherit entries belonging to this one.
    clearSymbolCache();

    // Leaving a session must not take the user's folder with it. When a local
    // workspace is open the files belong to the disk, not the session, so the
    // tree and the open file stay exactly as they are — only the collaboration
    // state is torn down.
    const {
      workspaceRoot, files, activePath, code, language, savedContents, projectRootPath,
      whiteboardElements, snapshots,
    } = get();

    // The board and history belong to the folder, not the session, and they are
    // saved under the folder's own key. Blanking them here would leave the next
    // stroke overwriting the stored copy with an empty one.
    const keepWorkspace = workspaceRoot
      ? { files, activePath, code, language, savedContents, projectRootPath, whiteboardElements, snapshots }
      : {
          files: {},
          activePath: '',
          code: '',
          language: 'javascript',
          savedContents: {},
          projectRootPath: null,
          whiteboardElements: [],
          snapshots: [],
        };

    // A pending countdown must not outlive the session and lock a local file.
    clearTimeout(connectionLostTimer);
    connectionLostTimer = null;

    set({
      sessionId: null,
      sessionName: '',
      joinCode: '',
      joinCodeStale: false,
      rewindLog: [],
      rewindOpen: false,
      rewindIndex: null,
      rewindNotice: null,
      connectionState: 'connected',
      tunnelState: 'off',
      tunnelError: null,
      currentUser: null,
      userRole: null,
      connectedUsers: [],
      remoteCursors: {},
      remoteTyping: {},
      changeNotifications: [],
      remoteLineChanges: {},
      remoteLineDeletions: {},
      filePresence: {},
      // Locks belong to the session. Keeping them would leave a file frozen in
      // a local folder with no owner left to unfreeze it.
      lockedFiles: {},
      pendingAdmissions: [],
      // Nothing left to prove membership of.
      reauthNeeded: false,
      impactWarnings: [],
      revertNotification: null,
      ...keepWorkspace,
      output: '',
      error: '',
      // snapshots is set above — a local folder keeps its own history.
      currentSnapshotIndex: -1,
      isReplaying: false,
      rootCause: null,
      causalityGraph: null,
      collisionWarning: null,
      collabReady: false,
      // Save state — savedContents is set above, since a local workspace keeps
      // its dirty-tracking baseline when only the session goes away.
      fileHandles: {},
      fileSavedPaths: {},
      activeView: 'code',
      // whiteboardElements is set above — a local folder keeps its own board.
      whiteboardCursors: {},
      // Terminal — close it so the welcome screen comes back clean
      isTerminalOpen: false,
      terminalLayoutMode: 'normal',
      // Git — a disconnected session must not show stale repo state
      gitRepoConnected: false,
      gitRepoUrl: '',
      gitStatus: '',
      gitLog: '',
      gitLoading: false,
      gitError: null,
      commitSuggestion: null,
      // Voice room
      voiceRoomUsers: [],
      isInVoiceRoom: false,
      isMuted: false,
      isDeafened: false,
      speakingUsers: {},
      // Follow mode
      followingUserId: null,
      followedByUsers: [],
      followState: null,
      followToast: null,
      // Deployment
      deployStatus: 'idle',
      deployLogs: [],
      deployUrl: null,
      deployError: null,
      deployStartTime: null,
      currentDeployId: null,
      deployHistory: [],
      vercelConnected: false,
      vercelUsername: null,
      deployFramework: null,
      pendingRedeploy: false,
      deployTarget: 'frontend',
      lastDeploySessionId: null,
      // Render (backend) deployment
      renderDeployStatus: 'idle',
      renderDeployLogs: [],
      renderDeployUrl: null,
      renderDeployError: null,
      renderDeployStartTime: null,
      currentRenderDeployId: null,
      renderConnected: false,
      renderOwnerName: null,
      lastRenderDeploySessionId: null,
    });
  },
}), {
  name: 'causify-session',
  // Persistence: the workspace (files, layout, whiteboard) AND the session
  // identity (id, user, role) both live in localStorage, so reopening the app
  // drops you back into the same session — App.jsx verifies it against the
  // backend on launch and reconnects the WebSocket (or recreates the session
  // if the backend no longer has it). The sessionStorage split is retained for
  // any future per-window-only keys (SESSION_ONLY_KEYS), currently none.
  storage: {
    getItem: (name) => {
      const localStr = localStorage.getItem(name);
      const sessionStr = sessionStorage.getItem(name);
      if (!localStr && !sessionStr) return null;
      const local = localStr ? JSON.parse(localStr) : null;
      const session = sessionStr ? JSON.parse(sessionStr) : null;
      // Session-only keys must never be resurrected from localStorage
      // (covers entries written before a key became session-only).
      const localState = { ...(local?.state || {}) };
      SESSION_ONLY_KEYS.forEach((key) => delete localState[key]);

      const merged = { ...localState, ...(session?.state || {}) };
      // Always start with the terminal closed. Dropping it from partialize stops
      // it being written from now on, but anyone upgrading still has a stored
      // `true` sitting in localStorage that would restore once — so strip it on
      // the way in as well.
      NEVER_RESTORED_KEYS.forEach((key) => delete merged[key]);

      return {
        version: (session ?? local)?.version ?? 0,
        state: merged,
      };
    },
    setItem: (name, value) => {
      const sessionState = {};
      const localState = {};
      Object.entries(value.state || {}).forEach(([key, val]) => {
        if (SESSION_ONLY_KEYS.includes(key)) sessionState[key] = val;
        else localState[key] = val;
      });
      sessionStorage.setItem(name, JSON.stringify({ version: value.version, state: sessionState }));
      try {
        localStorage.setItem(name, JSON.stringify({ version: value.version, state: localState }));
      } catch (e) {
        // Quota exceeded (very large projects) — workspace restore degrades
        // gracefully; session behavior is unaffected.
        console.warn('[Causify] Could not persist workspace state:', e.message);
      }
    },
    removeItem: (name) => {
      sessionStorage.removeItem(name);
      localStorage.removeItem(name);
    },
  },
  // Persist the workspace + session identity — not transient collab/UI data
  partialize: (state) => ({
    // Session identity (sessionStorage — dropped when the window closes)
    sessionId: state.sessionId,
    currentUser: state.currentUser,
    userRole: state.userRole,
    // Workspace (localStorage — restored when the app reopens)
    sessionName: state.sessionName,
    // In local mode the disk holds the contents, so only the paths are kept —
    // persisting a whole project here would re-create the duplication (and the
    // quota failures) that local mode exists to remove.
    files: state.workspaceRoot
      ? Object.fromEntries(Object.keys(state.files || {}).map((p) => [p, null]))
      : state.files,
    workspaceRoot: state.workspaceRoot,
    workspaceName: state.workspaceName,
    projectRootPath: state.projectRootPath,
    activePath: state.activePath,
    code: state.code,
    language: state.language,
    savedContents: state.savedContents,
    fileSavedPaths: state.fileSavedPaths,
    activeView: state.activeView,
    /* ── Session Rewind ──
     *
     * Checkpoints are things the user chose to save, often labelled "last
     * working build". Losing them to a tab close made the panel a record of the
     * current sitting only, which is the opposite of what a history is for.
     *
     * The attribution travels with it. Without those two maps the restored
     * checkpoints would come back saying "no edits by anyone" — a record of the
     * project's contents with the account of who changed what stripped out. */
    rewindLog: rewindForStorage(state.rewindLog),
    remoteLineChanges: state.remoteLineChanges,
    remoteLineDeletions: state.remoteLineDeletions,
    /* A collaborator's own saves. Line records only, already capped in both
       directions, so this is small next to the log above — and losing it to a
       reload would defeat the point of saving anything. */
    myCheckpoints: state.myCheckpoints,
    /* Where the user parked Mario. A placement preference, like where a tool is
       left on a desk — worth remembering, and clamped back on screen on mount
       in case the window is smaller this time. `marioOpen` is deliberately not
       persisted: he is summoned when wanted, not waiting on every launch. */
    marioPos: state.marioPos,
    whiteboardElements: state.whiteboardElements,
    whiteboardPan: state.whiteboardPan,
    whiteboardZoom: state.whiteboardZoom,
    terminalActiveTab: state.terminalActiveTab,
    terminalSecondActiveTab: state.terminalSecondActiveTab,
    // isTerminalOpen is deliberately NOT persisted. The size and the last tab
    // are preferences worth remembering; whether the panel was open is not —
    // a shell from the previous session is gone, so restoring the panel would
    // show an empty terminal the user has to close. It starts closed, and Run
    // opens it again.
    terminalHeight: state.terminalHeight,
    terminalLayoutMode: state.terminalLayoutMode,
    isFileExplorerOpen: state.isFileExplorerOpen,
    // Git repo connection — persisted so a connected repo stays connected across
    // reopen (the panel shows it immediately instead of flashing the connect
    // form) until the user manually disconnects. App/panel reconciles with the
    // backend on launch and only drops it if the repo truly can't be restored.
    gitRepoConnected: state.gitRepoConnected,
    gitRepoUrl: state.gitRepoUrl,
    // Deployment state (Vercel) — restored so reopening shows the success panel
    deployStatus: state.deployStatus,
    deployUrl: state.deployUrl,
    vercelConnected: state.vercelConnected,
    vercelUsername: state.vercelUsername,
    deployFramework: state.deployFramework,
    deployTarget: state.deployTarget,
    lastDeploySessionId: state.lastDeploySessionId,
    // Deployment state (Render)
    renderDeployStatus: state.renderDeployStatus,
    renderDeployUrl: state.renderDeployUrl,
    renderConnected: state.renderConnected,
    renderOwnerName: state.renderOwnerName,
    renderRuntime: state.renderRuntime,
    lastRenderDeploySessionId: state.lastRenderDeploySessionId,
  }),
}));

export default useEditorStore;


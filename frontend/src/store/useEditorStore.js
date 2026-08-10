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
import { sendCodeChange, sendRevert, sendFollowStart, sendFollowStop } from '../services/socket';
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
const MAX_REWIND_POINTS = 240;
const REWIND_SAMPLE_MS = 15000;
let rewindSampler = null;
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
   * Each entry: { id, at, files: { path: content | null }, run: 'ok'|'fail'|null }
   * A null content means the file did not exist at that point.
   */
  rewindLog: [],
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
        connectionState: 'connected',
        joinCodeStale: false,
      });

      return { ok: true, sessionId: session.id, keepWorkspace: Boolean(workspaceRoot) };
    } catch (err) {
      set({ connectionState: 'lost' });
      return { ok: false, reason: err.response?.data?.message || err.message || 'Could not start a new session.' };
    }
  },

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

    const oldLines = (oldContent || '').split('\n');
    const newLines = (newContent || '').split('\n');
    const now = Date.now();
    const existingPathChanges = { ...(get().remoteLineChanges[path] || {}) };

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

    // Range [top, bottomNew] in the NEW file is what changed
    for (let i = top; i <= bottomNew; i++) {
      const lineNum = i + 1;
      const prevRecord = existingPathChanges[lineNum];
      const sameUser = prevRecord && prevRecord.userId === (userId || 'local');

      // Preserve initial baseline oldLine if same user is continuing to edit this line
      const rawOldLine = i <= bottomOld ? oldLines[i] : undefined;
      const initialOldLine = sameUser ? prevRecord.oldLine : (rawOldLine ?? '(line added)');
      const newLineVal = newLines[i] ?? '';

      // Determine change type relative to original baseline line
      let changeType = sameUser ? prevRecord.type : (rawOldLine === undefined ? 'added' : (i > bottomOld ? 'added' : 'modified'));
      if (!sameUser && (rawOldLine === '' || rawOldLine === undefined)) {
        changeType = 'added';
      }

      // If user reverted/cleared the line back to its original baseline content, clear change record
      if (sameUser && (newLineVal === initialOldLine || (initialOldLine === '(line added)' && newLineVal === ''))) {
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

    // Cleanup logic for stale line numbers beyond current file length
    Object.keys(existingPathChanges).forEach((ln) => {
      if (parseInt(ln, 10) > newLines.length) {
        delete existingPathChanges[ln];
      }
    });

    set((s) => ({
      remoteLineChanges: { ...s.remoteLineChanges, [path]: existingPathChanges }
    }));
  },

  setCode: (code, remote = false) => {
    const { activePath, language, isReplaying, files, currentUser } = get();
    if (isReplaying || !activePath) return;

    const oldContent = files[activePath] || '';
    if (oldContent !== code) {
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

  // Update a specific file from a remote event
  updateRemoteFile: (path, content, userId) => {
    if (!userId) return; // Ignore own changes echoed back from socket to prevent typing glitch

    // A collaborator's edit has to reach this machine's disk too, or the folder
    // silently falls behind what everyone is looking at. Debounced, because this
    // fires per keystroke batch and a write per keystroke would hammer the disk.
    if (get().workspaceRoot) get().scheduleLocalPersist(path, content || '');
    const { activePath, files, connectedUsers } = get();
    const oldContent = files[path] || '';
    const newContent = content || '';

    // ── Compute line-level diff (Anchor-based search) ──
    if (oldContent !== newContent) {
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
  applyRemoteFileEdits: (edits, userId) => {
    const { activePath } = get();
    edits.forEach(({ path, text }) => {
      // The open file is already mirrored by the binding's own observer;
      // repeating it here would raise a second impact warning for one change.
      if (path === activePath) return;
      if (get().files[path] === text) return;
      get().updateRemoteFile(path, text, userId);
    });
    get().markRemoteTyping(userId);
  },

  // Clear remote line changes for a specific path
  clearRemoteLineChanges: (path) => {
    set((s) => {
      const updated = { ...s.remoteLineChanges };
      delete updated[path];
      return { remoteLineChanges: updated };
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
   * Sampled on a timer rather than wired into every place a file can change.
   * There are a dozen such places — typing, a collaborator's edit, a new file,
   * a delete, a disk write, an applied AI fix — and hooking each one would mean
   * touching a dozen working code paths for a feature that only needs to know
   * "did anything change since last time".
   */
  captureRewindPoint: ({ run = null, force = false } = {}) => {
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

  /* Sampling runs only while the app is mounted, and is idempotent so React's
   * double-mount in development cannot end up with two timers appending
   * duplicate checkpoints. */
  startRewindSampler: () => {
    if (rewindSampler) return;
    rewindSampler = setInterval(() => {
      useEditorStore.getState().captureRewindPoint();
    }, REWIND_SAMPLE_MS);
  },

  stopRewindSampler: () => {
    clearInterval(rewindSampler);
    rewindSampler = null;
  },

  /* ── Undo one person's changes ──
   *
   * The thing git structurally cannot do. Git reverts commits, which bundle
   * everyone's work together — you cannot take back what one person did to a
   * file over the last twenty minutes while keeping what someone else did to
   * the same file.
   *
   * Built on the line attribution that already exists for the gutter markers.
   * Each record carries who changed the line and, crucially, `oldLine` — what
   * it held before that person started on it — so reverting is a lookup rather
   * than a reconstruction.
   *
   * The alternative was Yjs's own UndoManager, which would have meant changing
   * how the shared document is created (per-user origins, history kept forever
   * rather than compacted). That is surgery on the one part of the app whose
   * failure mode is silent divergence between collaborators, for the same
   * user-facing result. This touches nothing shared until it writes.
   */
  fileContributors: (path) => {
    const changes = get().remoteLineChanges[path] || {};
    const byUser = new Map();

    Object.values(changes).forEach((rec) => {
      const entry = byUser.get(rec.userId) || {
        userId: rec.userId,
        username: rec.username,
        color: rec.color,
        lines: 0,
        latest: 0,
      };
      entry.lines += 1;
      entry.latest = Math.max(entry.latest, rec.timestamp || 0);
      byUser.set(rec.userId, entry);
    });

    return [...byUser.values()].sort((a, b) => b.latest - a.latest);
  },

  undoUserChanges: async (path, userId) => {
    const { remoteLineChanges, files, isReplaying } = get();
    if (isReplaying) return { ok: false, reason: 'Exit replay mode first.' };

    const content = files[path];
    if (typeof content !== 'string') {
      return { ok: false, reason: 'That file is not loaded.' };
    }

    const records = Object.entries(remoteLineChanges[path] || {})
      .map(([line, rec]) => ({ line: Number(line), ...rec }))
      .filter((r) => r.userId === userId);

    if (records.length === 0) return { ok: false, reason: 'Nothing of theirs to undo here.' };

    const lines = content.split('\n');

    /* Only lines that still hold exactly what was recorded. If someone has
     * since edited the same line, it is no longer purely this person's work and
     * reverting it would quietly discard the other person's edit — the precise
     * thing this feature exists to avoid. */
    const applicable = records.filter((r) => lines[r.line - 1] === r.newLine);
    if (applicable.length === 0) {
      return { ok: false, reason: 'Those lines have been edited since — nothing safe to undo.' };
    }

    // Restoring is itself a change worth being able to take back.
    get().captureRewindPoint({ force: true });

    /* Descending, so removing a line cannot shift the ones not yet handled. */
    applicable.sort((a, b) => b.line - a.line).forEach((r) => {
      const idx = r.line - 1;
      if (r.type === 'added' || r.oldLine === '(line added)') lines.splice(idx, 1);
      else lines[idx] = r.oldLine;
    });

    const reverted = lines.join('\n');

    if (path === get().activePath) {
      get().setCode(reverted);
    } else {
      const propagated = replaceFileText(path, reverted);
      if (!propagated) set((s) => ({ files: { ...s.files, [path]: reverted } }));
    }
    if (get().workspaceRoot) {
      await get().writeLocalFile(path, reverted).catch(() => { /* surfaced below */ });
    }

    // Those lines are no longer theirs, so drop the markers with them.
    set((s) => {
      const forPath = { ...(s.remoteLineChanges[path] || {}) };
      applicable.forEach((r) => delete forPath[r.line]);
      return { remoteLineChanges: { ...s.remoteLineChanges, [path]: forPath } };
    });

    // Tell the room, so a change vanishing from their screen has a reason.
    const { sessionId, currentUser } = get();
    if (sessionId && currentUser) {
      sendRevert(sessionId, currentUser.id, path, currentUser.username, records[0].username);
    }

    const skipped = records.length - applicable.length;
    set({
      rewindNotice: `Undid ${applicable.length} line${applicable.length === 1 ? '' : 's'} from `
        + `${records[0].username} in ${path}`
        + (skipped ? ` — ${skipped} left alone because someone edited them since.` : '.'),
    });

    return { ok: true, reverted: applicable.length, skipped };
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
  restoreRewindPoint: async (index) => {
    const { rewindLog, isReplaying, sessionId, userRole, connectedUsers, currentUser } = get();
    if (index < 0 || index >= rewindLog.length) return { ok: false, reason: 'That point is no longer in history.' };
    if (isReplaying) return { ok: false, reason: 'Exit replay mode before restoring.' };

    const canEdit = !sessionId || userRole === 'owner'
      || connectedUsers.find((u) => u.id === currentUser?.id)?.permission !== 'viewer';
    if (!canEdit) return { ok: false, reason: 'You have view-only access to this session.' };

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
  },

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

  /** Ask the agent to repair the current error. Leaves the file untouched. */
  requestAutoFix: async () => {
    const { code, language, sessionId, activePath, rootCause, autoFixState } = get();
    if (autoFixState === 'working') return;
    if (!code || !rootCause) return;

    set({ autoFixState: 'working', autoFix: null });

    try {
      const result = await fetchAutoFix({
        sessionId: sessionId || '',
        code,
        language,
        filePath: activePath || '',
        errorType: rootCause.errorType,
        errorMessage: rootCause.errorMessage,
        errorLine: rootCause.errorLine,
        suspectedVariable: rootCause.suspectedVariable,
        semanticContext: rootCause.semanticContext || null,
      });

      set({
        autoFix: {
          ...result,
          // Pin the proposal to what it was generated against. Without this a
          // fix could be applied minutes later onto edited code, and its line
          // numbers would land somewhere else entirely.
          targetPath: activePath,
          basedOnCode: code,
          applied: false,
          previousCode: null,
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
  applyAutoFix: () => {
    const { autoFix, files, activePath, userRole, connectedUsers, currentUser, isReplaying } = get();

    if (!autoFix || !autoFix.fixedCode) return { ok: false, reason: 'There is no fix to apply.' };
    if (autoFix.applied) return { ok: false, reason: 'This fix has already been applied.' };
    if (isReplaying) return { ok: false, reason: 'Exit replay mode before applying a fix.' };

    // Viewers get a read-only editor; the agent must not be a way around that.
    const canEdit = userRole === 'owner'
      || connectedUsers.find((u) => u.id === currentUser?.id)?.permission !== 'viewer';
    if (!canEdit) return { ok: false, reason: 'You have view-only access to this session.' };

    // setCode is a no-op without an active file, which would leave us reporting
    // a success that never touched anything.
    if (!activePath) return { ok: false, reason: 'Open the file before applying a fix.' };

    if (autoFix.targetPath && autoFix.targetPath !== activePath) {
      return { ok: false, reason: `This fix was written for ${autoFix.targetPath}. Open that file to apply it.` };
    }

    const current = files[activePath] ?? '';
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
      error: ''
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
      isRunning: false,
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
    /* Runs are the checkpoints that matter most: they are the only moments we
     * know whether the project actually worked, which is what makes "last
     * working build" answerable. */
    get().captureRewindPoint({ run: finalError ? 'fail' : 'ok', force: true });

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
      filePresence: {},
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


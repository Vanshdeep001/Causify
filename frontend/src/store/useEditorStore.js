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
import { executeCode, createSnapshot, getTimeline, getDeployments } from '../services/api';
import { analyzeImpact } from '../utils/impactAnalyzer';
import { sendCodeChange, sendRevert, sendFollowStart, sendFollowStop } from '../services/socket';

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

  // ---- Save State ----
  fileHandles: {},          // { [path]: FileSystemFileHandle } — for silent re-saves
  savedContents: {},        // { [path]: string } — last-saved content, for dirty detection
  fileSavedPaths: {},       // { [path]: string } — on-disk path chosen in Save dialog

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

  openFile: (path) => {
    const { files, isReplaying } = get();
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
      causalityGraph: parseExecutionGraph(code, language)
    });
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

  setCode: (code, remote = false) => {
    const { activePath, language, isReplaying } = get();
    if (isReplaying) {
      set((s) => ({
        code,
        files: { ...s.files, [activePath]: code }
      }));
      return;
    }
    set((s) => ({
      code,
      files: { ...s.files, [activePath]: code },
      output: '',
      error: '',
      rootCause: null,
      causalityGraph: parseExecutionGraph(code, language)
    }));
    // Impact warnings are only shown to REMOTE users (in updateRemoteFile),
    // not to the user who is making the change.
  },

  setCollisionWarning: (warning) => set({ collisionWarning: warning }),

  // Update a specific file from a remote event
  updateRemoteFile: (path, content, userId) => {
    if (!userId) return; // Ignore own changes echoed back from socket to prevent typing glitch
    const { activePath, files, connectedUsers, remoteLineChanges } = get();
    const oldContent = files[path] || '';
    const newContent = content || '';

    // ── Compute line-level diff (Anchor-based search) ──
    if (userId && oldContent !== newContent) {
      const oldLines = oldContent.split('\n');
      const newLines = newContent.split('\n');
      const now = Date.now();
      const user = connectedUsers.find(u => u.id === userId);
      const existingPathChanges = { ...(remoteLineChanges[path] || {}) };

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
        const oldLine = i <= bottomOld ? oldLines[i] : undefined;
        const newLine = newLines[i];

        existingPathChanges[i + 1] = {
          userId,
          username: user?.username || userId,
          color: user?.color || '#6366f1',
          timestamp: now,
          oldLine: oldLine ?? '(line added)',
          newLine: newLine ?? '(line removed)',
          type: oldLine === undefined ? 'added' : (i > bottomOld ? 'added' : 'modified'),
        };
      }

      // Cleanup logic still required to remove stale high line numbers
      Object.keys(existingPathChanges).forEach(ln => {
        if (parseInt(ln, 10) > newLines.length) {
          delete existingPathChanges[ln];
        }
      });

      set((s) => ({
        remoteLineChanges: { ...s.remoteLineChanges, [path]: existingPathChanges }
      }));

      // Auto-fade changes after 30s
      setTimeout(() => {
        const current = get().remoteLineChanges[path];
        if (!current) return;
        const cleaned = { ...current };
        Object.keys(cleaned).forEach(ln => {
          if (cleaned[ln].timestamp === now) delete cleaned[ln];
        });
        set((s) => ({
          remoteLineChanges: {
            ...s.remoteLineChanges,
            [path]: Object.keys(cleaned).length > 0 ? cleaned : undefined
          }
        }));
      }, 30000);
    }

    set((s) => ({
      files: { ...s.files, [path]: content },
      code: path === activePath ? content : s.code
    }));

    if (userId) {
      get().registerRemoteChange(userId, path);

      // Run cross-file impact analysis on remote changes
      const updatedFiles = get().files;
      const result = analyzeImpact(path, oldContent, newContent, updatedFiles);
      if (result.impacts.length > 0) {
        const user = connectedUsers.find(u => u.id === userId);
        get().addImpactWarning({
          changedBy: user?.username || userId,
          changedPath: path,
          impacts: result.impacts,
          summary: result.summary,
          affectedFiles: result.affectedFiles,
          oldContent: oldContent,
        });
      }
    }
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
  setWhiteboardElements: (val) => set((s) => ({
    whiteboardElements: typeof val === 'function' ? val(s.whiteboardElements) : val
  })),
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
      causalityGraph: finalGraph,
      commitSuggestion: result.commitSuggestion || null,
      // Auto-open terminal on result
      isTerminalOpen: true,
      terminalActiveTab: 'output',
      terminalLayoutMode: 'normal'
    });
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
    set({
      sessionId: null,
      sessionName: '',
      currentUser: null,
      userRole: null,
      connectedUsers: [],
      remoteCursors: {},
      changeNotifications: [],
      remoteLineChanges: {},
      filePresence: {},
      impactWarnings: [],
      revertNotification: null,
      files: {},
      projectRootPath: null,
      activePath: '',
      code: '',
      language: 'javascript',
      output: '',
      error: '',
      snapshots: [],
      currentSnapshotIndex: -1,
      isReplaying: false,
      rootCause: null,
      causalityGraph: null,
      collisionWarning: null,
      collabReady: false,
      // Save state
      fileHandles: {},
      savedContents: {},
      fileSavedPaths: {},
      activeView: 'code',
      whiteboardElements: [],
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
      return {
        version: (session ?? local)?.version ?? 0,
        state: { ...localState, ...(session?.state || {}) },
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
    files: state.files,
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
    isTerminalOpen: state.isTerminalOpen,
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


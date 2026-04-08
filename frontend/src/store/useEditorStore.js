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
import { executeCode } from '../services/api';
import { analyzeImpact } from '../utils/impactAnalyzer';
import { sendCodeChange, sendRevert } from '../services/socket';

const useEditorStore = create(persist((set, get) => ({

  // ---- Session State ----
  sessionId: null,          // Current session ID
  sessionName: '',          // Display name of the session
  currentUser: null,        // Current user object { id, username, color }
  userRole: null,           // 'owner' or 'collaborator'
  connectedUsers: [],       // List of users currently connected
  lastChange: null,         // Most recent remote change: { userId, path, timestamp }
  fileActivity: {},         // { [path]: { userId, timestamp, username, color } }
  remoteCursors: {},        // { [userId]: { line, column, path, username, color } }
  changeNotifications: [],  // [ { id, username, path, linesChanged, timestamp, color } ]
  remoteLineChanges: {},    // { [path]: { [lineNumber]: { userId, username, color, timestamp, oldLine, newLine } } }

  // ---- Editor State ----
  files: {},                // Map of { path: content }
  activePath: '',           // Currently opened file path
  code: '',                 // Code content
  language: 'javascript',  // Editor language mode

  // ---- Execution State ----
  output: '',               // Stdout from last execution
  error: '',                // Stderr from last execution
  isRunning: false,         // Whether code is currently executing
  executionHistory: [],     // History of all executions

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

  // ---- UI Layout State ----
  terminalActiveTab: 'output', // 'output' | 'timeline' | 'graph' | 'git'
  isTerminalOpen: false,       // Whether terminal is visible
  terminalHeight: 300,         // Height in pixels (normal mode)
  terminalLayoutMode: 'normal', // 'normal' | 'split' | 'maximized'
  isFileExplorerOpen: true,    // File explorer visibility

  // ---- Actions: Session ----
  setSession: (sessionId, sessionName) => set({ sessionId, sessionName }),
  setCurrentUser: (user) => set({ currentUser: user }),
  setUserRole: (role) => set({ userRole: role }),
  isOwner: () => get().userRole === 'owner',
  setConnectedUsers: (users) => set({ connectedUsers: users }),
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
    fileArray.forEach(f => { fileMap[f.path] = f.content; });
    const firstPath = fileArray.length > 0 ? fileArray[0].path : 'index.js';
    const firstContent = fileArray.length > 0 ? fileArray[0].content : '';
    set({
      files: fileMap,
      activePath: firstPath,
      code: firstContent,
      language: get().detectLanguage(firstPath)
    });
  },

  openFile: (path) => {
    const { files, isReplaying } = get();
    if (isReplaying) return; // Disable switching during replay for now
    set({
      activePath: path,
      code: files[path] || '',
      language: get().detectLanguage(path)
    });
  },

  addFile: (path, content = '') => {
    const { files } = get();
    set((s) => ({
      files: { ...s.files, [path]: content },
      activePath: path,
      code: content,
      language: get().detectLanguage(path)
    }));
  },

  removeFile: (path) => {
    const { files, activePath } = get();
    const newFiles = { ...files };

    // Recursive delete: remove exact path or any path starting with "path/"
    Object.keys(newFiles).forEach(f => {
      if (f === path || f.startsWith(path + '/')) {
        delete newFiles[f];
      }
    });

    let newActive = activePath;
    let newCode = get().code;

    // If the active file was deleted or its parent folder was deleted
    if (activePath === path || activePath.startsWith(path + '/')) {
      const remainingPaths = Object.keys(newFiles);
      newActive = remainingPaths.length > 0 ? remainingPaths[0] : '';
      newCode = remainingPaths.length > 0 ? newFiles[newActive] : '';

      set({
        files: newFiles,
        activePath: newActive,
        code: newCode,
        language: get().detectLanguage(newActive)
      });
    } else {
      set({ files: newFiles });
    }
  },

  detectLanguage: (path) => {
    if (path.endsWith('.java')) return 'java';
    if (path.endsWith('.py')) return 'python';
    if (path.endsWith('.html')) return 'html';
    if (path.endsWith('.css')) return 'css';
    return 'javascript';
  },

  setCode: (code, remote = false) => {
    const { activePath } = get();
    set((s) => ({
      code,
      files: { ...s.files, [activePath]: code }
    }));
    // Impact warnings are only shown to REMOTE users (in updateRemoteFile),
    // not to the user who is making the change.
  },

  // Update a specific file from a remote event
  updateRemoteFile: (path, content, userId) => {
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
      set({
        currentSnapshotIndex: index,
        isReplaying: true,
        code: snap.code,
        commitSuggestion: snap.suggestion || null
      });
    }
  },

  // Return to live editing (exit replay)
  goToLive: () => {
    const { snapshots } = get();
    const lastCode = snapshots.length > 0
      ? snapshots[snapshots.length - 1].code
      : get().code;
    set({
      currentSnapshotIndex: -1,
      isReplaying: false,
      code: lastCode,
    });
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
  setTerminalActiveTab: (tab) => {
    set({
      terminalActiveTab: tab,
      isTerminalOpen: true // Auto-open when switching tabs
    });
  },
  toggleTerminal: () => set((s) => ({
    isTerminalOpen: !s.isTerminalOpen,
    terminalLayoutMode: 'normal' // Reset to normal if closing
  })),
  setTerminalOpen: (isOpen) => set({ isTerminalOpen: isOpen }),
  setTerminalHeight: (height) => set({ terminalHeight: height }),
  setTerminalLayoutMode: (mode) => set({ terminalLayoutMode: mode }),
  setFileExplorerOpen: (isOpen) => set({ isFileExplorerOpen: isOpen }),

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
      get().addSnapshot(result.snapshot);
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
      impactWarnings: [],
      revertNotification: null,
      files: {},
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
    });
  },
}), {
  name: 'causify-session',
  // Use sessionStorage so each tab gets its own independent session
  storage: {
    getItem: (name) => {
      const str = sessionStorage.getItem(name);
      return str ? JSON.parse(str) : null;
    },
    setItem: (name, value) => sessionStorage.setItem(name, JSON.stringify(value)),
    removeItem: (name) => sessionStorage.removeItem(name),
  },
  // Only persist the essential session state — not transient UI data
  partialize: (state) => ({
    sessionId: state.sessionId,
    sessionName: state.sessionName,
    currentUser: state.currentUser,
    userRole: state.userRole,
    files: state.files,
    activePath: state.activePath,
    code: state.code,
    language: state.language,
  }),
}));

export default useEditorStore;


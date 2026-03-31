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
import { executeCode } from '../services/api';

const useEditorStore = create((set, get) => ({

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

  // ---- UI Layout State ----
  terminalActiveTab: 'output', // 'output' | 'timeline' | 'graph'
  isTerminalOpen: false,       // Whether terminal is visible
  terminalHeight: 300,         // Height in pixels
  layoutMode: 'default',       // Fixed to 'default' as split view is removed
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

  detectLanguage: (path) => {
    if (path.endsWith('.java')) return 'java';
    if (path.endsWith('.py')) return 'python';
    if (path.endsWith('.html')) return 'html';
    if (path.endsWith('.css')) return 'css';
    return 'javascript';
  },

  setCode: (code, remote = false) => {
    const { activePath, files } = get();
    set((s) => ({ 
      code,
      files: { ...s.files, [activePath]: code }
    }));
  },

  // Update a specific file from a remote event
  updateRemoteFile: (path, content, userId) => {
    const { activePath } = get();
    set((s) => ({
      files: { ...s.files, [path]: content },
      // If the remote update is for the currently open file, update the editor too
      code: path === activePath ? content : s.code
    }));
    
    if (userId) {
      get().registerRemoteChange(userId, path);
    }
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
      set({
        currentSnapshotIndex: index,
        isReplaying: true,
        code: snapshots[index].code,
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

    // For HTML/CSS files, show the preview tab directly
    const isStaticFile = language === 'html' || language === 'css';

    set({ 
      isRunning: true, 
      isTerminalOpen: true,
      terminalHeight: isStaticFile ? 400 : 280,
      terminalActiveTab: isStaticFile ? 'preview' : 'output',
      layoutMode: 'default',
      error: '' 
    });

    try {
      // For static projects, send ALL files combined so the graph can analyze JS/CSS too
      let codeToSend = code;
      if (isStaticFile && files && Object.keys(files).length > 1) {
        codeToSend = Object.entries(files)
          .map(([path, content]) => `// ── FILE: ${path} ──\n${content}`)
          .join('\n\n');
      }

      const result = await executeCode(sessionId, codeToSend, language);
      get().handleExecutionResult(result);
      // Keep preview tab active for static files
      if (isStaticFile) {
        set({ terminalActiveTab: 'preview' });
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
  toggleTerminal: () => set((s) => ({ isTerminalOpen: !s.isTerminalOpen })),
  setTerminalOpen: (isOpen) => set({ isTerminalOpen: isOpen }),
  setTerminalHeight: (height) => set({ terminalHeight: height }),
  setLayoutMode: (mode) => set({ layoutMode: mode }),

  // ---- Compound Actions ----

  // Called after successful execution
  handleExecutionResult: (result) => {
    set({
      output: result.output || '',
      error: result.error || '',
      isRunning: false,
      rootCause: result.rootCause || null,
      causalityGraph: result.causalityGraph || null,
      // Auto-open terminal on result
      isTerminalOpen: true,
      terminalActiveTab: 'output',
      layoutMode: 'default'
    });
    if (result.snapshot) {
      get().addSnapshot(result.snapshot);
    }
  },

  // Reset entire session state
  resetSession: () => set({
    sessionId: null,
    sessionName: '',
    userRole: null,
    connectedUsers: [],
    remoteCursors: {},
    changeNotifications: [],
    code: '',
    output: '',
    error: '',
    snapshots: [],
    currentSnapshotIndex: -1,
    isReplaying: false,
    rootCause: null,
    causalityGraph: null,
  }),
}));

export default useEditorStore;

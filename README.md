# 🌌 Causify (formerly DebugSync)

> **The Intelligent Collaborative Debugging & Development Environment**

Causify is a modern, real-time collaborative development platform designed to treat debugging as a first-class citizen. By integrating deep impact analysis, execution timelines, and a context-aware output hub, Causify helps teams understand not just *what* code changed, but *why* it matters and what it might break.

---

## ✨ Core Features

### 🛠️ Intelligent Git Assistant (Blueprint HUD)
A high-fidelity, sandboxed Git interface that brings version control directly into the collaborative workflow.
- **Sandboxed Operations**: All Git commands (Clone, Commit, Push, Pull, Log) run in a secure, isolated workspace.
- **Blueprint HUD UI**: A neo-brutalist, high-contrast dashboard for managing repository states and commit history.
- **Auto-Sync**: Seamlessly synchronizes changes between the shared editor database and the Git workspace.

### 🖥️ Intelligent Output Hub
The "Mission Control" for your development session. No more switching between tabs for logs, previews, and server status.
- **Merged View**: Consolidates the Terminal, Live Preview, and Dev Server logs into a single, adaptive interface.
- **Context-Aware Routing**: Automatically detects project types (React, Vite, Node, Static HTML) to display the correct performance HUD.
- **Integrated Terminal**: Full-featured xterm.js terminal for direct execution within the collaborative sandbox.

### 🕸️ Impact Analysis & Causality Graph
Predict the future of your bugs before they happen.
- **Causality Graph**: A visual representation of how your files interact. See the links between HTML elements, CSS selectors, and JS logic in real-time.
- **Impact Engine**: Scans your workspace to detect when a change in one file (e.g., renaming a CSS class) will break references in another file.
- **Proactive Warnings**: Get HUD alerts immediately if a code change is likely to cause a null-pointer or un-styled element.

### 🕒 Execution Timeline
Travel back in time to catch elusive bugs.
- **Automatic Snapshotting**: Captures high-resolution snapshots of your codebase during critical execution points.
- **History Exploration**: Step through the timeline to see how the project evolved and precisely where an error was introduced.
- **Snapshot Diffing**: Compare current code against any point in history to isolate regression.

### 👥 Seamless Collaboration
Code together, anywhere, securely.
- **Real-time Editing**: Powered by WebSockets and Monaco Editor for a low-latency, multi-user coding experience.
- **Protected Sessions**: Share your environment via unique Session IDs with optional password authentication.
- **Presence Tracking**: See where your teammates are and what they are working on in real-time.

---

## 🚀 Tech Stack

- **Frontend**: React, Monaco Editor, Socket.IO, TailwindCSS/Vanilla CSS (Blueprint HUD)
- **Backend**: Java 17+, Spring Boot, WebSocket, MongoDB
- **Engine**: Custom Impact Analyzer (Regex-based AST simulation)
- **Build**: Maven, Vite

---

## 🛠️ Getting Started

### Prerequisites
- Java 21+ (Recommended)
- Node.js 18+
- MongoDB instance

### 1. Setup Backend
```bash
cd backend
mvn spring-boot:run
```

### 2. Setup Frontend
```bash
cd frontend
npm install
npm run dev
```

---

## 📂 Project Structure

```
Causify/
├── backend/          # Spring Boot Core API
│   ├── controller/   # Git, Timeline, & Session Endpoints
│   ├── service/      # Impact Analysis & Project Detection
│   └── model/        # Real-time state management
├── frontend/         # React Modern UI
│   ├── components/   # Graph, Output Hub, & Blueprint HUD
│   └── utils/        # Impact Detection Engine
└── tools/            # Developer automation scripts
```

---

## 📄 License

MIT © 2026 Causify Team

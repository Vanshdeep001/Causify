# Causify (DebugSync)

A real-time collaborative debugging and development environment built with **Spring Boot** and **React**.

## Features

- 🔄 **Real-time Collaboration** — Multiple users can code together in shared sessions via WebSockets
- 🔐 **Password-Protected Sessions** — Secure shared coding sessions with password authentication
- 📁 **Project-Based File Management** — Upload and manage multi-file projects with a built-in file explorer
- 🖥️ **Integrated Terminal** — Execute code and view output directly in the browser
- 🐛 **Error Tracking & Timeline** — Automatic error parsing and execution timeline visualization
- ⚡ **Live Code Sync** — Changes propagate instantly across all connected users

## Tech Stack

| Layer     | Technology                     |
|-----------|--------------------------------|
| Frontend  | React, Monaco Editor, Socket.IO |
| Backend   | Java, Spring Boot, WebSocket   |
| Database  | MongoDB                        |
| Build     | Maven, Vite                    |

## Getting Started

### Prerequisites

- Java 17+
- Node.js 18+
- MongoDB

### Backend

```bash
cd backend
./mvnw spring-boot:run
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Project Structure

```
DebugSync/
├── backend/          # Spring Boot API & WebSocket server
│   └── src/main/java/com/debugsync/
│       ├── config/       # CORS, WebSocket configuration
│       ├── controller/   # REST & WebSocket controllers
│       ├── model/        # Data models (User, Session, ErrorLog)
│       ├── repository/   # MongoDB repositories
│       └── util/         # Utility classes (ErrorParser)
├── frontend/         # React application
│   └── src/
│       ├── components/   # UI components (Editor, Terminal, Sidebar)
│       ├── services/     # API & socket services
│       └── pages/        # Application pages
└── tools/            # Development utilities
```

## License

MIT

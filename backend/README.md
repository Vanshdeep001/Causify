# Causify (DebugSync) — Backend Documentation

A complete, beginner-friendly explanation of what every folder and every file in the backend does, which **OOP concepts** each file uses, how **snapshots get stored in the H2 database**, and how the **Causality Graph** is built purely through code.

---

## 📁 Backend Folder Structure at a Glance

```
backend/src/main/java/com/debugsync/
├── DebugSyncApplication.java      ← Starts the entire application
├── config/                         ← Settings / Configuration
├── controller/                     ← Receives requests from the frontend
├── dto/                            ← Shapes of data sent to / received from frontend
├── model/                          ← Database table definitions
├── repository/                     ← Talks to the database
├── service/                        ← Core business logic (the brain)
├── util/                           ← Helper / utility tools
└── websocket/                      ← Real-time collaboration (live code sync)
```

---

## 🚀 Root File

### `DebugSyncApplication.java`

| Detail | Value |
|--------|-------|
| **What it does** | This is the **starting point** of the entire backend. When you run the project, Java looks for the `main()` method inside this file and boots up the Spring Boot server on port `8080`. |
| **How it works** | `SpringApplication.run(...)` scans all sub-packages (`config`, `controller`, `service`, etc.) and automatically registers everything it finds (controllers, services, repositories). |
| **OOP Concepts** | **Class**, **Static Method** (`main` is a static entry point), **Encapsulation** (Spring internally manages object creation). |

---

## ⚙️ `config/` — Configuration Folder

> **Purpose:** Contains settings that tell the backend *how to behave* — like which websites are allowed to talk to it.

### `CorsConfig.java`

| Detail | Value |
|--------|-------|
| **What it does** | Allows the frontend (running on `http://localhost:5173`) to make API calls to the backend. Without this, the browser would block all requests due to CORS security policy. |
| **How it works** | Implements the `WebMvcConfigurer` **interface** and overrides `addCorsMappings()` to whitelist the frontend URL and allowed HTTP methods (`GET`, `POST`, `PUT`, `DELETE`). |
| **OOP Concepts** | **Interface Implementation** (`implements WebMvcConfigurer`), **Method Overriding** (`@Override addCorsMappings`), **Abstraction** (the interface defines *what* to configure, this class defines *how*). |

---

## 🎮 `controller/` — Controller Folder

> **Purpose:** This folder is the **entry gate** of the backend. Every request that comes from the frontend (when a user clicks a button, runs code, joins a session, etc.) first lands here. Controllers **do NOT** contain any logic — they just receive the request and pass it to the correct service.

### `ExecutionController.java`

| Detail | Value |
|--------|-------|
| **What it does** | Handles the `POST /api/execute` request. When a user clicks **"Run"** in the editor, this controller receives the code and forwards it to `ExecutionService`. |
| **How it works** | Takes an `ExecutionRequest` (code + language + sessionId), calls `executionService.executeCode()`, and returns the result. |
| **OOP Concepts** | **Encapsulation** (the field `executionService` is private), **Constructor Injection / Dependency Injection** (Spring passes `ExecutionService` through the constructor), **Single Responsibility** (only handles execution requests). |

### `RootCauseController.java`

| Detail | Value |
|--------|-------|
| **What it does** | Handles the `POST /api/root-cause` request. When the frontend needs a **standalone root cause analysis** of an error (separate from code execution), it calls this endpoint. |
| **How it works** | Receives the error message, code, and sessionId. Uses `ErrorParser` to extract structured error info, then calls `RootCauseService.analyze()` to find the probable cause, and `CausalityGraphService.buildCausalityGraph()` to build a visual graph. Packages everything into a `RootCauseResponse`. |
| **OOP Concepts** | **Dependency Injection** (two services injected via constructor), **Encapsulation** (private fields), **Composition** (this controller *uses* multiple services together — it doesn't inherit them), **Null Safety Checks** (conditional logic to handle missing data). |

### `SessionController.java`

| Detail | Value |
|--------|-------|
| **What it does** | Manages all **session-related** operations — creating a new session, joining an existing session with a password, uploading project files, and fetching session details. |
| **Endpoints** | `POST /api/session/create` → create session, `POST /api/session/join` → join with password, `POST /api/session/{id}/upload` → upload project files, `GET /api/session/{id}` → get session info. |
| **How it works** | Directly uses `SessionRepository` and `ProjectFileRepository` to save/retrieve data from the H2 database. Generates a random `userId` for each new user joining. |
| **OOP Concepts** | **Dependency Injection** (repositories injected via constructor), **Encapsulation** (private fields), **Generics** (`ResponseEntity<Map<String, String>>`), **Optional Pattern** (`Optional<Session>` used to safely handle "session not found" cases). |

### `TimelineController.java`

| Detail | Value |
|--------|-------|
| **What it does** | Handles the **debug timeline** — the history of all code snapshots in a session. |
| **Endpoints** | `GET /api/timeline/{sessionId}` → get all snapshots for a session, `POST /api/timeline/snapshot` → manually create a new snapshot. |
| **How it works** | Delegates to `TimelineService` which talks to the database. |
| **OOP Concepts** | **Dependency Injection** (constructor injection of `TimelineService`), **Encapsulation**, **Single Responsibility**. |

---

## 📦 `dto/` — Data Transfer Object Folder

> **Purpose:** DTOs define the **shape of data** that travels between the frontend and backend. They are like **envelopes** — they carry information in a specific format. Models represent database tables, but DTOs represent what the API sends/receives.

### `ExecutionRequest.java`

| Detail | Value |
|--------|-------|
| **What it does** | Defines **what the frontend sends** when the user clicks "Run". Contains three fields: `sessionId`, `code`, and `language`. |
| **OOP Concepts** | **Encapsulation** (all fields are `private`, accessed only through getters/setters), **JavaBean Pattern** (no-arg constructor + getters + setters), **Data Hiding**. |

### `ExecutionResponse.java`

| Detail | Value |
|--------|-------|
| **What it does** | This is the **big response** sent back after code execution. Contains: `output` (console result), `error` (if any), `executionTimeMs`, `snapshot` (the saved code version), `rootCause` (analysis if error), and `causalityGraph` (visual graph data). |
| **Inner Classes** | Contains **5 static nested classes**: `SnapshotData`, `RootCauseData`, `StepData`, `CausalityGraphData`, `GraphNode`, `GraphEdge`. |
| **OOP Concepts** | **Encapsulation** (private fields, public getters/setters), **Nested/Inner Classes** (static inner classes like `RootCauseData`, `GraphNode` live inside `ExecutionResponse` — this keeps related data together), **Composition** (the main class *contains* objects of its inner classes), **Constructor Overloading** (`StepData` has both no-arg and parameterized constructors). |

### `RootCauseResponse.java`

| Detail | Value |
|--------|-------|
| **What it does** | Defines the response for the **standalone** `/api/root-cause` endpoint. Similar to `ExecutionResponse.RootCauseData` but also includes the `causalityGraph`. |
| **OOP Concepts** | **Encapsulation**, **Reuse via Composition** (uses `ExecutionResponse.StepData` and `ExecutionResponse.CausalityGraphData` instead of duplicating those classes — reuses nested classes from another DTO). |

---

## 🗄️ `model/` — Model Folder (Database Tables)

> **Purpose:** Each file here represents a **table in the H2 database**. These are called **Entity classes**. When Spring starts, it reads these classes and automatically creates the corresponding tables in the database (because of `ddl-auto: update` in the config).

### `Session.java`

| Detail | Value |
|--------|-------|
| **What it does** | Represents the `sessions` table. A session is a **shared workspace** where users collaborate. Stores: `id`, `name`, `password`, `currentCode`, `createdAt`. |
| **How H2 stores it** | Spring sees `@Entity` and `@Table(name = "sessions")` and creates a `SESSIONS` table with columns matching each field. The `@Id` + `@GeneratedValue(strategy = UUID)` means the ID is auto-generated as a unique string. |
| **OOP Concepts** | **Encapsulation** (private fields, public getters/setters), **Annotations as Metadata** (`@Entity`, `@Table`, `@Id`, `@Column`), **Lifecycle Hooks** (`@PrePersist` — the `onCreate()` method runs *automatically* right before the object is saved to the database, setting `createdAt` to the current time), **Constructor Overloading** (no-arg + parameterized). |

### `CodeSnapshot.java` ⭐ (Snapshot Storage — Key File)

| Detail | Value |
|--------|-------|
| **What it does** | Represents the `code_snapshots` table. Every time code is executed, a **frozen copy** of the code at that moment is saved as a snapshot. Stores: `id`, `sessionId`, `code`, `userId`, `timestamp`, `diff`, `hasError`. |
| **How H2 stores it** | Same as Session — `@Entity` tells Spring this is a database table. `@Column(columnDefinition = "TEXT")` tells H2 to use a `TEXT` type for `code` and `diff` (since they can be very long). |
| **OOP Concepts** | **Encapsulation**, **Lifecycle Hooks** (`@PrePersist onCreate()`), **Constructor Overloading**, **Annotations**. |

### `ErrorLog.java`

| Detail | Value |
|--------|-------|
| **What it does** | Represents the `error_logs` table. Stores parsed error information: `type` (e.g., TypeError), `message`, `lineNumber`, `involvedVariables`. Linked to an execution via `executionId`. |
| **OOP Concepts** | **Encapsulation**, **Annotations**, **Single Responsibility** (only stores error data). |

### `ExecutionLog.java`

| Detail | Value |
|--------|-------|
| **What it does** | Represents the `execution_logs` table. Records the result of every code run: `snapshotId` (which snapshot it belongs to), `output`, `error`, `timestamp`, `executionTimeMs`. |
| **OOP Concepts** | **Encapsulation**, **Lifecycle Hooks** (`@PrePersist`), **Association** (linked to `CodeSnapshot` via `snapshotId`). |

### `ProjectFile.java`

| Detail | Value |
|--------|-------|
| **What it does** | Represents the `project_files` table. When a user uploads a project (multiple files), each file is stored here with its `sessionId`, `path` (e.g., `src/App.js`), and `content`. |
| **OOP Concepts** | **Encapsulation**, **Lifecycle Hooks** (`@PrePersist` AND `@PreUpdate` — both `onCreate` and `onUpdate` set `lastModified` automatically), **Constructor Overloading**. |

### `User.java`

| Detail | Value |
|--------|-------|
| **What it does** | Represents the `users` table. Stores collaborator info: `username`, `color` (for cursor highlighting), and which `sessionId` they belong to. |
| **OOP Concepts** | **Encapsulation**, **Annotations**. |

---

## 🔌 `repository/` — Repository Folder (Database Access Layer)

> **Purpose:** Repositories are the layer that **directly talks to the database**. Instead of writing SQL queries by hand, we define **interfaces** and Spring automatically generates the SQL behind the scenes. This is called **Spring Data JPA**.

### `SessionRepository.java`

| Detail | Value |
|--------|-------|
| **What it does** | Provides database access for the `Session` model. By extending `JpaRepository<Session, String>`, it automatically gets methods like `save()`, `findById()`, `findAll()`, `delete()`, `existsById()` — no code needed! |
| **OOP Concepts** | **Interface**, **Inheritance** (`extends JpaRepository`), **Generics** (`JpaRepository<Session, String>` means "this repository handles `Session` objects whose ID type is `String`"), **Abstraction** (we define *what* we want, Spring provides *how*), **Interface Segregation Principle** (only session-related methods). |

### `SnapshotRepository.java`

| Detail | Value |
|--------|-------|
| **What it does** | Database access for `CodeSnapshot`. Has two custom methods: `findBySessionIdOrderByTimestampAsc()` (get all snapshots for a session, sorted by time — for the timeline) and `findTopBySessionIdOrderByTimestampDesc()` (get the most recent snapshot). |
| **How Spring generates SQL** | Spring reads the method name and auto-generates the query: `findBySessionIdOrderByTimestampAsc` → `SELECT * FROM code_snapshots WHERE session_id = ? ORDER BY timestamp ASC`. |
| **OOP Concepts** | **Interface**, **Inheritance**, **Generics**, **Abstraction** (method-name-based query derivation — we express intent, Spring writes SQL). |

### `ExecutionRepository.java`

| Detail | Value |
|--------|-------|
| **What it does** | Database access for `ExecutionLog`. Only uses the default inherited methods (`save()`, `findById()`, etc.). |
| **OOP Concepts** | **Interface**, **Inheritance**, **Generics**. |

### `ErrorRepository.java`

| Detail | Value |
|--------|-------|
| **What it does** | Database access for `ErrorLog`. Only uses default inherited methods. |
| **OOP Concepts** | **Interface**, **Inheritance**, **Generics**. |

### `ProjectFileRepository.java`

| Detail | Value |
|--------|-------|
| **What it does** | Database access for `ProjectFile`. Has two custom methods: `findBySessionId()` (get all files in a session) and `findBySessionIdAndPath()` (find a specific file by its path in a session). |
| **OOP Concepts** | **Interface**, **Inheritance**, **Generics**, **Abstraction**. |

---

## 🧠 `service/` — Service Folder (Business Logic)

> **Purpose:** This is the **brain** of the application. Controllers receive requests and pass them here. Services contain the actual **logic** — running code, analyzing errors, building graphs, managing collaboration. Controllers are thin; services are heavy.

### `ExecutionService.java`

| Detail | Value |
|--------|-------|
| **What it does** | The **code execution engine**. When a user clicks "Run", this service: (1) detects the programming language, (2) writes the code to a temp file, (3) runs it as a system process, (4) captures stdout and stderr, (5) creates a snapshot, (6) saves the execution log, (7) if there's an error → triggers root cause analysis + causality graph, (8) if success → builds an execution interaction graph. |
| **How it works (step by step)** | `executeCode()` → `guessLanguage()` (auto-detects Java/Python/JS/HTML) → for Java: writes `.java` file, runs `javac` to compile, then `java` to run → for JS: writes `.js` file, runs `node` → captures output → calls `buildResponse()` which saves snapshot + execution log → if error: calls `ErrorParser.parse()` + `RootCauseService.analyze()` + `CausalityGraphService.buildCausalityGraph()` → if success: calls `CausalityGraphService.buildExecutionGraph()`. |
| **OOP Concepts** | **Dependency Injection** (6 dependencies injected via constructor), **Encapsulation** (all fields private), **Composition** (uses multiple services and repositories together), **Single Responsibility** (only handles code execution), **Method Extraction** (complex logic broken into `executeJava()`, `runProcess()`, `buildResponse()`, `guessLanguage()`, `readStream()` — each does one thing). |

### `RootCauseService.java`

| Detail | Value |
|--------|-------|
| **What it does** | The **root cause analysis engine** — the "brain" of DebugSync. When code has an error, this service runs a **4-step algorithm** to find *why* the error happened and *which variable* most likely caused it. |
| **The 4-Step Algorithm** | **STEP 1 — EXTRACT:** Gets the failing line of code and extracts all variable names from it. **STEP 2 — TRACE:** For each variable, finds where it was last assigned a value in the code. **STEP 3 — MATCH:** Checks if any of those variables were **recently modified** by comparing the current snapshot with the previous snapshot. Also checks if any variable was set to `null`/`undefined`. **STEP 4 — RANK:** Scores each variable based on three factors: (a) Was it recently changed? (+0.4), (b) How close is its assignment to the error line? (up to +0.3), (c) How many times does it appear in the code? (up to +0.3). The highest-scoring variable is declared the **suspected root cause**. |
| **OOP Concepts** | **Dependency Injection**, **Encapsulation**, **Algorithm Design** (the 4-step analysis), **Composition** (uses `SnapshotRepository` and `DiffUtil`), **Method Extraction** (separate methods for each sub-task: `buildPartialResult()`, `generateExplanation()`, `getLineFromCode()`, `countOccurrences()`). |

### `CausalityGraphService.java` ⭐ (Graph Building — Key File)

| Detail | Value |
|--------|-------|
| **What it does** | Builds **two types of graphs** entirely through code (no external graph library): (1) **Error Causality Graph** — shows the cause-effect chain from code change → variable → function → error. (2) **Execution Graph** — shows the structure and flow of successfully-run code. |
| **OOP Concepts** | **Encapsulation**, **Single Responsibility**, **Composition** (builds `CausalityGraphData` from `GraphNode` + `GraphEdge` objects), **Factory-style Methods** (`createNode()`, `createEdge()` — helper methods that create and return objects), **Utility Pattern** (stateless helper methods), **Regex Pattern Matching**. |

*(See the detailed Graph section below for a full explanation of how graphs are built.)*

### `TimelineService.java`

| Detail | Value |
|--------|-------|
| **What it does** | Manages the **debug timeline** — creates snapshots and retrieves them. This is the service that actually **saves snapshots to the H2 database**. |
| **How it works** | `createSnapshot()` creates a new `CodeSnapshot` object, fills in its fields, and calls `snapshotRepository.save()` which triggers Spring Data JPA to run an `INSERT INTO code_snapshots ...` SQL query automatically. `getTimeline()` returns all snapshots ordered by time. |
| **OOP Concepts** | **Dependency Injection**, **Encapsulation**, **Single Responsibility** (only deals with snapshots/timeline). |

### `CollaborationService.java`

| Detail | Value |
|--------|-------|
| **What it does** | Manages the list of **online users** in each session. Tracks who is connected, lets users join and leave. |
| **How it works** | Uses a `ConcurrentHashMap` (thread-safe map) to store a `Set` of users for each session. `addUser()` adds a user to the session's set. `removeUser()` removes them. `getUsers()` returns the current list. |
| **OOP Concepts** | **Encapsulation**, **Thread Safety** (`ConcurrentHashMap` ensures that multiple users joining/leaving at the same time don't cause data corruption), **Composition** (uses `Map` of `Set` of `Map` — complex data structure to store session → users → user details). |

---

## 🔧 `util/` — Utility Folder

> **Purpose:** Contains **helper tools** that are used by multiple services. These are stateless classes with `static` methods — they don't depend on any state or inject anything. Think of them as a **toolbox**.

### `DiffUtil.java`

| Detail | Value |
|--------|-------|
| **What it does** | Compares two versions of code and finds the **differences** (what lines were added, removed, or modified). Also finds which **variables** were changed and where a variable was **last assigned**. |
| **Methods** | `computeDiff(oldCode, newCode)` → returns a human-readable diff string (e.g., `+ Line 5: let x = null`). `findModifiedVariables(oldCode, newCode)` → returns a list of variable names that changed between two versions. `findLastAssignment(code, variableName)` → finds the line number where a variable was last assigned a value (searches from bottom to top). |
| **OOP Concepts** | **Utility/Helper Pattern** (all methods are `static` — no object creation needed), **Encapsulation** (`extractAssignedVariable()` is `private` — internal helper), **Pure Functions** (same input always gives same output, no side effects), **Optional Pattern** (`Optional<String>` used to safely return "found or not found"). |

### `ErrorParser.java`

| Detail | Value |
|--------|-------|
| **What it does** | Takes a raw error message string (e.g., `"TypeError: Cannot read properties of undefined"`) and **parses it** into a structured `ErrorLog` object with `type`, `message`, `lineNumber`, and `involvedVariables`. |
| **Methods** | `parse(rawError, code)` → extracts error type + message using regex, finds the line number, and identifies which variables are on that line. `extractVariablesFromLine(line)` → pulls out all variable names from a line of code (ignoring keywords like `let`, `const`, `function`, etc.). `extractLineNumber(errorText)` → uses regex to find line numbers in error stack traces. |
| **OOP Concepts** | **Utility/Helper Pattern** (static methods), **Regex Pattern Matching** (compiled `Pattern` constants for efficiency), **Immutable Constants** (`JS_KEYWORDS` is a `Set.of(...)` — cannot be modified after creation), **Encapsulation**. |

---

## 🌐 `websocket/` — WebSocket Folder

> **Purpose:** Enables **real-time communication** between multiple users in a session. When one user types code, all other users see the change instantly — no page refresh, no repeated API calls. This is powered by **WebSockets** (specifically the **STOMP protocol** over **SockJS**).

### `WebSocketConfig.java`

| Detail | Value |
|--------|-------|
| **What it does** | Configures the WebSocket connection. Sets up: (1) `/topic` prefix for broadcast messages (server → all clients), (2) `/app` prefix for incoming messages (client → server), (3) `/ws` endpoint that clients connect to. |
| **How it works** | Implements `WebSocketMessageBrokerConfigurer` interface. `configureMessageBroker()` sets up an in-memory message broker. `registerStompEndpoints()` registers the `/ws` connection point with SockJS fallback. |
| **OOP Concepts** | **Interface Implementation** (`implements WebSocketMessageBrokerConfigurer`), **Method Overriding**, **Abstraction**. |

### `CollaborationHandler.java`

| Detail | Value |
|--------|-------|
| **What it does** | Handles incoming **WebSocket messages**. Three types: (1) `code` — when a user edits code, broadcast the change to everyone, (2) `join` — when a user joins a session, update the user list and broadcast it, (3) `cursor` — when a user moves their cursor, broadcast the position so others can see it. |
| **How it works** | Methods are annotated with `@MessageMapping` (similar to `@PostMapping` but for WebSocket). When a message arrives at `/app/session/{sessionId}/code`, the `handleCodeChange()` method runs and uses `messagingTemplate.convertAndSend()` to broadcast it to `/topic/session/{sessionId}/code` (all subscribers). |
| **OOP Concepts** | **Dependency Injection** (two services injected), **Encapsulation**, **Observer Pattern** (clients subscribe to topics and get notified when messages are published — the classic pub/sub pattern), **Composition**. |

---

---

## ⭐ How Snapshots Get Stored in the H2 Database

This section explains the **complete flow** of how a code snapshot makes its way from the user's browser into the H2 database.

### The Complete Flow

```
User clicks "Run" in the browser
        ↓
Frontend sends POST /api/execute with { sessionId, code, language }
        ↓
ExecutionController.execute() receives the request
        ↓
ExecutionService.executeCode() is called
        ↓
Code is run as a system process (node/python/javac+java)
        ↓
ExecutionService.buildResponse() is called
        ↓
TimelineService.createSnapshot() is called ← THIS IS WHERE THE SNAPSHOT IS SAVED
        ↓
Inside createSnapshot():
   1. A new CodeSnapshot object is created
   2. Fields are set: sessionId, code, userId, diff, hasError
   3. snapshotRepository.save(snapshot) is called
        ↓
Spring Data JPA sees snapshotRepository.save()
        ↓
JPA generates SQL: INSERT INTO code_snapshots (id, session_id, code, user_id, timestamp, diff, has_error) VALUES (?, ?, ?, ?, ?, ?, ?)
        ↓
@PrePersist runs BEFORE the insert → sets timestamp = LocalDateTime.now()
        ↓
@GeneratedValue(strategy = UUID) generates a unique ID
        ↓
The snapshot is now stored in the H2 database table "code_snapshots"
```

### Key Files Involved

| Step | File | What It Does |
|------|------|-------------|
| 1 | `ExecutionController.java` | Receives the HTTP request |
| 2 | `ExecutionService.java` | Runs the code, then calls `buildResponse()` |
| 3 | `TimelineService.java` | `createSnapshot()` — creates the `CodeSnapshot` object and calls `save()` |
| 4 | `SnapshotRepository.java` | `save()` method (inherited from `JpaRepository`) — triggers the actual SQL insert |
| 5 | `CodeSnapshot.java` | The `@Entity` class — defines which columns exist in the table |
| 6 | `application.yml` | Configures H2: `jdbc:h2:file:./data/debugsync` — stored in a file at `backend/data/debugsync.mv.db` |

### H2 Database Configuration (`application.yml`)

```yaml
datasource:
  url: jdbc:h2:file:./data/debugsync    # File-based H2 (data persists across restarts)
  driver-class-name: org.h2.Driver
  username: sa
  password:                               # No password (dev mode)

jpa:
  hibernate:
    ddl-auto: update                      # Auto-creates/updates tables from @Entity classes
  database-platform: org.hibernate.dialect.H2Dialect

h2:
  console:
    enabled: true                         # Access at http://localhost:8080/h2-console
    path: /h2-console
```

### What `ddl-auto: update` does

When the application starts, Hibernate looks at all `@Entity` classes (`Session`, `CodeSnapshot`, `ErrorLog`, `ExecutionLog`, `ProjectFile`, `User`) and:
- If the table **doesn't exist** → creates it
- If the table **exists but is missing columns** → adds the new columns
- If the table **exists and matches** → does nothing

This is how the `code_snapshots` table (and all other tables) are automatically created without writing any SQL.

---

## ⭐ How the Causality Graph is Built (Purely Through Code)

The graph is built in `CausalityGraphService.java`. There is **no external graph library** — the graph is represented as a simple data structure: a **list of nodes** and a **list of edges** (like a JSON adjacency list). The frontend then renders it visually.

### Graph Data Structure

```java
CausalityGraphData {
    List<GraphNode> nodes;    // Points on the graph
    List<GraphEdge> edges;    // Arrows connecting the points
}

GraphNode { id, type, label, detail }    // e.g., { "n1", "error", "TypeError", "Cannot read..." }
GraphEdge { id, source, target, label }  // e.g., { "n1-n2", "n1", "n2", "throws" }
```

### Type 1: Error Causality Graph (`buildCausalityGraph()`)

When code **fails with an error**, this method builds a reverse chain showing what caused the error.

```
         ┌──────────────┐       ┌──────────────┐       ┌──────────────┐       ┌──────────────┐
         │   CHANGE     │       │   VARIABLE   │       │   FUNCTION   │       │    ERROR     │
         │ Set x = null │──────►│     x        │──────►│  myFunc()    │──────►│  TypeError   │
         │              │modifies│              │used_in│ at line 15   │throws │ Cannot read..|
         └──────────────┘       └──────────────┘       └──────────────┘       └──────────────┘
```

**How it works, step by step:**

1. **Node 1 — CHANGE:** Takes the `suspectedVariable` and `suspectedChange` from the root cause analysis. Creates a node labeled like `"Set x = null"`.
2. **Node 2 — VARIABLE:** Creates a node for the variable that's involved in the error (e.g., `"x"`).
3. **Edge:** Connects CHANGE → VARIABLE with label `"modifies"`.
4. **Node 3 — FUNCTION:** Calls `findFunctionAtLine()` which searches backward from the error line to find the enclosing function name. Creates a node like `"myFunc()"`.
5. **Edge:** Connects VARIABLE → FUNCTION with label `"used_in"`.
6. **Node 4 — ERROR:** Creates a node with the error type and message (e.g., `"TypeError"`, `"Cannot read properties of undefined"`).
7. **Edge:** Connects FUNCTION → ERROR with label `"throws"`.

### Type 2: Execution Graph (`buildExecutionGraph()`)

When code **runs successfully**, this method builds a graph showing the code's structure and flow.

```
                          ┌─────────────┐
               ┌─────────│ Program Entry│──────────┐
               │          │ 45 lines    │          │
               │          └─────────────┘          │
               │               │    │              │
          ┌────▼────┐    ┌─────▼──┐ │        ┌─────▼──────┐
          │ add()   │    │ sub()  │ │        │Console Out │
          │ Line 3  │    │Line 10 │ │        │            │
          └─────────┘    └────────┘ │        └────────────┘
                              ┌─────▼──────┐
                              │✓ Ran OK    │
                              │2 functions │
                              └────────────┘
```

**How it works, step by step:**

1. **Adaptive Detail Level:** First counts real (non-comment) lines. If < 40 lines → "small code" (show more detail). Otherwise → "large code" (show high-level view only). Small code shows up to 6 functions and 4 variables; large code shows up to 3 functions and 0 individual variables.

2. **Entry Point Node:** Looks for `public static void main` (Java) or just creates a "Program Entry" label. Shows total line count.

3. **Function Detection:** Uses **regex** to find function declarations in multiple languages:
   - JavaScript: `function foo()` or `const foo = (...)`
   - Python: `def foo():`
   - Java: `public int foo()`
   
   Each function becomes a node connected to Entry with a `"calls"` edge. If there are more functions than the cap, adds a summary node like `"+5 more functions"`.

4. **Variable Detection (small code only):** Uses regex to find variable declarations (`let x =`, `int x`, etc.). Each becomes a node with a `"declares"` edge from Entry.

5. **Loop Detection (small code only):** Looks for `for`, `while`, `.forEach()`, `.map()`. Creates loop nodes and tries to connect them to their parent function using `findParentFunction()` (which searches backward for the enclosing function).

6. **High-Level Features (always shown):**
   - **HTML UI:** Detects tags like `<input>`, `<form>`, `<button>` etc. and creates a node labeled "HTML UI".
   - **DOM + Events:** Detects `getElementById`, `addEventListener`, `.innerHTML`, etc.
   - **External APIs:** Detects `localStorage`, `fetch()`, `Notification`, `setTimeout`, etc.
   - **Console Output:** Detects `console.log`, `System.out.print`, `print()`, etc.

7. **Function-to-Function Calls:** Checks if any function calls another function (by looking for `functionName(` in the code) and adds `"calls"` edges between them.

8. **Success Node:** Adds a final `"✓ Ran Successfully"` node with a summary like `"2 functions, 45 lines"`.

9. **Edge Deduplication:** Removes duplicate edges (same source → same target) using a `HashSet`.

The final result is a `CausalityGraphData` object containing all nodes and edges, which is serialized to JSON and sent to the frontend for rendering.

---

## 📋 Summary Table — OOP Concepts by File

| File | Encapsulation | Inheritance | Interface | Composition | DI | Polymorphism | Abstraction | Other |
|------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|------|
| `DebugSyncApplication` | ✅ | | | | | | | Static Method |
| `CorsConfig` | | | ✅ | | | ✅ | ✅ | Method Overriding |
| `ExecutionController` | ✅ | | | | ✅ | | | Single Responsibility |
| `RootCauseController` | ✅ | | | ✅ | ✅ | | | |
| `SessionController` | ✅ | | | | ✅ | | | Optional Pattern, Generics |
| `TimelineController` | ✅ | | | | ✅ | | | |
| `ExecutionRequest` | ✅ | | | | | | | JavaBean Pattern |
| `ExecutionResponse` | ✅ | | | ✅ | | | | Nested Classes, Constructor Overloading |
| `RootCauseResponse` | ✅ | | | ✅ | | | | Reuse via Composition |
| `Session` | ✅ | | | | | | | Lifecycle Hooks, Annotations |
| `CodeSnapshot` | ✅ | | | | | | | Lifecycle Hooks, Annotations |
| `ErrorLog` | ✅ | | | | | | | Annotations |
| `ExecutionLog` | ✅ | | | | | | | Lifecycle Hooks |
| `ProjectFile` | ✅ | | | | | | | PrePersist + PreUpdate |
| `User` | ✅ | | | | | | | Annotations |
| `SessionRepository` | | ✅ | ✅ | | | | ✅ | Generics, ISP |
| `SnapshotRepository` | | ✅ | ✅ | | | | ✅ | Query Derivation |
| `ExecutionRepository` | | ✅ | ✅ | | | | ✅ | Generics |
| `ErrorRepository` | | ✅ | ✅ | | | | ✅ | Generics |
| `ProjectFileRepository` | | ✅ | ✅ | | | | ✅ | Generics |
| `ExecutionService` | ✅ | | | ✅ | ✅ | | | Method Extraction |
| `RootCauseService` | ✅ | | | ✅ | ✅ | | | Algorithm Design |
| `CausalityGraphService` | ✅ | | | ✅ | | | | Factory Methods, Regex |
| `TimelineService` | ✅ | | | | ✅ | | | Single Responsibility |
| `CollaborationService` | ✅ | | | ✅ | | | | Thread Safety |
| `DiffUtil` | ✅ | | | | | | | Utility Pattern, Optional |
| `ErrorParser` | ✅ | | | | | | | Utility Pattern, Regex, Immutable Constants |
| `WebSocketConfig` | | | ✅ | | | ✅ | ✅ | Method Overriding |
| `CollaborationHandler` | ✅ | | | ✅ | ✅ | | | Observer/PubSub Pattern |

---

*This documentation covers the complete backend architecture of Causify (DebugSync). Each folder follows the standard Spring Boot layered architecture: Controller → Service → Repository → Model, with DTOs for data transfer, Utils for helper functions, and WebSocket for real-time features.*

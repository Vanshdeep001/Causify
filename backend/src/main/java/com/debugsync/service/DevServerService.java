/*
 * DevServerService.java — Manages long-running dev server processes
 * 
 * Flow: Detect project → Write files to disk → npm install → npm run dev
 *       → capture logs → auto-detect port/URL → report status
 *
 * Each session can have multiple servers (frontend + backend).
 * Processes are managed in a ConcurrentHashMap keyed by "sessionId:type".
 */
package com.debugsync.service;

import com.debugsync.dto.DevServerDto.*;
import com.debugsync.model.ProjectFile;
import com.debugsync.repository.ProjectFileRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import jakarta.annotation.PreDestroy;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.*;

@Service
public class DevServerService {

    private static final Logger log = LoggerFactory.getLogger(DevServerService.class);
    private static final int MAX_LOG_LINES = 200;
    private static final String WORKSPACE_BASE = System.getProperty("java.io.tmpdir") + File.separator + "causify-devservers";

    private final ProjectFileRepository projectFileRepository;
    private final ProjectDetectorService projectDetectorService;
    private final ExecutorService executor = Executors.newCachedThreadPool();

    // Active server processes: key = "sessionId:type"
    private final ConcurrentHashMap<String, ManagedServer> servers = new ConcurrentHashMap<>();

    // Port detection patterns
    private static final Pattern[] PORT_PATTERNS = {
        Pattern.compile("(?:localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0):(\\d+)"),
        Pattern.compile("Local:\\s+https?://[^:]+:(\\d+)"),
        Pattern.compile("running (?:on|at) (?:port )?:?(\\d+)", Pattern.CASE_INSENSITIVE),
        Pattern.compile("listening (?:on|at) (?:port )?:?(\\d+)", Pattern.CASE_INSENSITIVE),
        Pattern.compile("port\\s+(\\d+)", Pattern.CASE_INSENSITIVE),
        Pattern.compile("Started.*on port (\\d+)", Pattern.CASE_INSENSITIVE)
    };

    private static final Pattern URL_PATTERN = Pattern.compile("(https?://(?:localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0):\\d+/?\\S*)");

    public DevServerService(ProjectFileRepository projectFileRepository,
                            ProjectDetectorService projectDetectorService) {
        this.projectFileRepository = projectFileRepository;
        this.projectDetectorService = projectDetectorService;
    }

    /**
     * Detect project types for a session.
     */
    public DetectionResult detectProjects(String sessionId) {
        return projectDetectorService.detect(sessionId);
    }

    /**
     * Detect project types by scanning a folder the user opened from disk.
     */
    public DetectionResult detectProjectsAtPath(String projectPath) {
        return projectDetectorService.detectFromDisk(Paths.get(projectPath));
    }

    /**
     * Start a dev server against a folder on disk.
     *
     * Local mode runs the project exactly where it lives, which is both simpler
     * and more correct than the session path: no files are copied, so there is no
     * temp workspace to keep in sync, no node_modules to preserve across restarts,
     * and the dev server sees the same tree the user sees in their own editor.
     *
     * Servers are keyed by the project path here rather than a session id; the
     * client passes that same value to stop/status/logs, so the rest of the API
     * is unchanged.
     */
    public ServerStatus startLocalServer(String projectPath, String directory, String type) {
        String key = serverKey(projectPath, type);

        ManagedServer existing = servers.get(key);
        if (existing != null && existing.isAlive()) {
            log.info("[DevServer] Server {} is already running", key);
            return buildStatus(key, existing);
        }

        Path root = Paths.get(projectPath);
        if (!Files.isDirectory(root)) {
            ServerStatus status = new ServerStatus();
            status.setServerId(key);
            status.setType(type);
            status.setState("ERROR");
            status.setErrorMessage("Project folder no longer exists: " + projectPath);
            return status;
        }

        DetectionResult detection = detectProjectsAtPath(projectPath);
        DetectedProject project = detection.getProjects().stream()
            .filter(p -> p.getType().equals(type) && p.getDirectory().equals(directory))
            .findFirst()
            .orElse(null);

        if (project == null) {
            ServerStatus status = new ServerStatus();
            status.setServerId(key);
            status.setType(type);
            status.setState("ERROR");
            status.setErrorMessage("No " + type + " project detected in directory: " + directory);
            return status;
        }

        ManagedServer server = new ManagedServer();
        server.type = type;
        server.directory = directory;
        server.framework = project.getFramework();
        server.displayName = project.getDisplayName();
        server.defaultPort = project.getDefaultPort();
        server.startCommand = project.getStartCommand();
        server.state = "PREPARING";
        server.logs = Collections.synchronizedList(new ArrayList<>());
        // Run in place — this is what makes the copy-to-temp step unnecessary.
        server.localRoot = directory == null || directory.isEmpty() ? root : root.resolve(directory);

        servers.put(key, server);
        executor.submit(() -> runServerPipeline(null, key, server));

        return buildStatus(key, server);
    }

    /**
     * Start a dev server for a detected project.
     */
    public ServerStatus startServer(String sessionId, String directory, String type) {
        String key = serverKey(sessionId, type);

        // Check if already running
        ManagedServer existing = servers.get(key);
        if (existing != null && existing.isAlive()) {
            log.info("[DevServer] Server {} is already running", key);
            return buildStatus(key, existing);
        }

        // Detect the project first
        DetectionResult detection = detectProjects(sessionId);
        DetectedProject project = detection.getProjects().stream()
            .filter(p -> p.getType().equals(type) && p.getDirectory().equals(directory))
            .findFirst()
            .orElse(null);

        if (project == null) {
            ServerStatus status = new ServerStatus();
            status.setServerId(key);
            status.setType(type);
            status.setState("ERROR");
            status.setErrorMessage("No " + type + " project detected in directory: " + directory);
            return status;
        }

        // Create managed server entry
        ManagedServer server = new ManagedServer();
        server.type = type;
        server.directory = directory;
        server.framework = project.getFramework();
        server.displayName = project.getDisplayName();
        server.defaultPort = project.getDefaultPort();
        server.startCommand = project.getStartCommand();
        server.state = "PREPARING";
        server.logs = Collections.synchronizedList(new ArrayList<>());

        servers.put(key, server);

        // Launch asynchronously
        executor.submit(() -> runServerPipeline(sessionId, key, server));

        return buildStatus(key, server);
    }

    /**
     * Stop a running dev server.
     */
    public ServerStatus stopServer(String sessionId, String type) {
        String key = serverKey(sessionId, type);
        // Remove the entry entirely: this kills the process, clears the accumulated
        // logs from the panel, and prevents dead servers from piling up in the map.
        ManagedServer server = servers.remove(key);

        ServerStatus status = new ServerStatus();
        status.setServerId(key);
        status.setType(type);
        status.setState("IDLE");
        status.setRecentLogs(new ArrayList<>());

        if (server != null) {
            if (server.process != null && server.process.isAlive()) {
                server.process.descendants().forEach(ProcessHandle::destroy);
                server.process.destroyForcibly();
            }
            // Preserve enough metadata for the panel to still render the card.
            status.setDirectory(server.directory);
            status.setFramework(server.framework);
            status.setDisplayName(server.displayName);
            status.setPort(server.defaultPort);
            status.setUrl("http://localhost:" + server.defaultPort);
        }

        return status;
    }

    /**
     * Get status of all servers for a session.
     */
    public AllServersStatus getStatus(String sessionId) {
        AllServersStatus result = new AllServersStatus();
        Map<String, ServerStatus> statusMap = new HashMap<>();

        servers.forEach((key, server) -> {
            if (key.startsWith(sessionId + ":")) {
                statusMap.put(server.type, buildStatus(key, server));
            }
        });

        result.setServers(statusMap);
        return result;
    }

    /**
     * Get logs for a specific server.
     */
    public List<String> getLogs(String sessionId, String type) {
        String key = serverKey(sessionId, type);
        ManagedServer server = servers.get(key);
        if (server == null) return Collections.emptyList();
        return new ArrayList<>(server.logs);
    }

    // ════════════════════════════════════════════════════════════
    //  Restart-and-watch — used by the auto-fix agent to verify a patch
    //
    //  A server cannot be proven by running one file, only by booting it. These
    //  three give the agent exactly that and nothing more: what is running, put
    //  it through a restart, and wait for it to settle either way.
    // ════════════════════════════════════════════════════════════

    /** Enough about a running server to put it back after stopping it. */
    public static class ServerHandle {
        private final String type;
        private final String directory;
        private final Path localRoot;
        private final String state;

        ServerHandle(String type, String directory, Path localRoot, String state) {
            this.type = type;
            this.directory = directory;
            this.localRoot = localRoot;
            this.state = state;
        }

        public String getType() { return type; }
        public String getDirectory() { return directory; }
        /** Set only for a server running in place in the user's own folder. */
        public Path getLocalRoot() { return localRoot; }
        public String getState() { return state; }
        public boolean isLocal() { return localRoot != null; }
    }

    /**
     * What is running under this scope and type, or null if nothing is.
     *
     * Worth taking before a stop: {@link #stopServer} removes the entry, taking
     * the directory and framework with it, and those are needed to start it again.
     */
    public ServerHandle handleFor(String scope, String type) {
        ManagedServer server = servers.get(serverKey(scope, type));
        if (server == null) return null;
        return new ServerHandle(server.type, server.directory, server.localRoot, server.state);
    }

    /**
     * Stop a server and start it again on the same directory.
     *
     * Only for servers running in place from a local folder — that is the case
     * the agent verifies, and the session-backed path materialises files out of
     * the database, which would undo the candidate patch on the way up.
     *
     * @return false when there was nothing to restart or it is not a local server
     */
    public boolean restartLocalServer(String projectPath, String type) {
        ServerHandle handle = handleFor(projectPath, type);
        if (handle == null || !handle.isLocal()) return false;

        stopServer(projectPath, type);
        startLocalServer(projectPath, handle.getDirectory(), type);
        return true;
    }

    /**
     * Block until the server has either come up or failed, or the wait runs out.
     *
     * PREPARING/INSTALLING/STARTING are all "still deciding". RUNNING and ERROR
     * are verdicts. A timeout is reported as its own answer rather than being
     * folded into failure: a server that is merely slow has not told us anything
     * about the patch, and calling that a failed fix would be a lie.
     *
     * @return the state it settled on, or "TIMEOUT"
     */
    public String awaitSettled(String scope, String type, long timeoutMs) {
        long deadline = System.currentTimeMillis() + timeoutMs;
        String state = "IDLE";

        while (System.currentTimeMillis() < deadline) {
            ManagedServer server = servers.get(serverKey(scope, type));
            if (server == null) return "STOPPED";

            state = server.state;
            if ("RUNNING".equals(state) || "ERROR".equals(state) || "STOPPED".equals(state)) {
                return state;
            }

            try {
                Thread.sleep(250);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return state;
            }
        }
        return "TIMEOUT";
    }

    // ════════════════════════════════════════════════════════════
    //  Pipeline: Write files → npm install → npm run dev
    // ════════════════════════════════════════════════════════════

    private void runServerPipeline(String sessionId, String key, ManagedServer server) {
        try {
            // Step 1: Write files to disk
            server.state = "PREPARING";
            server.addLog("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            server.addLog("🚀 CAUSIFY DEV SERVER — " + server.displayName.toUpperCase());
            server.addLog("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            server.addLog("");
            Path workspaceDir;
            if (server.localRoot != null) {
                // Local mode: the project is already on disk exactly where the user
                // put it. Nothing to write, nothing to keep in sync.
                workspaceDir = toCanonicalPath(server.localRoot);
                server.addLog("📂 Running in your project folder (no copy made)");
                server.addLog("   " + workspaceDir);
                server.addLog("");
            } else {
                server.addLog("📂 Writing project files to workspace...");
                workspaceDir = writeFilesToDisk(sessionId, server.directory);
                server.addLog("✓ Files written to: " + workspaceDir.toString());
                server.addLog("");
            }
            server.workspacePath = workspaceDir;

            // Step 1b: Validate critical files exist
            validateWorkspace(workspaceDir, server);

            // Step 2: Dependencies / Setup
            server.state = "INSTALLING";
            server.addLog("📦 PHASE 1 — SETTING UP ENVIRONMENT");
            server.addLog("─────────────────────────────────────");

            if (!shouldRunSetup(workspaceDir, server.framework)) {
                server.addLog("✓ Dependencies already installed (package.json unchanged) — skipping install.");
                server.addLog("");
            } else {
                String setupCmd = getSetupCommand(server.framework);
                server.addLog("$ " + setupCmd);
                server.addLog("");

                String[] setupParts = setupCmd.split("\\s+");
                boolean setupOk = runCommand(workspaceDir, setupParts[0], Arrays.copyOfRange(setupParts, 1, setupParts.length), server, 600);

                if (!setupOk) {
                    server.state = "ERROR";
                    server.addLog("");
                    server.addLog("✗ Setup failed. Check logs above.");
                    return;
                }

                // Remember what we installed so the next start can skip a no-op install.
                recordSetupHash(workspaceDir);

                server.addLog("");
                server.addLog("✓ Environment ready!");
                server.addLog("");
            }

            // Step 3: Run
            server.state = "STARTING";
            server.addLog("⚡ PHASE 2 — STARTING DEV SERVER");
            server.addLog("─────────────────────────────────");

            String startCmd = server.startCommand;
            // On Windows, launcher scripts need their ".cmd" extension for ProcessBuilder.
            String osName = System.getProperty("os.name", "").toLowerCase();
            if (osName.contains("win")) {
                startCmd = startCmd.replaceFirst("^npm ", "npm.cmd ")
                                   .replaceFirst("^npx ", "npx.cmd ")
                                   .replaceFirst("^mvn ", "mvn.cmd ");
            }

            // Build the argument list, then (for Java/Python backends only) steer the
            // dev server onto a guaranteed-free port so it never collides with
            // DebugSync's own backend (8080) or anything else already listening.
            List<String> startParts = new ArrayList<>(Arrays.asList(startCmd.split("\\s+")));
            startParts = applyBackendPort(server, startParts);

            server.addLog("$ " + String.join(" ", startParts));
            server.addLog("");

            startLongRunningProcess(workspaceDir, server, startParts.toArray(new String[0]));

        } catch (Exception e) {
            log.error("[DevServer] Pipeline failed for {}: {}", key, e.getMessage(), e);
            server.state = "ERROR";
            server.addLog("✗ ERROR: " + e.getMessage());
        }
    }

    /**
     * Validate that the workspace directory has the expected files for the framework.
     */
    private void validateWorkspace(Path workspaceDir, ManagedServer server) {
        server.addLog("🔍 Validating workspace structure...");
        
        // List top-level contents
        try {
            long fileCount = Files.walk(workspaceDir)
                .filter(Files::isRegularFile)
                .count();
            server.addLog("  Total files on disk: " + fileCount);
        } catch (IOException e) {
            server.addLog("  ⚠ Could not count files: " + e.getMessage());
        }

        // Check for critical files
        boolean hasPackageJson = Files.exists(workspaceDir.resolve("package.json"));
        boolean hasIndexHtml = Files.exists(workspaceDir.resolve("index.html"));
        boolean hasSrcDir = Files.isDirectory(workspaceDir.resolve("src"));
        
        server.addLog("  package.json: " + (hasPackageJson ? "✓" : "✗ MISSING"));
        server.addLog("  index.html:   " + (hasIndexHtml ? "✓" : "✗ MISSING"));
        server.addLog("  src/:         " + (hasSrcDir ? "✓" : "✗ MISSING"));

        if (hasSrcDir) {
            // Check for entry point files
            String[] entryFiles = {"main.jsx", "main.tsx", "main.js", "index.jsx", "index.tsx", "index.js", "App.jsx", "App.tsx"};
            boolean foundEntry = false;
            for (String entry : entryFiles) {
                if (Files.exists(workspaceDir.resolve("src").resolve(entry))) {
                    server.addLog("  entry point:  ✓ src/" + entry);
                    foundEntry = true;
                    break;
                }
            }
            if (!foundEntry) {
                server.addLog("  entry point:  ⚠ No standard entry file found in src/");
                // List what's actually in src/
                try {
                    Files.list(workspaceDir.resolve("src"))
                        .limit(10)
                        .forEach(p -> server.addLog("    → " + p.getFileName()));
                } catch (IOException e) {
                    server.addLog("    ⚠ Could not list src/ contents");
                }
            }
        }

        if (!hasPackageJson) {
            server.addLog("");
            server.addLog("⚠ WARNING: package.json is missing from the workspace.");
            server.addLog("  This usually means the project directory was not detected correctly.");
            server.addLog("  Expected workspace: " + workspaceDir);
        }
        
        server.addLog("");
    }


    private String getSetupCommand(String framework) {
        if (framework.startsWith("springboot")) {
            return getMvnCommand() + " dependency:resolve";
        }
        if (framework.equals("django") || framework.equals("python")) {
            return "pip install -r requirements.txt";
        }
        return getNpmCommand() + " install";
    }

    /** The Maven command for the current OS (mvn.cmd on Windows). */
    private String getMvnCommand() {
        String os = System.getProperty("os.name", "").toLowerCase();
        return os.contains("win") ? "mvn.cmd" : "mvn";
    }

    /**
     * For Java/Python backends ONLY, pick a free port up-front and pass it to the
     * dev server through that framework's own standard mechanism, so it never
     * collides with DebugSync's backend (8080) or another running server. Frontend
     * and Node projects are intentionally left untouched — they keep their existing
     * output-parsing behavior. Returns the (possibly extended) command to run.
     */
    private List<String> applyBackendPort(ManagedServer server, List<String> command) {
        String fw = server.framework == null ? "" : server.framework;
        boolean isSpring = fw.startsWith("springboot");
        boolean isDjango = fw.equals("django");
        boolean isPython = fw.equals("python");
        if (!isSpring && !isDjango && !isPython) {
            return command; // not a targeted backend — do nothing
        }

        int startFrom = server.defaultPort > 0 ? server.defaultPort : 8080;
        int port = findFreePort(startFrom);
        server.addLog("  → Using free port " + port + " (avoids conflicts with other servers)");

        List<String> result = command;
        // "Authoritative" means the framework is guaranteed to bind the port we set,
        // so we can report it without parsing output. A generic `python app.py` may
        // ignore the hint, so we only steer it and let output parsing confirm.
        boolean portIsAuthoritative;

        if (isSpring) {
            // Spring Boot: SERVER_PORT maps to server.port via relaxed binding.
            server.extraEnv.put("SERVER_PORT", String.valueOf(port));
            portIsAuthoritative = true;
        } else if (isDjango) {
            // Django's runserver takes the port as a positional argument.
            result = new ArrayList<>(command);
            result.add(String.valueOf(port));
            portIsAuthoritative = true;
        } else { // python
            boolean isFlask = !command.isEmpty() && command.get(0).toLowerCase().contains("flask");
            server.extraEnv.put("PORT", String.valueOf(port)); // common convention, best effort
            if (isFlask) {
                server.extraEnv.put("FLASK_RUN_PORT", String.valueOf(port));
                portIsAuthoritative = true;
            } else {
                portIsAuthoritative = false;
            }
        }

        // Report the chosen port. For authoritative frameworks it's final; for a
        // generic python script it's a provisional fallback that output parsing may
        // refine to the port the script actually printed.
        server.detectedPort = port;
        server.detectedUrl = "http://localhost:" + port;
        if (portIsAuthoritative) {
            server.portConfirmed = true;
        }
        return result;
    }

    /**
     * Find a free TCP port at or after {@code startPort} by attempting to bind it on
     * loopback. Falls back to {@code startPort} if none is found in range (the dev
     * server will then surface its own bind error, as before).
     */
    private int findFreePort(int startPort) {
        for (int port = startPort; port < startPort + 200 && port < 65535; port++) {
            try (java.net.ServerSocket socket = new java.net.ServerSocket()) {
                socket.setReuseAddress(true);
                socket.bind(new java.net.InetSocketAddress("127.0.0.1", port));
                return port;
            } catch (IOException e) {
                // port busy — try the next one
            }
        }
        return startPort;
    }

    /**
     * Decide whether the dependency-install step needs to run. For Node projects we
     * skip it when {@code node_modules} already exists AND {@code package.json} is
     * unchanged since the last install (tracked via a hash marker inside
     * node_modules, so it's preserved/cleared together with the deps). Non-Node
     * frameworks always run their setup (mvn/pip are effectively no-ops when cached).
     */
    private boolean shouldRunSetup(Path workspaceDir, String framework) {
        if (framework.startsWith("springboot") || framework.equals("django") || framework.equals("python")) {
            return true;
        }
        Path nodeModules = workspaceDir.resolve("node_modules");
        if (!Files.isDirectory(nodeModules)) {
            return true; // no dependencies installed yet
        }
        try {
            Path pkg = workspaceDir.resolve("package.json");
            String currentHash = Files.exists(pkg) ? sha256(Files.readAllBytes(pkg)) : "";
            Path marker = nodeModules.resolve(".causify-deps-hash");
            String savedHash = Files.exists(marker) ? Files.readString(marker).trim() : "";
            return !currentHash.equals(savedHash); // reinstall only if package.json changed
        } catch (IOException e) {
            return true; // when in doubt, install
        }
    }

    /** Record the current package.json hash so the next start can skip a no-op install. */
    private void recordSetupHash(Path workspaceDir) {
        try {
            Path pkg = workspaceDir.resolve("package.json");
            Path nodeModules = workspaceDir.resolve("node_modules");
            if (Files.exists(pkg) && Files.isDirectory(nodeModules)) {
                Files.writeString(nodeModules.resolve(".causify-deps-hash"), sha256(Files.readAllBytes(pkg)));
            }
        } catch (Exception ignored) {
            // Best-effort — a missing marker just means we install again next time.
        }
    }

    private String sha256(byte[] data) {
        try {
            byte[] digest = java.security.MessageDigest.getInstance("SHA-256").digest(data);
            StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            return Integer.toHexString(java.util.Arrays.hashCode(data)); // fallback
        }
    }

    /**
     * Write session files to a workspace directory on disk.
     */
    private Path writeFilesToDisk(String sessionId, String projectDir) throws IOException {
        List<ProjectFile> allFiles = projectFileRepository.findBySessionId(sessionId);
        
        // Create workspace
        Path basePath = Paths.get(WORKSPACE_BASE, sessionId);
        Path projectPath = projectDir.isEmpty() ? basePath : basePath.resolve(projectDir);
        
        // Clean existing workspace, but PRESERVE node_modules so we don't have to
        // reinstall dependencies on every restart. Deleting non-node_modules files
        // in reverse (deepest-first) order clears stale source; File::delete is a
        // no-op on directories that still contain the preserved node_modules.
        if (Files.exists(basePath)) {
            Files.walk(basePath)
                .sorted(Comparator.reverseOrder())
                .filter(p -> {
                    String s = p.toString().replace('\\', '/');
                    return !s.contains("/node_modules");
                })
                .map(Path::toFile)
                .forEach(File::delete);
        }

        Files.createDirectories(projectPath);

        int written = 0;
        for (ProjectFile pf : allFiles) {
            String filePath = pf.getPath();
            
            // Skip files outside the project directory
            if (!projectDir.isEmpty() && !filePath.startsWith(projectDir + "/") && !filePath.equals(projectDir)) {
                continue;
            }

            // Remove project dir prefix for relative path
            String relativePath = projectDir.isEmpty() ? filePath : filePath.substring(projectDir.length() + 1);
            
            // Skip node_modules, .git, target, venv, etc.
            if (relativePath.contains("node_modules/") || 
                relativePath.startsWith(".git/") || 
                relativePath.contains("target/") || 
                relativePath.contains("venv/") || 
                relativePath.contains("__pycache__/")) continue;
            
            Path targetFile = projectPath.resolve(relativePath);
            Files.createDirectories(targetFile.getParent());
            String content = pf.getContent() != null ? pf.getContent() : "";
            byte[] binary = decodeDataUrl(content);
            if (binary != null) {
                // Binary asset (image/font) stored as a base64 data URL — write raw bytes
                // so bundlers like Vite can resolve `import logo from './logo.png'`.
                Files.write(targetFile, binary);
            } else {
                Files.writeString(targetFile, content);
            }
            written++;
        }

        // Canonicalize to the real (long-form) path before handing it to the dev
        // server. See toCanonicalPath() for why this matters on Windows.
        Path canonicalProjectPath = toCanonicalPath(projectPath);
        log.info("[DevServer] Wrote {} files to {}", written, canonicalProjectPath);
        return canonicalProjectPath;
    }

    /**
     * Resolve a path to its real (canonical) form.
     *
     * On Windows {@code java.io.tmpdir} is frequently an 8.3 "short" path — e.g.
     * {@code C:\Users\VANSHD~1\AppData\Local\Temp} when the user folder is long or
     * contains spaces ("Vansh Deep Srivastav"). Dev servers such as Vite compute
     * their {@code server.fs.allow} list from the process working directory, but
     * {@code realpath} every file they serve. When the working directory is the
     * short form while the realpath'd request expands to the long form, Vite treats
     * every file as "outside the fs.allow list" and returns HTTP 403 ("403
     * Restricted"). Asset/module requests then receive the 403 HTML page instead of
     * JavaScript, which the browser fails to parse ("Uncaught SyntaxError:
     * Unexpected token '<'").
     *
     * Canonicalizing the working directory to its long form keeps both sides
     * consistent and matches what running the project manually would do.
     */
    private Path toCanonicalPath(Path path) {
        try {
            return path.toRealPath();
        } catch (IOException e) {
            log.warn("[DevServer] Could not canonicalize path {}: {}", path, e.getMessage());
            return path.toAbsolutePath().normalize();
        }
    }

    /**
     * If the stored content is a base64 data URL (e.g. {@code data:image/png;base64,iVBOR...}),
     * decode it back to the original bytes. Binary assets such as images and fonts
     * are imported as data URLs (they are not text), so they must be written to
     * disk as raw bytes — otherwise bundlers like Vite fail to resolve imports such
     * as {@code import logo from './logo.png'}. Returns {@code null} for ordinary
     * text content, which is then written as a string.
     */
    private byte[] decodeDataUrl(String content) {
        if (content == null || !content.startsWith("data:")) return null;
        int marker = content.indexOf(";base64,");
        if (marker < 0) return null;
        String base64 = content.substring(marker + ";base64,".length());
        try {
            // MIME decoder tolerates any stray whitespace/newlines in the payload.
            return Base64.getMimeDecoder().decode(base64);
        } catch (IllegalArgumentException e) {
            log.warn("[DevServer] Failed to decode data URL, writing as text instead: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Run a command and wait for it to complete (used for npm install).
     */
    private boolean runCommand(Path workDir, String cmd, String[] args, ManagedServer server, int timeoutSec) {
        try {
            List<String> fullCmd = new ArrayList<>();
            fullCmd.add(cmd);
            fullCmd.addAll(Arrays.asList(args));
            ProcessBuilder pb = new ProcessBuilder(fullCmd);
            pb.directory(workDir.toFile());
            pb.redirectErrorStream(true);
            
            // Set environment to avoid interactive prompts
            Map<String, String> env = pb.environment();
            env.put("CI", "true");
            env.put("npm_config_yes", "true");

            Process process = pb.start();

            // Read output in a separate thread
            Thread outputReader = new Thread(() -> {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        server.addLog("  " + line);
                    }
                } catch (IOException e) {
                    // Process ended
                }
            });
            outputReader.setDaemon(true);
            outputReader.start();

            boolean finished = process.waitFor(timeoutSec, TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                server.addLog("✗ Command timed out after " + timeoutSec + "s");
                return false;
            }

            return process.exitValue() == 0;

        } catch (Exception e) {
            server.addLog("✗ Command error: " + e.getMessage());
            return false;
        }
    }

    /**
     * Start a long-running dev server process with log streaming.
     */
    private void startLongRunningProcess(Path workDir, ManagedServer server, String[] args) {
        try {
            List<String> command = new ArrayList<>(Arrays.asList(args));

            ProcessBuilder pb = new ProcessBuilder(command);
            pb.directory(workDir.toFile());
            pb.redirectErrorStream(true);

            // Set environment
            Map<String, String> env = pb.environment();
            env.put("CI", "true");
            env.put("BROWSER", "none"); // Prevent auto-opening browser
            env.put("FORCE_COLOR", "0"); // Disable ANSI colors for cleaner logs
            // Framework-specific extras (e.g. SERVER_PORT/FLASK_RUN_PORT for backends).
            if (server.extraEnv != null && !server.extraEnv.isEmpty()) {
                env.putAll(server.extraEnv);
            }

            Process process = pb.start();
            server.process = process;

            // Stream output
            Thread outputReader = new Thread(() -> {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        server.addLog("  " + line);

                        // Keep parsing the server's own output until it reports its
                        // real URL. We must NOT stop at the first non-zero port: the
                        // 3s fallback below may set a provisional default while the
                        // dev server is still scanning past busy ports (5173→5174→
                        // 5175). Only a URL parsed from actual output is authoritative.
                        if (!server.portConfirmed) {
                            detectPortFromLine(line, server);
                        }
                    }
                } catch (IOException e) {
                    // Process ended
                }
                
                if (!"STOPPED".equals(server.state)) {
                    server.state = "STOPPED";
                    server.addLog("");
                    server.addLog("⏹ Server process exited.");
                }
            });
            outputReader.setDaemon(true);
            outputReader.start();

            // Wait for the server to settle. We always wait a minimum time so an
            // immediate crash (compile error, missing dependency) is caught, and up
            // to a longer deadline for a slow server to report its URL. We break
            // early once we've both settled and know the port — parsed from output
            // for frontends, or assigned up-front for Java/Python backends.
            final long MIN_SETTLE_MS = 3000;
            final long DEADLINE_MS = 20000;
            long startedAt = System.currentTimeMillis();
            while (process.isAlive()) {
                long elapsed = System.currentTimeMillis() - startedAt;
                if (elapsed >= DEADLINE_MS) break;
                if (elapsed >= MIN_SETTLE_MS && server.portConfirmed) break;
                Thread.sleep(200);
            }

            if (process.isAlive()) {
                server.state = "RUNNING";
                if (!server.portConfirmed && server.detectedPort == 0) {
                    // Nothing reported a port in time — fall back to the framework default.
                    server.detectedPort = server.defaultPort;
                    server.detectedUrl = "http://localhost:" + server.defaultPort;
                }
                server.addLog("");
                server.addLog("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                server.addLog("✓ SERVER IS RUNNING");
                server.addLog("  URL: " + server.detectedUrl);
                server.addLog("  Port: " + server.detectedPort);
                server.addLog("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            } else {
                server.state = "ERROR";
                server.addLog("✗ Server process exited immediately (code: " + process.exitValue() + ")");
            }

        } catch (Exception e) {
            server.state = "ERROR";
            server.addLog("✗ Failed to start: " + e.getMessage());
        }
    }

    private void detectPortFromLine(String line, ManagedServer server) {
        // Strip ANSI escape codes
        String plainLine = line.replaceAll("\\x1B\\[[;\\d]*m", "");

        // Ignore messages about ports being in use
        if (plainLine.toLowerCase().contains("in use") || plainLine.toLowerCase().contains("trying another")) {
            return;
        }

        // Try URL pattern first (most reliable)
        Matcher urlMatcher = URL_PATTERN.matcher(plainLine);
        if (urlMatcher.find()) {
            server.detectedUrl = urlMatcher.group(1);
            // Extract port from URL
            for (Pattern p : PORT_PATTERNS) {
                Matcher m = p.matcher(server.detectedUrl);
                if (m.find()) {
                    try {
                        server.detectedPort = Integer.parseInt(m.group(1));
                        server.portConfirmed = true;
                        server.addLog("  → Detected: " + server.detectedUrl);
                        return;
                    } catch (NumberFormatException ignored) {}
                }
            }
        }

        // Try port patterns
        for (Pattern p : PORT_PATTERNS) {
            Matcher m = p.matcher(plainLine);
            if (m.find()) {
                try {
                    int port = Integer.parseInt(m.group(1));
                    if (port > 1000 && port < 65536) {
                        server.detectedPort = port;
                        server.detectedUrl = "http://localhost:" + port;
                        server.portConfirmed = true;
                        server.addLog("  → Detected port: " + port);
                        return;
                    }
                } catch (NumberFormatException ignored) {}
            }
        }
    }

    /**
     * Get the npm command for the current OS.
     */
    private String getNpmCommand() {
        String os = System.getProperty("os.name", "").toLowerCase();
        return os.contains("win") ? "npm.cmd" : "npm";
    }

    /**
     * Build a ServerStatus DTO from a ManagedServer.
     */
    private ServerStatus buildStatus(String key, ManagedServer server) {
        ServerStatus status = new ServerStatus();
        status.setServerId(key);
        status.setType(server.type);
        status.setState(server.state);
        status.setDirectory(server.directory);
        status.setPort(server.detectedPort > 0 ? server.detectedPort : server.defaultPort);
        status.setUrl(server.detectedUrl != null ? server.detectedUrl : "http://localhost:" + server.defaultPort);
        status.setFramework(server.framework);
        status.setDisplayName(server.displayName);
        
        // Return last N log lines
        List<String> allLogs = server.logs;
        int size = allLogs.size();
        status.setRecentLogs(size > MAX_LOG_LINES ? 
            new ArrayList<>(allLogs.subList(size - MAX_LOG_LINES, size)) : 
            new ArrayList<>(allLogs));

        return status;
    }

    private String serverKey(String sessionId, String type) {
        return sessionId + ":" + type;
    }

    @PreDestroy
    public void cleanup() {
        log.info("[DevServer] Shutting down all dev servers...");
        servers.forEach((key, server) -> {
            if (server.process != null && server.process.isAlive()) {
                server.process.descendants().forEach(ProcessHandle::destroy);
                server.process.destroyForcibly();
            }
        });
        executor.shutdownNow();
    }

    // ── Inner class: Managed server state ──
    private static class ManagedServer {
        String type;
        String directory;
        String framework;
        String displayName;
        int defaultPort;
        String startCommand;
        volatile String state = "IDLE";
        volatile int detectedPort = 0;
        volatile String detectedUrl = null;
        volatile boolean portConfirmed = false; // true once the port is known (parsed or assigned)
        Map<String, String> extraEnv = new HashMap<>(); // extra process env (e.g. backend SERVER_PORT)
        Path localRoot;           // Local mode: run here directly instead of copying files out
        Process process;
        Path workspacePath;
        List<String> logs = Collections.synchronizedList(new ArrayList<>());

        void addLog(String line) {
            logs.add(line);
            // Trim logs to prevent memory issues
            while (logs.size() > 500) {
                logs.remove(0);
            }
        }

        boolean isAlive() {
            return process != null && process.isAlive();
        }
    }
}

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
        ManagedServer server = servers.get(key);

        if (server == null) {
            ServerStatus status = new ServerStatus();
            status.setServerId(key);
            status.setType(type);
            status.setState("IDLE");
            return status;
        }

        server.addLog("⏹ Stopping server...");
        server.state = "STOPPED";

        if (server.process != null && server.process.isAlive()) {
            server.process.descendants().forEach(ProcessHandle::destroy);
            server.process.destroyForcibly();
            server.addLog("✓ Server process terminated.");
        }

        return buildStatus(key, server);
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
            server.addLog("📂 Writing project files to workspace...");

            Path workspaceDir = writeFilesToDisk(sessionId, server.directory);
            server.workspacePath = workspaceDir;
            server.addLog("✓ Files written to: " + workspaceDir.toString());
            server.addLog("");

            // Step 2: Dependencies / Setup
            server.state = "INSTALLING";
            String setupCmd = getSetupCommand(server.framework);
            server.addLog("📦 PHASE 1 — SETTING UP ENVIRONMENT");
            server.addLog("─────────────────────────────────────");
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

            server.addLog("");
            server.addLog("✓ Environment ready!");
            server.addLog("");

            // Step 3: Run
            server.state = "STARTING";
            server.addLog("⚡ PHASE 2 — STARTING DEV SERVER");
            server.addLog("─────────────────────────────────");

            String startCmd = server.startCommand;
            // On Windows, "npm" must be "npm.cmd" for ProcessBuilder
            String osName = System.getProperty("os.name", "").toLowerCase();
            if (osName.contains("win")) {
                startCmd = startCmd.replaceFirst("^npm ", "npm.cmd ")
                                   .replaceFirst("^npx ", "npx.cmd ");
            }
            server.addLog("$ " + startCmd);
            server.addLog("");

            String[] startParts = startCmd.split("\\s+");
            startLongRunningProcess(workspaceDir, server, startParts);

        } catch (Exception e) {
            log.error("[DevServer] Pipeline failed for {}: {}", key, e.getMessage(), e);
            server.state = "ERROR";
            server.addLog("✗ ERROR: " + e.getMessage());
        }
    }

    private String getSetupCommand(String framework) {
        if (framework.startsWith("springboot")) {
            return "mvn dependency:resolve";
        }
        if (framework.equals("django") || framework.equals("python")) {
            return "pip install -r requirements.txt";
        }
        return getNpmCommand() + " install";
    }

    /**
     * Write session files to a workspace directory on disk.
     */
    private Path writeFilesToDisk(String sessionId, String projectDir) throws IOException {
        List<ProjectFile> allFiles = projectFileRepository.findBySessionId(sessionId);
        
        // Create workspace
        Path basePath = Paths.get(WORKSPACE_BASE, sessionId);
        Path projectPath = projectDir.isEmpty() ? basePath : basePath.resolve(projectDir);
        
        // Clean existing workspace
        if (Files.exists(basePath)) {
            Files.walk(basePath)
                .sorted(Comparator.reverseOrder())
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
            Files.writeString(targetFile, pf.getContent() != null ? pf.getContent() : "");
            written++;
        }

        log.info("[DevServer] Wrote {} files to {}", written, projectPath);
        return projectPath;
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

            Process process = pb.start();
            server.process = process;

            // Stream output
            Thread outputReader = new Thread(() -> {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        server.addLog("  " + line);

                        // Auto-detect port and URL
                        if (server.detectedPort == 0) {
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

            // Wait a bit to check for immediate crash
            Thread.sleep(3000);

            if (process.isAlive()) {
                server.state = "RUNNING";
                if (server.detectedPort == 0) {
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

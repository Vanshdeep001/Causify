/*
 * GitWorkspaceService.java — Sandboxed Git Command Executor
 *
 * Each session gets an isolated workspace folder.
 * SAFETY: command whitelist, input sanitization, process timeouts,
 *         no raw shell access, path traversal prevention.
 *
 * 🔒 Tokens are held in-memory only — NEVER logged or persisted.
 */
package com.debugsync.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.debugsync.model.ProjectFile;
import com.debugsync.repository.ProjectFileRepository;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

@Service
public class GitWorkspaceService {

    private static final Logger log = LoggerFactory.getLogger(GitWorkspaceService.class);

    // ── Safety: Command whitelist ──
    private static final Set<String> ALLOWED_COMMANDS = Set.of(
        "clone", "add", "commit", "push", "pull", "status", "log", "remote"
    );

    // ── Safety: URL validation (HTTPS only, no shell metacharacters) ──
    private static final Pattern REPO_URL_PATTERN = Pattern.compile(
        "^https://[\\w.:@/?=&#%+~-]+\\.git$",
        Pattern.CASE_INSENSITIVE
    );

    // ── Safety: Dangerous characters in commit messages ──
    private static final Pattern SHELL_METACHAR = Pattern.compile("[;&|`$(){}\\[\\]!<>\\\\\"']");

    @Value("${debugsync.git.workspace-root:./git-workspaces}")
    private String workspaceRoot;

    @Value("${debugsync.git.timeout-seconds:30}")
    private int timeoutSeconds;

    // In-memory map of sessionId → repo URL (contains token, NEVER persisted)
    private final ConcurrentHashMap<String, String> sessionRepoUrls = new ConcurrentHashMap<>();

    private final ProjectFileRepository projectFileRepository;

    public GitWorkspaceService(ProjectFileRepository projectFileRepository) {
        this.projectFileRepository = projectFileRepository;
    }

    // ── PUBLIC API ──────────────────────────────────────────

    /**
     * Clone a repository into the session's isolated workspace.
     */
    public Map<String, Object> cloneRepo(String sessionId, String repoUrl) throws Exception {
        validateSessionId(sessionId);
        validateRepoUrl(repoUrl);

        Path workspace = getWorkspacePath(sessionId);

        // If workspace already exists with a repo, destroy it first
        if (Files.exists(workspace)) {
            deleteDirectory(workspace);
        }
        Files.createDirectories(workspace);

        // Store URL in-memory for push/pull (contains token — never log this)
        sessionRepoUrls.put(sessionId, repoUrl);

        // Build a safe URL for logging (strip token)
        String safeUrl = repoUrl.replaceAll("://[^@]+@", "://***@");
        log.info("[GitWorkspace] Cloning repo for session {}: {}", sessionId, safeUrl);

        String[] command = {"git", "clone", repoUrl, "."};
        return executeGitCommand(workspace, command);
    }

    /**
     * Stage all files and commit with sanitized message.
     */
    public Map<String, Object> commitAll(String sessionId, String message) throws Exception {
        return commitAll(sessionId, message, null);
    }

    /**
     * Stage files and commit with sanitized message.
     * If 'files' is null, content is synced from DB.
     * If 'files' is provided, those files are written to workspace directly.
     */
    public Map<String, Object> commitAll(String sessionId, String message, List<Map<String, String>> files) throws Exception {
        validateSessionId(sessionId);
        Path workspace = ensureWorkspaceExists(sessionId);

        // Sync files to workspace before committing
        syncFilesToWorkspace(sessionId, workspace, files);

        // Sanitize commit message
        String safeMessage = sanitizeCommitMessage(message);
        if (safeMessage.isEmpty()) {
            throw new IllegalArgumentException("Commit message cannot be empty after sanitization");
        }

        log.info("[GitWorkspace] Committing for session {}: '{}'", sessionId, safeMessage);

        // Step 1: git add .
        Map<String, Object> addResult = executeGitCommand(workspace, new String[]{"git", "add", "."});
        if (Boolean.FALSE.equals(addResult.get("success"))) {
            return addResult;
        }

        // Step 2: git commit -m "..."
        return executeGitCommand(workspace, new String[]{"git", "commit", "-m", safeMessage});
    }

    /**
     * Push to remote origin.
     */
    public Map<String, Object> push(String sessionId) throws Exception {
        validateSessionId(sessionId);
        Path workspace = ensureWorkspaceExists(sessionId);

        log.info("[GitWorkspace] Pushing for session {}", sessionId);
        return executeGitCommand(workspace, new String[]{"git", "push"});
    }

    /**
     * Pull latest from remote origin.
     */
    public Map<String, Object> pull(String sessionId) throws Exception {
        validateSessionId(sessionId);
        Path workspace = ensureWorkspaceExists(sessionId);

        log.info("[GitWorkspace] Pulling for session {}", sessionId);
        return executeGitCommand(workspace, new String[]{"git", "pull"});
    }

    /**
     * Get the porcelain status of the workspace.
     */
    public Map<String, Object> getStatus(String sessionId) throws Exception {
        return getStatus(sessionId, null);
    }

    /**
     * Get the porcelain status of the workspace, optionally syncing provided files first.
     */
    public Map<String, Object> getStatus(String sessionId, List<Map<String, String>> files) throws Exception {
        validateSessionId(sessionId);
        Path workspace = ensureWorkspaceExists(sessionId);

        // Sync files before checking status so changed files are detected
        syncFilesToWorkspace(sessionId, workspace, files);

        return executeGitCommand(workspace, new String[]{"git", "status", "--porcelain", "-b"});
    }

    /**
     * Get recent commit log.
     */
    public Map<String, Object> getLog(String sessionId, int count) throws Exception {
        validateSessionId(sessionId);
        Path workspace = ensureWorkspaceExists(sessionId);

        int safeCount = Math.max(1, Math.min(count, 50)); // Cap at 50
        return executeGitCommand(workspace, new String[]{"git", "log", "--oneline", "-n", String.valueOf(safeCount)});
    }

    /**
     * Check if a session has a connected repo.
     */
    public boolean isRepoConnected(String sessionId) {
        Path workspace = getWorkspacePath(sessionId);
        return Files.exists(workspace.resolve(".git"));
    }

    /**
     * Disconnect / cleanup a session's workspace.
     */
    public void disconnectRepo(String sessionId) {
        sessionRepoUrls.remove(sessionId);
        Path workspace = getWorkspacePath(sessionId);
        if (Files.exists(workspace)) {
            try {
                deleteDirectory(workspace);
                log.info("[GitWorkspace] Cleaned up workspace for session {}", sessionId);
            } catch (IOException e) {
                log.warn("[GitWorkspace] Failed to clean up workspace for session {}", sessionId, e);
            }
        }
    }

    /**
     * Synchronize files from the database to the Git sandbox.
     */
    private void syncFilesToWorkspace(String sessionId, Path workspace) {
        syncFilesToWorkspace(sessionId, workspace, null);
    }

    /**
     * Synchronize files from provided list OR database to the Git sandbox.
     */
    private void syncFilesToWorkspace(String sessionId, Path workspace, List<Map<String, String>> providedFiles) {
        List<Map<String, String>> filesToSync = new ArrayList<>();

        if (providedFiles != null && !providedFiles.isEmpty()) {
            filesToSync = providedFiles;
        } else {
            List<ProjectFile> dbFiles = projectFileRepository.findBySessionId(sessionId);
            for (ProjectFile pf : dbFiles) {
                Map<String, String> fileMap = new HashMap<>();
                fileMap.put("path", pf.getPath());
                fileMap.put("content", pf.getContent());
                filesToSync.add(fileMap);
            }
        }

        for (Map<String, String> fileData : filesToSync) {
            String pathStr = fileData.get("path");
            String content = fileData.get("content");

            try {
                if (pathStr == null) continue;
                String normalizedPathStr = pathStr.replace("\\", "/");
                Path filePath = workspace.resolve(normalizedPathStr).normalize();
                
                // Path traversal protection
                if (!filePath.startsWith(workspace)) {
                    log.warn("[GitWorkspace] Path traversal attempt in sync: {}", pathStr);
                    continue; 
                }
                
                Files.createDirectories(filePath.getParent());
                Files.writeString(filePath, content != null ? content : "");
            } catch (IOException e) {
                log.error("[GitWorkspace] Failed to sync file to workspace: {}", pathStr, e);
            }
        }
    }

    // ── CORE EXECUTOR ───────────────────────────────────────

    private Map<String, Object> executeGitCommand(Path workDir, String[] command) throws Exception {
        // Safety: Validate the git subcommand is whitelisted
        if (command.length >= 2) {
            String subCommand = command[1];
            if (!ALLOWED_COMMANDS.contains(subCommand)) {
                throw new SecurityException("Git command not allowed: " + subCommand);
            }
        }

        // Safety: Ensure working directory is within our sandbox
        Path resolvedWorkDir = workDir.toAbsolutePath().normalize();
        Path rootPath = Paths.get(workspaceRoot).toAbsolutePath().normalize();
        if (!resolvedWorkDir.startsWith(rootPath)) {
            throw new SecurityException("Path traversal detected — operation blocked");
        }

        // Ensure directory exists
        if (!Files.exists(resolvedWorkDir)) {
            Files.createDirectories(resolvedWorkDir);
        }

        ProcessBuilder pb = new ProcessBuilder(command);
        pb.directory(resolvedWorkDir.toFile());
        pb.redirectErrorStream(true); // Merge stderr into stdout to prevent deadlock

        // Prevent git from asking for credentials interactively
        Map<String, String> env = pb.environment();
        env.put("GIT_TERMINAL_PROMPT", "0");

        Process process = pb.start();

        // Since error stream is merged with input stream, we only read input stream
        String stdout = readStream(process.getInputStream());
        String stderr = "";

        // Safety: Timeout protection
        boolean finished = process.waitFor(timeoutSeconds, TimeUnit.SECONDS);
        if (!finished) {
            process.destroyForcibly();
            log.warn("[GitWorkspace] Process timed out after {}s: {}", timeoutSeconds, String.join(" ", command));
            return Map.of(
                "success", false,
                "output", "",
                "error", "Process timed out after " + timeoutSeconds + " seconds"
            );
        }

        int exitCode = process.exitValue();
        boolean success = exitCode == 0;

        // Filter output to remove any token leakage
        String safeStdout = filterTokens(stdout);
        // stderr is merged into stdout, so safeStderr would be empty.

        Map<String, Object> result = new HashMap<>();
        result.put("success", success);
        result.put("output", safeStdout);
        result.put("error", success ? "" : safeStdout);
        result.put("exitCode", exitCode);

        return result;
    }

    // ── SAFETY VALIDATORS ───────────────────────────────────

    private void validateSessionId(String sessionId) {
        if (sessionId == null || sessionId.isBlank()) {
            throw new IllegalArgumentException("Session ID is required");
        }
        // Only allow alphanumeric + hyphens (standard UUID chars)
        if (!sessionId.matches("^[a-zA-Z0-9-]+$")) {
            throw new SecurityException("Invalid session ID format");
        }
    }

    private void validateRepoUrl(String repoUrl) {
        if (repoUrl == null || repoUrl.isBlank()) {
            throw new IllegalArgumentException("Repository URL is required");
        }
        if (!REPO_URL_PATTERN.matcher(repoUrl).matches()) {
            throw new IllegalArgumentException(
                "Invalid repository URL. Must be HTTPS and end with .git"
            );
        }
        // Extra safety: reject URLs with suspicious patterns
        String lower = repoUrl.toLowerCase();
        if (lower.contains("..") || lower.contains("file://") || lower.contains("ssh://")) {
            throw new SecurityException("Suspicious URL pattern detected");
        }
    }

    private String sanitizeCommitMessage(String message) {
        if (message == null) return "";
        // Remove shell metacharacters
        String sanitized = SHELL_METACHAR.matcher(message).replaceAll("");
        // Limit length to 500 chars
        if (sanitized.length() > 500) {
            sanitized = sanitized.substring(0, 500);
        }
        return sanitized.trim();
    }

    /**
     * Strip any token-like patterns from output to prevent leakage.
     */
    private String filterTokens(String text) {
        if (text == null) return "";
        // Remove anything that looks like a token in URL
        return text.replaceAll("://[^@\\s]+@", "://***@");
    }

    // ── HELPERS ─────────────────────────────────────────────

    private Path getWorkspacePath(String sessionId) {
        return Paths.get(workspaceRoot, sessionId).toAbsolutePath().normalize();
    }

    private Path ensureWorkspaceExists(String sessionId) throws Exception {
        Path workspace = getWorkspacePath(sessionId);
        if (!Files.exists(workspace) || !Files.exists(workspace.resolve(".git"))) {
            throw new IllegalStateException("No repository connected for this session. Clone a repo first.");
        }
        return workspace;
    }

    private String readStream(InputStream inputStream) throws IOException {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream))) {
            String line;
            while ((line = reader.readLine()) != null) sb.append(line).append("\n");
        }
        return sb.toString().trim();
    }

    private void deleteDirectory(Path directory) throws IOException {
        if (Files.exists(directory)) {
            Files.walk(directory)
                .sorted(Comparator.reverseOrder())
                .map(Path::toFile)
                .forEach(File::delete);
        }
    }
}

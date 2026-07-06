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
        "clone", "add", "commit", "push", "pull", "status", "log", "remote",
        "branch", "checkout", "merge", "reset", "config"
    );

    // ── Safety: Branch names — no shell metachars, no leading dash, no ".." ──
    private static final Pattern BRANCH_NAME_PATTERN = Pattern.compile(
        "^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$"
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
        Map<String, Object> cloneResult = executeGitCommand(workspace, command);

        // Session files are written with LF; stop the user's global
        // autocrlf setting from generating phantom line-ending diffs
        // and "LF will be replaced by CRLF" noise in this sandbox.
        if (Boolean.TRUE.equals(cloneResult.get("success"))) {
            executeGitCommand(workspace, new String[]{"git", "config", "core.autocrlf", "false"});
        }
        return cloneResult;
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

        // Self-heal before committing (same rationale as getStatus): never
        // let stale sandbox noise — like line-ending pollution from older
        // syncs — sneak into a commit alongside the user's real changes.
        executeGitCommand(workspace, new String[]{"git", "checkout", "--", "."});

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
     *
     * A conflicting pull must NEVER leave the sandbox mid-merge (a later
     * commit would silently complete the merge with the editor's versions).
     * On conflict the merge is aborted immediately — the workspace returns
     * to its pre-pull state — and the conflicting files are reported so the
     * UI can guide the user through resolving them properly.
     */
    public Map<String, Object> pull(String sessionId) throws Exception {
        validateSessionId(sessionId);
        Path workspace = ensureWorkspaceExists(sessionId);

        log.info("[GitWorkspace] Pulling for session {}", sessionId);

        // The sandbox is a derived artifact: its uncommitted modifications
        // come from editor/DB syncs and always survive in the session itself.
        // Restore tracked files to HEAD first so background sync noise can
        // never block the merge with "local changes would be overwritten".
        executeGitCommand(workspace, new String[]{"git", "checkout", "--", "."});

        // --no-rebase: force merge semantics so newer git doesn't refuse
        // divergent branches outright, and conflicts stay detectable/abortable.
        Map<String, Object> result = executeGitCommand(workspace, new String[]{"git", "pull", "--no-rebase"});

        String output = String.valueOf(result.getOrDefault("output", ""));
        if (Boolean.FALSE.equals(result.get("success")) && output.contains("CONFLICT")) {
            log.info("[GitWorkspace] Pull conflict for session {} — aborting merge", sessionId);
            executeGitCommand(workspace, new String[]{"git", "merge", "--abort"});

            List<String> conflictFiles = new ArrayList<>();
            for (String line : output.split("\n")) {
                int idx = line.indexOf("Merge conflict in ");
                if (idx >= 0) {
                    conflictFiles.add(line.substring(idx + "Merge conflict in ".length()).trim());
                }
            }

            Map<String, Object> res = new HashMap<>();
            res.put("success", false);
            res.put("conflict", true);
            res.put("conflictFiles", conflictFiles);
            res.put("error", "Pull would create merge conflicts — the workspace was left untouched");
            res.put("output", output);
            return res;
        }
        return result;
    }

    /**
     * Undo the most recent commit — ONLY while it hasn't been pushed.
     *
     * Uses `git reset --soft HEAD~1`: every file keeps its exact content;
     * only the commit itself is removed, so the changes return to the
     * working tree. Refuses when the branch isn't ahead of the remote,
     * because rewriting pushed history would break the remote.
     */
    public Map<String, Object> undoLastCommit(String sessionId) throws Exception {
        validateSessionId(sessionId);
        Path workspace = ensureWorkspaceExists(sessionId);

        Map<String, Object> status = executeGitCommand(workspace, new String[]{"git", "status", "--porcelain", "-b"});
        String statusOut = String.valueOf(status.getOrDefault("output", ""));
        if (!statusOut.contains("[ahead")) {
            return Map.of(
                "success", false,
                "error", "Nothing to undo — the last commit is already on the remote"
            );
        }

        log.info("[GitWorkspace] Undoing last (unpushed) commit for session {}", sessionId);
        return executeGitCommand(workspace, new String[]{"git", "reset", "--soft", "HEAD~1"});
    }

    /**
     * List local branches (current one is marked with '*').
     */
    public Map<String, Object> listBranches(String sessionId) throws Exception {
        validateSessionId(sessionId);
        Path workspace = ensureWorkspaceExists(sessionId);

        return executeGitCommand(workspace, new String[]{"git", "branch"});
    }

    /**
     * Switch to a branch; optionally create it first (checkout -b).
     */
    public Map<String, Object> checkoutBranch(String sessionId, String branch, boolean create) throws Exception {
        validateSessionId(sessionId);
        Path workspace = ensureWorkspaceExists(sessionId);

        String safeBranch = validateBranchName(branch);
        log.info("[GitWorkspace] Checkout for session {}: '{}' (create={})", sessionId, safeBranch, create);

        String[] command = create
            ? new String[]{"git", "checkout", "-b", safeBranch}
            : new String[]{"git", "checkout", safeBranch};
        return executeGitCommand(workspace, command);
    }

    private String validateBranchName(String branch) {
        if (branch == null || branch.isBlank()) {
            throw new IllegalArgumentException("Branch name is required");
        }
        String trimmed = branch.trim();
        if (trimmed.contains("..") || !BRANCH_NAME_PATTERN.matcher(trimmed).matches()) {
            throw new IllegalArgumentException(
                "Invalid branch name — use letters, digits, '.', '_', '/', '-' (no leading '-')");
        }
        return trimmed;
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

        // Self-heal: the sandbox is a derived artifact (see pull()) — any
        // difference that didn't come from HEAD or the sync below is stale
        // noise (e.g. files once written with the wrong line endings).
        // Restore tracked files first; the sync re-applies real edits, so
        // the status reflects exactly editor-vs-HEAD.
        executeGitCommand(workspace, new String[]{"git", "checkout", "--", "."});

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

        // Imported sessions wrap every path in the project's root folder
        // (e.g. "My Project/src/app.js") while the cloned repo tracks files
        // from the repository root ("src/app.js"). Syncing wrapped paths
        // would duplicate the whole tree inside the repo — strip the common
        // wrapper segment when every file shares one.
        filesToSync = stripCommonRootFolder(filesToSync);

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
                String newContent = content != null ? content : "";

                // Blindly rewriting every file makes git report the whole
                // tree as modified when the editor and the checkout disagree
                // only on line endings (CRLF vs LF) or the trailing newline.
                // Adapt to the existing file's conventions and skip the write
                // when nothing really changed.
                if (Files.exists(filePath)) {
                    String existing = null;
                    try {
                        existing = Files.readString(filePath);
                    } catch (IOException notText) {
                        // Binary or non-UTF-8 file — sync it as-is below.
                    }
                    if (existing != null) {
                        String adapted = adaptToExistingStyle(newContent, existing);
                        if (!adapted.equals(existing)) {
                            Files.writeString(filePath, adapted);
                        }
                        continue;
                    }
                }

                Files.writeString(filePath, newContent);
            } catch (IOException e) {
                log.error("[GitWorkspace] Failed to sync file to workspace: {}", pathStr, e);
            }
        }
    }

    /**
     * Match synced content to the workspace file's existing line-ending
     * style and trailing-newline convention. Only formatting that git would
     * otherwise flag on EVERY line is normalized — real edits still differ.
     */
    private String adaptToExistingStyle(String content, String existing) {
        boolean crlf = existing.contains("\r\n");
        String eol = crlf ? "\r\n" : "\n";

        String adapted = content.replace("\r\n", "\n");
        if (crlf) adapted = adapted.replace("\n", "\r\n");

        // Trailing-newline drift: editors often drop (or add) the final
        // newline. When that is the ONLY difference, keep the file as-is.
        if (existing.endsWith(eol) && !adapted.endsWith(eol) && existing.equals(adapted + eol)) {
            return existing;
        }
        if (!existing.endsWith(eol) && adapted.endsWith(eol) && adapted.equals(existing + eol)) {
            return existing;
        }
        // A genuinely edited file keeps the checkout's trailing-newline style.
        if (existing.endsWith(eol) && !adapted.endsWith(eol)) {
            adapted += eol;
        }
        return adapted;
    }

    /**
     * If ALL paths share a single top-level folder, return copies with that
     * folder stripped; otherwise return the list unchanged. Any top-level
     * file (no '/') or a second distinct root disables stripping.
     */
    private List<Map<String, String>> stripCommonRootFolder(List<Map<String, String>> files) {
        if (files == null || files.size() < 2) return files;
        String root = null;
        for (Map<String, String> f : files) {
            String p = f.get("path");
            if (p == null) continue;
            String normalized = p.replace("\\", "/");
            int idx = normalized.indexOf('/');
            if (idx <= 0) return files;                 // top-level file → real layout
            String seg = normalized.substring(0, idx);
            if (root == null) root = seg;
            else if (!root.equals(seg)) return files;   // multiple roots → real layout
        }
        if (root == null) return files;

        String prefix = root + "/";
        List<Map<String, String>> stripped = new ArrayList<>();
        for (Map<String, String> f : files) {
            Map<String, String> copy = new HashMap<>(f);
            String p = f.get("path");
            if (p != null) {
                String normalized = p.replace("\\", "/");
                copy.put("path", normalized.startsWith(prefix) ? normalized.substring(prefix.length()) : normalized);
            }
            stripped.add(copy);
        }
        log.info("[GitWorkspace] Stripped wrapper folder '{}' from {} synced paths", root, stripped.size());
        return stripped;
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

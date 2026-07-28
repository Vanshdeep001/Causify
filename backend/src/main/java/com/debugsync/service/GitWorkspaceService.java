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
        // "init" and the plumbing beside it are needed to attach a remote to an
        // opened folder and bring its history in — the local equivalent of cloning.
        "clone", "init", "fetch", "symbolic-ref", "update-ref", "rev-parse",
        "add", "commit", "push", "pull", "status", "log", "remote",
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

    // Folders the user opened in local mode. Git may run in these as well as in
    // the sandbox — see the working-directory check in executeGitCommand.
    private final Set<Path> localRoots = ConcurrentHashMap.newKeySet();

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

        // Cloning wipes the target directory first. That is correct for a
        // disposable session sandbox and catastrophic for a folder the user
        // opened — it would delete their project. What "connect a repository"
        // means for an open folder is attaching a remote to what is already
        // there, so do that instead.
        if (isLocalRepo(sessionId)) {
            return connectLocalRepo(sessionId, repoUrl);
        }

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
     * Attach a remote to a folder the user already has open.
     *
     * The local equivalent of cloning. The folder is initialised as a repository
     * if it is not one yet, and `origin` is pointed at the given URL.
     *
     * The credentials are deliberately stripped from the URL written into
     * `.git/config`: that file lives in the user's own project, often gets
     * committed, and is frequently shared — a token embedded there would leak.
     * The authenticated URL is kept in memory only, and push/pull pass it
     * explicitly for the duration of the command.
     */
    public Map<String, Object> connectLocalRepo(String scope, String repoUrl) throws Exception {
        Path folder = getWorkspacePath(scope);
        if (!Files.isDirectory(folder)) {
            throw new IllegalArgumentException("Project folder not found: " + scope);
        }

        boolean alreadyRepo = Files.exists(folder.resolve(".git"));
        if (!alreadyRepo) {
            log.info("[GitWorkspace] Initialising a repository in the open folder");
            Map<String, Object> init = executeGitCommand(folder, new String[]{"git", "init"});
            if (Boolean.FALSE.equals(init.get("success"))) return init;

            // `git init` still names the first branch "master" on most installs,
            // while GitHub creates "main" — so the panel reported a branch that
            // did not exist on the remote. Set it before anything is committed,
            // while the ref is still unborn and renaming costs nothing.
            executeGitCommand(folder, new String[]{"git", "symbolic-ref", "HEAD", "refs/heads/main"});
        }

        // Remember the authenticated URL for this folder (never logged, never written to disk).
        sessionRepoUrls.put(scope, repoUrl);

        String safeUrl = stripCredentials(repoUrl);
        Map<String, Object> existing = executeGitCommand(folder, new String[]{"git", "remote"});
        boolean hasOrigin = String.valueOf(existing.getOrDefault("output", "")).contains("origin");

        Map<String, Object> result = executeGitCommand(folder, hasOrigin
            ? new String[]{"git", "remote", "set-url", "origin", safeUrl}
            : new String[]{"git", "remote", "add", "origin", safeUrl});

        if (Boolean.FALSE.equals(result.get("success"))) return result;

        /* Bring the remote's history in.
         *
         * Attaching a remote alone left a repository that was empty: no commits,
         * and a branch name invented locally. The panel then truthfully reported
         * "no commit history" about a repository the user had never seen, while
         * their real one sat on GitHub with a full log. Fetching is what makes
         * the two the same repository.
         *
         * The refspec is explicit because the URL is passed inline rather than
         * as a named remote — fetching a bare URL would otherwise land in
         * FETCH_HEAD and leave origin/* unpopulated. */
        Map<String, Object> fetch = executeGitCommand(folder, new String[]{
            "git", "fetch", repoUrl, "+refs/heads/*:refs/remotes/origin/*"
        });
        if (Boolean.FALSE.equals(fetch.get("success"))) {
            result.put("success", false);
            result.put("output", "Connected, but could not read the repository: "
                + String.valueOf(fetch.getOrDefault("output", "")).replace(repoUrl, safeUrl));
            return result;
        }

        String branch = detectRemoteDefaultBranch(folder);
        boolean hasLocalCommits = Boolean.TRUE.equals(
            executeGitCommand(folder, new String[]{"git", "rev-parse", "--verify", "HEAD"}).get("success"));

        String summary;
        if (branch == null) {
            summary = "Connected to " + safeUrl + " — the repository is empty.";
        } else if (hasLocalCommits) {
            // The folder already had its own history. Leave it alone; merging is
            // the user's decision, and pull is right there.
            summary = "Connected to " + safeUrl + ". Use Pull to bring in origin/" + branch + ".";
        } else {
            summary = adoptRemoteBranch(folder, branch, safeUrl);
        }

        log.info("[GitWorkspace] Connected the open folder to {}", safeUrl);
        result.put("success", true);
        result.put("output", summary);
        return result;
    }

    /** The remote's default branch — main, then master, then whatever exists. */
    private String detectRemoteDefaultBranch(Path folder) throws Exception {
        for (String candidate : new String[]{"main", "master"}) {
            Map<String, Object> check = executeGitCommand(folder, new String[]{
                "git", "rev-parse", "--verify", "refs/remotes/origin/" + candidate
            });
            if (Boolean.TRUE.equals(check.get("success"))) return candidate;
        }

        Map<String, Object> all = executeGitCommand(folder, new String[]{"git", "branch", "-r"});
        for (String line : String.valueOf(all.getOrDefault("output", "")).split("\n")) {
            String name = line.trim();
            if (name.isEmpty() || name.contains("->")) continue;
            if (name.startsWith("origin/")) return name.substring("origin/".length());
        }
        return null;
    }

    /**
     * Point a freshly initialised repository at the remote's history.
     *
     * An empty folder gets a real checkout — the same result as cloning. A
     * folder that already holds the user's files gets the history and the branch
     * without touching a single file: their work is not something to overwrite
     * on the strength of a URL they typed. Their files then show up as changes
     * against the remote, which is the truth of the situation.
     */
    private String adoptRemoteBranch(Path folder, String branch, String safeUrl) throws Exception {
        boolean folderIsEmpty;
        try (java.util.stream.Stream<Path> entries = Files.list(folder)) {
            folderIsEmpty = entries.noneMatch(p -> !p.getFileName().toString().equals(".git"));
        }

        if (folderIsEmpty) {
            Map<String, Object> checkout = executeGitCommand(folder, new String[]{
                "git", "checkout", "-B", branch, "refs/remotes/origin/" + branch
            });
            if (Boolean.TRUE.equals(checkout.get("success"))) {
                return "Cloned " + safeUrl + " into this folder (" + branch + ").";
            }
            return "Connected to " + safeUrl + ", but the checkout failed: "
                + checkout.getOrDefault("output", "");
        }

        /* A folder that already holds files but is not a clone of this remote
         * gets the remote recorded and nothing else.
         *
         * Pointing HEAD at the remote's tip here was wrong: without checking the
         * files out, git compares a full repository against a folder that does
         * not contain it and reports every remote file as deleted. That produced
         * a screen of phantom deletions describing nothing the user had done.
         *
         * The history is fetched and available under origin/<branch>; making it
         * this folder's history would require overwriting their files, which is
         * not something to do on the strength of a pasted URL. */
        return "Connected to " + safeUrl + ". This folder is not a working copy of "
            + branch + " — its history is available as origin/" + branch + ". "
            + "To work on that repository, open a clone of it; to publish this "
            + "folder instead, commit and push.";
    }

    /**
     * The remote this repository points at, or null if it has none.
     *
     * For a folder opened from disk this is the authoritative answer, and it is
     * already persistent: git keeps it in .git/config, so a connection survives
     * restarts, upgrades and cleared browser storage without us storing
     * anything. Credentials are stripped before it leaves here.
     */
    public String getRemoteUrl(String scope) throws Exception {
        validateSessionId(scope);
        Path workspace = getWorkspacePath(scope);
        if (!Files.exists(workspace.resolve(".git"))) return null;

        Map<String, Object> result = executeGitCommand(workspace,
            new String[]{"git", "remote", "get-url", "origin"});
        if (Boolean.FALSE.equals(result.get("success"))) return null;

        String url = String.valueOf(result.getOrDefault("output", "")).trim();
        return url.isEmpty() ? null : stripCredentials(url);
    }

    /**
     * Undo a HEAD that connect adopted from the remote.
     *
     * An earlier version of connect pointed HEAD at the remote's tip without
     * checking the files out, so git compared a whole repository against a
     * folder that did not contain it and reported every file as deleted.
     * Removing that branch ref puts the repository back to "no commits yet",
     * and the folder's files go back to being untracked — which is what they
     * actually are.
     *
     * Guarded hard: the ref is only removed when everything reachable from HEAD
     * also exists on the remote. The moment the user has a commit of their own,
     * HEAD is theirs and nothing here touches it.
     */
    private void detachAdoptedHead(Path folder) throws Exception {
        Map<String, Object> head = executeGitCommand(folder,
            new String[]{"git", "rev-parse", "--verify", "HEAD"});
        if (Boolean.FALSE.equals(head.get("success"))) return; // already unborn

        String sha = String.valueOf(head.getOrDefault("output", "")).trim();
        if (sha.isEmpty()) return;

        // Is this commit present on a remote branch? If so, nothing local is lost.
        Map<String, Object> containing = executeGitCommand(folder,
            new String[]{"git", "branch", "-r", "--contains", sha});
        boolean onlyFromRemote = Boolean.TRUE.equals(containing.get("success"))
            && !String.valueOf(containing.getOrDefault("output", "")).trim().isEmpty();

        if (!onlyFromRemote) {
            log.info("[GitWorkspace] HEAD has local commits — leaving it alone");
            return;
        }

        Map<String, Object> branch = executeGitCommand(folder,
            new String[]{"git", "symbolic-ref", "--short", "HEAD"});
        String name = String.valueOf(branch.getOrDefault("output", "")).trim();
        if (name.isEmpty()) return;

        executeGitCommand(folder, new String[]{"git", "update-ref", "-d", "refs/heads/" + name});

        // The index still holds the adopted tree, so the same files would keep
        // reporting as staged deletions. With HEAD now unborn, a plain reset
        // empties it — and touches no file on disk.
        executeGitCommand(folder, new String[]{"git", "reset"});

        log.info("[GitWorkspace] Cleared an adopted HEAD; the folder's files are untracked again");
    }

    /** Remove any user:token@ portion from a URL so it is safe to store or show. */
    private String stripCredentials(String url) {
        return url == null ? null : url.replaceAll("://[^@/]+@", "://");
    }

    /**
     * How push/pull should refer to the remote.
     *
     * A session sandbox cloned with credentials in the URL can just say "origin".
     * A local repository's origin is deliberately credential-free, so the
     * authenticated URL held in memory is passed explicitly instead.
     */
    private String remoteRefFor(String scope) {
        String stored = sessionRepoUrls.get(scope);
        return (isLocalRepo(scope) && stored != null) ? stored : "origin";
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

        // Session sandboxes need two things that local mode must never do:
        //
        //   `git checkout -- .` discards every uncommitted change. In a sandbox
        //   that only clears line-ending noise, because the real content is
        //   re-synced immediately afterwards. Against the user's own repository
        //   it would destroy their working tree.
        //
        //   syncFilesToWorkspace writes the session's files over the checkout.
        //   In local mode the files already are the working tree.
        if (!isLocalRepo(sessionId)) {
            executeGitCommand(workspace, new String[]{"git", "checkout", "--", "."});
            syncFilesToWorkspace(sessionId, workspace, files);
        }

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

        // "HEAD" pushes the current branch to a branch of the same name, which is
        // what is needed when the remote is given explicitly and there may be no
        // upstream configured yet (a folder that was just initialised).
        String remote = remoteRefFor(sessionId);
        return "origin".equals(remote)
            ? executeGitCommand(workspace, new String[]{"git", "push"})
            : executeGitCommand(workspace, new String[]{"git", "push", "-u", remote, "HEAD"});
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
        // A real repository is not derived — discarding the user's uncommitted
        // work here would be unrecoverable, so let git refuse the pull instead.
        if (!isLocalRepo(sessionId)) {
            executeGitCommand(workspace, new String[]{"git", "checkout", "--", "."});
        }

        // --no-rebase: force merge semantics so newer git doesn't refuse
        // divergent branches outright, and conflicts stay detectable/abortable.
        // As with push: a local repository's origin carries no credentials, so
        // the authenticated URL held in memory is supplied for this command only.
        String remote = remoteRefFor(sessionId);
        Map<String, Object> result = "origin".equals(remote)
            ? executeGitCommand(workspace, new String[]{"git", "pull", "--no-rebase"})
            : executeGitCommand(workspace, new String[]{"git", "pull", "--no-rebase", remote});

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
        //
        // Local mode needs neither step: the working tree IS the user's files,
        // so git already reports exactly the right thing — and the checkout
        // would wipe the very changes we are being asked to report.
        if (!isLocalRepo(sessionId)) {
            executeGitCommand(workspace, new String[]{"git", "checkout", "--", "."});
            syncFilesToWorkspace(sessionId, workspace, files);
        }

        // "-uall" lists untracked files individually instead of collapsing a whole
        // directory into one entry ending in "/". Without it, a new folder counts
        // as a single change no matter how many files it holds, so the reported
        // total is wrong. Files matched by .gitignore are still excluded.
        Map<String, Object> result =
            executeGitCommand(workspace, new String[]{"git", "status", "--porcelain", "-b", "-uall"});

        return capStatusOutput(result);
    }

    /** Upper bound on status lines sent to the client. */
    private static final int MAX_STATUS_LINES = 2000;

    /**
     * Keep a status response to a sane size.
     *
     * A project without a .gitignore can have tens of thousands of untracked
     * files, and shipping all of them would bloat the response and stall the UI.
     * The full count is reported separately so the number stays truthful even
     * when the list is trimmed.
     */
    private Map<String, Object> capStatusOutput(Map<String, Object> result) {
        String output = String.valueOf(result.getOrDefault("output", ""));
        if (output.isEmpty()) return result;

        String[] lines = output.split("\n", -1);
        long changeCount = Arrays.stream(lines)
            .filter(l -> !l.isBlank() && !l.startsWith("##"))
            .count();

        result.put("changeCount", changeCount);
        result.put("truncated", lines.length > MAX_STATUS_LINES);

        if (lines.length > MAX_STATUS_LINES) {
            result.put("output", String.join("\n", Arrays.copyOfRange(lines, 0, MAX_STATUS_LINES)));
        }
        return result;
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

        // In local mode the "workspace" is the user's own project folder, so
        // disconnecting must never delete it. It does, however, undo what
        // connecting put there.
        if (isLocalRepo(sessionId)) {
            try {
                Path folder = getWorkspacePath(sessionId);
                if (Files.exists(folder.resolve(".git"))) {
                    // Order matters: the safety check reads refs/remotes/origin/*
                    // to prove HEAD holds nothing local, and removing the remote
                    // deletes those refs. Detach first, or the guard sees no
                    // remote branches and declines to clean up.
                    detachAdoptedHead(folder);
                    executeGitCommand(folder, new String[]{"git", "remote", "remove", "origin"});
                }
            } catch (Exception e) {
                log.warn("[GitWorkspace] Could not fully disconnect local repository: {}", e.getMessage());
            }
            log.info("[GitWorkspace] Disconnected local repository (files left untouched)");
            return;
        }

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

        // Safety: the working directory must be either the session sandbox or a
        // folder the user opened in local mode. Anything else — in particular a
        // path smuggled in through the session id — is refused.
        Path resolvedWorkDir = workDir.toAbsolutePath().normalize();
        Path rootPath = Paths.get(workspaceRoot).toAbsolutePath().normalize();
        boolean inSandbox = resolvedWorkDir.startsWith(rootPath);
        boolean inOpenedFolder = localRoots.stream().anyMatch(resolvedWorkDir::startsWith);
        if (!inSandbox && !inOpenedFolder) {
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

    /**
     * True when the scope is an absolute filesystem path — a folder the user
     * opened in local mode, rather than a session id naming a sandbox.
     */
    private static boolean isLocalRepo(String scope) {
        return scope != null
            && (scope.matches("^[A-Za-z]:[\\\\/].*") || scope.startsWith("/"));
    }

    private void validateSessionId(String sessionId) {
        if (sessionId == null || sessionId.isBlank()) {
            throw new IllegalArgumentException("Session ID is required");
        }
        // Local mode: the value is a real folder, used verbatim as the git working
        // directory and never concatenated onto anything. It must therefore be an
        // existing directory, but the UUID character rules below cannot apply.
        if (isLocalRepo(sessionId)) {
            if (!Files.isDirectory(Paths.get(sessionId))) {
                throw new IllegalArgumentException("Project folder not found: " + sessionId);
            }
            return;
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
        // Local mode operates on the user's own repository, in place.
        if (isLocalRepo(sessionId)) {
            Path folder = Paths.get(sessionId).toAbsolutePath().normalize();
            // Record it as a permitted working directory. Every caller reaches
            // here only after validateSessionId has confirmed the path is an
            // existing directory, so this admits exactly the folders the user
            // opened — and nothing else.
            localRoots.add(folder);
            return folder;
        }
        return Paths.get(workspaceRoot, sessionId).toAbsolutePath().normalize();
    }

    private Path ensureWorkspaceExists(String sessionId) throws Exception {
        Path workspace = getWorkspacePath(sessionId);
        if (!Files.exists(workspace) || !Files.exists(workspace.resolve(".git"))) {
            throw new IllegalStateException(isLocalRepo(sessionId)
                ? "This folder is not a Git repository. Run `git init` in it, or open a folder that already has one."
                : "No repository connected for this session. Clone a repo first.");
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
                .forEach(file -> {
                    if (!file.delete()) {
                        // On Windows, git files inside .git/objects/ are read-only; make writable and retry
                        file.setWritable(true);
                        if (!file.delete()) {
                            log.warn("[GitWorkspace] Failed to delete file/directory: {}", file.getAbsolutePath());
                        }
                    }
                });
        }
    }
}

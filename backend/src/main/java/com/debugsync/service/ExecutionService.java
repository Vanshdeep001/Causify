/*
 * ExecutionService.java — Runs user code and captures results
 * 
 * Flow: Write code → exec process → capture output → create snapshot
 *       → if error: parse → root cause analysis → causality graph
 */
package com.debugsync.service;

import com.debugsync.dto.ExecutionRequest;
import com.debugsync.dto.CommitSuggestionDto;
import com.debugsync.dto.ExecutionResponse;
import com.debugsync.model.*;
import com.debugsync.repository.*;
import com.debugsync.util.DiffUtil;
import com.debugsync.util.ErrorParser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.*;
import java.nio.file.*;
import java.util.Comparator;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class ExecutionService {

    private static final Logger log = LoggerFactory.getLogger(ExecutionService.class);

    /**
     * Resolve a JDK tool — "java", "javac" — to something runnable.
     *
     * The user's own JDK comes first, and that ordering is deliberate. Running
     * someone's code is meant to reproduce what they would get in their own
     * terminal, exactly as it does for gcc, python and node, none of which we
     * ship. Their compiler, their version, their behaviour.
     *
     * The runtime bundled with the desktop app is the fallback, not the
     * default. It exists so the BACKEND always starts — an app that refuses to
     * launch until you install a JDK is our problem, not the user's. It is a
     * trimmed image built for that job: 29 modules, no jdk.localedata among
     * them, so locale-sensitive formatting in user code would quietly differ
     * from a real JDK. Fine as a last resort for someone who has no Java at
     * all; wrong as the thing that runs in front of someone who does.
     */
    /**
     * Find an executable the way a shell would, or return null.
     *
     * Asking first — rather than letting ProcessBuilder throw — is what makes a
     * missing toolchain explainable. The IOException it raises says "The system
     * cannot find the file specified", names a temp path, and mentions nothing
     * about gcc; that message sent someone hunting through their own source for
     * a bug that was never there.
     *
     * Candidates are tried in order, so a language whose command differs by
     * platform ("python3" then "python") resolves to whichever exists.
     */
    private static String resolveTool(String... candidates) {
        boolean windows = System.getProperty("os.name", "").toLowerCase().contains("win");
        // PATHEXT decides what counts as executable on Windows: gcc installs as
        // gcc.exe, but some toolchains ship .cmd or .bat shims.
        String[] exts = windows
                ? new String[] { ".exe", ".cmd", ".bat", "" }
                : new String[] { "" };

        String pathEnv = System.getenv("PATH");
        if (pathEnv == null) return null;

        for (String tool : candidates) {
            for (String dir : pathEnv.split(File.pathSeparator)) {
                if (dir == null || dir.isBlank()) continue;
                for (String ext : exts) {
                    try {
                        Path candidate = Paths.get(dir.trim(), tool + ext);
                        if (Files.isRegularFile(candidate)) return tool;
                    } catch (Exception ignored) {
                        // A malformed PATH entry is not a reason to stop looking.
                    }
                }
            }
        }
        return null;
    }

    /**
     * "You are missing a compiler", said in a way the client can act on.
     *
     * No error string: an error would be rendered as program output and read as
     * the code having failed. The named tool lets the UI explain the situation
     * and point at the installer instead.
     */
    private ExecutionResponse missingToolResponse(String tool, ExecutionRequest request, long startTime) {
        log.info("Execution skipped — {} is not installed on this machine", tool);
        ExecutionResponse response = new ExecutionResponse();
        response.setMissingTool(tool);
        response.setOutput(null);
        response.setError(null);
        response.setExecutionTimeMs(System.currentTimeMillis() - startTime);
        return response;
    }

    private static String jdkTool(String tool) {
        String exe = System.getProperty("os.name", "").toLowerCase().contains("win") ? ".exe" : "";

        // 1. The user's JAVA_HOME.
        String javaHome = System.getenv("JAVA_HOME");
        if (javaHome != null && !javaHome.isBlank()) {
            Path candidate = Paths.get(javaHome, "bin", tool + exe);
            if (Files.isRegularFile(candidate)) return candidate.toString();
        }

        // 2. The user's PATH. Returning the bare name lets the OS resolve it,
        //    which is what a terminal would do.
        String pathEnv = System.getenv("PATH");
        if (pathEnv != null) {
            for (String dir : pathEnv.split(File.pathSeparator)) {
                if (dir.isBlank()) continue;
                try {
                    if (Files.isRegularFile(Paths.get(dir.trim(), tool + exe))) return tool;
                } catch (Exception ignored) {
                    // A malformed PATH entry is not a reason to stop looking.
                }
            }
        }

        // 3. Ours, so "no JDK installed" still runs rather than failing outright.
        String bundled = System.getenv("CAUSIFY_JAVA_HOME");
        if (bundled != null && !bundled.isBlank()) {
            Path candidate = Paths.get(bundled, "bin", tool + exe);
            if (Files.isRegularFile(candidate)) {
                log.debug("No system JDK found — running {} from the bundled runtime", tool);
                return candidate.toString();
            }
        }

        return tool;
    }

    private final SnapshotRepository snapshotRepository;
    private final ExecutionRepository executionRepository;
    private final ErrorRepository errorRepository;
    private final RootCauseService rootCauseService;
    private final CausalityGraphService causalityGraphService;
    private final TimelineService timelineService;
    private final GitAssistantService gitAssistantService;

    public ExecutionService(SnapshotRepository snapshotRepository,
            ExecutionRepository executionRepository,
            ErrorRepository errorRepository,
            RootCauseService rootCauseService,
            CausalityGraphService causalityGraphService,
            TimelineService timelineService,
            GitAssistantService gitAssistantService) {
        this.snapshotRepository = snapshotRepository;
        this.executionRepository = executionRepository;
        this.errorRepository = errorRepository;
        this.rootCauseService = rootCauseService;
        this.causalityGraphService = causalityGraphService;
        this.timelineService = timelineService;
        this.gitAssistantService = gitAssistantService;
    }

    public ExecutionResponse executeCode(ExecutionRequest request) {
        long startTime = System.currentTimeMillis();
        Path tempFile = null;

        try {
            // Step 1: Handle Language Dispatching
            String lang = (request.getLanguage() == null || "javascript".equals(request.getLanguage()))
                    ? guessLanguage(request.getCode())
                    : request.getLanguage().toLowerCase();

            if ("java".equals(lang)) {
                return executeJava(request, startTime);
            }
            if ("c".equals(lang) || "cpp".equals(lang)) {
                return executeC(request, startTime, "cpp".equals(lang));
            }

            // --- Fix for HTML/CSS/React: Prevent crash when "running" static files ---
            boolean isReactCode = request.getCode().contains("import React")
                    || request.getCode().contains("from 'react'") || request.getCode().contains("from \"react\"");
            boolean isStaticLang = "html".equals(lang) || "css".equals(lang) || "react".equals(lang)
                    || "jsx".equals(lang) || "tsx".equals(lang);

            if (isStaticLang || isReactCode) {
                String msg = ("react".equals(lang) || "jsx".equals(lang) || "tsx".equals(lang) || isReactCode)
                        ? "[Causify] React file loaded.\n\n→ This is a UI frontend component, not a backend Node script!\n→ Please use the DEV SERVER tab (🚀) below to run frontend React apps."
                        : String.format("[Causify] Loaded %s file successfully.\nPreview is available in the web view.",
                                lang.toUpperCase());

                return buildResponse(
                        msg,
                        null,
                        request,
                        System.currentTimeMillis() - startTime);
            }

            // Default behavior for other languages (Python, JS)
            String ext = ".js";
            if ("python".equals(lang))
                ext = ".py";

            tempFile = Files.createTempFile("debugsync_", ext);
            Files.writeString(tempFile, request.getCode());

            /* "python3" as well as "python": on macOS and most Linux distros the
               bare name either does not exist or still points at Python 2. */
            String interpreter = "python".equals(lang)
                    ? resolveTool("python3", "python")
                    : resolveTool("node");

            if (interpreter == null) {
                return missingToolResponse("python".equals(lang) ? "python" : "node", request, startTime);
            }

            String[] command = { interpreter, tempFile.toString() };

            return runProcess(command, request, startTime, tempFile);

        } catch (Exception e) {
            log.error("Code execution failed", e);
            ExecutionResponse response = new ExecutionResponse();
            response.setError("Internal error: " + e.getMessage());
            response.setExecutionTimeMs(System.currentTimeMillis() - startTime);
            return response;
        } finally {
            if (tempFile != null) {
                try {
                    Files.deleteIfExists(tempFile);
                } catch (IOException ignored) {
                }
            }
        }
    }

    private ExecutionResponse executeJava(ExecutionRequest request, long startTime) throws Exception {
        Path tempDir = Files.createTempDirectory("debugsync_java_");
        try {
            String mainClass = findMainClass(request.getCode());
            if (mainClass == null)
                mainClass = "Main";

            Path javaFile = tempDir.resolve(mainClass + ".java");
            Files.writeString(javaFile, request.getCode());

            // Compile
            Process compileProcess = new ProcessBuilder(jdkTool("javac"), javaFile.toString()).start();
            String compileError = readStream(compileProcess.getErrorStream());
            int compileCode = compileProcess.waitFor();

            if (compileCode != 0) {
                return buildResponse(null, compileError, request, System.currentTimeMillis() - startTime);
            }

            // Run
            String[] command = { jdkTool("java"), "-cp", tempDir.toString(), mainClass };
            return runProcess(command, request, startTime, null);

        } finally {
            // Cleanup directory
            Files.walk(tempDir)
                    .sorted(Comparator.reverseOrder())
                    .map(Path::toFile)
                    .forEach(File::delete);
        }
    }

    private ExecutionResponse executeC(ExecutionRequest request, long startTime, boolean isCpp) throws Exception {
        Path tempDir = Files.createTempDirectory("debugsync_c_");
        try {
            String ext = isCpp ? ".cpp" : ".c";
            Path srcFile = tempDir.resolve("main" + ext);
            Files.writeString(srcFile, request.getCode());

            Path outFile = tempDir.resolve("main.exe");
            String wanted = isCpp ? "g++" : "gcc";
            String compiler = resolveTool(wanted);

            if (compiler == null) {
                return missingToolResponse(wanted, request, startTime);
            }

            // Compile
            Process compileProcess = new ProcessBuilder(compiler, srcFile.toString(), "-o", outFile.toString()).start();
            String compileError = readStream(compileProcess.getErrorStream());
            int compileCode = compileProcess.waitFor();

            if (compileCode != 0) {
                return buildResponse(null, compileError, request, System.currentTimeMillis() - startTime);
            }

            // Run
            String[] command = { outFile.toString() };
            return runProcess(command, request, startTime, null);

        } finally {
            Files.walk(tempDir)
                    .sorted(Comparator.reverseOrder())
                    .map(Path::toFile)
                    .forEach(File::delete);
        }
    }

    private String findMainClass(String code) {
        int mainIndex = code.indexOf("public static void main");
        if (mainIndex == -1)
            return null;

        String beforeMain = code.substring(0, mainIndex);
        Pattern classPattern = Pattern.compile("class\\s+(\\w+)");
        Matcher matcher = classPattern.matcher(beforeMain);
        String lastClass = null;
        while (matcher.find()) {
            lastClass = matcher.group(1);
        }
        return lastClass;
    }

    private ExecutionResponse runProcess(String[] command, ExecutionRequest request, long startTime, Path tempFile)
            throws Exception {
        ProcessBuilder pb = new ProcessBuilder(command);
        pb.redirectErrorStream(false);
        Process process = pb.start();

        String stdout = readStream(process.getInputStream());
        String stderr = readStream(process.getErrorStream());

        boolean finished = process.waitFor(10, TimeUnit.SECONDS);
        if (!finished) {
            process.destroyForcibly();
            stderr = "Execution timed out (10 second limit)";
        }

        long executionTime = System.currentTimeMillis() - startTime;
        return buildResponse(stdout, stderr, request, executionTime);
    }

    private ExecutionResponse buildResponse(String stdout, String stderr, ExecutionRequest request,
            long executionTime) {
        // A run outside any session — a folder opened from disk, or an untitled
        // file — has nothing to attach history to, and its timeline is kept on
        // the client instead. Persisting here would fail anyway: a snapshot
        // requires a session id.
        boolean persist = request.getSessionId() != null && !request.getSessionId().isBlank();

        CodeSnapshot lastSnapshot = persist
                ? snapshotRepository.findTopBySessionIdOrderByTimestampDesc(request.getSessionId())
                : null;
        String previousCode = lastSnapshot != null ? lastSnapshot.getCode() : "";
        String diff = DiffUtil.computeDiff(previousCode, request.getCode());
        boolean hasError = stderr != null && !stderr.isEmpty();

        CodeSnapshot snapshot;
        if (persist) {
            snapshot = timelineService.createSnapshot(
                    request.getSessionId(), request.getCode(), "system", diff, hasError);
        } else {
            // Transient — populated only so the response carries the same shape.
            snapshot = new CodeSnapshot();
            snapshot.setId("local-" + java.util.UUID.randomUUID());
            snapshot.setCode(request.getCode());
            snapshot.setUserId("local");
            snapshot.setTimestamp(java.time.LocalDateTime.now());
            snapshot.setDiff(diff);
            snapshot.setHasError(hasError);
        }

        // Save execution log — only meaningful when it can reference a stored
        // snapshot. Stays in scope for the error analysis below, which links a
        // parsed error back to the run that produced it.
        ExecutionLog execLog = null;
        if (persist) {
            execLog = new ExecutionLog();
            execLog.setSnapshotId(snapshot.getId());
            execLog.setOutput(stdout != null ? stdout : "");
            execLog.setError(stderr != null ? stderr : "");
            execLog.setExecutionTimeMs(executionTime);
            executionRepository.save(execLog);
        }

        // Analysis if error
        ExecutionResponse.RootCauseData rootCauseData = null;
        ExecutionResponse.CausalityGraphData graphData = null;

        if (hasError) {
            String lang = (request.getLanguage() == null || "javascript".equals(request.getLanguage()))
                    ? guessLanguage(request.getCode())
                    : request.getLanguage().toLowerCase();
            ErrorLog parsedError = ErrorParser.parse(stderr, request.getCode(), lang);
            if (parsedError != null) {
                // No execution log for a run outside a session — the error is
                // still parsed and reported, it just has no stored run to link to.
                if (execLog != null) {
                    parsedError.setExecutionId(execLog.getId());
                    errorRepository.save(parsedError);
                }
                rootCauseData = rootCauseService.analyze(parsedError, request.getCode(), request.getSessionId());
                if (rootCauseData != null)
                    graphData = causalityGraphService.buildCausalityGraph(parsedError, rootCauseData,
                            request.getCode());
            }
        } else {
            // Generate interaction graph for successful execution
            graphData = causalityGraphService.buildExecutionGraph(request.getCode());
        }

        // Build response
        ExecutionResponse response = new ExecutionResponse();
        response.setOutput(stdout != null ? stdout : "");
        response.setError(stderr == null || stderr.isEmpty() ? null : stderr);
        response.setExecutionTimeMs(executionTime);

        ExecutionResponse.SnapshotData snapData = new ExecutionResponse.SnapshotData();
        snapData.setId(snapshot.getId());
        snapData.setCode(snapshot.getCode());
        snapData.setUserId(snapshot.getUserId());
        snapData.setTimestamp(snapshot.getTimestamp().toString());
        snapData.setDiff(diff);
        snapData.setHasError(hasError);
        response.setSnapshot(snapData);

        response.setRootCause(rootCauseData);
        response.setCausalityGraph(graphData);

        // Git Assistant Analysis
        ExecutionLog prevExecutionLog = null;
        if (lastSnapshot != null) {
            prevExecutionLog = executionRepository.findBySnapshotId(lastSnapshot.getId());
        }

        String lang = (request.getLanguage() == null) ? "javascript" : request.getLanguage().toLowerCase();
        CommitSuggestionDto suggestion = gitAssistantService.analyze(lastSnapshot, prevExecutionLog, request.getCode(),
                hasError, diff, lang);

        if (suggestion != null) {
            response.setCommitSuggestion(suggestion);
            snapData.setSuggestion(suggestion);

            // Serialize to JSON and save to snapshot entity for persistence
            try {
                com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
                String suggestionJson = mapper.writeValueAsString(suggestion);
                snapshot.setSuggestionJson(suggestionJson);
                // Only a stored snapshot can be updated; a local run's is transient.
                if (persist) snapshotRepository.save(snapshot);
            } catch (Exception e) {
                log.warn("Failed to serialize commit suggestion", e);
            }
        }

        return response;
    }

    /* ─────────────────────────────────────────────────────────
     * Dry run — execute code without recording anything
     *
     * The auto-fix agent has to run a candidate patch to find out whether it
     * actually works. executeCode() is the wrong tool for that: every call
     * writes a snapshot, an execution log and a parsed error row, and pays for
     * a full AI root-cause analysis. An agent making three attempts would
     * bury the user's real timeline under six entries they never asked for.
     *
     * This path compiles and runs exactly like the real one — same commands,
     * same 10s ceiling — and returns only what the agent needs to judge the
     * attempt: stdout and stderr.
     * ───────────────────────────────────────────────────────── */

    /** Raw result of a verification run: no snapshot, no analysis, just output. */
    public static class DryRunResult {
        private final String stdout;
        private final String stderr;
        private final boolean toolchainMissing;

        public DryRunResult(String stdout, String stderr) {
            this(stdout, stderr, false);
        }

        private DryRunResult(String stdout, String stderr, boolean toolchainMissing) {
            this.stdout = stdout == null ? "" : stdout;
            this.stderr = stderr == null ? "" : stderr;
            this.toolchainMissing = toolchainMissing;
        }

        /**
         * The compiler or interpreter could not be launched at all.
         *
         * Kept apart from an ordinary failure because it says nothing about the
         * code. Without the distinction, a machine with no g++ turns every C++
         * patch into "the fix still fails" — three attempts, three rewrites of
         * code that was probably right the first time, and a verdict blaming
         * the patch for a tool that was never installed.
         */
        public static DryRunResult toolchainMissing(String message) {
            return new DryRunResult("", message, true);
        }

        public String getStdout() { return stdout; }
        public String getStderr() { return stderr; }
        public boolean hasError() { return !stderr.isBlank(); }
        public boolean isToolchainMissing() { return toolchainMissing; }
    }

    /**
     * Whether a language can be executed here at all. Static and UI languages
     * (html, css, react) have no runnable form on the backend, so a fix for one
     * can be proposed but never machine-verified.
     */
    public boolean canDryRun(String language, String code) {
        String lang = (language == null || "javascript".equals(language)) ? guessLanguage(code) : language.toLowerCase();
        if ("html".equals(lang) || "css".equals(lang) || "react".equals(lang)
                || "jsx".equals(lang) || "tsx".equals(lang)) {
            return false;
        }
        boolean isReactCode = code != null && (code.contains("import React")
                || code.contains("from 'react'") || code.contains("from \"react\""));
        return !isReactCode;
    }

    /** Compile and run {@code code}, returning its raw output. Never throws. */
    public DryRunResult dryRun(String code, String language) {
        String lang = (language == null || "javascript".equals(language)) ? guessLanguage(code) : language.toLowerCase();
        try {
            if ("java".equals(lang)) return dryRunJava(code);
            if ("c".equals(lang) || "cpp".equals(lang)) return dryRunC(code, "cpp".equals(lang));
            return dryRunScript(code, "python".equals(lang));
        } catch (Exception e) {
            log.warn("Dry run failed to start: {}", e.getMessage());
            return DryRunResult.toolchainMissing(missingToolMessage(e));
        }
    }

    /**
     * Name the tool that is not there.
     *
     * The JDK phrases this as {@code Cannot run program "g++": CreateProcess
     * error=2}, which is precise and unreadable. Pulling the program name out
     * turns it into something the user can act on — and when the shape does not
     * match, the original text is passed through rather than replaced by a
     * guess.
     */
    private String missingToolMessage(Exception e) {
        String raw = e.getMessage() == null ? "" : e.getMessage();
        java.util.regex.Matcher m =
                java.util.regex.Pattern.compile("Cannot run program \"([^\"]+)\"").matcher(raw);
        if (m.find()) {
            return m.group(1) + " isn't installed on this machine, so the patched code "
                    + "could not be run here.";
        }
        return "The patched code could not be run on this machine: " + raw;
    }

    private DryRunResult dryRunScript(String code, boolean isPython) throws Exception {
        Path tempFile = Files.createTempFile("debugsync_fix_", isPython ? ".py" : ".js");
        try {
            Files.writeString(tempFile, code);
            String[] command = isPython
                    ? new String[] { "python", tempFile.toString() }
                    : new String[] { "node", tempFile.toString() };
            return runRaw(command);
        } finally {
            try { Files.deleteIfExists(tempFile); } catch (IOException ignored) { }
        }
    }

    private DryRunResult dryRunJava(String code) throws Exception {
        Path tempDir = Files.createTempDirectory("debugsync_fix_java_");
        try {
            String mainClass = findMainClass(code);
            if (mainClass == null) mainClass = "Main";

            Path javaFile = tempDir.resolve(mainClass + ".java");
            Files.writeString(javaFile, code);

            Process compileProcess = new ProcessBuilder(jdkTool("javac"), javaFile.toString()).start();
            String compileError = readStream(compileProcess.getErrorStream());
            if (compileProcess.waitFor() != 0) {
                return new DryRunResult("", compileError);
            }
            return runRaw(new String[] { jdkTool("java"), "-cp", tempDir.toString(), mainClass });
        } finally {
            deleteTree(tempDir);
        }
    }

    private DryRunResult dryRunC(String code, boolean isCpp) throws Exception {
        Path tempDir = Files.createTempDirectory("debugsync_fix_c_");
        try {
            Path srcFile = tempDir.resolve("main" + (isCpp ? ".cpp" : ".c"));
            Files.writeString(srcFile, code);

            Path outFile = tempDir.resolve("main.exe");
            Process compileProcess = new ProcessBuilder(isCpp ? "g++" : "gcc",
                    srcFile.toString(), "-o", outFile.toString()).start();
            String compileError = readStream(compileProcess.getErrorStream());
            if (compileProcess.waitFor() != 0) {
                return new DryRunResult("", compileError);
            }
            return runRaw(new String[] { outFile.toString() });
        } finally {
            deleteTree(tempDir);
        }
    }

    private DryRunResult runRaw(String[] command) throws Exception {
        Process process = new ProcessBuilder(command).start();
        String stdout = readStream(process.getInputStream());
        String stderr = readStream(process.getErrorStream());

        if (!process.waitFor(10, TimeUnit.SECONDS)) {
            process.destroyForcibly();
            return new DryRunResult(stdout, "Execution timed out (10 second limit)");
        }
        return new DryRunResult(stdout, stderr);
    }

    private void deleteTree(Path dir) {
        try {
            Files.walk(dir)
                    .sorted(Comparator.reverseOrder())
                    .map(Path::toFile)
                    .forEach(File::delete);
        } catch (IOException ignored) {
        }
    }

    private String guessLanguage(String code) {
        if (code == null)
            return "javascript";
        String trimmed = code.trim().toLowerCase();
        if (trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html") || trimmed.startsWith("<head")
                || trimmed.startsWith("<body"))
            return "html";
        if (code.contains("public static void main") || code.contains("System.out.println"))
            return "java";
        if (code.contains("def ") && code.contains(":"))
            return "python";
        if (code.contains("#include <stdio.h>") || code.contains("#include <stdlib.h>")
                || (code.contains("int main(") && code.contains("printf")))
            return "c";
        if (code.contains("#include <iostream>") || code.contains("#include <string>")
                || code.contains("using namespace std") || code.contains("cout") || code.contains("std::"))
            return "cpp";
        if (code.contains("import react") || code.contains("from 'react'") || code.contains("from \"react\"")
                || (code.contains("export default") && code.contains("<div")))
            return "react";
        return "javascript";
    }

    private String readStream(InputStream inputStream) throws IOException {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream))) {
            String line;
            while ((line = reader.readLine()) != null)
                sb.append(line).append("\n");
        }
        return sb.toString().trim();
    }
}

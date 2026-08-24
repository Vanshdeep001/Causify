/*
 * ProjectVerifier.java — proving a patch works when the program is a server
 *
 * AutoFixService's credibility rests on one thing: it does not hand you a fix it
 * has not watched run. For a single file that is ExecutionService.dryRun — write
 * a temp copy, execute it, read stderr. A server has no equivalent. It is not a
 * program that finishes; it is a process that either comes up or does not, and
 * the only way to learn which is to boot it.
 *
 * Booting it means the candidate has to be on disk, in the real project, where
 * the server will read it. That is in direct tension with the rule that the
 * agent never writes to the user's files — so the write here is strictly
 * borrowed:
 *
 *     back up the original  →  write the candidate  →  restart  →  read the logs
 *                                                                        ↓
 *                            restore the original, always, in a finally block
 *
 * When this method returns, the file on disk is byte-for-byte what it was. The
 * fix becomes real only where it always did: in the frontend, after the user has
 * read the diff and accepted it.
 *
 * Two gates, cheapest first. A syntax check costs a second and catches most bad
 * patches; only something that survives it is worth restarting a server for.
 */
package com.debugsync.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

@Service
public class ProjectVerifier {

    private static final Logger log = LoggerFactory.getLogger(ProjectVerifier.class);

    /** A syntax check that has not answered by now is not going to. */
    private static final long SYNTAX_TIMEOUT_SECONDS = 20;

    /**
     * How long a restarted server gets to come up. Generous because a cold Vite
     * or Next start genuinely takes this long on a first run; past it we report
     * "could not tell" rather than inventing a verdict.
     */
    private static final long BOOT_TIMEOUT_MS = 25_000;

    /**
     * Once the server says RUNNING, how long to keep reading. A dev server
     * happily reports itself up and then prints a compile error a second later
     * — treating the first "ready" line as success is exactly how a broken patch
     * gets called verified.
     */
    private static final long SETTLE_AFTER_RUNNING_MS = 2_500;

    private static final int MAX_ERROR_CHARS = 1200;

    /** Lines that mean the server came up but the code inside it did not compile. */
    private static final List<String> FAILURE_MARKERS = List.of(
            "error:", "error ", "failed to compile", "module not found",
            "cannot find module", "syntaxerror", "referenceerror", "typeerror",
            "traceback (most recent call last)", "unhandled", "econnrefused",
            "transform failed", "build failed", "pre-transform error"
    );

    /**
     * Extensions whose CONTENT cannot stop a dev server coming up.
     *
     * The test for membership is narrow: could a file of this type, however
     * badly mangled, make `npm run dev` fail to reach "ready"? Stylesheets,
     * markup and prose are served as assets and never executed at boot, so the
     * answer is no and a restart tells us nothing.
     *
     * JSON is deliberately absent — a broken package.json or tsconfig stops a
     * boot cold — and is handled by its own in-process parse instead. Anything
     * a bundler compiles (jsx, ts, vue, svelte) is absent for the same reason:
     * booting is the only check those have.
     */
    private static final java.util.Set<String> BOOT_TELLS_NOTHING = java.util.Set.of(
            "css", "scss", "sass", "less", "styl",
            "html", "htm", "svg", "md", "mdx", "txt"
    );

    /** Reused: mappers are thread-safe once configured, and building one per check is waste. */
    private static final com.fasterxml.jackson.databind.ObjectMapper JSON =
            new com.fasterxml.jackson.databind.ObjectMapper();

    private final DevServerService devServerService;

    public ProjectVerifier(DevServerService devServerService) {
        this.devServerService = devServerService;
    }

    /** Lower-case extension without the dot, or "" when there is none. */
    private static String extensionOf(Path target) {
        String name = target.getFileName().toString().toLowerCase(Locale.ROOT);
        return name.contains(".") ? name.substring(name.lastIndexOf('.') + 1) : "";
    }

    private static boolean bootTellsNothing(Path target) {
        return BOOT_TELLS_NOTHING.contains(extensionOf(target));
    }

    /** The verdict on one candidate patch. */
    public static class Result {
        private final boolean verified;
        private final boolean conclusive;
        private final String failure;

        private Result(boolean verified, boolean conclusive, String failure) {
            this.verified = verified;
            this.conclusive = conclusive;
            this.failure = failure;
        }

        /** The server came up clean on this patch. */
        public boolean isVerified() { return verified; }

        /**
         * Whether this run actually tested anything. False means we could not
         * check (no server running, restart unavailable, timed out) — the patch
         * is neither proven nor disproven, and must be labelled unproven rather
         * than blamed.
         */
        public boolean isConclusive() { return conclusive; }

        /** What went wrong, ready to feed back to the model. Null when verified. */
        public String getFailure() { return failure; }

        static Result pass() { return new Result(true, true, null); }
        static Result fail(String why) { return new Result(false, true, why); }
        static Result unknown(String why) { return new Result(false, false, why); }
    }

    /**
     * Whether a boot check is actually available — a local server of this type
     * is running and can be restarted. Callers use it to describe what
     * "verified" will have meant, before spending anything to find out.
     */
    public boolean canBoot(String projectPath, String serverType) {
        if (projectPath == null || serverType == null || serverType.isBlank()) return false;
        DevServerService.ServerHandle handle = devServerService.handleFor(projectPath, serverType);
        return handle != null && handle.isLocal();
    }

    /**
     * Put {@code candidate} through both gates.
     *
     * @param target       the file being patched, inside the project
     * @param candidate    its full proposed contents
     * @param projectPath  project root — also the scope a local server is keyed by
     * @param serverType   which server to restart, or null to stop after syntax
     */
    public Result verify(Path target, String candidate, String projectPath, String serverType) {
        Result syntax = checkSyntax(target, candidate);
        if (!syntax.isVerified() && syntax.isConclusive()) {
            // Cheap gate said no. Nothing is on disk and no server was touched.
            return syntax;
        }
        /* ── When restarting proves nothing ──
         *
         * The boot gate costs up to half a minute: back up the file, write the
         * candidate, restart the server, watch it come up, put the original
         * back. That is a fair price for a change that could stop the server
         * starting.
         *
         * A stylesheet cannot. Neither can markup or a README. Vite, Next and
         * the rest serve those as assets — the content is never executed at
         * boot, so the server comes up green whatever is in them, and the
         * "verification" is half a minute spent proving something that was
         * true before the patch. For a one-line colour change typed at the
         * agent, that half minute IS the feature's latency.
         *
         * Reported honestly as unverified rather than dressed up as a pass:
         * nothing has actually checked that the change is right, and the panel
         * already knows how to say so. */
        if (bootTellsNothing(target)) {
            return Result.unknown("Restarting the dev server can't check a "
                    + extensionOf(target) + " change, so this was not verified.");
        }

        if (serverType == null || serverType.isBlank()) {
            return Result.unknown("No dev server is running, so the fix could not be booted.");
        }

        DevServerService.ServerHandle handle = devServerService.handleFor(projectPath, serverType);
        if (handle == null || !handle.isLocal()) {
            return Result.unknown("The dev server is not running from this folder, so the fix could not be booted.");
        }

        return checkBoot(target, candidate, projectPath, serverType);
    }

    /* ─────────────────────────────────────────────────────────
     * Gate 1 — syntax
     * ───────────────────────────────────────────────────────── */

    /**
     * Parse the candidate without running it.
     *
     * Deliberately on a temp copy: this runs before anything touches the real
     * project, so a patch that does not even parse costs the user nothing.
     *
     * A language with no checker available returns "unknown" rather than
     * "passed" — the distinction matters, because the boot gate is what decides
     * next, and pretending we checked would be the lie.
     */
    private Result checkSyntax(Path target, String candidate) {
        String ext = extensionOf(target);

        String[] command;
        String suffix;
        switch (ext) {
            case "js", "mjs", "cjs" -> { command = new String[] { "node", "--check", "%s" }; suffix = "." + ext; }
            case "py" -> { command = new String[] { "python", "-m", "py_compile", "%s" }; suffix = ".py"; }
            /* In process, and therefore instant.
             *
             * JSON earns its own gate for two reasons. It is the one "data"
             * file that genuinely can stop a server booting — a broken
             * package.json, tsconfig or manifest does exactly that — so it
             * cannot join the skip list below. And parsing it needs no node,
             * no python and no subprocess at all, so the answer is conclusive
             * and free rather than a 25-second restart. */
            case "json" -> {
                try {
                    JSON.readTree(candidate);
                    return Result.pass();
                } catch (Exception e) {
                    return Result.fail(truncate("The patched file is not valid JSON:\n" + e.getMessage()));
                }
            }
            default -> {
                // jsx/tsx/ts/vue/svelte need the project's own toolchain to parse,
                // which the boot gate exercises properly anyway.
                return Result.unknown("No standalone syntax check for ." + ext);
            }
        }

        Path temp = null;
        try {
            temp = Files.createTempFile("causify_syntax_", suffix);
            Files.writeString(temp, candidate);

            String[] resolved = new String[command.length];
            for (int i = 0; i < command.length; i++) {
                resolved[i] = command[i].equals("%s") ? temp.toString() : command[i];
            }

            ProcessBuilder pb = new ProcessBuilder(resolved);
            pb.redirectErrorStream(true);
            Process process = pb.start();

            String output = read(process.getInputStream());
            if (!process.waitFor(SYNTAX_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                return Result.unknown("The syntax check did not finish in time.");
            }

            if (process.exitValue() == 0) return Result.pass();

            // Scrub the temp path so the model is not told about a file that is
            // about to be deleted and never existed as far as the project knows.
            String cleaned = output.replace(temp.toString(), target.getFileName().toString());
            return Result.fail(truncate("The patched file does not parse:\n" + cleaned));

        } catch (IOException e) {
            // No node/python on this machine is not the patch's fault.
            return Result.unknown("Could not run a syntax check: " + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return Result.unknown("The syntax check was interrupted.");
        } finally {
            if (temp != null) {
                try { Files.deleteIfExists(temp); } catch (IOException ignored) { }
            }
        }
    }

    /* ─────────────────────────────────────────────────────────
     * Gate 2 — does the server actually come up
     * ───────────────────────────────────────────────────────── */

    /**
     * Write the candidate, restart, watch, and put the original back.
     *
     * The finally block is the whole safety argument. Every return path below
     * it — success, failure, timeout, exception — passes through the restore,
     * so there is no route out of this method that leaves the user's file
     * modified.
     */
    private Result checkBoot(Path target, String candidate, String projectPath, String serverType) {
        String original;
        try {
            original = Files.readString(target);
        } catch (IOException e) {
            return Result.unknown("Could not read " + target.getFileName() + " to back it up.");
        }

        // A sidecar copy as well as the in-memory string: if the process dies
        // between the write and the restore, this is what is left to recover from.
        Path backup = target.resolveSibling(target.getFileName() + ".causify-backup");

        try {
            Files.writeString(backup, original);
            Files.writeString(target, candidate);

            if (!devServerService.restartLocalServer(projectPath, serverType)) {
                return Result.unknown("The dev server could not be restarted, so the fix was not booted.");
            }

            String state = devServerService.awaitSettled(projectPath, serverType, BOOT_TIMEOUT_MS);

            if ("TIMEOUT".equals(state)) {
                return Result.unknown("The dev server did not finish starting within "
                        + (BOOT_TIMEOUT_MS / 1000) + "s.");
            }
            if ("STOPPED".equals(state)) {
                return Result.unknown("The dev server stopped while the fix was being checked.");
            }
            if ("ERROR".equals(state)) {
                return Result.fail(truncate("The dev server failed to start:\n"
                        + tail(devServerService.getLogs(projectPath, serverType))));
            }

            // RUNNING. Keep reading — "ready" is often printed before the code
            // it is serving has been compiled.
            sleep(SETTLE_AFTER_RUNNING_MS);

            List<String> logs = devServerService.getLogs(projectPath, serverType);
            String complaint = firstFailureIn(logs);
            if (complaint != null) {
                return Result.fail(truncate("The server started but reported an error:\n" + complaint));
            }

            return Result.pass();

        } catch (IOException e) {
            return Result.unknown("Could not write the candidate to disk: " + e.getMessage());
        } finally {
            restore(target, original, backup);
        }
    }

    /**
     * Put the file back and leave the server running the user's real code.
     *
     * The restart at the end matters as much as the restore: without it the user
     * is left with a server still running the agent's rejected patch, which is a
     * worse state than before they asked.
     */
    private void restore(Path target, String original, Path backup) {
        try {
            Files.writeString(target, original);
        } catch (IOException e) {
            // The one genuinely bad outcome. Say so loudly and leave the sidecar
            // in place — it is the user's copy of their own file.
            log.error("[Verifier] COULD NOT RESTORE {} — the original is preserved at {}",
                    target, backup, e);
            return;
        }

        try {
            Files.deleteIfExists(backup);
        } catch (IOException e) {
            log.warn("[Verifier] Left a backup file behind at {}", backup);
        }
    }

    /** Restart the server so it is running the user's code again, not a candidate. */
    public void restoreRunningState(String projectPath, String serverType) {
        if (serverType == null || serverType.isBlank()) return;
        try {
            devServerService.restartLocalServer(projectPath, serverType);
        } catch (Exception e) {
            log.warn("[Verifier] Could not restart the server after verifying: {}", e.getMessage());
        }
    }

    /* ─────────────────────────────────────────────────────────
     * Reading logs
     * ───────────────────────────────────────────────────────── */

    /**
     * The first line that looks like a real failure, with a little context after
     * it — the message is usually on the line following the marker.
     */
    private String firstFailureIn(List<String> logs) {
        if (logs == null || logs.isEmpty()) return null;

        for (int i = 0; i < logs.size(); i++) {
            String line = logs.get(i);
            if (line == null) continue;
            String lower = stripAnsi(line).toLowerCase(Locale.ROOT);

            for (String marker : FAILURE_MARKERS) {
                if (!lower.contains(marker)) continue;
                // "0 errors" and friends are the opposite of a failure.
                if (lower.contains("0 error") || lower.contains("no error")) continue;

                List<String> window = new ArrayList<>();
                for (int j = i; j < Math.min(logs.size(), i + 8); j++) {
                    window.add(stripAnsi(logs.get(j)));
                }
                return String.join("\n", window);
            }
        }
        return null;
    }

    private String tail(List<String> logs) {
        if (logs == null || logs.isEmpty()) return "(the server produced no output)";
        List<String> window = logs.subList(Math.max(0, logs.size() - 25), logs.size());
        List<String> cleaned = new ArrayList<>();
        for (String line : window) cleaned.add(stripAnsi(line));
        return String.join("\n", cleaned);
    }

    /** Dev servers colour their output; the escape codes are noise to a model. */
    private String stripAnsi(String s) {
        return s == null ? "" : s.replaceAll("\\[[;\\d]*[ -/]*[@-~]", "");
    }

    /* ─────────────────────────────────────────────────────────
     * Helpers
     * ───────────────────────────────────────────────────────── */

    private String read(InputStream stream) throws IOException {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) sb.append(line).append('\n');
        }
        return sb.toString();
    }

    private String truncate(String s) {
        if (s == null) return null;
        String trimmed = s.trim();
        return trimmed.length() <= MAX_ERROR_CHARS ? trimmed : trimmed.substring(0, MAX_ERROR_CHARS) + "…";
    }

    private void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}

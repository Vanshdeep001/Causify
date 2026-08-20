/*
 * ProjectErrorLocator.java — working out which file a server crash came from
 *
 * In file mode the agent is handed the code to repair. In project mode it is
 * handed a log, and the first question is one the user never has to think about
 * because they can read: *which file is this about?*
 *
 * A stack trace answers that, but every runtime writes it differently, and most
 * of the frames are not the user's code. Getting this wrong is worse than
 * failing: the agent would confidently patch a file that was never broken. So
 * this is deliberately conservative — it either finds a file inside the project
 * that plausibly threw, or it finds nothing and says so.
 */
package com.debugsync.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class ProjectErrorLocator {

    private static final Logger log = LoggerFactory.getLogger(ProjectErrorLocator.class);

    /**
     * Directories whose contents are never the user's bug. A trace through a
     * dependency is real, but the frame worth fixing is the one in their own
     * code — patching inside node_modules would "work" once and vanish on the
     * next install.
     *
     * Mirrors the SKIP_DIRS the frontend importer uses, so both halves of the
     * app agree on what counts as the user's own code.
     */
    private static final Set<String> NOT_USER_CODE = Set.of(
            "node_modules", ".venv", "venv", "env", "__pycache__", ".git",
            "dist", "build", "out", ".next", ".nuxt", "target", "vendor",
            ".cache", "coverage", ".pytest_cache"
    );

    /** A file we would never ask a model to patch even when it is named. */
    private static final Set<String> NOT_EDITABLE = Set.of(
            "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock"
    );

    /**
     * A path, optionally carrying a Windows drive letter.
     *
     * The drive is spelled out separately because it contains a colon, and the
     * rest of the pattern has to treat a colon as the separator before a line
     * number. Without this, every absolute path on Windows is silently missed —
     * and "found nothing" on this machine looks exactly like a log that named
     * no files, so it fails quietly rather than loudly.
     */
    private static final String PATH = "(?:[A-Za-z]:)?[^()\\s:]+\\.[A-Za-z0-9]+";

    /**
     * The shapes a file reference takes across the runtimes Causify runs.
     * Each pattern captures the path in group 1; group 2 is the line number when
     * the runtime prints one.
     *
     *   node         at Object.<anonymous> (/srv/app/routes/user.js:42:11)
     *   python       File "app/main.py", line 12
     *   node (bare)  /srv/app/routes/user.js:42
     *   vite         [plugin:vite:react-babel] /src/App.jsx: Unexpected token
     *
     * Ordered so that a reference carrying a line number is preferred over the
     * same path without one — the line is worth having, and both forms often
     * appear in the same trace.
     */
    private static final List<Pattern> REFERENCE_PATTERNS = List.of(
            Pattern.compile("\\((" + PATH + "):(\\d+)(?::\\d+)?\\)"),
            Pattern.compile("File \"([^\"]+)\", line (\\d+)"),
            Pattern.compile("(?:^|\\s)(" + PATH + "):(\\d+)(?::\\d+)?"),
            /* No line number at all. Restricted to paths with a separator in
               them, so an ordinary sentence mentioning "config.json" is not
               mistaken for a stack frame. */
            Pattern.compile("(?:^|\\s)((?:[A-Za-z]:)?[/\\\\][^()\\s:]*\\.[A-Za-z0-9]+)")
    );

    /** What the log pointed at, once it has been checked against the disk. */
    public static class Located {
        private final Path absolutePath;
        private final String relativePath;
        private final String content;
        private final int line;

        Located(Path absolutePath, String relativePath, String content, int line) {
            this.absolutePath = absolutePath;
            this.relativePath = relativePath;
            this.content = content;
            this.line = line;
        }

        public Path getAbsolutePath() { return absolutePath; }
        /** Project-relative, which is what the user recognises and the UI shows. */
        public String getRelativePath() { return relativePath; }
        public String getContent() { return content; }
        /** 1-based line the runtime blamed, or 0 when it did not say. */
        public int getLine() { return line; }
    }

    /**
     * Find the first file in {@code errorLog} that belongs to the project and
     * can be read.
     *
     * First rather than best: a stack trace is ordered innermost-first, so the
     * earliest frame in the user's own code is the one that actually threw.
     * Later frames are its callers, and patching a caller treats the symptom.
     *
     * @return the located file, or null when the log names nothing usable —
     *         which the caller must treat as "I don't know", never as a reason
     *         to guess.
     */
    public Located locate(String errorLog, String projectPath) {
        if (errorLog == null || errorLog.isBlank() || projectPath == null || projectPath.isBlank()) {
            return null;
        }

        Path root;
        try {
            root = Paths.get(projectPath).toRealPath();
        } catch (IOException e) {
            log.warn("[Locator] Project folder is not readable: {}", projectPath);
            return null;
        }

        for (Candidate candidate : candidates(errorLog)) {
            Located located = resolve(candidate, root);
            if (located != null) return located;
        }
        return null;
    }

    /** Every file reference in the log, in the order they appear. */
    private List<Candidate> candidates(String errorLog) {
        // Ordered and de-duplicated: a trace repeats the same frame often, and
        // re-checking a path we already rejected just costs disk reads.
        Set<String> seen = new LinkedHashSet<>();
        List<Candidate> out = new ArrayList<>();

        for (String rawLine : errorLog.split("\\R")) {
            for (Pattern pattern : REFERENCE_PATTERNS) {
                Matcher m = pattern.matcher(rawLine);
                while (m.find()) {
                    String path = m.group(1);
                    // The last pattern captures a path with no line number.
                    int line = m.groupCount() >= 2 ? parseLine(m.group(2)) : 0;
                    if (seen.add(path + ":" + line)) {
                        out.add(new Candidate(path, line));
                    }
                }
            }
        }
        return out;
    }

    /**
     * Turn a path out of a log into a file on disk, or null.
     *
     * The path may be absolute (node) or relative to the project (python, vite),
     * and vite prefixes its own with "/" even though they are relative — so all
     * three readings are tried before giving up.
     */
    private Located resolve(Candidate candidate, Path root) {
        for (Path attempt : readings(candidate.path, root)) {
            Path real;
            try {
                real = attempt.toRealPath();
            } catch (IOException e) {
                continue; // does not exist under this reading
            }

            // The decisive check. A trace can name any file on the machine, and
            // without this the agent could be steered into reading — and later
            // proposing edits to — something entirely outside the project.
            if (!real.startsWith(root)) continue;
            if (!Files.isRegularFile(real)) continue;

            Path relative = root.relativize(real);
            if (isExcluded(relative)) continue;

            try {
                return new Located(real, relative.toString().replace('\\', '/'),
                        Files.readString(real), candidate.line);
            } catch (IOException e) {
                // Binary, or unreadable. Either way it is not what we want to patch.
                log.debug("[Locator] Could not read {}: {}", real, e.getMessage());
            }
        }
        return null;
    }

    /** The ways a logged path might map onto the project folder. */
    private List<Path> readings(String logged, Path root) {
        String trimmed = logged.trim();
        List<Path> out = new ArrayList<>();
        try {
            Path asGiven = Paths.get(trimmed);
            if (asGiven.isAbsolute()) out.add(asGiven);
            else out.add(root.resolve(asGiven));

            // Vite and friends report "/src/App.jsx" for a project-relative path.
            if (trimmed.startsWith("/") || trimmed.startsWith("\\")) {
                out.add(root.resolve(trimmed.substring(1)));
            }
        } catch (Exception e) {
            // An unparseable path is simply not a candidate.
            return List.of();
        }
        return out;
    }

    private boolean isExcluded(Path relative) {
        if (NOT_EDITABLE.contains(relative.getFileName().toString())) return true;
        for (Path part : relative) {
            if (NOT_USER_CODE.contains(part.toString())) return true;
        }
        return false;
    }

    private int parseLine(String raw) {
        try {
            return Math.max(0, Integer.parseInt(raw));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private record Candidate(String path, int line) { }
}

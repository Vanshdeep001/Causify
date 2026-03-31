/*
 * DiffUtil.java — Computes differences between two code versions
 * 
 * This utility compares code line-by-line to find:
 *   - Which lines were added
 *   - Which lines were removed
 *   - Which lines were modified
 * 
 * The diff data is stored in snapshots and used by the
 * Root Cause Engine to trace variable changes.
 * 
 * OOP Principle: Utility pattern — stateless, pure functions.
 */
package com.debugsync.util;

import java.util.*;

public class DiffUtil {

    /*
     * Compare two code strings and return a human-readable diff.
     * 
     * Example output:
     *   + Line 5: let x = null;
     *   - Line 7: let x = [];
     *   ~ Line 10: console.log(x.length) → console.log(x?.length)
     */
    public static String computeDiff(String oldCode, String newCode) {
        if (oldCode == null) oldCode = "";
        if (newCode == null) newCode = "";

        String[] oldLines = oldCode.split("\n", -1);
        String[] newLines = newCode.split("\n", -1);
        StringBuilder diff = new StringBuilder();

        int maxLen = Math.max(oldLines.length, newLines.length);

        for (int i = 0; i < maxLen; i++) {
            String oldLine = i < oldLines.length ? oldLines[i] : null;
            String newLine = i < newLines.length ? newLines[i] : null;

            if (oldLine == null) {
                // Line was added
                diff.append("+ Line ").append(i + 1).append(": ").append(newLine).append("\n");
            } else if (newLine == null) {
                // Line was removed
                diff.append("- Line ").append(i + 1).append(": ").append(oldLine).append("\n");
            } else if (!oldLine.equals(newLine)) {
                // Line was modified
                diff.append("~ Line ").append(i + 1).append(": ").append(oldLine)
                    .append(" → ").append(newLine).append("\n");
            }
        }

        return diff.toString();
    }

    /*
     * Find which variables were modified between two code versions.
     * 
     * Looks for assignment patterns (let x = ..., var y = ..., z = ...)
     * in lines that changed.
     */
    public static List<String> findModifiedVariables(String oldCode, String newCode) {
        if (oldCode == null) oldCode = "";
        if (newCode == null) newCode = "";

        String[] oldLines = oldCode.split("\n", -1);
        String[] newLines = newCode.split("\n", -1);
        Set<String> modifiedVars = new LinkedHashSet<>();

        int maxLen = Math.max(oldLines.length, newLines.length);

        for (int i = 0; i < maxLen; i++) {
            String oldLine = i < oldLines.length ? oldLines[i] : "";
            String newLine = i < newLines.length ? newLines[i] : "";

            if (!oldLine.equals(newLine)) {
                // This line changed — check if it contains a variable assignment
                extractAssignedVariable(newLine).ifPresent(modifiedVars::add);
                extractAssignedVariable(oldLine).ifPresent(modifiedVars::add);
            }
        }

        return new ArrayList<>(modifiedVars);
    }

    /*
     * Extract the variable name being assigned in a line of code.
     * Matches patterns like: let x = ..., const y = ..., z = ...
     */
    private static Optional<String> extractAssignedVariable(String line) {
        if (line == null) return Optional.empty();
        String trimmed = line.trim();

        // Match: (let|const|var) varName = ...
        java.util.regex.Matcher m = java.util.regex.Pattern
            .compile("(?:let|const|var)?\\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=")
            .matcher(trimmed);

        if (m.find()) {
            return Optional.of(m.group(1));
        }
        return Optional.empty();
    }

    /*
     * Find the line number where a specific variable was last assigned.
     * Searches from bottom to top (most recent assignment first).
     */
    public static int findLastAssignment(String code, String variableName) {
        if (code == null || variableName == null) return -1;

        String[] lines = code.split("\n");
        // Search from bottom to top for the last assignment
        for (int i = lines.length - 1; i >= 0; i--) {
            String line = lines[i].trim();
            // Check if this line assigns the variable
            if (line.contains(variableName) && line.contains("=") && !line.contains("==")) {
                return i + 1; // 1-indexed
            }
        }
        return -1; // Not found
    }
}

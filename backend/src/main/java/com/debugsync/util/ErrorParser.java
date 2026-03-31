/*
 * ErrorParser.java — Extracts structured data from error messages
 * 
 * Parses raw error text into structured ErrorLog with:
 *   - errorType, message, lineNumber, involvedVariables
 */
package com.debugsync.util;

import com.debugsync.model.ErrorLog;
import java.util.*;
import java.util.regex.*;

public class ErrorParser {

    private static final Pattern JS_ERROR_PATTERN = Pattern.compile("(\\w*Error):\\s*(.+)");
    private static final Pattern LINE_NUMBER_PATTERN =
        Pattern.compile("(?:at.*?:(\\d+))|(?:line\\s+(\\d+))|(?:<anonymous>:(\\d+))");
    private static final Set<String> JS_KEYWORDS = Set.of(
        "var", "let", "const", "function", "return", "if", "else", "for",
        "while", "do", "switch", "case", "break", "continue", "new", "this",
        "class", "import", "export", "default", "from", "try", "catch",
        "throw", "typeof", "instanceof", "null", "undefined", "true", "false",
        "console", "log", "error", "warn", "Math", "String", "Number",
        "Array", "Object", "JSON", "parseInt", "parseFloat", "async", "await",
        "of", "in", "delete", "void", "with", "yield", "super", "static"
    );

    // Parse raw error into structured ErrorLog
    public static ErrorLog parse(String rawError, String code) {
        if (rawError == null || rawError.isEmpty()) return null;

        String errorType = "Error";
        String errorMessage = rawError;

        Matcher errorMatcher = JS_ERROR_PATTERN.matcher(rawError);
        if (errorMatcher.find()) {
            errorType = errorMatcher.group(1);
            errorMessage = errorMatcher.group(2);
        }

        int lineNumber = extractLineNumber(rawError);

        String involvedVariables = "";
        if (lineNumber > 0 && code != null) {
            String[] lines = code.split("\n");
            if (lineNumber <= lines.length) {
                List<String> vars = extractVariablesFromLine(lines[lineNumber - 1]);
                involvedVariables = String.join(",", vars);
            }
        }

        ErrorLog log = new ErrorLog();
        log.setType(errorType);
        log.setMessage(errorMessage);
        log.setLineNumber(lineNumber);
        log.setInvolvedVariables(involvedVariables);
        return log;
    }

    public static int extractLineNumber(String errorText) {
        Matcher matcher = LINE_NUMBER_PATTERN.matcher(errorText);
        while (matcher.find()) {
            for (int i = 1; i <= matcher.groupCount(); i++) {
                if (matcher.group(i) != null) {
                    try { return Integer.parseInt(matcher.group(i)); }
                    catch (NumberFormatException e) { /* skip */ }
                }
            }
        }
        return 0;
    }

    public static List<String> extractVariablesFromLine(String line) {
        if (line == null) return Collections.emptyList();
        String cleaned = line
            .replaceAll("\"[^\"]*\"", "").replaceAll("'[^']*'", "")
            .replaceAll("`[^`]*`", "").replaceAll("//.*$", "")
            .replaceAll("/\\*.*\\*/", "");

        Matcher m = Pattern.compile("[a-zA-Z_$][a-zA-Z0-9_$]*").matcher(cleaned);
        Set<String> variables = new LinkedHashSet<>();
        while (m.find()) {
            String token = m.group();
            if (!JS_KEYWORDS.contains(token)) variables.add(token);
        }
        return new ArrayList<>(variables);
    }
}

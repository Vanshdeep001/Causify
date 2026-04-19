/*
 * ErrorParser.java — Extracts structured data from error messages
 * 
 * Supports:
 *   - JavaScript/Node.js runtime errors
 *   - Java compiler errors  (path:line: error: message)
 *   - GCC/G++ compiler errors (path:line:col: error: message)
 *   - Python runtime errors (File "...", line N)
 */
package com.debugsync.util;

import com.debugsync.model.ErrorLog;
import java.util.*;
import java.util.regex.*;
import java.util.stream.Collectors;

public class ErrorParser {

    // --- JS/Node runtime error patterns ---
    private static final Pattern JS_ERROR_PATTERN = Pattern.compile("(\\w*Error):\\s*(.+)");
    private static final Pattern LINE_NUMBER_PATTERN =
        Pattern.compile("(?:at.*?:(\\d+))|(?:line\\s+(\\d+))|(?:<anonymous>:(\\d+))");

    // --- Java compiler error pattern: path.java:LINE: error: MESSAGE ---
    private static final Pattern JAVA_COMPILER_ERROR =
        Pattern.compile("([^:]+\\.java):(\\d+):\\s*error:\\s*(.+)");

    // --- GCC/G++ compiler error: path.c:LINE:COL: error: MESSAGE ---
    private static final Pattern C_COMPILER_ERROR =
        Pattern.compile("([^:]+\\.[ch](?:pp|xx|\\+\\+)?):(\\d+):(\\d+)?:?\\s*error:\\s*(.+)");

    // --- Python error patterns ---
    private static final Pattern PYTHON_FILE_LINE =
        Pattern.compile("File \"([^\"]+)\",\\s*line (\\d+)");
    private static final Pattern PYTHON_ERROR =
        Pattern.compile("^(\\w*(?:Error|Exception)):\\s*(.+)", Pattern.MULTILINE);
    private static final Pattern PYTHON_SYNTAX_ERROR =
        Pattern.compile("SyntaxError:\\s*(.+)", Pattern.MULTILINE);

    private static final Set<String> JS_KEYWORDS = Set.of(
        "var", "let", "const", "function", "return", "if", "else", "for",
        "while", "do", "switch", "case", "break", "continue", "new", "this",
        "class", "import", "export", "default", "from", "try", "catch",
        "throw", "typeof", "instanceof", "null", "undefined", "true", "false",
        "console", "log", "error", "warn", "Math", "String", "Number",
        "Array", "Object", "JSON", "parseInt", "parseFloat", "async", "await",
        "of", "in", "delete", "void", "with", "yield", "super", "static"
    );

    /**
     * Parse raw error text into a structured ErrorLog.
     * @param rawError  The raw stderr output
     * @param code      The source code that was executed
     * @param language  Language hint (java, c, cpp, python, javascript)
     */
    public static ErrorLog parse(String rawError, String code, String language) {
        if (rawError == null || rawError.isEmpty()) return null;
        if (language == null) language = "javascript";

        switch (language.toLowerCase()) {
            case "java":
                return parseJavaCompilerError(rawError, code);
            case "c":
            case "cpp":
                return parseCCompilerError(rawError, code);
            case "python":
                return parsePythonError(rawError, code);
            default:
                return parseJsError(rawError, code);
        }
    }

    /** Backward-compatible overload without language hint */
    public static ErrorLog parse(String rawError, String code) {
        return parse(rawError, code, guessLanguageFromError(rawError));
    }

    // ==================== Java Compiler Errors ====================

    private static ErrorLog parseJavaCompilerError(String rawError, String code) {
        List<CompilerErrorInfo> errors = new ArrayList<>();
        Matcher m = JAVA_COMPILER_ERROR.matcher(rawError);
        while (m.find()) {
            String file = m.group(1);
            int line = Integer.parseInt(m.group(2));
            String message = m.group(3).trim();
            // Extract just the filename without the full temp path
            String shortFile = file.contains("/") ? file.substring(file.lastIndexOf('/') + 1) : file;
            shortFile = shortFile.contains("\\") ? shortFile.substring(shortFile.lastIndexOf('\\') + 1) : shortFile;
            errors.add(new CompilerErrorInfo(shortFile, line, message));
        }

        if (errors.isEmpty()) {
            // Fallback: might be a runtime exception (java.lang.*)
            return parseJavaRuntimeError(rawError, code);
        }

        // Build a clean summary
        CompilerErrorInfo first = errors.get(0);
        String cleanType = "CompilationError";
        String cleanMessage;

        if (errors.size() == 1) {
            cleanMessage = first.message;
        } else {
            cleanMessage = errors.size() + " compilation errors found. First: " + first.message;
        }

        ErrorLog log = new ErrorLog();
        log.setType(cleanType);
        log.setMessage(cleanMessage);
        log.setLineNumber(first.line);
        log.setInvolvedVariables("");
        log.setSemanticContext(buildCompilerSemanticContext(errors, code));
        return log;
    }

    private static ErrorLog parseJavaRuntimeError(String rawError, String code) {
        // Java runtime: "Exception in thread "main" java.lang.NullPointerException: ..."
        Pattern runtimePattern = Pattern.compile(
            "(?:Exception in thread \"[^\"]+\"\\s+)?([\\w.]+(?:Error|Exception))(?::\\s*(.+))?");
        Matcher m = runtimePattern.matcher(rawError);
        if (m.find()) {
            String fullType = m.group(1);
            String shortType = fullType.contains(".") ? fullType.substring(fullType.lastIndexOf('.') + 1) : fullType;
            String message = m.group(2) != null ? m.group(2).trim() : shortType;

            int line = 0;
            // Find line from "at ClassName.method(File.java:LINE)"
            Pattern atLine = Pattern.compile("at .+\\(\\w+\\.java:(\\d+)\\)");
            Matcher lm = atLine.matcher(rawError);
            if (lm.find()) line = Integer.parseInt(lm.group(1));

            String involvedVariables = "";
            if (line > 0 && code != null) {
                String[] lines = code.split("\n");
                if (line <= lines.length) {
                    involvedVariables = extractVariablesWithRoles(lines[line - 1], shortType, message);
                }
            }

            ErrorLog log = new ErrorLog();
            log.setType(shortType);
            log.setMessage(message);
            log.setLineNumber(line);
            log.setInvolvedVariables(involvedVariables);
            log.setSemanticContext(extractSemanticValues(shortType, message));
            return log;
        }

        // Ultimate fallback
        return buildFallbackError(rawError, code);
    }

    // ==================== C/C++ Compiler Errors ====================

    private static ErrorLog parseCCompilerError(String rawError, String code) {
        List<CompilerErrorInfo> errors = new ArrayList<>();
        Matcher m = C_COMPILER_ERROR.matcher(rawError);
        while (m.find()) {
            String file = m.group(1);
            int line = Integer.parseInt(m.group(2));
            String message = m.group(4).trim();
            String shortFile = file.contains("/") ? file.substring(file.lastIndexOf('/') + 1) : file;
            shortFile = shortFile.contains("\\") ? shortFile.substring(shortFile.lastIndexOf('\\') + 1) : shortFile;
            errors.add(new CompilerErrorInfo(shortFile, line, message));
        }

        if (errors.isEmpty()) {
            return buildFallbackError(rawError, code);
        }

        CompilerErrorInfo first = errors.get(0);
        String cleanMessage = errors.size() == 1 ? first.message
            : errors.size() + " compilation errors found. First: " + first.message;

        ErrorLog log = new ErrorLog();
        log.setType("CompilationError");
        log.setMessage(cleanMessage);
        log.setLineNumber(first.line);
        log.setInvolvedVariables("");
        log.setSemanticContext(buildCompilerSemanticContext(errors, code));
        return log;
    }

    // ==================== Python Errors ====================

    private static ErrorLog parsePythonError(String rawError, String code) {
        // Try SyntaxError first
        Matcher synM = PYTHON_SYNTAX_ERROR.matcher(rawError);
        if (synM.find()) {
            int line = 0;
            Matcher fileM = PYTHON_FILE_LINE.matcher(rawError);
            if (fileM.find()) line = Integer.parseInt(fileM.group(2));

            ErrorLog log = new ErrorLog();
            log.setType("SyntaxError");
            log.setMessage(synM.group(1).trim());
            log.setLineNumber(line);
            log.setInvolvedVariables("");
            log.setSemanticContext("errorCategory=syntax");
            return log;
        }

        // Try runtime errors (TypeError, ValueError, etc.)
        Matcher errM = PYTHON_ERROR.matcher(rawError);
        if (errM.find()) {
            String errorType = errM.group(1);
            String message = errM.group(2).trim();
            int line = 0;
            Matcher fileM = PYTHON_FILE_LINE.matcher(rawError);
            while (fileM.find()) { line = Integer.parseInt(fileM.group(2)); } // take last match

            String involvedVariables = "";
            if (line > 0 && code != null) {
                String[] lines = code.split("\n");
                if (line <= lines.length) {
                    involvedVariables = extractVariablesWithRoles(lines[line - 1], errorType, message);
                }
            }

            ErrorLog log = new ErrorLog();
            log.setType(errorType);
            log.setMessage(message);
            log.setLineNumber(line);
            log.setInvolvedVariables(involvedVariables);
            log.setSemanticContext(extractSemanticValues(errorType, message));
            return log;
        }

        return buildFallbackError(rawError, code);
    }

    // ==================== JS/Node Errors ====================

    private static ErrorLog parseJsError(String rawError, String code) {
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
                involvedVariables = extractVariablesWithRoles(lines[lineNumber - 1], errorType, errorMessage);
            }
        }

        ErrorLog log = new ErrorLog();
        log.setType(errorType);
        log.setMessage(errorMessage);
        log.setLineNumber(lineNumber);
        log.setInvolvedVariables(involvedVariables);
        log.setSemanticContext(extractSemanticValues(errorType, errorMessage));
        return log;
    }

    // ==================== Helpers ====================

    private static ErrorLog buildFallbackError(String rawError, String code) {
        // Best-effort: extract any line number and clean up the message
        int line = extractLineNumber(rawError);
        String firstLine = rawError.contains("\n") ? rawError.substring(0, rawError.indexOf('\n')).trim() : rawError.trim();
        // Limit message length
        if (firstLine.length() > 200) firstLine = firstLine.substring(0, 200) + "...";

        ErrorLog log = new ErrorLog();
        log.setType("Error");
        log.setMessage(firstLine);
        log.setLineNumber(line);
        log.setInvolvedVariables("");
        log.setSemanticContext("");
        return log;
    }

    /** Build semantic context string for compiler errors (multi-error info) */
    private static String buildCompilerSemanticContext(List<CompilerErrorInfo> errors, String code) {
        StringBuilder ctx = new StringBuilder();
        ctx.append("errorCategory=compilation");
        ctx.append(";errorCount=").append(errors.size());

        // Include all error details for the AI
        StringBuilder allErrors = new StringBuilder();
        String[] codeLines = code != null ? code.split("\n") : new String[0];
        for (int i = 0; i < Math.min(errors.size(), 5); i++) {
            CompilerErrorInfo e = errors.get(i);
            if (i > 0) allErrors.append(" | ");
            allErrors.append("Line ").append(e.line).append(": ").append(e.message);
            if (e.line > 0 && e.line <= codeLines.length) {
                allErrors.append(" [code: ").append(codeLines[e.line - 1].trim()).append("]");
            }
        }
        ctx.append(";errors=").append(allErrors);

        return ctx.toString();
    }

    private static String guessLanguageFromError(String rawError) {
        if (rawError == null) return "javascript";
        if (rawError.contains(".java:") && rawError.contains("error:")) return "java";
        if ((rawError.contains(".c:") || rawError.contains(".cpp:")) && rawError.contains("error:")) return "c";
        if (rawError.contains("File \"") && rawError.contains("line ")) return "python";
        return "javascript";
    }

    private static String extractSemanticValues(String type, String message) {
        Map<String, String> values = new LinkedHashMap<>();
        
        if ("ArrayIndexOutOfBoundsException".equals(type) || "IndexOutOfBoundsException".equals(type)) {
            Matcher m = Pattern.compile("Index (\\d+) out of bounds for length (\\d+)").matcher(message);
            if (m.find()) { values.put("index", m.group(1)); values.put("length", m.group(2)); }
        }
        else if (type.contains("NullPointer") || type.contains("TypeError")) {
            Matcher m = Pattern.compile("Cannot read field \"(\\w+)\" because \"(\\w+)\" is null").matcher(message);
            if (m.find()) { values.put("field", m.group(1)); values.put("base", m.group(2)); }
            Matcher m2 = Pattern.compile("Cannot read property '(\\w+)' of null").matcher(message);
            if (m2.find()) { values.put("property", m2.group(1)); values.put("base", "null"); }
        }
        
        if (values.isEmpty()) return "";
        return values.entrySet().stream()
                .map(e -> e.getKey() + "=" + e.getValue())
                .collect(Collectors.joining(";"));
    }

    private static String extractVariablesWithRoles(String line, String errorType, String errorMessage) {
        List<String> variables = extractVariablesFromLine(line);
        if (variables.isEmpty()) return "";

        List<String> results = new ArrayList<>();
        for (String var : variables) {
            String role = "neutral";
            
            if ("ArithmeticException".equals(errorType) && errorMessage.contains("/ by zero")) {
                if (line.matches(".*\\/\\s*" + var + "\\b.*")) role = "divisor";
                else if (line.matches(".*\\/.*\\(.*" + var + ".*\\).*")) role = "divisor";
            } 
            else if (errorType.contains("NullPointer") || errorType.contains("TypeError")) {
                if (line.matches(".*" + var + "\\s*\\..*")) role = "base_object";
            }
            else if (errorType.contains("IndexOutOfBounds")) {
                if (line.matches(".*\\[\\s*" + var + "\\s*\\].*")) role = "index";
            }

            results.add(var + ":" + role);
        }
        return String.join(",", results);
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

    /** Structured info for a single compiler error */
    public static class CompilerErrorInfo {
        public final String file;
        public final int line;
        public final String message;

        public CompilerErrorInfo(String file, int line, String message) {
            this.file = file;
            this.line = line;
            this.message = message;
        }
    }
}

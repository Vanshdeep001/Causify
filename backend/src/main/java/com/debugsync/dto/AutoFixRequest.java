/*
 * AutoFixRequest.java — What the frontend sends when the user asks the
 * auto-fix agent to repair a failing program.
 *
 * Everything past `code` is the diagnosis the user is already looking at.
 * Forwarding it means the agent starts from what the root-cause analysis
 * already established instead of re-deriving it from scratch.
 */
package com.debugsync.dto;

import java.util.Map;

public class AutoFixRequest {

    /** Repair one file the caller already has in hand — the original behaviour. */
    public static final String MODE_FILE = "FILE";

    /**
     * Repair a project. The caller does not know which file is at fault: the
     * failure arrived as a dev-server log, so the agent locates the file itself
     * and verifies by booting the server rather than by running one program.
     */
    public static final String MODE_PROJECT = "PROJECT";

    /**
     * Which of the two above. Absent means FILE, so every caller written before
     * project mode existed keeps its exact behaviour without being updated.
     */
    private String mode;

    private String sessionId;
    private String code;
    private String language;
    private String filePath;

    /* ── Project mode ── */

    /** Absolute folder of a project opened from disk. */
    private String projectPath;

    /** Which dev server to restart when verifying (its type key, e.g. "node"). */
    private String serverType;

    /**
     * Tail of the dev server's log. This is project mode's substitute for
     * `rootCause`: nothing has parsed it, so the agent reads it as-is to find
     * both the failing file and what went wrong.
     */
    private String errorLog;

    /**
     * A request typed by the user rather than a button press — "add a health
     * route", "this crashes on save, fix it". When set the agent is being asked
     * to make a change, which is not always the same as repairing a failure.
     */
    private String userInstruction;

    private String errorType;
    private String errorMessage;
    private int errorLine;
    private String suspectedVariable;

    /** Precise runtime values pulled out of the error (e.g. "divisor" -> "0"). */
    private Map<String, String> semanticContext;

    public AutoFixRequest() {}

    /** Never null: an unset or unrecognised mode is FILE. */
    public String getMode() {
        return MODE_PROJECT.equalsIgnoreCase(mode) ? MODE_PROJECT : MODE_FILE;
    }
    public void setMode(String mode) { this.mode = mode; }

    public boolean isProjectMode() { return MODE_PROJECT.equals(getMode()); }

    /** True when the user asked for a change rather than pressing "fix it". */
    public boolean hasInstruction() {
        return userInstruction != null && !userInstruction.isBlank();
    }

    public String getProjectPath() { return projectPath; }
    public void setProjectPath(String projectPath) { this.projectPath = projectPath; }
    public String getServerType() { return serverType; }
    public void setServerType(String serverType) { this.serverType = serverType; }
    public String getErrorLog() { return errorLog; }
    public void setErrorLog(String errorLog) { this.errorLog = errorLog; }
    public String getUserInstruction() { return userInstruction; }
    public void setUserInstruction(String userInstruction) { this.userInstruction = userInstruction; }

    public String getSessionId() { return sessionId; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }
    public String getCode() { return code; }
    public void setCode(String code) { this.code = code; }
    public String getLanguage() { return language; }
    public void setLanguage(String language) { this.language = language; }
    public String getFilePath() { return filePath; }
    public void setFilePath(String filePath) { this.filePath = filePath; }

    public String getErrorType() { return errorType; }
    public void setErrorType(String errorType) { this.errorType = errorType; }
    public String getErrorMessage() { return errorMessage; }
    public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }
    public int getErrorLine() { return errorLine; }
    public void setErrorLine(int errorLine) { this.errorLine = errorLine; }
    public String getSuspectedVariable() { return suspectedVariable; }
    public void setSuspectedVariable(String suspectedVariable) { this.suspectedVariable = suspectedVariable; }

    public Map<String, String> getSemanticContext() { return semanticContext; }
    public void setSemanticContext(Map<String, String> semanticContext) { this.semanticContext = semanticContext; }
}

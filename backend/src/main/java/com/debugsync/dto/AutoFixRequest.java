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
    private String sessionId;
    private String code;
    private String language;
    private String filePath;

    private String errorType;
    private String errorMessage;
    private int errorLine;
    private String suspectedVariable;

    /** Precise runtime values pulled out of the error (e.g. "divisor" -> "0"). */
    private Map<String, String> semanticContext;

    public AutoFixRequest() {}

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

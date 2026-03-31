/*
 * ExecutionRequest.java — What the frontend sends when user clicks "Run"
 */
package com.debugsync.dto;

public class ExecutionRequest {
    private String sessionId;
    private String code;
    private String language;

    public ExecutionRequest() {}

    public String getSessionId() { return sessionId; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }
    public String getCode() { return code; }
    public void setCode(String code) { this.code = code; }
    public String getLanguage() { return language; }
    public void setLanguage(String language) { this.language = language; }
}

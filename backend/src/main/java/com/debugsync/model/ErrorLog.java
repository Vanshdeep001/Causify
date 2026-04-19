/*
 * ErrorLog.java — Parsed information about a specific error
 */
package com.debugsync.model;

import jakarta.persistence.*;

@Entity
@Table(name = "error_logs")
public class ErrorLog {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    private String executionId;
    @Column(columnDefinition = "TEXT")
    private String type;

    @Column(columnDefinition = "TEXT")
    private String message;

    private int lineNumber;
    @Column(columnDefinition = "TEXT")
    private String involvedVariables;
    @Column(columnDefinition = "TEXT")
    private String semanticContext;

    public ErrorLog() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getExecutionId() { return executionId; }
    public void setExecutionId(String executionId) { this.executionId = executionId; }
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }
    public int getLineNumber() { return lineNumber; }
    public void setLineNumber(int lineNumber) { this.lineNumber = lineNumber; }
    public String getInvolvedVariables() { return involvedVariables; }
    public void setInvolvedVariables(String involvedVariables) { this.involvedVariables = involvedVariables; }
    public String getSemanticContext() { return semanticContext; }
    public void setSemanticContext(String semanticContext) { this.semanticContext = semanticContext; }
}

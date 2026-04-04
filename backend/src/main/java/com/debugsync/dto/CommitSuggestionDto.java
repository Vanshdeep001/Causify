package com.debugsync.dto;

import java.util.List;

public class CommitSuggestionDto {
    private String type;
    private String message;
    private List<String> modifiedFiles;
    private List<String> affectedFiles;
    private String confidence; // HIGH, MEDIUM, LOW
    private String reason;

    public CommitSuggestionDto() {}

    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }
    public List<String> getModifiedFiles() { return modifiedFiles; }
    public void setModifiedFiles(List<String> modifiedFiles) { this.modifiedFiles = modifiedFiles; }
    public List<String> getAffectedFiles() { return affectedFiles; }
    public void setAffectedFiles(List<String> affectedFiles) { this.affectedFiles = affectedFiles; }
    public String getConfidence() { return confidence; }
    public void setConfidence(String confidence) { this.confidence = confidence; }
    public String getReason() { return reason; }
    public void setReason(String reason) { this.reason = reason; }
}

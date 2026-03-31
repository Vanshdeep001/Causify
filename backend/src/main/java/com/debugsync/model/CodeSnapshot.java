/*
 * CodeSnapshot.java — A frozen copy of the code at a point in time
 */
package com.debugsync.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "code_snapshots")
public class CodeSnapshot {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(nullable = false)
    private String sessionId;

    @Column(columnDefinition = "TEXT")
    private String code;

    private String userId;

    @Column(nullable = false)
    private LocalDateTime timestamp;

    @Column(columnDefinition = "TEXT")
    private String diff;

    private boolean hasError;

    public CodeSnapshot() {}

    public CodeSnapshot(String id, String sessionId, String code, String userId,
                        LocalDateTime timestamp, String diff, boolean hasError) {
        this.id = id;
        this.sessionId = sessionId;
        this.code = code;
        this.userId = userId;
        this.timestamp = timestamp;
        this.diff = diff;
        this.hasError = hasError;
    }

    @PrePersist
    protected void onCreate() {
        this.timestamp = LocalDateTime.now();
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getSessionId() { return sessionId; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }
    public String getCode() { return code; }
    public void setCode(String code) { this.code = code; }
    public String getUserId() { return userId; }
    public void setUserId(String userId) { this.userId = userId; }
    public LocalDateTime getTimestamp() { return timestamp; }
    public void setTimestamp(LocalDateTime timestamp) { this.timestamp = timestamp; }
    public String getDiff() { return diff; }
    public void setDiff(String diff) { this.diff = diff; }
    public boolean isHasError() { return hasError; }
    public void setHasError(boolean hasError) { this.hasError = hasError; }
}

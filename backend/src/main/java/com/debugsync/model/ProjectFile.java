/*
 * ProjectFile.java — Represents a file within a collaborative session
 */
package com.debugsync.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/*
 * Every lookup here is by session — findBySessionId, findBySessionIdAndPath and
 * the recursive delete. Without these indexes each one degenerates into a full
 * scan that materializes the `content` of every row in the table (binary assets
 * are stored as base64 data URLs), which is what exhausted the packaged app's
 * heap and left H2 reporting "The database has been closed [90098]".
 */
@Entity
@Table(name = "project_files", indexes = {
    @Index(name = "idx_project_files_session", columnList = "session_id"),
    @Index(name = "idx_project_files_session_path", columnList = "session_id, path")
})
public class ProjectFile {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(nullable = false)
    private String sessionId;

    @Column(nullable = false)
    private String path;

    @Column(columnDefinition = "TEXT")
    private String content;

    @Column(nullable = false)
    @com.fasterxml.jackson.annotation.JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss")
    private java.time.LocalDateTime lastModified;

    public ProjectFile() {}

    public ProjectFile(String sessionId, String path, String content) {
        this.sessionId = sessionId;
        this.path = path;
        this.content = content;
        this.lastModified = LocalDateTime.now();
    }

    @PrePersist
    @PreUpdate
    protected void onUpdate() {
        this.lastModified = LocalDateTime.now();
    }

    // Getters and Setters
    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getSessionId() { return sessionId; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }
    public String getPath() { return path; }
    public void setPath(String path) { this.path = path; }
    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }
    public LocalDateTime getLastModified() { return lastModified; }
    public void setLastModified(LocalDateTime lastModified) { this.lastModified = lastModified; }
}

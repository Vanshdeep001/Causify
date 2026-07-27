/*
 * Session.java — Represents a collaborative debugging session
 * 
 * A session is a shared workspace where multiple users can
 * edit and debug code together in real-time.
 */
package com.debugsync.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "sessions")
public class Session {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(nullable = false)
    private String name;

    @Column
    private String password;

    @Column(columnDefinition = "TEXT")
    private String currentCode;

    @Column(columnDefinition = "TEXT")
    private String whiteboardData;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    /**
     * When this session was last used.
     *
     * Retention is based on activity rather than age: a session someone is still
     * working in must never be swept out from under them just because it was
     * created a while ago, and an abandoned one should not linger merely because
     * it was touched once recently.
     */
    @Column
    private LocalDateTime lastActiveAt;

    public Session() {
    }

    public Session(String id, String name, String currentCode, LocalDateTime createdAt) {
        this.id = id;
        this.name = name;
        this.currentCode = currentCode;
        this.createdAt = createdAt;
    }

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        this.lastActiveAt = this.createdAt;
    }

    /** Mark the session as in use, so the retention sweep leaves it alone. */
    public void touch() {
        this.lastActiveAt = LocalDateTime.now();
    }

    // Getters and Setters
    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password;
    }

    public String getCurrentCode() {
        return currentCode;
    }

    public void setCurrentCode(String currentCode) {
        this.currentCode = currentCode;
    }

    public String getWhiteboardData() {
        return whiteboardData;
    }

    public void setWhiteboardData(String whiteboardData) {
        this.whiteboardData = whiteboardData;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }

    public LocalDateTime getLastActiveAt() {
        return lastActiveAt;
    }

    public void setLastActiveAt(LocalDateTime lastActiveAt) {
        this.lastActiveAt = lastActiveAt;
    }
}

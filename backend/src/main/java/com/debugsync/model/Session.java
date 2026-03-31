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

    @Column(nullable = false)
    private LocalDateTime createdAt;

    public Session() {}

    public Session(String id, String name, String currentCode, LocalDateTime createdAt) {
        this.id = id;
        this.name = name;
        this.currentCode = currentCode;
        this.createdAt = createdAt;
    }

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
    }

    // Getters and Setters
    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getPassword() { return password; }
    public void setPassword(String password) { this.password = password; }
    public String getCurrentCode() { return currentCode; }
    public void setCurrentCode(String currentCode) { this.currentCode = currentCode; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}

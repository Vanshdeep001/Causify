/*
 * Deployment.java — JPA Entity for deployment history/records linked to sessions and snapshots
 */
package com.debugsync.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "deployments", indexes = {
    @Index(name = "idx_deployments_session", columnList = "session_id")
})
public class Deployment {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(nullable = false)
    private String sessionId;

    @Column(nullable = false, length = 1000)
    private String deploymentUrl;

    private String vercelDeploymentId;

    private String target; // "production" | "preview"

    private String gitBranch;

    private String gitCommit;

    private String snapshotId; // Links to CodeSnapshot.id

    private String status; // "success" | "error"

    private String framework;

    @Column(nullable = false)
    private LocalDateTime timestamp;

    public Deployment() {}

    @PrePersist
    protected void onCreate() {
        this.timestamp = LocalDateTime.now();
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getSessionId() { return sessionId; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }

    public String getDeploymentUrl() { return deploymentUrl; }
    public void setDeploymentUrl(String deploymentUrl) { this.deploymentUrl = deploymentUrl; }

    public String getVercelDeploymentId() { return vercelDeploymentId; }
    public void setVercelDeploymentId(String vercelDeploymentId) { this.vercelDeploymentId = vercelDeploymentId; }

    public String getTarget() { return target; }
    public void setTarget(String target) { this.target = target; }

    public String getGitBranch() { return gitBranch; }
    public void setGitBranch(String gitBranch) { this.gitBranch = gitBranch; }

    public String getGitCommit() { return gitCommit; }
    public void setGitCommit(String gitCommit) { this.gitCommit = gitCommit; }

    public String getSnapshotId() { return snapshotId; }
    public void setSnapshotId(String snapshotId) { this.snapshotId = snapshotId; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public String getFramework() { return framework; }
    public void setFramework(String framework) { this.framework = framework; }

    public LocalDateTime getTimestamp() { return timestamp; }
    public void setTimestamp(LocalDateTime timestamp) { this.timestamp = timestamp; }
}

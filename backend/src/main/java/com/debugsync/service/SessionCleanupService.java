/*
 * SessionCleanupService.java — Keeps the database bounded
 *
 * Sessions used to be created implicitly and never removed, so every folder a
 * user ever opened left a full copy of its files in the store forever. That
 * unbounded growth is what eventually exhausted the heap and left H2 reporting
 * "The database has been closed".
 *
 * Files now live on the user's disk; a session only carries them to a
 * collaborator while people are actually connected. This service is what makes
 * that true in practice: it deletes a session's rows once everyone has left, and
 * sweeps anything left behind by a crash or a hard quit.
 */
package com.debugsync.service;

import com.debugsync.model.Session;
import com.debugsync.repository.DeploymentRepository;
import com.debugsync.repository.ProjectFileRepository;
import com.debugsync.repository.SessionRepository;
import com.debugsync.repository.SnapshotRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Service
public class SessionCleanupService {

    private static final Logger log = LoggerFactory.getLogger(SessionCleanupService.class);

    /** How long an untouched session survives before the sweep removes it. */
    @Value("${debugsync.session.retention-hours:48}")
    private int retentionHours;

    private final SessionRepository sessionRepository;
    private final ProjectFileRepository projectFileRepository;
    private final SnapshotRepository snapshotRepository;
    private final DeploymentRepository deploymentRepository;

    public SessionCleanupService(SessionRepository sessionRepository,
                                 ProjectFileRepository projectFileRepository,
                                 SnapshotRepository snapshotRepository,
                                 DeploymentRepository deploymentRepository) {
        this.sessionRepository = sessionRepository;
        this.projectFileRepository = projectFileRepository;
        this.snapshotRepository = snapshotRepository;
        this.deploymentRepository = deploymentRepository;
    }

    /**
     * Delete everything belonging to a session.
     *
     * Safe to call for a session that is already gone, so a duplicate "last user
     * left" signal is harmless.
     */
    @Transactional
    public void purgeSession(String sessionId) {
        if (sessionId == null || sessionId.isBlank()) return;

        try {
            projectFileRepository.deleteBySessionId(sessionId);
            snapshotRepository.deleteAll(snapshotRepository.findBySessionIdOrderByTimestampAsc(sessionId));
            deploymentRepository.deleteAll(deploymentRepository.findBySessionIdOrderByTimestampDesc(sessionId));
            sessionRepository.deleteById(sessionId);
            log.info("[SessionCleanup] Purged session {}", sessionId);
        } catch (Exception e) {
            // Cleanup must never break the request that triggered it.
            log.warn("[SessionCleanup] Could not fully purge session {}: {}", sessionId, e.getMessage());
        }
    }

    /**
     * Remove sessions nobody came back to.
     *
     * The "last user left" path covers an orderly exit, but a crash, a lost
     * network or a force-quit leaves rows behind. Runs hourly, and once shortly
     * after startup so a restart also clears anything stranded by the last run.
     *
     * Retention is measured from last activity, not creation. A session the user
     * is still working in gets touched on launch and survives; one they left
     * behind months ago does not. Judging by age instead would delete a
     * long-running session while its files were still the only copy.
     */
    @Scheduled(initialDelay = 60_000, fixedDelay = 3_600_000)
    public void sweepStaleSessions() {
        try {
            LocalDateTime cutoff = LocalDateTime.now().minusHours(retentionHours);
            List<Session> stale = sessionRepository.findAll().stream()
                .filter(s -> {
                    // Rows written before lastActiveAt existed fall back to createdAt.
                    LocalDateTime seen = s.getLastActiveAt() != null ? s.getLastActiveAt() : s.getCreatedAt();
                    return seen != null && seen.isBefore(cutoff);
                })
                .toList();

            if (stale.isEmpty()) return;

            log.info("[SessionCleanup] Sweeping {} session(s) untouched for over {}h",
                     stale.size(), retentionHours);
            for (Session session : stale) {
                purgeSession(session.getId());
            }
        } catch (Exception e) {
            log.warn("[SessionCleanup] Sweep failed: {}", e.getMessage());
        }
    }
}

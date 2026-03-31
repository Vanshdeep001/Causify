/*
 * TimelineService.java — Manages code snapshots and the debug timeline
 */
package com.debugsync.service;

import com.debugsync.model.CodeSnapshot;
import com.debugsync.repository.SnapshotRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
public class TimelineService {

    private static final Logger log = LoggerFactory.getLogger(TimelineService.class);
    private final SnapshotRepository snapshotRepository;

    // Constructor injection (replaces Lombok's @RequiredArgsConstructor)
    public TimelineService(SnapshotRepository snapshotRepository) {
        this.snapshotRepository = snapshotRepository;
    }

    // Create a new snapshot and save it
    public CodeSnapshot createSnapshot(String sessionId, String code, String userId,
                                        String diff, boolean hasError) {
        CodeSnapshot snapshot = new CodeSnapshot();
        snapshot.setSessionId(sessionId);
        snapshot.setCode(code);
        snapshot.setUserId(userId);
        snapshot.setDiff(diff);
        snapshot.setHasError(hasError);

        CodeSnapshot saved = snapshotRepository.save(snapshot);
        log.info("Created snapshot {} for session {}", saved.getId(), sessionId);
        return saved;
    }

    // Get all snapshots for a session (the timeline)
    public List<CodeSnapshot> getTimeline(String sessionId) {
        return snapshotRepository.findBySessionIdOrderByTimestampAsc(sessionId);
    }

    // Get the most recent snapshot
    public CodeSnapshot getLatestSnapshot(String sessionId) {
        return snapshotRepository.findTopBySessionIdOrderByTimestampDesc(sessionId);
    }
}

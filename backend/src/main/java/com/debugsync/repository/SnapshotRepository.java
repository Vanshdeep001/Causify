/*
 * SnapshotRepository.java — Data Access for Code Snapshots
 * 
 * Provides methods to query snapshots by session,
 * ordered by time, so we can build the debug timeline.
 */
package com.debugsync.repository;

import com.debugsync.model.CodeSnapshot;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface SnapshotRepository extends JpaRepository<CodeSnapshot, String> {

    // Get all snapshots for a session, oldest first (for timeline)
    List<CodeSnapshot> findBySessionIdOrderByTimestampAsc(String sessionId);

    // Get the most recent snapshot for a session
    CodeSnapshot findTopBySessionIdOrderByTimestampDesc(String sessionId);
}

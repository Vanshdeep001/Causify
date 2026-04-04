/*
 * ExecutionRepository.java — Data Access for Execution Logs
 */
package com.debugsync.repository;

import com.debugsync.model.ExecutionLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface ExecutionRepository extends JpaRepository<ExecutionLog, String> {
    ExecutionLog findBySnapshotId(String snapshotId);
}

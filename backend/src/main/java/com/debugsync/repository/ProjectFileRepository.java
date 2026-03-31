/*
 * ProjectFileRepository.java — Data Access Object for Project Files
 */
package com.debugsync.repository;

import com.debugsync.model.ProjectFile;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface ProjectFileRepository extends JpaRepository<ProjectFile, String> {
    List<ProjectFile> findBySessionId(String sessionId);
    Optional<ProjectFile> findBySessionIdAndPath(String sessionId, String path);
}

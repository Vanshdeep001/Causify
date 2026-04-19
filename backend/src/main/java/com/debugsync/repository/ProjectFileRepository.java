/*
 * ProjectFileRepository.java — Data Access Object for Project Files
 */
package com.debugsync.repository;

import com.debugsync.model.ProjectFile;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

@Repository
public interface ProjectFileRepository extends JpaRepository<ProjectFile, String> {
    List<ProjectFile> findBySessionId(String sessionId);
    Optional<ProjectFile> findBySessionIdAndPath(String sessionId, String path);

    @Transactional
    @Modifying
    void deleteBySessionId(String sessionId);

    @Transactional
    @Modifying
    @Query("DELETE FROM ProjectFile f WHERE f.sessionId = ?1 AND (f.path = ?2 OR f.path LIKE ?2 || '/%')")
    void deleteBySessionIdAndPathRecursive(String sessionId, String path);
}

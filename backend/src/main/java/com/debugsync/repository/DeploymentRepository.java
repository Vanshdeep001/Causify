/*
 * DeploymentRepository.java — Data Access for Deployments
 */
package com.debugsync.repository;

import com.debugsync.model.Deployment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface DeploymentRepository extends JpaRepository<Deployment, String> {
    
    // Find all deployments for a session, newest first
    List<Deployment> findBySessionIdOrderByTimestampDesc(String sessionId);
}

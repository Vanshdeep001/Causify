/*
 * DeploymentService.java — Manages Vercel deployment records for Causify sessions
 */
package com.debugsync.service;

import com.debugsync.model.Deployment;
import com.debugsync.repository.DeploymentRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
public class DeploymentService {

    private static final Logger log = LoggerFactory.getLogger(DeploymentService.class);
    private final DeploymentRepository deploymentRepository;

    public DeploymentService(DeploymentRepository deploymentRepository) {
        this.deploymentRepository = deploymentRepository;
    }

    /**
     * Save a new deployment record.
     */
    public Deployment saveDeployment(Deployment deployment) {
        Deployment saved = deploymentRepository.save(deployment);
        log.info("Saved deployment record {} for session {}", saved.getId(), saved.getSessionId());
        return saved;
    }

    /**
     * Retrieve deployment history for a session, newest first.
     */
    public List<Deployment> getDeploymentsBySession(String sessionId) {
        return deploymentRepository.findBySessionIdOrderByTimestampDesc(sessionId);
    }
}

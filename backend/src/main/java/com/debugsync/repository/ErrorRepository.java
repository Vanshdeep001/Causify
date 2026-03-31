/*
 * ErrorRepository.java — Data Access for Error Logs
 */
package com.debugsync.repository;

import com.debugsync.model.ErrorLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface ErrorRepository extends JpaRepository<ErrorLog, String> {
}

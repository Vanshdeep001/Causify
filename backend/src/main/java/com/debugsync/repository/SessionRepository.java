/*
 * SessionRepository.java — Data Access for Sessions
 * 
 * Spring Data JPA automatically creates the SQL queries
 * from our method names. We don't need to write any SQL.
 * 
 * OOP Principle: Interface Segregation — this interface
 * only defines methods relevant to Session data access.
 */
package com.debugsync.repository;

import com.debugsync.model.Session;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface SessionRepository extends JpaRepository<Session, String> {
    // JpaRepository gives us: save(), findById(), findAll(), delete(), etc.
    // No custom methods needed yet — Spring does the heavy lifting!
}

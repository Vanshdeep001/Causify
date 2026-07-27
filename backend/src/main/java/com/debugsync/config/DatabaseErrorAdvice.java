/*
 * DatabaseErrorAdvice.java — Turns an unrecoverable H2 state into a clear message
 *
 * When MVStore hits an unrecoverable error it panics and closes the store. Every
 * query afterwards fails with H2 error 90098 ("The database has been closed")
 * until the process restarts, which surfaced in the UI as a bare
 * "REQUEST FAILED WITH STATUS CODE 500" with no indication that restarting the
 * app is the remedy.
 *
 * This advice recognises only that specific unrecoverable condition and reports
 * it as 503 with an actionable message. Every other data-access failure is
 * rethrown so existing error handling is left exactly as it was.
 */
package com.debugsync.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

@RestControllerAdvice
public class DatabaseErrorAdvice {

    private static final Logger log = LoggerFactory.getLogger(DatabaseErrorAdvice.class);

    /** H2's DATABASE_IS_CLOSED error code. */
    private static final int DATABASE_IS_CLOSED = 90098;

    @ExceptionHandler(DataAccessException.class)
    public ResponseEntity<Map<String, String>> handleDataAccess(DataAccessException ex) throws DataAccessException {
        if (!isDatabaseClosed(ex)) {
            throw ex; // not our case — preserve the previous behaviour untouched
        }

        log.error("[Database] Store is closed; the backend must be restarted", ex);
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of(
            "error", "DATABASE_UNAVAILABLE",
            "message", "The local database stopped responding and Causify needs to be restarted. "
                     + "Your files on disk are unaffected."
        ));
    }

    /**
     * Walk the cause chain looking for H2 error 90098. We match on the error code
     * rather than the message so this keeps working across locales and H2 versions.
     */
    private boolean isDatabaseClosed(Throwable ex) {
        for (Throwable t = ex; t != null; t = t.getCause()) {
            if (t instanceof java.sql.SQLException sqlEx && sqlEx.getErrorCode() == DATABASE_IS_CLOSED) {
                return true;
            }
            if (t.getCause() == t) break; // defensive: self-referencing cause
        }
        return false;
    }
}

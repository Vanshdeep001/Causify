/*
 * LlmException.java — A provider failure whose message is meant for the user.
 *
 * Distinct from a bare RuntimeException on purpose: everything thrown as one of
 * these carries text that has already been translated out of vendor-speak
 * ("insufficient_quota", "ValidationException") into something a developer can
 * act on. Callers surface getMessage() straight to the UI, so anything thrown
 * here must read as a sentence, not a status code.
 */
package com.debugsync.ai;

public class LlmException extends RuntimeException {

    public LlmException(String message) {
        super(message);
    }

    public LlmException(String message, Throwable cause) {
        super(message, cause);
    }
}

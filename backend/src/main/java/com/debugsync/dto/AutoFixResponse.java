/*
 * AutoFixResponse.java — A repair the agent is proposing.
 *
 * This is a PROPOSAL, never an applied change. The backend has already run the
 * patched code to see whether it works, but the user's file is untouched until
 * they accept it in the UI.
 */
package com.debugsync.dto;

import java.util.List;

public class AutoFixResponse {

    /* ── status values ── */
    /** Patched code ran clean. */
    public static final String VERIFIED = "VERIFIED";
    /** A patch was produced but it still fails, or the language can't be run here. */
    public static final String UNVERIFIED = "UNVERIFIED";
    /** The agent could not produce a usable edit. */
    public static final String NO_FIX = "NO_FIX";
    /** No Gemini key configured. */
    public static final String NO_AI_KEY = "NO_AI_KEY";
    /** Something broke while talking to the model. */
    public static final String ERROR = "ERROR";

    private String status;
    private String summary;
    private String explanation;
    private double confidence;

    /** Full file content with the fix applied — what the editor writes on accept. */
    private String fixedCode;
    private List<FixEdit> edits;

    /** One entry per repair attempt, so the UI can show the agent's reasoning trail. */
    private List<Attempt> attempts;
    private int attemptsUsed;

    /** stdout of the verified run — evidence the program now works. */
    private String verifiedOutput;
    /** The error still standing when the agent ran out of attempts. */
    private String remainingError;
    /** Whether this language can be executed on the backend at all. */
    private boolean verificationSupported;
    /** Human-readable status line for the UI. */
    private String message;

    /**
     * Which file this patch is for, project-relative.
     *
     * In file mode the caller already knew. In project mode the agent worked it
     * out from a stack trace, so it has to say — the frontend needs it both to
     * label the diff and to open the right file before applying, and the user
     * needs it because "here is a fix" means nothing without "to what".
     */
    private String targetPath;

    public AutoFixResponse() {}

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getSummary() { return summary; }
    public void setSummary(String summary) { this.summary = summary; }
    public String getExplanation() { return explanation; }
    public void setExplanation(String explanation) { this.explanation = explanation; }
    public double getConfidence() { return confidence; }
    public void setConfidence(double confidence) { this.confidence = confidence; }
    public String getFixedCode() { return fixedCode; }
    public void setFixedCode(String fixedCode) { this.fixedCode = fixedCode; }
    public List<FixEdit> getEdits() { return edits; }
    public void setEdits(List<FixEdit> edits) { this.edits = edits; }
    public List<Attempt> getAttempts() { return attempts; }
    public void setAttempts(List<Attempt> attempts) { this.attempts = attempts; }
    public int getAttemptsUsed() { return attemptsUsed; }
    public void setAttemptsUsed(int attemptsUsed) { this.attemptsUsed = attemptsUsed; }
    public String getVerifiedOutput() { return verifiedOutput; }
    public void setVerifiedOutput(String verifiedOutput) { this.verifiedOutput = verifiedOutput; }
    public String getRemainingError() { return remainingError; }
    public void setRemainingError(String remainingError) { this.remainingError = remainingError; }
    public boolean isVerificationSupported() { return verificationSupported; }
    public void setVerificationSupported(boolean verificationSupported) { this.verificationSupported = verificationSupported; }
    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }
    public String getTargetPath() { return targetPath; }
    public void setTargetPath(String targetPath) { this.targetPath = targetPath; }

    /**
     * One contiguous line-range replacement.
     *
     * Line numbers are 1-based and always refer to the ORIGINAL code, so the
     * frontend can render a diff without replaying anything.
     */
    public static class FixEdit {
        private int startLine;
        private int endLine;
        private String oldText;
        private String newText;

        public FixEdit() {}

        public FixEdit(int startLine, int endLine, String oldText, String newText) {
            this.startLine = startLine;
            this.endLine = endLine;
            this.oldText = oldText;
            this.newText = newText;
        }

        public int getStartLine() { return startLine; }
        public void setStartLine(int startLine) { this.startLine = startLine; }
        public int getEndLine() { return endLine; }
        public void setEndLine(int endLine) { this.endLine = endLine; }
        public String getOldText() { return oldText; }
        public void setOldText(String oldText) { this.oldText = oldText; }
        public String getNewText() { return newText; }
        public void setNewText(String newText) { this.newText = newText; }
    }

    /** A single pass of the propose → apply → run → observe loop. */
    public static class Attempt {
        private int number;
        private String summary;
        private boolean verified;
        /** Why this attempt was rejected — the error it produced, or an invalid edit. */
        private String rejectedBecause;

        public Attempt() {}

        public Attempt(int number, String summary, boolean verified, String rejectedBecause) {
            this.number = number;
            this.summary = summary;
            this.verified = verified;
            this.rejectedBecause = rejectedBecause;
        }

        public int getNumber() { return number; }
        public void setNumber(int number) { this.number = number; }
        public String getSummary() { return summary; }
        public void setSummary(String summary) { this.summary = summary; }
        public boolean isVerified() { return verified; }
        public void setVerified(boolean verified) { this.verified = verified; }
        public String getRejectedBecause() { return rejectedBecause; }
        public void setRejectedBecause(String rejectedBecause) { this.rejectedBecause = rejectedBecause; }
    }
}

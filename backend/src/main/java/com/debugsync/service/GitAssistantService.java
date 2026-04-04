package com.debugsync.service;

import com.debugsync.dto.CommitSuggestionDto;
import com.debugsync.model.CodeSnapshot;
import com.debugsync.model.ErrorLog;
import com.debugsync.model.ExecutionLog;
import com.debugsync.repository.ErrorRepository;
import com.debugsync.util.DiffUtil;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

@Service
public class GitAssistantService {

    private final ErrorRepository errorRepository;

    public GitAssistantService(ErrorRepository errorRepository) {
        this.errorRepository = errorRepository;
    }

    /**
     * Determines the appropriate commit suggestion based on the transition
     * between the previous execution and the current execution.
     *
     * @param prevSnapshot Previous snapshot to compare against.
     * @param prevExecutionLog The execution log of the previous run.
     * @param currentCode The current code being analyzed.
     * @param hasCurrentError Whether the current run failed.
     * @param diff The computed diff string.
     * @param language The language of the code to detect UI changes.
     * @return Generated CommitSuggestionDto or null if no significant change.
     */
    public CommitSuggestionDto analyze(CodeSnapshot prevSnapshot, ExecutionLog prevExecutionLog,
                                       String currentCode, boolean hasCurrentError,
                                       String diff, String language) {
        CommitSuggestionDto suggestion = new CommitSuggestionDto();
        
        // Extract modified variables/files heuristically
        List<String> modifiedFiles = guessModifiedFiles(currentCode, language);
        suggestion.setModifiedFiles(modifiedFiles);
        suggestion.setAffectedFiles(new ArrayList<>());

        if (prevSnapshot == null) {
            suggestion.setType("feat");
            suggestion.setConfidence("HIGH");
            suggestion.setReason("First run of the session (Initial commit)");
            suggestion.setMessage("feat: initial commit of actual project files");
            return suggestion;
        }

        if (diff == null || diff.isEmpty()) {
            return null; // No changes since last run
        }

        boolean hadPrevError = prevSnapshot.isHasError() || 
                               (prevExecutionLog != null && prevExecutionLog.getError() != null && !prevExecutionLog.getError().isEmpty());

        // CASE 1: BUG FIX (Error -> Success)
        if (hadPrevError && !hasCurrentError) {
            suggestion.setType("fix");
            suggestion.setConfidence("HIGH");
            suggestion.setReason("Detected bug fix (error → success)");
            
            // Try to extract exact context from previous error
            String contextStr = "issue";
            if (prevExecutionLog != null) {
                ErrorLog lastError = errorRepository.findByExecutionId(prevExecutionLog.getId());
                if (lastError != null && lastError.getMessage() != null) {
                    // E.g., "resolve ReferenceError in Main"
                    contextStr = lastError.getType();
                    if (contextStr == null || contextStr.isEmpty()) contextStr = "exception";

                    
                    // Cleanup common long error messages for concise commit
                    if (contextStr.length() > 20) {
                        contextStr = "error";
                    }
                }
            }
            
            String fileContext = modifiedFiles.isEmpty() ? "code" : modifiedFiles.get(0).replace(".java", "").replace(".js", "");
            suggestion.setMessage(String.format("fix: resolve %s in %s", contextStr, fileContext));
            return suggestion;
        }

        // Only do further analysis if there's no error right now
        if (hasCurrentError) {
            return null; // Don't suggest committing broken code unless specifically requested via UI.
        }

        // CASE 3: UI UPDATE
        if ("html".equals(language) || "css".equals(language)) {
            suggestion.setType("style");
            suggestion.setConfidence("MEDIUM");
            suggestion.setReason("Detected UI/Style modification");
            suggestion.setMessage("style: update UI elements");
            return suggestion;
        }

        // Analyze diff for Case 2 (FEATURE) and Case 4 (REFACTOR)
        int linesAdded = countLines(diff, "+ Line");
        int linesRemoved = countLines(diff, "- Line");

        // CASE 2: FEATURE
        // Simple heuristic: Significant additions or new methods
        if (linesAdded > 5 || diff.contains("+ function") || diff.contains("+ class") || 
            diff.contains("+ public") || diff.contains("+ def ")) {
            suggestion.setType("feat");
            suggestion.setConfidence("MEDIUM");
            suggestion.setReason("Detected significant structural additions (new features)");
            
            String fileContext = modifiedFiles.isEmpty() ? "module" : modifiedFiles.get(0).replace(".java", "").replace(".js", "");
            suggestion.setMessage("feat: implement new functionality in " + fileContext);
            return suggestion;
        }

        // CASE 4: REFACTOR
        // Changes occurred but no new structural blocks
        if (linesAdded > 0 || linesRemoved > 0) {
            suggestion.setType("refactor");
            suggestion.setConfidence("LOW");
            suggestion.setReason("Detected structural changes with no major additions");
            String fileContext = modifiedFiles.isEmpty() ? "code" : modifiedFiles.get(0).replace(".java", "").replace(".js", "");
            suggestion.setMessage("refactor: clean up logic in " + fileContext);
            return suggestion;
        }

        return null;
    }

    private int countLines(String text, String searchStr) {
        if (text == null || text.isEmpty()) return 0;
        int count = 0;
        int idx = 0;
        while ((idx = text.indexOf(searchStr, idx)) != -1) {
            count++;
            idx += searchStr.length();
        }
        return count;
    }

    private List<String> guessModifiedFiles(String code, String language) {
        // As standard execution runs all code as one block currently,
        // we infer the primary class name or use a default marker based on lang.
        if (code == null) return Collections.singletonList("main.js");
        
        if ("java".equals(language)) {
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("class\\s+(\\w+)").matcher(code);
            String lastClass = "Main";
            while (m.find()) { lastClass = m.group(1); }
            return Collections.singletonList(lastClass + ".java");
        } else if ("python".equals(language)) {
            return Collections.singletonList("script.py");
        } else if ("html".equals(language)) {
            return Collections.singletonList("index.html");
        } else if ("css".equals(language)) {
            return Collections.singletonList("style.css");
        }
        return Collections.singletonList("script.js");
    }
}

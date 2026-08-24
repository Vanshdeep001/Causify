/*
 * InstructionGuard.java — what the Mario agent will and will not accept
 *
 * The agent has exactly one capability: return line edits to the file the user
 * has open. It cannot answer a question, hold a conversation, look anything up,
 * or write prose. So the scope test is not really "is this about programming" —
 * it is "is this a change to THIS FILE". "What is a closure?" is a perfectly
 * good coding question and still out of scope, because there is nothing this
 * agent could do with it but invent an edit nobody asked for.
 *
 * That last part is the actual risk. Given an off-topic request and a JSON
 * schema demanding `edits`, a model will fill the schema in — so "tell me a
 * joke" comes back as a real patch to a real file, and the user is one click
 * from applying it. A refusal is not politeness here; it is what stops the
 * agent editing code for a reason that has nothing to do with the code.
 *
 * Two layers, and the split matters:
 *
 *   1. THIS CLASS. Cheap, deterministic, and deliberately HIGH PRECISION at the
 *      cost of recall — it only rejects requests that are unambiguously not
 *      code changes. A false positive refuses work the user legitimately asked
 *      for, which is far worse than a false negative, because
 *   2. THE PROMPT. AutoFixService asks the model itself to refuse anything out
 *      of scope, and that catches everything this class deliberately lets past.
 *
 * So the rule for editing the patterns below: when in doubt, let it through.
 */
package com.debugsync.service;

import java.util.regex.Pattern;

final class InstructionGuard {

    private InstructionGuard() {}

    /**
     * Longest instruction accepted.
     *
     * Not a safety boundary — it is a cost one. The instruction is pasted into
     * a prompt that already carries the whole file, and an essay-length request
     * is either a mistake or someone pasting a document at the agent.
     */
    static final int MAX_INSTRUCTION_CHARS = 2000;

    /**
     * Anything that suggests the request touches code, however faintly.
     *
     * Read the leniency here as deliberate. A single hit sends the request
     * through to the model, so this list exists to PROTECT real work from the
     * off-topic patterns below, not to prove the request is legitimate. It is
     * broad on purpose: domain words, punctuation that only appears in code,
     * hex colours, file extensions, call syntax.
     */
    private static final Pattern CODE_SIGNAL = Pattern.compile(
            "(?i)\\b("
            + "code|function|func|method|class|variable|const|let|var|import|export|return|"
            + "bug|error|crash|fail|exception|stack ?trace|null|undefined|nan|typo|syntax|"
            + "refactor|rename|extract|inline|comment|indent|format|lint|debug|fix|"
            + "css|html|js|jsx|ts|tsx|python|java|sql|json|yaml|api|endpoint|route|component|"
            + "colou?r|font|margin|padding|width|height|background|border|style|hover|flex|grid|"
            + "loop|array|list|dict|map|set|string|int|float|bool|param|argument|value|"
            + "test|assert|mock|regex|async|await|promise|callback|hook|state|prop|render|"
            + "file|line|button|input|form|div|span|header|footer|log|print|console|"
            + "add|remove|delete|change|replace|move|wrap|split|merge|handle|check|validate"
            + ")\\b"
            // Shapes that essentially only occur in code or in talk about code.
            + "|[\\w$]+\\s*\\(|=>|[{};]|\\.[a-z]{1,5}\\b|#[0-9a-fA-F]{3,8}\\b|</?\\w+>"
    );

    /**
     * Shapes that are plainly not a request to change a file.
     *
     * Every one of these is anchored or specific enough that a code request
     * would have to go out of its way to match — and even then, it only counts
     * when the text carries no code signal at all.
     */
    private static final Pattern OFF_TOPIC = Pattern.compile(
            "(?i)"
            // Bare general-knowledge questions: "who is …", "what was …".
            + "^\\s*(who|what|when|where|why|which|how much|how many)\\s+"
            + "(is|are|was|were|will|would|did|does|do|can)\\b.*"
            // Requests for prose rather than code.
            + "|\\b(tell|sing|write|compose|draft)\\s+(me\\s+)?(a|an|the|some)?\\s*"
            + "(joke|story|poem|song|essay|recipe|letter|email|tweet|blog|article|speech)\\b"
            // Subjects with nothing to do with the file on screen.
            + "|\\b(weather|forecast|news|headlines|stock price|president|prime minister|"
            + "capital of|meaning of life|horoscope|lottery|score|match|movie|film|"
            + "restaurant|hotel|flight|holiday|vacation)\\b"
            // Pure pleasantries.
            + "|^\\s*(hi|hello|hey|yo|sup|thanks|thank you|ty|ok|okay|cool|nice|"
            + "good (morning|afternoon|evening|night))\\s*[!.?]*\\s*$"
    );

    /** Why an instruction was turned away, or null when it is worth sending. */
    static String reasonToRefuse(String instruction) {
        if (instruction == null || instruction.isBlank()) return null;
        String text = instruction.trim();

        if (text.length() > MAX_INSTRUCTION_CHARS) {
            return "That request is too long for me to work from. Tell me in a sentence "
                    + "or two what you want changed in this file.";
        }

        /* Both conditions, never one. OFF_TOPIC alone would reject "why is this
         * function returning undefined", which is exactly the kind of request
         * the agent exists for — the code signal is what saves it. */
        if (OFF_TOPIC.matcher(text).find() && !CODE_SIGNAL.matcher(text).find()) {
            return offTopicMessage();
        }

        return null;
    }

    /**
     * What the agent says when it declines.
     *
     * Says what it CAN do rather than what it will not. A refusal that only
     * lists prohibitions leaves the user guessing at the shape of a request
     * that would have worked.
     */
    static String offTopicMessage() {
        return "I only make code changes to the file you have open — I can't answer "
                + "questions or chat. Try something like \"rename this variable\", "
                + "\"handle the empty case\" or \"make the total red\".";
    }
}

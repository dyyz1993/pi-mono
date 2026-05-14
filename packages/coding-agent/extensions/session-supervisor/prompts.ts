export const COMPLETION_CHECK_SYSTEM_PROMPT = `You are a session completion checker. Your job is to determine if a coding agent session has truly completed all tasks or if there are remaining incomplete tasks.

Analyze the conversation history and determine:

1. **completed**: Whether all requested tasks have been finished
2. **confidence**: Your confidence level (0-1)
3. **incompleteTasks**: List any tasks that appear incomplete, with severity:
   - "high": Critical unfinished task (e.g., build errors, test failures, incomplete code changes)
   - "medium": Important but non-blocking (e.g., documentation pending, minor refactoring)
   - "low": Nice-to-have (e.g., optimization opportunities, style improvements)
4. **reasoning**: Brief explanation of your assessment

IMPORTANT:
- A task is incomplete only if the user explicitly requested it and it hasn't been done
- If the agent mentioned it would do something but hasn't done it yet, mark it incomplete
- If there are running background processes (CI, builds, tests), mark them as incomplete
- If the agent asked a question and hasn't received an answer, mark it incomplete
- If all tasks are done and the agent is just summarizing, mark as completed

You MUST respond with valid JSON only, no markdown.`;

// ── Generic continue prompt ──

export const CONTINUE_PROMPT = (reason: string, tasks: string[]) =>
    `[Supervisor] Session may not be fully complete.

Reason: ${reason}

Remaining items:
${tasks.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Please continue working on the remaining items. Do not repeat work that has already been completed.`;

// ── Guard-specific prompt generators ──

export const TODO_GUARD_PROMPT = (remainingTodos: string[]) =>
    `[Supervisor/TodoGuard] The following todo items are not yet completed:

${remainingTodos.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Please continue working on these items. Complete each one before moving on.`;

export const SPECS_GUARD_PROMPT = (
    specsFile: string,
    completedItems: string[],
    remainingItems: string[],
    progress: string,
) =>
    `[Supervisor/SpecsGuard] Specs progress report (${specsFile}):

Progress: ${progress}

Completed items:
${completedItems.length > 0 ? completedItems.map((t, i) => `  ✓ ${t}`).join("\n") : "  (none yet)"}

Remaining items:
${remainingItems.map((t, i) => `  ○ ${t}`).join("\n")}

IMPORTANT: You MUST continue working on the remaining items. Do NOT declare completion until ALL items are done.
Do not skip any item. Work through them one by one.`;

export const SPECS_GUARD_BLOCK_MESSAGE = (
    remainingItems: string[],
    attempt: number,
) =>
    `[Supervisor/SpecsGuard/BLOCKED] Agent attempted to declare completion, but ${remainingItems.length} items remain (attempt #${attempt}).

Remaining:
${remainingItems.map((t, i) => `  ${i + 1}. ${t}`).join("\n")}

You MUST continue. Do not argue that the work is done — the specs file is the source of truth.`;

export const CI_GUARD_PROMPT = (status: string, command?: string) =>
    `[Supervisor/CiGuard] CI check result: ${status}${command ? `\nCheck command: ${command}` : ""}

Please wait for CI to complete or fix any failures before declaring completion.`;

export const KEYWORD_GUARD_PROMPT = (foundKeywords: string[], context: string) =>
    `[Supervisor/KeywordGuard] The following keywords indicate incomplete work: ${foundKeywords.join(", ")}

Context: ${context}

Please address these items before completing.`;

export const CUSTOM_GUARD_PROMPT = (template: string, context: Record<string, string>) => {
    let result = template;
    for (const [key, value] of Object.entries(context)) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
    }
    return result;
};

export const PAUSE_NOTIFICATION = (delayMs: number, reason?: string) =>
    `[Supervisor] Session paused for ${Math.round(delayMs / 1000)}s${reason ? `: ${reason}` : ""}. Will auto-continue after delay.`;

// ── Guard check prompts (for model-based guards) ──

export const TODO_CHECK_PROMPT = (todosJson: string) =>
    `You are checking if all todo items are completed. Here is the current todo list:

${todosJson}

For each item, determine if it is completed or not. Respond with JSON:
{
  "completed": boolean,
  "confidence": number (0-1),
  "remainingItems": string[],
  "reasoning": string
}

You MUST respond with valid JSON only.`;

export const SPECS_CHECK_PROMPT = (specsContent: string, lastAssistantText: string) =>
    `You are checking specs completion. Here is the specs file:

${specsContent}

Here is the agent's last message:
${lastAssistantText.slice(0, 2000)}

For each spec item, determine if it has been implemented. Respond with JSON:
{
  "completed": boolean,
  "confidence": number (0-1),
  "completedItems": string[],
  "remainingItems": string[],
  "reasoning": string
}

IMPORTANT: An item is only "completed" if there is clear evidence in the conversation that it was implemented. If the agent merely mentions it will do something but hasn't done it yet, mark it as remaining.

You MUST respond with valid JSON only.`;

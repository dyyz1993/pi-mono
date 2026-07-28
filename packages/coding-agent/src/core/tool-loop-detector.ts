/**
 * Tool-loop detection for AgentSession.
 *
 * Detects consecutive identical tool calls (same tool + similar arguments) that
 * result in errors, and consecutive identical tool calls regardless of error
 * status. When a threshold is reached, the session is notified to abort and
 * inject a corrective message.
 *
 * Based on analysis of 10,057 real sessions:
 * - 677 loops found; longest was 72 consecutive identical calls
 * - 81% of loops correlate with compaction_fold erasing prior history
 * - Most common looping tools: bash, read, write, edit
 * - Most extreme pattern: empty `{}` validation errors (213 occurrences)
 *
 * The counter persists across compaction (it's an in-memory field, not part
 * of the message stream), covering both single-prompt and cross-turn loops.
 */

// Tools that legitimately repeat and should not trigger loop detection.
const LOOP_EXEMPT_TOOLS = new Set([
	"todo",
	"session_delegate_status",
	"session_delegate_fork",
	"preview",
	"lsp",
	"get_background_process",
]);

/** Max consecutive identical tool calls before hard-aborting the run. */
const MAX_IDENTICAL_TOOL_CALLS = 5;

/** Max consecutive identical tool calls with errors before hard-aborting. */
const MAX_IDENTICAL_ERROR_CALLS = 2;

/**
 * Compute a normalized signature for a tool call.
 *
 * Design principle: the signature must be loose enough to catch loops
 * (same tool + same target) but strict enough to avoid false positives
 * on legitimate repetitive operations.
 *
 * - read: path + offset (reading different parts of a large file is legitimate)
 * - edit/write: path only (editing the same file repeatedly with different
 *   content is still suspicious — but errors are tracked separately)
 * - bash: command normalized via normalizeBashCommand (no-op/echo collapsed)
 * - grep/glob: pattern
 * - others: full JSON
 */

/**
 * Normalize a bash command for loop-detection signatures.
 *
 * No-op / output-only commands are collapsed to a fixed signature so that
 * LLM loops varying the echo text (a common degradation pattern under
 * context pressure) are detected:
 *   echo "submitting"       → bash:cmd=echo
 *   echo 'done'             → bash:cmd=echo
 *   echo submitting now     → bash:cmd=echo
 *   true                    → bash:cmd=noop
 *   :                       → bash:cmd=noop
 *   # comment               → bash:cmd=noop
 *   printf "..."            → bash:cmd=printf
 *
 * Any command with side effects (cd, git, cargo, grep, etc.) keeps its
 * truncated full-text signature.
 */
function normalizeBashCommand(cmd: string): string {
	const trimmed = cmd.trim();
	if (trimmed === "") return "";

	// Strip leading env-var assignments (FOO=bar baz=qux <real command>)
	const withoutEnv = trimmed.replace(/^(?:\w+=\S+\s+)+/, "");
	const firstToken = withoutEnv.split(/\s+/)[0] ?? "";

	// Pure no-op commands — always collapse regardless of arguments
	if (firstToken === "true" || firstToken === ":" || firstToken === "#") {
		return "noop";
	}

	// echo / printf — output-only, collapse to tool name
	if (firstToken === "echo" || firstToken === "printf") {
		return firstToken;
	}

	// Fall back to truncated full command for everything else
	return cmd.slice(0, 200);
}

export function computeToolSignature(toolName: string, args: Record<string, unknown> | undefined): string {
	if (!args || Object.keys(args).length === 0) {
		return `${toolName}:{}`;
	}

	// read: include offset to avoid false-positive on reading different parts
	if (toolName === "read") {
		const path = String(args.path ?? args.filePath ?? "");
		const offset = args.offset ?? 0;
		return `${toolName}:path=${path}:offset=${offset}`;
	}

	// edit/write: signature on path only (repeated edits to same file is suspicious)
	if (toolName === "edit" || toolName === "write") {
		const path = String(args.path ?? args.filePath ?? "");
		return `${toolName}:path=${path}`;
	}

	// Bash: signature on command (truncated).
	// No-op commands (echo / true / : / printf to stdout / comment) are
	// normalized to a single signature so that LLM loops like
	//   echo "submitting" → echo "done" → echo "final submit" → ...
	// are caught regardless of the varying text content.
	if (toolName === "bash") {
		const rawCmd = String(args.command ?? "");
		return `${toolName}:cmd=${normalizeBashCommand(rawCmd)}`;
	}

	// Search tools: signature on pattern
	if (toolName === "grep" || toolName === "glob") {
		const pattern = String(args.pattern ?? "");
		return `${toolName}:pattern=${pattern}`;
	}

	// Default: full JSON signature
	return `${toolName}:${JSON.stringify(args)}`;
}

export interface LoopDetectionState {
	/** The last tool call signature (tool name + normalized args). */
	lastSignature: string;
	/** Consecutive count of the same signature. */
	consecutiveCount: number;
	/** Consecutive count of the same signature with errors. */
	consecutiveErrorCount: number;
	/** Cached args from tool_execution_start, keyed by toolCallId. */
	pendingArgs: Map<string, { toolName: string; args: Record<string, unknown> | undefined }>;
}

export function createLoopDetectionState(): LoopDetectionState {
	return {
		lastSignature: "",
		consecutiveCount: 0,
		consecutiveErrorCount: 0,
		pendingArgs: new Map(),
	};
}

export function resetLoopDetection(state: LoopDetectionState): void {
	state.lastSignature = "";
	state.consecutiveCount = 0;
	state.consecutiveErrorCount = 0;
	// Don't clear pendingArgs — in-flight tool calls should still resolve
}

export interface LoopDetectionResult {
	/** A loop was detected and the run should be aborted. */
	detected: boolean;
	/** The tool that was looping. */
	toolName: string;
	/** How many consecutive identical calls occurred. */
	count: number;
	/** Whether the loop involved errors. */
	hadErrors: boolean;
	/** The corrective message to inject after abort. */
	message: string;
}

/**
 * Record a tool_execution_start event. Caches args for later use when
 * tool_execution_end fires.
 */
export function recordToolStart(
	state: LoopDetectionState,
	toolCallId: string,
	toolName: string,
	args: Record<string, unknown> | undefined,
): void {
	state.pendingArgs.set(toolCallId, { toolName, args });
}

/**
 * Process a tool_execution_end event. Returns a LoopDetectionResult if a loop
 * is detected, or undefined otherwise.
 */
export function checkToolEnd(
	state: LoopDetectionState,
	toolCallId: string,
	toolName: string,
	isError: boolean,
): LoopDetectionResult | undefined {
	// Skip exempt tools
	if (LOOP_EXEMPT_TOOLS.has(toolName)) {
		state.pendingArgs.delete(toolCallId);
		return undefined;
	}

	// Retrieve cached args from tool_execution_start
	const cached = state.pendingArgs.get(toolCallId);
	state.pendingArgs.delete(toolCallId);

	const args = cached?.args;
	const signature = computeToolSignature(toolName, args);

	if (signature === state.lastSignature) {
		state.consecutiveCount++;
		if (isError) {
			state.consecutiveErrorCount++;
		} else {
			// Reset error count on success — a successful call breaks the error loop
			state.consecutiveErrorCount = 0;
		}
	} else {
		state.lastSignature = signature;
		state.consecutiveCount = 1;
		state.consecutiveErrorCount = isError ? 1 : 0;
	}

	// Check error threshold first (stricter — 2 consecutive errors = abort)
	if (state.consecutiveErrorCount >= MAX_IDENTICAL_ERROR_CALLS) {
		return {
			detected: true,
			toolName,
			count: state.consecutiveCount,
			hadErrors: true,
			message: buildAbortMessage(toolName, state.consecutiveCount, true),
		};
	}

	// Check general threshold (5 consecutive identical calls)
	if (state.consecutiveCount >= MAX_IDENTICAL_TOOL_CALLS) {
		return {
			detected: true,
			toolName,
			count: state.consecutiveCount,
			hadErrors: state.consecutiveErrorCount > 0,
			message: buildAbortMessage(toolName, state.consecutiveCount, state.consecutiveErrorCount > 0),
		};
	}

	return undefined;
}

function buildAbortMessage(toolName: string, count: number, hadErrors: boolean): string {
	if (hadErrors) {
		return (
			`[Loop detection] The tool "${toolName}" has been called ${count} times consecutively with the same arguments ` +
			`and is failing each time. Stop repeating the same call. Change your approach: try a different tool, ` +
			`read the full file before editing, or ask the user for guidance.`
		);
	}
	return (
		`[Loop detection] The tool "${toolName}" has been called ${count} times consecutively with the same arguments. ` +
		`This appears to be a loop. Stop repeating the same call and try a different approach.`
	);
}

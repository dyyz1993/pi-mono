export interface ClaudeHookConfig {
	hooks?: Record<string, MatcherGroup[]>;
	disableAllHooks?: boolean;
}

export interface MatcherGroup {
	matcher?: string;
	hooks: HookHandler[];
}

export interface HookHandler {
	type: "command" | "http" | "mcp_tool" | "prompt" | "agent";
	command?: string;
	prompt?: string;
	url?: string;
	server?: string;
	tool?: string;
	input?: Record<string, unknown>;
	headers?: Record<string, string>;
	allowedEnvVars?: string[];
	model?: string;
	timeout?: number;
	if?: string;
	async?: boolean;
	asyncRewake?: boolean;
	shell?: "bash" | "powershell";
	statusMessage?: string;
	once?: boolean;
	"x-pi-variables"?: Record<string, string>;
}

export interface HookStdinData {
	session_id: string;
	transcript_path: string;
	cwd: string;
	permission_mode: string;
	hook_event_name: string;
	tool_name?: string;
	tool_input?: Record<string, unknown>;
	tool_use_id?: string;
	tool_output?: string;
	agent_type?: string;
	agent_id?: string;
	[key: string]: unknown;
}

export interface HookOutput {
	exitCode: number;
	stdout: string;
	stderr: string;
	parsed?: HookParsedOutput;
}

export interface HookParsedOutput {
	decision?: string;
	reason?: string;
	ok?: boolean;
	continue?: boolean;
	stopReason?: string;
	suppressOutput?: boolean;
	systemMessage?: string;
	retry?: boolean;
	hookSpecificOutput?: {
		hookEventName?: string;
		permissionDecision?: "allow" | "deny" | "ask" | "defer";
		permissionDecisionReason?: string;
		updatedInput?: Record<string, unknown>;
		modifiedToolInput?: Record<string, unknown>;
		additionalContext?: string;
		[key: string]: unknown;
	};
}

export interface IfClause {
	tool: string;
	pattern: string;
}

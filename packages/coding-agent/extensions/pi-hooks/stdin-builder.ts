import type { HookStdinData } from "./types.ts";

export function buildStdinData(
	eventName: string,
	extra: {
		toolName?: string;
		toolInput?: Record<string, unknown>;
		toolOutput?: string;
		toolUseId?: string;
		cwd: string;
		sessionId?: string;
		agentType?: string;
		permissionMode?: string;
		transcriptPath?: string;
	},
): HookStdinData {
	const data: HookStdinData = {
		session_id: extra.sessionId ?? "",
		transcript_path: extra.transcriptPath ?? "",
		cwd: extra.cwd,
		permission_mode: extra.permissionMode ?? "default",
		hook_event_name: eventName,
		tool_name: extra.toolName,
		tool_input: extra.toolInput,
		tool_use_id: extra.toolUseId,
		tool_output: extra.toolOutput,
		agent_type: extra.agentType,
	};
	// Claude Code compat: PostToolUse stdin includes tool_response (not tool_output)
	if (eventName === "PostToolUse" && extra.toolOutput !== undefined) {
		(data as Record<string, unknown>).tool_response = extra.toolOutput;
	}
	return data;
}

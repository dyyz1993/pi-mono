import type { HookStdinData } from "./types.js";

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
	},
): HookStdinData {
	return {
		session_id: extra.sessionId ?? "",
		transcript_path: "",
		cwd: extra.cwd,
		permission_mode: "default",
		hook_event_name: eventName,
		tool_name: extra.toolName,
		tool_input: extra.toolInput,
		tool_use_id: extra.toolUseId,
		tool_output: extra.toolOutput,
		agent_type: extra.agentType,
	};
}

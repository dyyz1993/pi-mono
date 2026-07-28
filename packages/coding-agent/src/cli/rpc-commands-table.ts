/**
 * Static RPC command catalogue.
 *
 * The RPC protocol commands live only in the TypeScript type system
 * (`RpcCommand` union in `modes/rpc/rpc-types.ts`) — there is no runtime
 * schema, so `pi rpc --list-commands` mirrors that union here as a static
 * table. When a command is added or removed upstream, update this file too.
 *
 * Group names match the `docs/rpc/rpc-commands-*.md` documents.
 */

export interface RpcCommandEntry {
	name: string;
	summary: string;
	group: RpcCommandGroup;
}

export type RpcCommandGroup =
	| "Prompting"
	| "State"
	| "Session"
	| "Model"
	| "Messages"
	| "Tools"
	| "Extensions"
	| "Settings"
	| "MCP"
	| "Channels";

export const RPC_COMMAND_GROUPS: RpcCommandGroup[] = [
	"Prompting",
	"State",
	"Session",
	"Model",
	"Messages",
	"Tools",
	"Extensions",
	"Settings",
	"MCP",
	"Channels",
];

export const RPC_COMMAND_TABLE: readonly RpcCommandEntry[] = [
	// ── Prompting ──────────────────────────────────────────────────────────
	{ name: "prompt", group: "Prompting", summary: "Send a user message; events stream until agent_end" },
	{ name: "steer", group: "Prompting", summary: "Steer a running turn" },
	{ name: "follow_up", group: "Prompting", summary: "Queue a follow-up message" },
	{ name: "promote_follow_up", group: "Prompting", summary: "Promote a queued follow-up to active" },
	{ name: "continue", group: "Prompting", summary: "Resume after a stop" },
	{ name: "abort", group: "Prompting", summary: "Abort the current turn" },
	{ name: "steering", group: "Prompting", summary: "Steering control" },

	// ── State ──────────────────────────────────────────────────────────────
	{ name: "get_state", group: "State", summary: "Snapshot of session state" },
	{ name: "get_session_stats", group: "State", summary: "Token/turn statistics" },
	{ name: "get_context_usage", group: "State", summary: "Context window usage" },
	{ name: "get_queue", group: "State", summary: "Queued messages" },
	{ name: "clear_queue", group: "State", summary: "Clear the message queue" },

	// ── Session ────────────────────────────────────────────────────────────
	{ name: "new_session", group: "Session", summary: "Start a new session" },
	{ name: "switch_session", group: "Session", summary: "Switch to an existing session" },
	{ name: "clone", group: "Session", summary: "Clone the current session" },
	{ name: "reload", group: "Session", summary: "Reload session from disk" },
	{ name: "set_cwd", group: "Session", summary: "Change working directory" },
	{ name: "set_session_name", group: "Session", summary: "Name the current session" },
	{ name: "set_permission_mode", group: "Session", summary: "Set permission mode" },
	{ name: "append_system_event", group: "Session", summary: "Append a system event entry" },

	// ── Model ──────────────────────────────────────────────────────────────
	{ name: "get_available_models", group: "Model", summary: "List configured models" },
	{ name: "get_tier_models", group: "Model", summary: "Tier (fast/pro/max) model mapping" },
	{ name: "set_tier_models", group: "Model", summary: "Set tier model mapping" },
	{ name: "set_model", group: "Model", summary: "Switch active model" },
	{ name: "cycle_model", group: "Model", summary: "Cycle to the next model" },
	{ name: "set_thinking_level", group: "Model", summary: "Set thinking level" },
	{ name: "cycle_thinking_level", group: "Model", summary: "Cycle thinking level" },
	{ name: "set_steering_mode", group: "Model", summary: "Steering concurrency mode" },
	{ name: "set_follow_up_mode", group: "Model", summary: "Follow-up concurrency mode" },

	// ── Messages & history ─────────────────────────────────────────────────
	{ name: "get_messages", group: "Messages", summary: "Lightweight message list" },
	{ name: "get_full_messages", group: "Messages", summary: "Full messages with content" },
	{ name: "get_last_assistant_text", group: "Messages", summary: "Last assistant text" },
	{ name: "get_system_prompt", group: "Messages", summary: "Rendered system prompt" },
	{ name: "get_tree", group: "Messages", summary: "Session entry tree" },
	{ name: "get_tree_with_leaf", group: "Messages", summary: "Entry tree to a leaf" },
	{ name: "navigate_tree", group: "Messages", summary: "Navigate the entry tree" },
	{ name: "get_file_history", group: "Messages", summary: "File history entries" },
	{ name: "get_file_diff", group: "Messages", summary: "Single file diff" },
	{ name: "get_batch_diffs", group: "Messages", summary: "Batch file diffs" },
	{ name: "get_modified_files", group: "Messages", summary: "Files changed since baseline" },
	{ name: "get_latest_agent_change", group: "Messages", summary: "Latest change entry" },
	{ name: "fork", group: "Messages", summary: "Fork at an entry" },
	{ name: "copy_fork", group: "Messages", summary: "Copy a fork" },
	{ name: "get_fork_messages", group: "Messages", summary: "Fork point messages" },
	{ name: "rollback_preview", group: "Messages", summary: "Preview a rollback" },
	{ name: "delete_entries", group: "Messages", summary: "Delete entries" },
	{ name: "summarize_entries", group: "Messages", summary: "Summarize entries" },
	{ name: "export_html", group: "Messages", summary: "Export session as HTML" },

	// ── Compaction ─────────────────────────────────────────────────────────
	{ name: "compact", group: "Messages", summary: "Run compaction" },
	{ name: "set_auto_compaction", group: "Messages", summary: "Toggle auto-compaction" },
	{ name: "set_auto_retry", group: "Messages", summary: "Toggle auto-retry" },
	{ name: "abort_retry", group: "Messages", summary: "Abort a retry" },

	// ── Tools ──────────────────────────────────────────────────────────────
	{ name: "get_all_tools", group: "Tools", summary: "All tool definitions" },
	{ name: "get_tools", group: "Tools", summary: "Active tool definitions" },
	{ name: "get_active_tools", group: "Tools", summary: "Active tool names" },
	{ name: "set_active_tools", group: "Tools", summary: "Set active tools" },
	{ name: "get_flags", group: "Tools", summary: "Tool flag descriptors" },
	{ name: "get_flag_values", group: "Tools", summary: "Tool flag values" },
	{ name: "set_flag", group: "Tools", summary: "Set a tool flag" },
	{ name: "register_remote_tool", group: "Tools", summary: "Register a remote tool" },
	{ name: "unregister_remote_tool", group: "Tools", summary: "Unregister a remote tool" },
	{ name: "remote_tool_result", group: "Tools", summary: "Return a remote tool result" },

	// ── Extensions & agents ────────────────────────────────────────────────
	{ name: "get_extensions", group: "Extensions", summary: "Loaded extensions" },
	{ name: "get_skills", group: "Extensions", summary: "Available skills" },
	{ name: "get_commands", group: "Extensions", summary: "Slash commands, skills, templates" },
	{ name: "get_agents", group: "Extensions", summary: "Available agents" },
	{ name: "get_agents_files", group: "Extensions", summary: "Agent definition files" },
	{ name: "get_agent_detail", group: "Extensions", summary: "Single agent detail" },
	{ name: "get_current_agent", group: "Extensions", summary: "Currently active agent" },
	{ name: "switch_agent", group: "Extensions", summary: "Switch active agent" },

	// ── Settings ───────────────────────────────────────────────────────────
	{ name: "get_settings", group: "Settings", summary: "Session settings" },
	{ name: "set_settings", group: "Settings", summary: "Update settings" },
	{ name: "bash", group: "Settings", summary: "Run a bash command (gated)" },
	{ name: "abort_bash", group: "Settings", summary: "Abort running bash" },

	// ── MCP ────────────────────────────────────────────────────────────────
	{ name: "get_mcp_servers", group: "MCP", summary: "MCP server status" },
	{ name: "mcp_toggle_server", group: "MCP", summary: "Enable/disable an MCP server" },
	{ name: "mcp_restart_server", group: "MCP", summary: "Restart an MCP server" },
];

/**
 * Channel names registered in the static `ChannelTypeRegistry`
 * (`core/extensions/channel-registry.ts`). The channels actually available
 * at runtime depend on which extensions loaded; this list is the superset.
 */
export const STATIC_CHANNEL_NAMES: readonly string[] = [
	"bash",
	"todo",
	"lsp",
	"learning",
	"subagent",
	"coordinator",
	"rules-engine",
	"supervisor",
	"goal",
	"remote-ssh",
];

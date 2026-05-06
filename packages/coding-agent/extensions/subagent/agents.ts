/**
 * Agent discovery and configuration.
 *
 * Re-exports from the public API for backward compatibility.
 * All types and functions are defined in src/core/agent-types.ts.
 */

export {
	type AgentColor,
	type AgentConfig,
	type AgentDiscoveryResult,
	type AgentHook,
	type AgentHookCommand,
	type AgentHookPrompt,
	type AgentHooks,
	type AgentScope,
	type AgentSource,
	type IsolationMode,
	type MemoryScope,
	type PermissionMode,
	discoverAgents,
	formatAgentList,
	loadAgentsFromDir,
	mergeAgentsByPriority,
} from "@dyyz1993/pi-coding-agent";

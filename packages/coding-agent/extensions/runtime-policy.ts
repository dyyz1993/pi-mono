import * as PiCodingAgent from "@dyyz1993/pi-coding-agent";

export type ExtensionRuntimeKind = "local" | "ssh-command" | "remote-agent-child" | "remote-server";

export interface ExtensionRuntimeResourcePolicy {
	canLoadUserSkills: boolean;
	canLoadProjectSkills: boolean;
	canLoadUserAgents: boolean;
	canLoadProjectAgents: boolean;
	canLoadUserMemory: boolean;
	canLoadProjectMemory: boolean;
	canLoadPlugins: boolean;
	canLoadHooks: boolean;
	promptMayMentionLocalPaths: boolean;
}

function isTruthyEnv(value: string | undefined): boolean {
	if (!value) return false;
	return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

function getFallbackRuntimeKind(): ExtensionRuntimeKind {
	const kind = process.env.PI_RUNTIME_KIND?.trim();
	if (kind === "ssh-command" || kind === "remote-agent-child" || kind === "remote-server" || kind === "local") {
		return kind;
	}
	return isTruthyEnv(process.env.PI_REMOTE_SSH_TOOL_PROXY) ? "ssh-command" : "local";
}

function fallbackRuntimeResourcePolicy(): ExtensionRuntimeResourcePolicy {
	if (getFallbackRuntimeKind() === "ssh-command") {
		return {
			canLoadUserSkills: false,
			canLoadProjectSkills: false,
			canLoadUserAgents: false,
			canLoadProjectAgents: false,
			canLoadUserMemory: false,
			canLoadProjectMemory: false,
			canLoadPlugins: false,
			canLoadHooks: false,
			promptMayMentionLocalPaths: false,
		};
	}
	const promptMayMentionLocalPaths = getFallbackRuntimeKind() === "local";
	return {
		canLoadUserSkills: true,
		canLoadProjectSkills: true,
		canLoadUserAgents: true,
		canLoadProjectAgents: true,
		canLoadUserMemory: true,
		canLoadProjectMemory: true,
		canLoadPlugins: true,
		canLoadHooks: true,
		promptMayMentionLocalPaths,
	};
}

export function getExtensionRuntimeResourcePolicy(): ExtensionRuntimeResourcePolicy {
	const exported = (PiCodingAgent as { getRuntimeResourcePolicy?: () => ExtensionRuntimeResourcePolicy })
		.getRuntimeResourcePolicy;
	return typeof exported === "function" ? exported() : fallbackRuntimeResourcePolicy();
}

// Loader discovery treats every file in extensions/ as an extension and
// requires a default factory. This module is a shared utility consumed by
// other extensions (via jiti alias), so export a no-op factory to load
// cleanly instead of producing a warning on every session start.
export default function runtimePolicyExtension(): void {
	// No-op: this module only provides getExtensionRuntimeResourcePolicy().
}

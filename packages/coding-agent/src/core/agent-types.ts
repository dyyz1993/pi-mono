/**
 * Shared agent types and discovery logic.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, getRuntimeResourcePolicy } from "../config.ts";
import { parseFrontmatter } from "../utils/frontmatter.ts";
import { asRecord, type UnknownRecord } from "../utils/type-helpers.ts";
import type { PermissionProfileInput } from "./permissions/index.ts";
import {
	parseSessionHooks,
	type SessionHookEntry,
	type SessionHookGroup,
	type SessionHookHandler,
	type SessionHooks,
} from "./session-hooks.ts";

export type AgentScope = "user" | "project" | "both";

export type AgentColor = "red" | "blue" | "green" | "yellow" | "purple" | "orange";

export type MemoryScope = "user" | "project" | "local";

export type IsolationMode = "worktree" | "remote";

/**
 * Discriminated avatar value parsed from the `avatar` frontmatter field.
 * - `emoji`: short unicode/emoji text rendered as-is (e.g. "🧑‍💻").
 * - `image`: anything that resolves to a loadable image source — http(s) URL,
 *   `data:` URI, absolute path, or relative path (relative paths are resolved
 *   against the agent .md file's directory at the consumer side).
 */
export type AgentAvatar = { type: "emoji"; value: string } | { type: "image"; src: string };

export type AgentHookCommand = SessionHookHandler & { type: "command"; command: string };
export type AgentHookPrompt = SessionHookHandler & { type: "prompt"; prompt: string };
export type AgentHookHttp = SessionHookHandler & { type: "http"; url: string };
export type AgentHookAgent = SessionHookHandler & { type: "agent"; prompt: string };
export type AgentHook = SessionHookHandler;
export type AgentHookGroup = SessionHookGroup;
export type AgentHookEntry = SessionHookEntry;
export type AgentHooks = SessionHooks;

export interface PathConfig {
	write?: string[];
	read?: string[];
	bash?: string[];
}

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	disallowedTools?: string[];
	model?: string;
	systemPrompt: string;
	source: AgentSource;
	filePath: string;
	permissionMode?: PermissionProfileInput;
	permissionProfile?: PermissionProfileInput;
	maxTurns?: number;
	effort?: string;
	color?: AgentColor;
	background?: boolean;
	memory?: MemoryScope;
	isolation?: IsolationMode;
	initialPrompt?: string;
	skills?: string[];
	hooks?: AgentHooks;
	variables?: Record<string, string>;
	tier?: AgentTier;
	thinkingLevel?: string;
	mode?: AgentMode;
	hidden?: boolean;
	paths?: PathConfig;
	avatar?: AgentAvatar;
}

export type AgentSource = "builtin" | "plugin" | "user" | "project" | "flag" | "policy";

export type AgentTier = "fast" | "pro" | "max";

export type AgentMode = "primary" | "subagent" | "all";

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

const STRING_FIELDS: ReadonlySet<string> = new Set([
	"description",
	"model",
	"permissionMode",
	"permissionProfile",
	"effort",
	"color",
	"memory",
	"isolation",
	"initialPrompt",
	"tier",
	"thinkingLevel",
	"mode",
]);

const STRING_ARRAY_FIELDS: ReadonlySet<string> = new Set(["tools", "disallowedTools", "skills"]);

const BOOLEAN_FIELDS: ReadonlySet<string> = new Set(["background", "hidden"]);

const NUMBER_FIELDS: ReadonlySet<string> = new Set(["maxTurns"]);

function coerceField(key: string, raw: unknown): unknown {
	if (raw === undefined || raw === null) return undefined;
	if (STRING_FIELDS.has(key)) return typeof raw === "string" ? raw : String(raw);
	if (STRING_ARRAY_FIELDS.has(key)) {
		if (Array.isArray(raw)) return raw.map(String);
		if (typeof raw === "string") {
			return raw
				.split(",")
				.map((entry) => entry.trim())
				.filter(Boolean);
		}
		return undefined;
	}
	if (BOOLEAN_FIELDS.has(key)) {
		if (typeof raw === "boolean") return raw;
		if (typeof raw === "string") return raw === "true" || raw === "yes";
		return undefined;
	}
	if (NUMBER_FIELDS.has(key)) {
		if (typeof raw === "number") return raw;
		if (typeof raw === "string") {
			const value = Number.parseInt(raw, 10);
			return Number.isFinite(value) ? value : undefined;
		}
		return undefined;
	}
	return raw;
}

function isStringRecord(raw: unknown): raw is Record<string, string> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
	return Object.values(raw).every((value) => typeof value === "string");
}

function sanitizePatternArray(raw: unknown): string[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const patterns = raw.filter((value) => value != null && String(value).trim() !== "").map(String);
	return patterns.length > 0 ? patterns : undefined;
}

function parsePathConfig(raw: unknown): PathConfig | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const obj = asRecord(raw);
	const paths: PathConfig = {
		write: sanitizePatternArray(obj.write),
		read: sanitizePatternArray(obj.read),
		bash: sanitizePatternArray(obj.bash),
	};
	return paths.write || paths.read || paths.bash ? paths : undefined;
}

const AVATAR_IMAGE_SCHEME = /^(https?:|data:|file:)/i;
// Path-like: starts with `/`, `./`, `../`, or a Windows drive root (e.g. `C:\` or `C:/`).
const AVATAR_PATH_PREFIX = /^(\/|\.\/|\.\.[/\\]|[A-Za-z]:[\\/])/;

function parseAvatar(raw: unknown): AgentAvatar | undefined {
	if (typeof raw !== "string") return undefined;
	const trimmed = raw.trim();
	if (!trimmed) return undefined;
	if (AVATAR_IMAGE_SCHEME.test(trimmed) || AVATAR_PATH_PREFIX.test(trimmed)) {
		return { type: "image", src: trimmed };
	}
	return { type: "emoji", value: trimmed };
}

export function loadAgentsFromDir(dir: string, source: AgentSource): AgentConfig[] {
	if (!fs.existsSync(dir)) return [];

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	const agents: AgentConfig[] = [];
	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
		if (!frontmatter.name || !frontmatter.description) continue;

		// Validate: warn on unknown / deprecated fields so authors can fix them early
		const KNOWN_FIELDS = new Set([
			"name",
			"description",
			"tools",
			"disallowedTools",
			"model",
			"permissionMode",
			"permissionProfile",
			"maxTurns",
			"effort",
			"color",
			"background",
			"memory",
			"isolation",
			"initialPrompt",
			"skills",
			"hooks",
			"variables",
			"tier",
			"thinkingLevel",
			"mode",
			"hidden",
			"paths",
			"avatar",
		]);
		const fmKeys = Object.keys(frontmatter);
		const unknownFields = fmKeys.filter((k) => !KNOWN_FIELDS.has(k));
		if (unknownFields.length > 0) {
			console.warn(
				`[agent] "${entry.name}" has unrecognized frontmatter field(s): ${unknownFields.join(", ")}. ` +
					`Valid fields: ${[...KNOWN_FIELDS].join(", ")}`,
			);
		}
		// Commonly forgotten but useful fields — hint only, not an error
		const suggestedHints: string[] = [];
		if (!frontmatter.tier && !frontmatter.model) suggestedHints.push("tier");
		if (!frontmatter.thinkingLevel) suggestedHints.push("thinkingLevel");
		if (!frontmatter.effort) suggestedHints.push("effort");
		if (!frontmatter.tools && !frontmatter.disallowedTools) suggestedHints.push("tools");
		if (!frontmatter.permissionMode && frontmatter.permission) {
			console.warn(
				`[agent] "${entry.name}" uses deprecated "permission" map format. ` +
					`Use "permissionMode" with a single value like "always-allow" instead.`,
			);
		}
		if (frontmatter.permissionMode && frontmatter.permissionProfile) {
			console.warn(
				`[agent] "${entry.name}" defines both "permissionMode" and "permissionProfile". ` +
					`Using "permissionProfile".`,
			);
		}
		if (suggestedHints.length > 0) {
			console.warn(
				`[agent] "${entry.name}" is missing recommended field(s): ${suggestedHints.join(", ")}. ` +
					`These affect the Agent panel display.`,
			);
		}

		const tools = coerceField("tools", frontmatter.tools) as string[] | undefined;
		const disallowedTools = coerceField("disallowedTools", frontmatter.disallowedTools) as string[] | undefined;
		const skills = coerceField("skills", frontmatter.skills) as string[] | undefined;
		const variables = isStringRecord(frontmatter.variables) ? frontmatter.variables : undefined;
		const permissionProfile = coerceField(
			"permissionProfile",
			frontmatter.permissionProfile,
		) as AgentConfig["permissionProfile"];
		const permissionMode = coerceField("permissionMode", frontmatter.permissionMode) as AgentConfig["permissionMode"];

		agents.push({
			name: coerceField("name", frontmatter.name) as string,
			description: coerceField("description", frontmatter.description) as string,
			tools: tools && tools.length > 0 ? tools : undefined,
			disallowedTools: disallowedTools && disallowedTools.length > 0 ? disallowedTools : undefined,
			model: coerceField("model", frontmatter.model) as string | undefined,
			systemPrompt: body,
			source,
			filePath,
			permissionMode: permissionProfile ?? permissionMode,
			permissionProfile,
			maxTurns: coerceField("maxTurns", frontmatter.maxTurns) as number | undefined,
			effort: coerceField("effort", frontmatter.effort) as string | undefined,
			color: coerceField("color", frontmatter.color) as AgentColor | undefined,
			background: coerceField("background", frontmatter.background) as boolean | undefined,
			memory: coerceField("memory", frontmatter.memory) as MemoryScope | undefined,
			isolation: coerceField("isolation", frontmatter.isolation) as IsolationMode | undefined,
			initialPrompt: coerceField("initialPrompt", frontmatter.initialPrompt) as string | undefined,
			skills: skills && skills.length > 0 ? skills : undefined,
			hooks: parseSessionHooks(frontmatter.hooks),
			variables,
			tier: coerceField("tier", frontmatter.tier) as AgentTier | undefined,
			thinkingLevel: coerceField("thinkingLevel", frontmatter.thinkingLevel) as string | undefined,
			mode: coerceField("mode", frontmatter.mode) as AgentMode | undefined,
			hidden: coerceField("hidden", frontmatter.hidden) as boolean | undefined,
			paths: parsePathConfig(frontmatter.paths),
			avatar: parseAvatar(frontmatter.avatar),
		});
	}

	return agents;
}

function isDirectory(dir: string): boolean {
	try {
		return fs.statSync(dir).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, ".pi", "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function mergeAgentsByPriority(...groups: AgentConfig[][]): AgentConfig[] {
	const agentMap = new Map<string, AgentConfig>();
	for (const group of groups) {
		for (const agent of group) {
			agentMap.set(agent.name, agent);
		}
	}
	return Array.from(agentMap.values());
}

function builtinAgentAvatar(accent: string, glyph: string): AgentAvatar {
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
		`<defs><linearGradient id="g" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">` +
		`<stop stop-color="${accent}"/><stop offset="1" stop-color="#111827"/></linearGradient></defs>` +
		`<rect width="64" height="64" rx="18" fill="url(#g)"/>` +
		`<circle cx="48" cy="16" r="8" fill="rgba(255,255,255,0.18)"/>` +
		`<text x="32" y="40" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif" font-size="26" font-weight="700" fill="white">${glyph}</text>` +
		`</svg>`;
	return { type: "image", src: `data:image/svg+xml,${encodeURIComponent(svg)}` };
}

export function getBuiltinAgents(): AgentConfig[] {
	return [
		{
			name: "build",
			description: "Full-stack development with read, write, edit and execution capabilities",
			// No tools restriction — build agent gets ALL registered tools
			systemPrompt: "",
			source: "builtin",
			filePath: "",
			mode: "primary",
			tier: "pro",
			color: "orange",
			avatar: builtinAgentAvatar("#F97316", "B"),
		},
		{
			name: "explore",
			description: "Read-only exploration, search and read code",
			tools: ["read", "grep", "find", "ls", "bash"],
			disallowedTools: ["edit", "write"],
			systemPrompt:
				"You are a code exploration specialist. You can only read and search code, never modify any files.\n\nYour capabilities:\n- Use grep to search code content\n- Use find to discover files\n- Use read to read files\n- Use bash for read-only commands\n\nStrictly forbidden:\n- Do not modify any files\n- Do not run commands that change system state\n\nIf the user asks to modify code, refuse and suggest switching to the Build agent.",
			source: "builtin",
			filePath: "",
			mode: "primary",
			tier: "fast",
			color: "blue",
			avatar: builtinAgentAvatar("#3B82F6", "E"),
		},
		{
			name: "plan",
			description: "Planning mode, output analysis and specs only",
			tools: ["read", "grep", "find", "ls"],
			disallowedTools: ["edit", "write", "bash"],
			systemPrompt:
				"You are a planning specialist. You only output analysis reports and implementation plans. You cannot edit files.\n\nOutput format:\n### Requirements Analysis\n### Technical Solution\n### Implementation Steps\n### File Change List\n### Risks and Considerations",
			source: "builtin",
			filePath: "",
			mode: "primary",
			tier: "max",
			thinkingLevel: "high",
			color: "purple",
			avatar: builtinAgentAvatar("#7C3AED", "P"),
		},
	];
}

export function discoverAgents(cwd: string, scope: AgentScope, overrideAgents?: AgentConfig[]): AgentDiscoveryResult {
	const runtimePolicy = getRuntimeResourcePolicy();
	if (!runtimePolicy.canLoadUserAgents && !runtimePolicy.canLoadProjectAgents) {
		return {
			agents: getBuiltinAgents(),
			projectAgentsDir: null,
		};
	}

	const userDir = path.join(getAgentDir(), "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const userAgents = scope === "project" || !runtimePolicy.canLoadUserAgents ? [] : loadAgentsFromDir(userDir, "user");
	const projectAgents =
		scope === "user" || !projectAgentsDir || !runtimePolicy.canLoadProjectAgents
			? []
			: loadAgentsFromDir(projectAgentsDir, "project");
	const flagAgents = overrideAgents ?? [];

	return {
		agents: mergeAgentsByPriority(getBuiltinAgents(), userAgents, projectAgents, flagAgents),
		projectAgentsDir,
	};
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	return {
		text: listed.map((agent) => `${agent.name} (${agent.source}): ${agent.description}`).join("; "),
		remaining: agents.length - listed.length,
	};
}

/**
 * Format visible agents for inclusion in a system prompt.
 * Mirrors formatSkillsForPrompt() so models can choose delegation targets.
 */
export function formatAgentsForPrompt(agents: AgentConfig[]): string {
	const visibleAgents = agents.filter((agent) => !agent.hidden);

	if (visibleAgents.length === 0) {
		return "";
	}

	const lines = [
		"\n\n<available_agents>",
		"The following agents are available for task routing.",
		"When the user asks for an ordinary subtask/subagent/child task (including Chinese 子任务/子代理), prefer the `subagent` tool.",
		"Use `session_delegate` only for explicit asynchronous delegation/dispatch/background work where the parent should not wait.",
		"Choose the agent that best matches the task nature:",
		"",
	];

	for (const agent of visibleAgents) {
		lines.push("  <agent>");
		lines.push(`    <name>${escapeXml(agent.name)}</name>`);
		lines.push(`    <description>${escapeXml(agent.description)}</description>`);
		lines.push(`    <source>${escapeXml(agent.source)}</source>`);
		lines.push(`    <filePath>${escapeXml(agent.filePath || "(builtin)")}</filePath>`);
		lines.push("  </agent>");
	}

	lines.push("</available_agents>");
	lines.push("");
	lines.push(
		'Default agent is "build" when not specified. Use the agent name in the `agent` parameter of subagent/session_delegate tools.',
	);

	return lines.join("\n");
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

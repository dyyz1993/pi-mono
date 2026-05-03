/**
 * Agent discovery and configuration.
 *
 * Supports 6 priority levels (low→high, later overrides earlier):
 *   1. builtin   — agents shipped with pi
 *   2. plugin    — extension-provided agents
 *   3. user      — ~/.pi/agent/agents/*.md
 *   4. project   — .pi/agents/*.md
 *   5. flag      — CLI/programmatic overrides
 *   6. policy    — managed-settings (enterprise policy)
 *
 * Agent .md files use YAML frontmatter + markdown body as system prompt.
 * All frontmatter fields are optional except `name` and `description`.
 */

import * as fs from "node:fs";
import * as path from "path";
import { getAgentDir, parseFrontmatter } from "@dyyz1993/pi-coding-agent";

export type AgentScope = "user" | "project" | "both";

export type PermissionMode =
	| "auto"
	| "acceptEdits"
	| "plan"
	| "dontAsk"
	| "always-allow"
	| "always-deny";

export type AgentColor = "red" | "blue" | "green" | "yellow" | "purple" | "orange";

export type MemoryScope = "user" | "project" | "local";

export type IsolationMode = "worktree" | "remote";

export interface AgentHookCommand {
	type: "command";
	command: string;
	if?: string;
	async?: boolean;
}

export interface AgentHookPrompt {
	type: "prompt";
	prompt: string;
	if?: string;
}

export type AgentHook = AgentHookCommand | AgentHookPrompt;

export type AgentHooks = Partial<Record<string, AgentHook[]>>;

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	disallowedTools?: string[];
	model?: string;
	systemPrompt: string;
	source: AgentSource;
	filePath: string;

	permissionMode?: PermissionMode;
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
}

export type AgentSource = "builtin" | "plugin" | "user" | "project" | "flag" | "policy";

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

const STRING_FIELDS: ReadonlySet<string> = new Set([
	"description",
	"model",
	"permissionMode",
	"effort",
	"color",
	"memory",
	"isolation",
	"initialPrompt",
]);

const STRING_ARRAY_FIELDS: ReadonlySet<string> = new Set(["tools", "disallowedTools", "skills"]);

const BOOLEAN_FIELDS: ReadonlySet<string> = new Set(["background"]);

const NUMBER_FIELDS: ReadonlySet<string> = new Set(["maxTurns"]);

function coerceField(key: string, raw: unknown): unknown {
	if (raw === undefined || raw === null) return undefined;

	if (STRING_FIELDS.has(key)) {
		return typeof raw === "string" ? raw : String(raw);
	}

	if (STRING_ARRAY_FIELDS.has(key)) {
		if (Array.isArray(raw)) return raw.map(String);
		if (typeof raw === "string") {
			return raw
				.split(",")
				.map((s: string) => s.trim())
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
			const n = Number.parseInt(raw, 10);
			return Number.isFinite(n) ? n : undefined;
		}
		return undefined;
	}

	return raw;
}

function parseHooks(raw: unknown): AgentHooks | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const hooks: AgentHooks = {};
	for (const [event, handlers] of Object.entries(raw as Record<string, unknown>)) {
		if (!Array.isArray(handlers)) continue;
		const parsed: AgentHook[] = [];
		for (const h of handlers) {
			if (!h || typeof h !== "object") continue;
			const obj = h as Record<string, unknown>;
			if (obj.type === "command" && typeof obj.command === "string") {
				parsed.push({
					type: "command",
					command: obj.command,
					if: typeof obj.if === "string" ? obj.if : undefined,
					async: obj.async === true,
				});
			} else if (obj.type === "prompt" && typeof obj.prompt === "string") {
				parsed.push({
					type: "prompt",
					prompt: obj.prompt,
					if: typeof obj.if === "string" ? obj.if : undefined,
				});
			}
		}
		if (parsed.length > 0) hooks[event] = parsed;
	}
	return Object.keys(hooks).length > 0 ? hooks : undefined;
}

export function loadAgentsFromDir(dir: string, source: AgentSource): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

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

		if (!frontmatter.name || !frontmatter.description) {
			continue;
		}

		const tools = coerceField("tools", frontmatter.tools) as string[] | undefined;
		const disallowedTools = coerceField("disallowedTools", frontmatter.disallowedTools) as string[] | undefined;
		const skills = coerceField("skills", frontmatter.skills) as string[] | undefined;
		const hooks = parseHooks(frontmatter.hooks);
		const variables =
			frontmatter.variables && typeof frontmatter.variables === "object"
				? (frontmatter.variables as Record<string, string>)
				: undefined;

		agents.push({
			name: coerceField("name", frontmatter.name) as string,
			description: coerceField("description", frontmatter.description) as string,
			tools: tools && tools.length > 0 ? tools : undefined,
			disallowedTools: disallowedTools && disallowedTools.length > 0 ? disallowedTools : undefined,
			model: coerceField("model", frontmatter.model) as string | undefined,
			systemPrompt: body,
			source,
			filePath,
			permissionMode: coerceField("permissionMode", frontmatter.permissionMode) as PermissionMode | undefined,
			maxTurns: coerceField("maxTurns", frontmatter.maxTurns) as number | undefined,
			effort: coerceField("effort", frontmatter.effort) as string | undefined,
			color: coerceField("color", frontmatter.color) as AgentColor | undefined,
			background: coerceField("background", frontmatter.background) as boolean | undefined,
			memory: coerceField("memory", frontmatter.memory) as MemoryScope | undefined,
			isolation: coerceField("isolation", frontmatter.isolation) as IsolationMode | undefined,
			initialPrompt: coerceField("initialPrompt", frontmatter.initialPrompt) as string | undefined,
			skills: skills && skills.length > 0 ? skills : undefined,
			hooks,
			variables,
		});
	}

	return agents;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
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

export function mergeAgentsByPriority(
	...groups: AgentConfig[][]
): AgentConfig[] {
	const agentMap = new Map<string, AgentConfig>();
	for (const group of groups) {
		for (const agent of group) {
			agentMap.set(agent.name, agent);
		}
	}
	return Array.from(agentMap.values());
}

export function discoverAgents(
	cwd: string,
	scope: AgentScope,
	overrideAgents?: AgentConfig[],
): AgentDiscoveryResult {
	const userDir = path.join(getAgentDir(), "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const builtinAgents: AgentConfig[] = [];
	const pluginAgents: AgentConfig[] = [];
	const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
	const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");
	const flagAgents = overrideAgents ?? [];
	const policyAgents: AgentConfig[] = [];

	const agents = mergeAgentsByPriority(builtinAgents, pluginAgents, userAgents, projectAgents, flagAgents, policyAgents);

	return { agents, projectAgentsDir };
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
		remaining,
	};
}

import { Type } from "@dyyz1993/pi-ai";
import { defineTool, type ExtensionAPI } from "@dyyz1993/pi-coding-agent";
import { ServerChannel } from "../core/extensions/server-channel.js";
import { getRules, invalidateCache } from "./cache.js";
import { loadConfig } from "./config.js";
import { buildSystemPromptSection, buildToolContextSection } from "./injector.js";
import { matchesAnyGlob } from "./matcher.js";
import type {
	InjectedPayload,
	LifecycleEntry,
	MatchedRuleDetail,
	MatchRecord,
	ParsedRule,
	RuleDetail,
	RuleSeverity,
	RulesChannelContract,
	RulesChannelEvent,
	RulesConfig,
	ScannedDir,
	SnapshotPayload,
} from "./types.js";

export { ServerChannel } from "../core/extensions/server-channel.js";
export { getRules, invalidateCache } from "./cache.js";
export { loadConfig, resolveDirs } from "./config.js";
export { buildCompactContext, buildSystemPromptSection, buildToolContextSection } from "./injector.js";
export { loadRules, parseFrontmatter, parseRuleFile } from "./loader.js";
export { matchesAnyGlob, matchGlob } from "./matcher.js";
export type {
	InjectedPayload,
	LifecycleEntry,
	MatchedPayload,
	MatchRecord,
	ParsedRule,
	ReloadedPayload,
	RuleDetail,
	RuleFrontmatter,
	RuleScope,
	RuleSeverity,
	RulesChannelContract,
	RulesChannelEvent,
	RulesConfig,
	ScannedDir,
	SnapshotPayload,
	UnloadedPayload,
} from "./types.js";

const READ_TOOLS = new Set(["read", "grep", "glob"]);

export default function rulesEnginePlugin(pi: ExtensionAPI) {
	let config: RulesConfig | null = null;
	let rules: ParsedRule[] = [];
	let cachedMatchHash = "";
	let hasSentSnapshot = false;
	let _lastCwd = "";
	let lastMessages: unknown[] = [];

	function rebuildMatchHistory(messages: unknown[]): MatchRecord[] {
		const history: MatchRecord[] = [];
		for (const msg of messages) {
			if ((msg as Record<string, unknown>).role !== "toolResult") continue;
			const details = (msg as { details?: Record<string, unknown> }).details;
			if (!details?.rulesMatched) continue;
			const rulesMatched = details.rulesMatched as MatchedRuleDetail[];
			history.push({
				filePath: (details.matchedFilePath as string) || "",
				ruleNames: rulesMatched.map((r) => r.name),
				toolName: (msg as { toolName?: string }).toolName || "",
				toolCallId: (msg as { toolCallId?: string }).toolCallId || "",
				severity: rulesMatched.some((r) => r.severity === "critical" || r.severity === "high") ? "warning" : "info",
				timestamp: (msg as { timestamp?: number }).timestamp || 0,
				matchedRuleDetails: rulesMatched,
			});
		}
		return history;
	}

	const rawChannel = pi.registerChannel("rules-engine");
	const channel = new ServerChannel<RulesChannelContract>(rawChannel);

	channel.handle("getSnapshot", (params) => {
		const unconditional = getUnconditionalRules();
		const conditional = getConditionalRules();
		const matchHistory = rebuildMatchHistory(lastMessages);
		return {
			type: "snapshot" as const,
			rules: rules.map(toRuleDetail),
			injectedRuleNames: unconditional.map((r) => r.name),
			totalRules: rules.length,
			unconditionalCount: unconditional.length,
			conditionalCount: conditional.length,
			matchHistory,
			lifecycleLog: [] as LifecycleEntry[],
			loadedAt: Date.now(),
			cacheTTL: config?.cacheTTL || 30000,
		};
	});

	function getUnconditionalRules(): ParsedRule[] {
		return rules.filter((r) => r.isUnconditional);
	}

	function getConditionalRules(): ParsedRule[] {
		return rules.filter((r) => !r.isUnconditional);
	}

	function getMatchingRules(targetPath: string): ParsedRule[] {
		return getConditionalRules().filter((rule) => {
			const globs = rule.frontmatter.paths;
			if (!globs || globs.length === 0) return false;
			return matchesAnyGlob(globs, targetPath);
		});
	}

	async function refreshRules(cwd: string): Promise<void> {
		config = await loadConfig(cwd);
		rules = await getRules(cwd, config);
	}

	function toRuleDetail(r: ParsedRule): RuleDetail {
		return {
			name: r.name,
			title: r.title,
			filePath: r.filePath,
			scope: r.scope,
			source: r.source,
			severity: r.frontmatter.severity || ("medium" as RuleSeverity),
			isUnconditional: r.isUnconditional,
			paths: r.frontmatter.paths || [],
			description: r.frontmatter.description,
		};
	}

	function buildSnapshot(matchHistory: MatchRecord[], lifecycleLog: LifecycleEntry[]): RulesChannelEvent {
		const unconditional = getUnconditionalRules();
		const conditional = getConditionalRules();
		return {
			type: "snapshot",
			rules: rules.map(toRuleDetail),
			injectedRuleNames: unconditional.map((r) => r.name),
			totalRules: rules.length,
			unconditionalCount: unconditional.length,
			conditionalCount: conditional.length,
			matchHistory,
			lifecycleLog,
			loadedAt: Date.now(),
			cacheTTL: config?.cacheTTL || 30000,
		};
	}

	function extractTargetPath(args: Record<string, unknown>): string | undefined {
		if ("filePath" in args && typeof args.filePath === "string") return args.filePath;
		if ("path" in args && typeof args.path === "string") return args.path;
		if ("pattern" in args && typeof args.pattern === "string") return args.pattern;
		return undefined;
	}

	pi.registerTool(
		defineTool({
			name: "rules_list",
			label: "List Rules",
			description: "List all discovered rules from all configured directories across all scopes",
			parameters: Type.Object({}),
			async execute() {
				const unconditional = getUnconditionalRules();
				const conditional = getConditionalRules();

				const byScope: Record<string, number> = {};
				for (const r of rules) {
					byScope[r.scope] = (byScope[r.scope] || 0) + 1;
				}

				let output = `# Loaded Rules (${rules.length})\n\n`;
				output += `Scopes: ${Object.entries(byScope)
					.map(([k, v]) => `${k}: ${v}`)
					.join(", ")}\n\n`;

				output += `**Unconditional** (${unconditional.length}):\n`;
				for (const rule of unconditional) {
					output += `- ${rule.title} (${rule.source})\n`;
				}

				output += `\n**Conditional** (${conditional.length}):\n`;
				for (const rule of conditional) {
					output += `- ${rule.title} [${rule.frontmatter.paths?.join(", ")}] (${rule.source})\n`;
				}

				return { content: [{ type: "text", text: output }], details: undefined };
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "rules_match",
			label: "Match Rules",
			description: "Find conditional rules that match a given file path by glob pattern",
			parameters: Type.Object({
				filePath: Type.String({ description: "File path to match" }),
			}),
			async execute(_id, params) {
				const matching = getMatchingRules(params.filePath);
				const unconditional = getUnconditionalRules();

				let output = `# Rule Match: ${params.filePath}\n\n`;
				output += `**Unconditional** (always active, ${unconditional.length}):\n`;
				for (const r of unconditional) {
					output += `- ${r.title}\n`;
				}
				output += `\n**Conditional matches** (${matching.length}):\n`;
				for (const r of matching) {
					const sev = r.frontmatter.severity || "medium";
					output += `- [${sev}] ${r.title} (${r.frontmatter.paths?.join(", ")})\n`;
				}

				return { content: [{ type: "text", text: output }], details: undefined };
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "rules_reload",
			label: "Reload Rules",
			description: "Force reload all rules from disk (clears cache and re-reads config)",
			parameters: Type.Object({}),
			async execute(_id, _params, _signal, _onUpdate, ctx) {
				invalidateCache();
				await refreshRules(ctx.cwd);
				return {
					content: [
						{
							type: "text",
							text: `Rules reloaded: ${rules.length} total (${getUnconditionalRules().length} unconditional, ${getConditionalRules().length} conditional)`,
						},
					],
					details: undefined,
				};
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "rules_show",
			label: "Show Rule",
			description: "Show the full content of a specific rule by name",
			parameters: Type.Object({
				name: Type.String({ description: "Rule name (filename without .md)" }),
			}),
			async execute(_id, params) {
				const rule = rules.find((r) => r.name === params.name);
				if (!rule) {
					return {
						content: [{ type: "text", text: `Rule '${params.name}' not found` }],
						isError: true,
						details: undefined,
					};
				}

				let output = `# ${rule.title}\n\n`;
				output += `- **Name**: ${rule.name}\n`;
				output += `- **Scope**: ${rule.scope}\n`;
				output += `- **Source**: ${rule.source}\n`;
				output += `- **File**: ${rule.filePath}\n`;
				if (rule.frontmatter.paths?.length) {
					output += `- **Paths**: ${rule.frontmatter.paths.join(", ")}\n`;
				}
				if (rule.frontmatter.description) {
					output += `- **Description**: ${rule.frontmatter.description}\n`;
				}
				output += `\n${rule.content}`;

				return { content: [{ type: "text", text: output }], details: undefined };
			},
		}),
	);

	pi.registerCommand("rules", {
		description: "Rules management (list, reload, check <path>, active)",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/);
			const sub = parts[0] || "list";

			if (sub === "list" || sub === "ls") {
				ctx.ui.notify(
					`${rules.length} rules loaded (${getUnconditionalRules().length} unconditional, ${getConditionalRules().length} conditional)`,
					"info",
				);
			} else if (sub === "reload") {
				invalidateCache();
				await refreshRules(ctx.cwd);
				ctx.ui.notify(`Rules reloaded: ${rules.length} total`, "info");
			} else if (sub === "check" && parts[1]) {
				const target = parts.slice(1).join(" ");
				const matching = getMatchingRules(target);
				ctx.ui.notify(
					matching.length > 0
						? `${matching.length} rules match ${target}: ${matching.map((r) => r.title).join(", ")}`
						: `No conditional rules match ${target}`,
					"info",
				);
			} else if (sub === "active") {
				const active = getUnconditionalRules();
				ctx.ui.notify(
					`Active: ${active.length} unconditional (in system prompt), ${getConditionalRules().length} conditional (on file match)`,
					"info",
				);
			} else {
				ctx.ui.notify("Usage: /rules [list|reload|check <path>|active]", "info");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		_lastCwd = ctx.cwd;
		await refreshRules(ctx.cwd);
		ctx.ui.setStatus("rules-engine", `Rules: ${rules.length}`);

		const unconditional = getUnconditionalRules();
		const conditional = getConditionalRules();

		if (!hasSentSnapshot) {
			hasSentSnapshot = true;

			const scopeGroups = new Map<string, ParsedRule[]>();
			for (const r of rules) {
				const list = scopeGroups.get(r.scope) || [];
				list.push(r);
				scopeGroups.set(r.scope, list);
			}

			const scannedDirs: ScannedDir[] = [...scopeGroups.entries()].map(([scope, scopeRules]) => ({
				dir: scopeRules[0]?.source || scope,
				fileCount: scopeRules.length,
				ruleNames: scopeRules.map((r) => r.name),
			}));

			channel.emit(
				"snapshot",
				buildSnapshot(
					[],
					[
						{
							event: "loaded",
							message: `Loaded ${rules.length} rules (${unconditional.length} unconditional, ${conditional.length} conditional)`,
							ruleCount: rules.length,
							timestamp: Date.now(),
							details: {
								scannedDirs,
								configSource: config ? ".rules-config.json" : "default",
								cacheHit: false,
							},
						},
					],
				),
			);

		}
	});

	pi.on("before_agent_start", async (event) => {
		const unconditional = getUnconditionalRules();

		if (unconditional.length === 0) {
			channel.emit("injected", {
				type: "injected",
				ruleNames: [],
				systemPromptLength: event.systemPrompt.length,
			});
			return undefined;
		}

		const sources = [...new Set(unconditional.map((r) => r.source))];
		const section = buildSystemPromptSection(unconditional, sources);
		const newPrompt = event.systemPrompt + section;

		channel.emit("injected", {
			type: "injected",
			ruleNames: unconditional.map((r) => r.name),
			systemPromptLength: newPrompt.length,
		});

		return {
			systemPrompt: newPrompt,
		};
	});

	pi.on("tool_result", async (event) => {
		if (!READ_TOOLS.has(event.toolName)) return undefined;

		const targetPath = extractTargetPath(event.input);
		if (!targetPath) return undefined;

		const matching = getMatchingRules(targetPath);
		if (matching.length === 0) return undefined;

		const matchedRuleDetails: MatchedRuleDetail[] = matching.map((r) => ({
			name: r.name,
			title: r.title,
			severity: r.frontmatter.severity || ("medium" as RuleSeverity),
			matchedGlob:
				r.frontmatter.paths?.find((p) => matchesAnyGlob([p], targetPath)) || r.frontmatter.paths?.[0] || "",
		}));

		const contextSection = buildToolContextSection(matching, targetPath);

		const hasCritical = matching.some((r) => r.frontmatter.severity === "critical");
		const hasHigh = matching.some((r) => r.frontmatter.severity === "high");

		channel.emit("matched", {
			type: "matched",
			filePath: targetPath,
			matchedRules: matchedRuleDetails,
			toolName: event.toolName,
			toolCallId: event.toolCallId,
			severity: hasCritical ? "warning" : hasHigh ? "warning" : "info",
			timestamp: Date.now(),
		});

		return {
			content: [...event.content, { type: "text" as const, text: `\n\n${contextSection}` }],
			details: {
				...((event.details as Record<string, unknown>) || {}),
				rulesMatched: matchedRuleDetails,
				matchedFilePath: targetPath,
			},
		};
	});

	pi.on("context", async (event) => {
		lastMessages = event.messages;
		const matchHistory = rebuildMatchHistory(event.messages);

		const hash = JSON.stringify(matchHistory.map((r) => `${r.toolCallId}:${r.filePath}`));
		if (hash !== cachedMatchHash) {
			cachedMatchHash = hash;
			const unconditional = getUnconditionalRules();
			const conditional = getConditionalRules();
			channel.emit("snapshot", {
				type: "snapshot",
				rules: rules.map(toRuleDetail),
				injectedRuleNames: unconditional.map((r) => r.name),
				totalRules: rules.length,
				unconditionalCount: unconditional.length,
				conditionalCount: conditional.length,
				matchHistory,
				lifecycleLog: [],
				loadedAt: Date.now(),
				cacheTTL: config?.cacheTTL || 30000,
			});
		}

		return undefined;
	});

	pi.on("session_compact", async (_event, ctx) => {
		cachedMatchHash = "";
		lastMessages = [];
		ctx.ui.setStatus("rules-engine", `Rules: ${rules.length} (re-injected after compact)`);
	});

	pi.on("turn_end", async () => {
		if (lastMessages.length === 0 && rules.length > 0) return;
		const matchHistory = rebuildMatchHistory(lastMessages);
		const hash = JSON.stringify(matchHistory.map((r) => `${r.toolCallId}:${r.filePath}`));
		if (hash !== cachedMatchHash) {
			cachedMatchHash = hash;
			channel.emit("snapshot", {
				type: "snapshot",
				rules: rules.map(toRuleDetail),
				injectedRuleNames: getUnconditionalRules().map((r) => r.name),
				totalRules: rules.length,
				unconditionalCount: getUnconditionalRules().length,
				conditionalCount: getConditionalRules().length,
				matchHistory,
				lifecycleLog: [],
				loadedAt: Date.now(),
				cacheTTL: config?.cacheTTL || 30000,
			});
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		channel.emit("unloaded", { type: "unloaded", reason: "session_shutdown" });
		ctx.ui.setStatus("rules-engine", undefined);
	});
}

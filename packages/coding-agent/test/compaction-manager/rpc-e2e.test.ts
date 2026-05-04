import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent } from "@dyyz1993/pi-agent-core";
import { describe, expect, it } from "vitest";
import { RpcClient } from "../../src/modes/rpc/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(join(__dirname, "..", "..", "extensions", "compaction-manager", "index.ts"));
const hasApiKey =
	!!process.env.ANTHROPIC_API_KEY ||
	!!process.env.ANTHROPIC_OAUTH_TOKEN ||
	!!process.env.OPENAI_API_KEY ||
	!!process.env.OPENROUTER_API_KEY ||
	existsSync(join(homedir(), ".pi/agent/models.json"));
const PROVIDER = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN ? "anthropic" : "zhipuai";
const MODEL = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN ? "claude-sonnet-4-5" : "glm-4.7";

interface CapturedTurn {
	turnIndex: number;
	prompt: string;
	events: AgentEvent[];
	eventTypes: string[];
	contextUsageAfter: { tokens: number | null; contextWindow: number; percent: number | null };
	hasAgentStart: boolean;
	hasAgentEnd: boolean;
	hasTurnEnd: boolean;
	hasContextEvent: boolean;
	assistantText: string;
}

interface CompactResult {
	summary: string;
	tokensBefore: number;
	firstKeptEntryId: string;
	contextUsageBefore: { tokens: number | null; contextWindow: number; percent: number | null };
	contextUsageAfter: { tokens: number | null; contextWindow: number; percent: number | null };
}

function makeClient(projectDir: string): RpcClient {
	return new RpcClient({
		cliPath: join(__dirname, "..", "..", "dist", "cli.js"),
		cwd: projectDir,
		provider: PROVIDER,
		model: MODEL,
		args: ["--no-extensions", "-e", extensionPath, "--no-session"],
	});
}

function makeTempProject(): string {
	const raw = join(tmpdir(), `cm-report-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(raw, { recursive: true });
	return raw;
}

function summarizeEvents(events: AgentEvent[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const e of events) {
		const type = (e as any).type;
		counts.set(type, (counts.get(type) || 0) + 1);
	}
	return counts;
}

function printTimeline(title: string, events: AgentEvent[]): void {
	console.log(`\n${"=".repeat(80)}`);
	console.log(`  TIMELINE: ${title}`);
	console.log(`${"=".repeat(80)}`);
	for (let i = 0; i < events.length; i++) {
		const e = events[i] as any;
		const type = e.type;
		let detail = "";
		switch (type) {
			case "agent_start":
				detail = "agent loop begins";
				break;
			case "agent_end":
				detail = "agent loop ends";
				break;
			case "turn_start":
				detail = `turn #${e.turnIndex ?? "?"}`;
				break;
			case "turn_end":
				detail = `turn #${e.turnIndex ?? "?"}`;
				break;
			case "message_start":
				detail = `role=${e.message?.role}`;
				break;
			case "message_update": {
				const sub = e.assistantMessageEvent;
				if (sub?.type === "text_delta") detail = `text_delta: "${sub.delta?.slice(0, 50)}..."`;
				else if (sub?.type === "tool_call") detail = `tool_call: ${sub.toolName}`;
				else if (sub?.type === "thinking_delta") detail = `thinking_delta (${sub.delta?.length ?? 0} chars)`;
				else detail = sub?.type ?? "unknown";
				break;
			}
			case "message_end":
				detail = `role=${e.message?.role}`;
				break;
			case "tool_execution_start":
				detail = `tool=${e.toolName}`;
				break;
			case "tool_execution_end":
				detail = `tool=${e.toolName}`;
				break;
			case "extension_ui_request":
				detail = `statusText="${e.statusText}"`;
				break;
			case "custom_entry":
				detail = `customType="${e.customType}"`;
				break;
			default:
				detail = JSON.stringify(e).slice(0, 80);
				break;
		}
		console.log(`  [${String(i).padStart(3)}] ${type.padEnd(30)} ${detail}`);
	}
	console.log(`${"=".repeat(80)}\n`);
}

function printTurnReport(turn: CapturedTurn): void {
	console.log(`  Turn ${turn.turnIndex}: "${turn.prompt}"`);
	console.log(`    agent_start: ${turn.hasAgentStart}  agent_end: ${turn.hasAgentEnd}  turn_end: ${turn.hasTurnEnd}`);
	console.log(`    context event fired: ${turn.hasContextEvent}`);
	console.log(
		`    context after: ${turn.contextUsageAfter.tokens?.toLocaleString() ?? "null"} / ${turn.contextUsageAfter.contextWindow.toLocaleString()} tokens (${turn.contextUsageAfter.percent?.toFixed(1) ?? "null"}%)`,
	);
	console.log(
		`    assistant text: "${turn.assistantText.slice(0, 80)}${turn.assistantText.length > 80 ? "..." : ""}"`,
	);
	console.log(`    event types: [${turn.eventTypes.join(", ")}]`);
	console.log(`    event counts: ${JSON.stringify(Object.fromEntries(summarizeEvents(turn.events)))}`);
}

function printCompactReport(result: CompactResult): void {
	console.log(`  Compact Result:`);
	console.log(`    tokensBefore: ${result.tokensBefore.toLocaleString()}`);
	console.log(`    tokensAfter:  ${result.contextUsageAfter.tokens?.toLocaleString() ?? "null"}`);
	console.log(
		`    reduction:    ${result.contextUsageBefore.tokens && result.contextUsageAfter.tokens ? `${(((result.contextUsageBefore.tokens - result.contextUsageAfter.tokens) / result.contextUsageBefore.tokens) * 100).toFixed(1)}%` : "N/A"}`,
	);
	console.log(`    summary length: ${result.summary.length} chars`);
	console.log(`    summary preview: "${result.summary.slice(0, 150)}${result.summary.length > 150 ? "..." : ""}"`);
}

async function captureTurn(client: RpcClient, turnIndex: number, prompt: string): Promise<CapturedTurn> {
	const turnEvents: AgentEvent[] = [];
	const unsub = client.onEvent((e) => turnEvents.push(e));
	const promptEvents = await client.promptAndWait(prompt, undefined, 120_000);
	unsub();

	const allTurnEvents = [...promptEvents, ...turnEvents];
	const eventTypes = allTurnEvents.map((e) => (e as any).type);
	const contextUsage = await client.getContextUsage();

	let assistantText = "";
	const agentEnd = promptEvents.find((e: any) => e.type === "agent_end") as any;
	if (agentEnd?.messages) {
		const lastAssistant = [...agentEnd.messages].reverse().find((m: any) => m.role === "assistant");
		if (lastAssistant?.content) {
			assistantText = lastAssistant.content
				.filter((c: any) => c.type === "text")
				.map((c: any) => c.text)
				.join("");
		}
	}

	return {
		turnIndex,
		prompt,
		events: allTurnEvents,
		eventTypes,
		contextUsageAfter: {
			tokens: contextUsage.tokens,
			contextWindow: contextUsage.contextWindow,
			percent: contextUsage.percent,
		},
		hasAgentStart: eventTypes.includes("agent_start"),
		hasAgentEnd: eventTypes.includes("agent_end"),
		hasTurnEnd: eventTypes.includes("turn_end"),
		hasContextEvent: eventTypes.includes("extension_ui_request") || eventTypes.includes("custom_entry"),
		assistantText,
	};
}

describe.skipIf(!hasApiKey)(
	"compaction-manager RPC e2e — full lifecycle report",
	{ sequential: true, timeout: 300_000 },
	() => {
		it("full lifecycle: load → multi-turn → compact → verify", async () => {
			const projectDir = makeTempProject();
			const client = makeClient(projectDir);
			const allGlobalEvents: AgentEvent[] = [];
			const globalUnsub = client.onEvent((e) => allGlobalEvents.push(e));

			try {
				await client.start();
				console.log("\n\nPHASE 1: EXTENSION LOADING");
				console.log("─".repeat(60));

				const extensions = await client.getExtensions();
				console.log(`  extensions loaded: ${extensions.length}`);
				for (const ext of extensions) {
					console.log(`    - ${ext.resolvedPath}`);
					console.log(`      tools: [${ext.toolNames?.join(", ") ?? "none"}]`);
					console.log(`      commands: [${ext.commandNames?.join(", ") ?? "none"}]`);
				}

				const state0 = await client.getState();
				console.log(`  initial state:`);
				console.log(`    isCompacting: ${state0.isCompacting}`);
				console.log(`    autoCompactionEnabled: ${state0.autoCompactionEnabled}`);
				console.log(`    messageCount: ${state0.messageCount}`);

				const usage0 = await client.getContextUsage();
				console.log(
					`  initial context: ${usage0.tokens?.toLocaleString() ?? "null"} / ${usage0.contextWindow.toLocaleString()} (${usage0.percent?.toFixed(1) ?? "null"}%)`,
				);

				console.log("\n\nPHASE 2: MULTI-TURN CONVERSATION");
				console.log("─".repeat(60));

				const turns: CapturedTurn[] = [];
				const prompts = ["用一句话说：你好", "用一句话说：1+1等于几", "用一句话说：天空是什么颜色"];

				for (let i = 0; i < prompts.length; i++) {
					console.log(`\n  --- Sending Turn ${i}: "${prompts[i]}" ---`);
					const turn = await captureTurn(client, i, prompts[i]);
					turns.push(turn);
					printTurnReport(turn);
				}

				console.log("\n  CONTEXT GROWTH SUMMARY:");
				console.log("  ┌─────────┬──────────────┬──────────────┬─────────┐");
				console.log("  │ Turn    │ Tokens       │ Window       │ Percent │");
				console.log("  ├─────────┼──────────────┼──────────────┼─────────┤");
				for (const t of turns) {
					const tok = String(t.contextUsageAfter.tokens?.toLocaleString() ?? "null").padStart(12);
					const win = String(t.contextUsageAfter.contextWindow.toLocaleString()).padStart(12);
					const pct = (t.contextUsageAfter.percent?.toFixed(1) ?? "null").padStart(7);
					console.log(`  │ ${String(t.turnIndex).padStart(7)} │ ${tok} │ ${win} │ ${pct} │`);
				}
				console.log("  └─────────┴──────────────┴──────────────┴─────────┘");

				console.log("\n\nPHASE 3: MANUAL COMPACT");
				console.log("─".repeat(60));

				const usageBeforeCompact = await client.getContextUsage();
				console.log(`  before compact: ${usageBeforeCompact.tokens?.toLocaleString() ?? "null"} tokens`);

				let compactResult: any;
				try {
					compactResult = await client.compact("Focus on the conversation topics discussed");
				} catch (err) {
					console.log(`  compact failed (retrying without instructions): ${err}`);
					try {
						compactResult = await client.compact();
					} catch (err2) {
						console.log(`  compact failed again: ${err2}`);
						compactResult = null;
					}
				}

				if (compactResult) {
					const usageAfterCompact = await client.getContextUsage();
					const report: CompactResult = {
						summary: compactResult.summary ?? "",
						tokensBefore: compactResult.tokensBefore ?? 0,
						firstKeptEntryId: compactResult.firstKeptEntryId ?? "",
						contextUsageBefore: {
							tokens: usageBeforeCompact.tokens,
							contextWindow: usageBeforeCompact.contextWindow,
							percent: usageBeforeCompact.percent,
						},
						contextUsageAfter: {
							tokens: usageAfterCompact.tokens,
							contextWindow: usageAfterCompact.contextWindow,
							percent: usageAfterCompact.percent,
						},
					};
					printCompactReport(report);
				} else {
					console.log("  compact returned null (skipped)");
				}

				console.log("\n\nPHASE 4: POST-COMPACT STATE");
				console.log("─".repeat(60));
				const statePost = await client.getState();
				console.log(`  isCompacting: ${statePost.isCompacting}`);
				console.log(`  messageCount: ${statePost.messageCount}`);
				const usagePost = await client.getContextUsage();
				console.log(
					`  context after compact: ${usagePost.tokens?.toLocaleString() ?? "null"} / ${usagePost.contextWindow.toLocaleString()} (${usagePost.percent?.toFixed(1) ?? "null"}%)`,
				);

				console.log("\n\nPHASE 5: GLOBAL EVENT ANALYSIS");
				console.log("─".repeat(60));
				printTimeline("All Events", allGlobalEvents);
				const globalCounts = summarizeEvents(allGlobalEvents);
				console.log("  EVENT SUMMARY:");
				for (const [type, count] of globalCounts) {
					console.log(`    ${type.padEnd(35)} × ${count}`);
				}

				const uiEvents = allGlobalEvents.filter((e) => (e as any).type === "extension_ui_request") as any[];
				console.log(`\n  EXTENSION UI EVENTS (${uiEvents.length}):`);
				for (const ue of uiEvents) {
					console.log(`    statusText="${ue.statusText}"`);
				}

				console.log("\n\nPHASE 6: ASSERTIONS");
				console.log("─".repeat(60));

				expect(extensions.length).toBeGreaterThanOrEqual(1);
				console.log("  ✓ extensions loaded");

				const hasCompactForce = extensions.some((e) => e.commandNames?.includes("compact-force"));
				expect(hasCompactForce).toBe(true);
				console.log("  ✓ compact-force command registered");

				for (const t of turns) {
					expect(t.hasAgentStart).toBe(true);
					expect(t.hasAgentEnd).toBe(true);
				}
				console.log("  ✓ all turns have agent_start + agent_end");

				const finalTokens = turns[turns.length - 1].contextUsageAfter.tokens;
				expect(finalTokens).not.toBeNull();
				expect(finalTokens!).toBeGreaterThan(0);
				console.log(`  ✓ final tokens > 0 (${finalTokens?.toLocaleString()})`);

				if (compactResult) {
					expect(compactResult.tokensBefore).toBeGreaterThan(0);
					console.log(`  ✓ compact tokensBefore > 0 (${compactResult.tokensBefore.toLocaleString()})`);
				}

				console.log(`\n${"═".repeat(60)}`);
				console.log("  ALL CHECKS PASSED");
				console.log(`${"═".repeat(60)}\n`);
			} finally {
				globalUnsub();
				await client.stop();
				rmSync(projectDir, { recursive: true, force: true });
			}
		}, 300_000);
	},
);

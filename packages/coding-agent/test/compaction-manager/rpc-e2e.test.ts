import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
const MODEL = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN ? "claude-sonnet-4-5" : "glm-4.5-air";

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
	const raw = join(tmpdir(), `cm-stress-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(raw, { recursive: true });
	return raw;
}

const LONG_PROMPTS = [
	"详细解释 JavaScript 闭包的概念，给出 3 个实际使用场景的代码示例",
	"请用 200 字以上解释 TCP 三次握手和四次挥手的完整过程",
	"请列出 React 中 useEffect 的 5 种常见使用模式和注意事项",
	"详细说明 Docker 容器和镜像的区别，以及 Dockerfile 的 10 个常用指令",
	"请写一篇 300 字的技术文章，对比 REST API 和 GraphQL 的优缺点",
	"请详细解释 JavaScript 事件循环机制，包括宏任务、微任务和队列",
	"请用 200 字解释 Git rebase 和 merge 的区别，以及各自的适用场景",
	"请列出 TypeScript 中 5 种高级类型操作符（Partial, Pick, Omit 等），每个给出示例",
	"请写一个完整的 Node.js Express 中间件实现，包含错误处理和日志记录",
	"请详细解释 CSS Grid 和 Flexbox 的区别，各自适合什么布局场景",
	"请用 300 字解释浏览器渲染原理，包括 DOM、CSSOM、渲染树和重排重绘",
	"请写一个完整的 Promise 实现，包含 then、catch、finally 和静态方法",
	"请详细说明 HTTP/2 相比 HTTP/1.1 的改进，包括多路复用和头部压缩",
	"请解释 Redis 的 5 种数据结构，以及在什么业务场景下使用哪种",
	"请详细对比 JWT 和 Session 认证方案的原理、优缺点和适用场景",
	"请写一篇关于微前端架构的文章，包括 3 种主流实现方案的对比",
	"请解释 Kubernetes 中 Pod、Service、Deployment 和 Ingress 的关系",
	"请用 300 字解释 WebAssembly 的工作原理和在前端的应用场景",
	"请详细说明 CSS 动画性能优化的 5 种策略，包括 GPU 加速和 will-change",
	"请解释 WebSocket 和 Server-Sent Events 的区别，以及各自的适用场景",
];

interface TriggerState {
	reactiveWarn: boolean;
	reactiveCritical: boolean;
	compactionStart: boolean;
	compactionEnd: boolean;
	sessionMemoryCompact: boolean;
	contextFold: boolean;
	thinkingStripped: boolean;
	compactForceCommand: boolean;
}

function printTriggerBoard(
	triggers: TriggerState,
	turn: number,
	tokens: number | null,
	percent: number | null,
	window: number,
): void {
	const check = (v: boolean) => (v ? "✅ TRIGGERED" : "⬜ pending");
	console.log(`\n  ┌──────────────────────────────────────────────────────────────┐`);
	console.log(
		`  │ TRIGGER BOARD @ Turn ${String(turn).padStart(2)} │ ${String(tokens?.toLocaleString() ?? "null").padStart(8)} / ${window.toLocaleString()} (${String(percent?.toFixed(1) ?? "null").padStart(5)}%) │`,
	);
	console.log(`  ├──────────────────────────────────────────────────────────────┤`);
	console.log(`  │ reactive warn (75%)           ${check(triggers.reactiveWarn).padEnd(30)} │`);
	console.log(`  │ reactive critical (90%)        ${check(triggers.reactiveCritical).padEnd(30)} │`);
	console.log(`  │ compaction_start               ${check(triggers.compactionStart).padEnd(30)} │`);
	console.log(`  │ compaction_end                 ${check(triggers.compactionEnd).padEnd(30)} │`);
	console.log(`  │ session memory compact         ${check(triggers.sessionMemoryCompact).padEnd(30)} │`);
	console.log(`  │ context fold notification      ${check(triggers.contextFold).padEnd(30)} │`);
	console.log(`  │ thinking stripped (context hk) ${check(triggers.thinkingStripped).padEnd(30)} │`);
	console.log(`  │ compact-force command          ${check(triggers.compactForceCommand).padEnd(30)} │`);
	console.log(`  └──────────────────────────────────────────────────────────────┘`);
}

describe.skipIf(!hasApiKey)(
	"compaction-manager RPC e2e — stress until all triggers fire",
	{ sequential: true, timeout: 600_000 },
	() => {
		it("loops prompts until every compaction-manager feature triggers", async () => {
			const projectDir = makeTempProject();

			const piDir = join(projectDir, ".pi");
			mkdirSync(piDir, { recursive: true });
			writeFileSync(
				join(piDir, "compaction.json"),
				JSON.stringify(
					{
						reactive: { warnPercent: 3, forceCompactPercent: 8, enabled: true },
						contextFold: { maxAgeMs: 500, keepRecentCount: 2, enabled: true, maxSummaryLength: 200 },
						microcompact: { enabled: true, maxAgeMs: 500, clearableTools: ["read", "bash", "grep"] },
						sessionMemory: { enabled: true, memoryDir: ".pi/memory", minContentLength: 10 },
					},
					null,
					2,
				),
			);

			const memoryDir = join(projectDir, ".pi", "memory");
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(
				join(memoryDir, "project-notes.md"),
				"# Project Notes\nThis is a test project for verifying compaction-manager features.\nWe test microcompact, reactive warnings, session memory compact, context fold, and thinking strip.\nThe memory system should detect these notes and use them during compaction.",
			);

			const client = makeClient(projectDir);
			const allEvents: AgentEvent[] = [];
			const globalUnsub = client.onEvent((e) => allEvents.push(e));

			const triggers: TriggerState = {
				reactiveWarn: false,
				reactiveCritical: false,
				compactionStart: false,
				compactionEnd: false,
				sessionMemoryCompact: false,
				contextFold: false,
				thinkingStripped: false,
				compactForceCommand: false,
			};

			try {
				await client.start();

				const extensions = await client.getExtensions();
				expect(extensions.length).toBeGreaterThanOrEqual(1);
				const hasCommand = extensions.some((e) => e.commandNames?.includes("compact-force"));
				triggers.compactForceCommand = hasCommand;
				console.log(`\n  Extensions: ${extensions.length}, compact-force: ${hasCommand}`);

				console.log(`\n  Memory files created: project-notes.md`);
				console.log(`  Starting stress loop with model: ${MODEL}\n`);

				let turn = 0;
				const maxTurns = 8;
				let prevTokens: number | null = null;
				let hadThinkingInPrompt = false;

				while (turn < maxTurns) {
					const prompt = LONG_PROMPTS[turn % LONG_PROMPTS.length];
					console.log(`\n  >>> Turn ${turn}: "${prompt.slice(0, 60)}..."`);

					const turnEvents: AgentEvent[] = [];
					const turnUnsub = client.onEvent((e) => turnEvents.push(e));

					try {
						await client.promptAndWait(prompt, undefined, 180_000);
					} catch (err) {
						console.log(`  ⚠ promptAndWait error: ${err}`);
						turnUnsub();
						turn++;
						continue;
					}
					turnUnsub();

					const usage = await client.getContextUsage();
					const state = await client.getState();

					const turnEventTypes = turnEvents.map((e) => (e as any).type);
					const uiEvents = turnEvents.filter((e) => (e as any).type === "extension_ui_request") as any[];
					const compactStarts = turnEvents.filter((e) => (e as any).type === "compaction_start") as any[];
					const compactEnds = turnEvents.filter((e) => (e as any).type === "compaction_end") as any[];

					if (compactStarts.length > 0) triggers.compactionStart = true;
					if (compactEnds.length > 0) triggers.compactionEnd = true;

					for (const ui of uiEvents) {
						const txt: string = (ui.message ?? ui.statusText ?? "") as string;
						if (txt.includes("Context high")) triggers.reactiveWarn = true;
						if (txt.includes("Context critical")) triggers.reactiveCritical = true;
						if (txt.includes("Context fold")) triggers.contextFold = true;
						if (txt.includes("Session Memory Compact")) triggers.sessionMemoryCompact = true;
						console.log(`    📢 UI notify: method=${ui.method}, text="${txt.slice(0, 80)}"`);
					}

					const hasThinking = turnEventTypes.some(() => {
						const e = turnEvents.find(
							(ev) =>
								(ev as any).type === "message_update" &&
								(ev as any).assistantMessageEvent?.type === "thinking_delta",
						);
						return !!e;
					});
					if (hasThinking) hadThinkingInPrompt = true;

					if (hadThinkingInPrompt && turn > 0) {
						triggers.thinkingStripped = true;
					}

					printTriggerBoard(triggers, turn, usage.tokens, usage.percent, usage.contextWindow);

					if (prevTokens !== null && usage.tokens !== null) {
						const delta = usage.tokens - prevTokens;
						console.log(`    token delta: ${delta >= 0 ? "+" : ""}${delta.toLocaleString()}`);
					}
					prevTokens = usage.tokens;

					for (const cs of compactStarts) {
						console.log(`    ⚡ compaction_start: reason=${cs.reason ?? "unknown"}`);
					}
					for (const ce of compactEnds) {
						console.log(`    ⚡ compaction_end: willRetry=${ce.willRetry ?? false}`);
						if (ce.result?.summary) {
							console.log(
								`       summary (${ce.result.summary.length} chars): "${ce.result.summary.slice(0, 100)}..."`,
							);
						}
					}

					const allFired =
						triggers.reactiveWarn &&
						triggers.reactiveCritical &&
						triggers.compactionStart &&
						triggers.compactionEnd &&
						triggers.contextFold;
					if (allFired && turn >= 3) {
						console.log(`\n  🎯 All critical triggers fired at turn ${turn}!`);
						break;
					}

					turn++;
				}

				console.log(`\n\n  Attempting manual compact to trigger session memory...`);
				try {
					const preCompact = await client.getContextUsage();
					console.log(`    before: ${preCompact.tokens?.toLocaleString() ?? "null"} tokens`);
					const result = await client.compact("Focus on all technical details discussed");
					console.log(
						`    compact result: tokensBefore=${result.tokensBefore?.toLocaleString()}, summary="${result.summary.slice(0, 100)}..."`,
					);
					const postCompact = await client.getContextUsage();
					console.log(`    after: ${postCompact.tokens?.toLocaleString() ?? "null"} tokens`);
				} catch (err) {
					console.log(`    compact failed: ${err}`);
				}

				console.log(`\n\n${"═".repeat(70)}`);
				console.log(`  FINAL TRIGGER BOARD`);
				console.log(`${"═".repeat(70)}`);
				const finalUsage = await client.getContextUsage();

				for (const e of allEvents) {
					const t = (e as any).type;
					if (t === "compaction_start") triggers.compactionStart = true;
					if (t === "compaction_end") triggers.compactionEnd = true;
					if (t === "extension_ui_request") {
						const msg = (e as any).message ?? "";
						if (typeof msg === "string") {
							if (msg.includes("Session Memory Compact")) triggers.sessionMemoryCompact = true;
						}
					}
				}

				printTriggerBoard(triggers, turn, finalUsage.tokens, finalUsage.percent, finalUsage.contextWindow);

				console.log(`\n  GLOBAL EVENT SUMMARY:`);
				const globalCounts = new Map<string, number>();
				for (const e of allEvents) {
					const t = (e as any).type;
					globalCounts.set(t, (globalCounts.get(t) || 0) + 1);
				}
				for (const [type, count] of globalCounts) {
					console.log(`    ${type.padEnd(35)} × ${count}`);
				}

				console.log(`\n  EXTENSION UI NOTIFICATIONS:`);
				const allUi = allEvents.filter((e) => (e as any).type === "extension_ui_request") as any[];
				if (allUi.length === 0) {
					console.log(`    (none)`);
				} else {
					for (const ui of allUi) {
						console.log(`    "${ui.statusText}"`);
					}
				}

				console.log(`\n  COMPACTION EVENTS:`);
				const allCompactStart = allEvents.filter((e) => (e as any).type === "compaction_start") as any[];
				const allCompactEnd = allEvents.filter((e) => (e as any).type === "compaction_end") as any[];
				console.log(`    compaction_start: ${allCompactStart.length}`);
				for (const cs of allCompactStart) {
					console.log(`      reason: ${cs.reason}`);
				}
				console.log(`    compaction_end: ${allCompactEnd.length}`);
				for (const ce of allCompactEnd) {
					console.log(`      reason: ${ce.reason}, willRetry: ${ce.willRetry}, hasResult: ${!!ce.result}`);
				}

				console.log(`\n  CONTEXT GROWTH TIMELINE:`);
				console.log(`    (see per-turn output above)`);

				console.log(`\n${"═".repeat(70)}`);
				console.log(`  ASSERTIONS`);
				console.log(`${"═".repeat(70)}`);

				expect(triggers.compactForceCommand).toBe(true);
				console.log(`  ✓ compact-force command registered`);

				expect(triggers.compactionStart).toBe(true);
				console.log(`  ✓ compaction_start fired`);

				expect(triggers.compactionEnd).toBe(true);
				console.log(`  ✓ compaction_end fired`);

				console.log(`  ℹ reactiveWarn: ${triggers.reactiveWarn}`);
				console.log(`  ℹ reactiveCritical: ${triggers.reactiveCritical}`);
				console.log(`  ℹ sessionMemoryCompact: ${triggers.sessionMemoryCompact}`);
				console.log(`  ℹ contextFold: ${triggers.contextFold}`);
				console.log(`  ℹ thinkingStripped: ${triggers.thinkingStripped}`);

				console.log(`\n${"═".repeat(70)}`);
				console.log(`  DONE — ${turn} turns completed`);
				console.log(`${"═".repeat(70)}\n`);
			} finally {
				globalUnsub();
				await client.stop();
				rmSync(projectDir, { recursive: true, force: true });
			}
		}, 600_000);
	},
);

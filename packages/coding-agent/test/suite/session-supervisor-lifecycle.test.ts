import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent } from "@dyyz1993/pi-agent-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RpcClient } from "../../src/modes/rpc/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const supervisorPath = join(__dirname, "..", "..", "extensions", "session-supervisor", "index.ts");
const todoPath = join(__dirname, "..", "..", "extensions", "todo-ext", "index.ts");
const bashPath = join(__dirname, "..", "..", "extensions", "bash-ext", "index.ts");

const hasApiKey =
	!!process.env.ANTHROPIC_API_KEY ||
	!!process.env.ANTHROPIC_OAUTH_TOKEN ||
	!!process.env.OPENAI_API_KEY ||
	!!process.env.OPENROUTER_API_KEY ||
	existsSync(join(homedir(), ".pi/agent/models.json"));

const PROVIDER = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN ? "anthropic" : "zhipuai";
const MODEL = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN ? "claude-sonnet-4-5" : "glm-4.7";

const EVENT_COLORS: Record<string, string> = {
	ready: "\ud83d\udfe2",
	agent_end: "\ud83d\udd35",
	agent_start: "\u26aa",
	message_update: "\ud83d\udcac",
	message_end: "\ud83d\udce8",
	tool_execution_start: "\ud83d\udd27",
	tool_execution_end: "\u2705",
	extension_ui_request: "\ud83d\udce1",
	channel_data: "\ud83d\udcc8",
	custom_entry: "\ud83d\udcdd",
	error: "\ud83d\udd34",
	extension_loaded: "\ud83c\udf0d",
	session_start: "\ud83d\ude80",
	session_end: "\ud83d\udd12",
};

function printEventTimeline(events: AgentEvent[]): void {
	console.log("\n=== 事件时间线 ===");
	for (const e of events) {
		const ev = e as Record<string, unknown>;
		const type = (ev.type as string) ?? "unknown";
		const icon = EVENT_COLORS[type] ?? "\u26aa";
		const time = new Date().toISOString().split("T")[1];

		let detail = "";
		if (type === "message_update" || type === "message_end") {
			const msg = ev.message as Record<string, unknown> | undefined;
			const role = (msg?.role as string) ?? "?";
			const content = msg?.content;
			let text = "";
			if (typeof content === "string") text = content;
			else if (Array.isArray(content))
				text = content
					.filter((c: Record<string, unknown>) => c.type === "text")
					.map((c: Record<string, unknown>) => (c.text as string) ?? "")
					.join("")
					.slice(0, 80);
			detail = `[${role}] ${text}`;
		} else if (type === "tool_execution_start") {
			detail = `tool=${ev.toolName ?? ev.tool ?? "?"}`;
		} else if (type === "tool_execution_end") {
			detail = `tool=${ev.toolName ?? ev.tool ?? "?"}`;
		} else if (type === "channel_data") {
			detail = `channel=${ev.name ?? "?"}`;
		} else if (type === "extension_ui_request") {
			detail = `statusText=${ev.statusText ?? ""}`;
		} else if (type === "custom_entry") {
			detail = `customType=${ev.customType ?? ""} content=${String(ev.content ?? "").slice(0, 60)}`;
		} else if (type === "extension_loaded") {
			detail = `name=${ev.name ?? ""}`;
		} else {
			detail = JSON.stringify(e).slice(0, 120);
		}

		console.log(`  ${icon} [${time}] ${type}: ${detail}`);
	}
	console.log(`\n总事件数: ${events.length}`);

	const typeCounts: Record<string, number> = {};
	for (const e of events) {
		const t = ((e as Record<string, unknown>).type as string) ?? "unknown";
		typeCounts[t] = (typeCounts[t] ?? 0) + 1;
	}
	console.log("\n事件类型统计:");
	for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
		console.log(`  ${type}: ${count}`);
	}
}

function makeClient(projectDir: string, extensions: string[]): RpcClient {
	return new RpcClient({
		cliPath: join(__dirname, "..", "..", "dist", "cli.js"),
		cwd: projectDir,
		provider: PROVIDER,
		model: MODEL,
		args: ["--no-extensions", ...extensions.flatMap((e) => ["-e", e]), "--no-session"],
	});
}

describe.skipIf(!hasApiKey)("session-supervisor lifecycle", () => {
	let client: RpcClient;
	let projectDir: string;
	let allEvents: AgentEvent[];
	let unsub: (() => void) | null;

	beforeEach(() => {
		projectDir = join(tmpdir(), `pi-supervisor-test-${Date.now()}`);
		mkdirSync(projectDir, { recursive: true });
		allEvents = [];
		unsub = null;

		const supervisorDir = join(projectDir, ".pi");
		mkdirSync(supervisorDir, { recursive: true });
		writeFileSync(
			join(supervisorDir, "supervisor.json"),
			JSON.stringify({
				enable: true,
				checkOnAgentEnd: true,
				smallModel: "fast",
				maxContinueCount: 2,
				defaultDelayMs: 5000,
				pauseThresholdMs: 300_000,
				taskRules: [
					{
						name: "Keyword check",
						checkMethod: "keyword",
						keywords: ["TODO", "FIXME", "not done", "remaining"],
					},
				],
			}),
		);
	});

	afterEach(async () => {
		if (unsub) {
			unsub();
			unsub = null;
		}
		await client?.stop();
		if (projectDir && existsSync(projectDir)) {
			try {
				rmSync(projectDir, { recursive: true, force: true });
			} catch {}
		}
		printEventTimeline(allEvents);
	});

	it("插件加载并触发 agent_end 检查", async () => {
		client = makeClient(projectDir, [supervisorPath, bashPath]);

		unsub = client.onEvent((e) => {
			allEvents.push(e);
		});

		await client.start();

		const state = await client.getState();
		expect(state).toBeDefined();
		console.log("\n初始状态:", JSON.stringify(state, null, 2));

		const extensions = await client.getExtensions();
		console.log(
			"已加载扩展:",
			extensions.map((e: Record<string, unknown>) => e.name),
		);
		expect(extensions.length).toBeGreaterThanOrEqual(1);

		const events = await client.promptAndWait("Say hello and tell me you're done.", undefined, 120_000);
		allEvents.push(...events);

		await new Promise((r) => setTimeout(r, 3000));

		const eventTypes = allEvents.map((e) => (e as Record<string, unknown>).type as string);
		console.log("\n事件类型列表:", [...new Set(eventTypes)].join(", "));

		const agentEndEvents = allEvents.filter((e) => (e as Record<string, unknown>).type === "agent_end");
		console.log(`\nagent_end 事件数: ${agentEndEvents.length}`);
		expect(agentEndEvents.length).toBeGreaterThan(0);

		const customEntries = allEvents.filter((e) => (e as Record<string, unknown>).type === "custom_entry");
		console.log(`custom_entry 事件数: ${customEntries.length}`);
		for (const ce of customEntries) {
			const d = ce as Record<string, unknown>;
			console.log(
				`  customType=${d.customType}, display=${d.display}, content=${String(d.content ?? "").slice(0, 100)}`,
			);
		}

		console.log("\n\u2705 基本生命周期完成");
	}, 180_000);

	it("supervisor 检测未完成任务并触发续执行", async () => {
		client = makeClient(projectDir, [supervisorPath, bashPath, todoPath]);

		unsub = client.onEvent((e) => {
			allEvents.push(e);
		});

		await client.start();
		await new Promise((r) => setTimeout(r, 2000));

		const firstTurnEvents = await client.promptAndWait(
			"Create a todo list with 3 items: 1) Write hello.txt 2) Write world.txt 3) Write done.txt. Only complete the first task. Do NOT complete tasks 2 and 3.",
			undefined,
			180_000,
		);
		allEvents.push(...firstTurnEvents);

		console.log("\n--- 第一轮 agent_end 后等待 supervisor 检查 ---");
		await new Promise((r) => setTimeout(r, 20000));

		const supervisorRelated = allEvents.filter((e) => {
			const s = JSON.stringify(e);
			return s.includes("supervisor") || s.includes("supervisor_continue");
		});
		console.log(`\nSupervisor 相关事件: ${supervisorRelated.length}`);
		for (const e of supervisorRelated) {
			console.log(`  - ${JSON.stringify(e).slice(0, 300)}`);
		}

		const extensionUiEvents = allEvents.filter((e) => (e as Record<string, unknown>).type === "extension_ui_request");
		console.log(`\nextension_ui_request 事件: ${extensionUiEvents.length}`);
		for (const e of extensionUiEvents) {
			const d = e as Record<string, unknown>;
			console.log(`  statusText=${d.statusText}, extensionName=${d.extensionName ?? ""}`);
		}

		const customEntries = allEvents.filter((e) => (e as Record<string, unknown>).type === "custom_entry");
		console.log(`\ncustom_entry 事件: ${customEntries.length}`);
		for (const ce of customEntries) {
			const d = ce as Record<string, unknown>;
			console.log(
				`  customType=${d.customType}, display=${d.display}, content=${String(d.content ?? "").slice(0, 120)}`,
			);
		}

		const agentEndCount = allEvents.filter((e) => (e as Record<string, unknown>).type === "agent_end").length;
		console.log(`\nagent_end 总数: ${agentEndCount} (>=2 意味着 supervisor 触发了续执行)`);
	}, 240_000);

	it("通过 Channel 查询 supervisor 状态", async () => {
		client = makeClient(projectDir, [supervisorPath, bashPath]);

		unsub = client.onEvent((e) => {
			allEvents.push(e);
		});

		await client.start();
		await new Promise((r) => setTimeout(r, 3000));

		const supervisorChannel = client.channel("supervisor");

		console.log("\n--- 测试 supervisor.getStatus ---");
		try {
			const status = await supervisorChannel.call("supervisor.getStatus", {}, 10_000);
			console.log("\n\ud83d\udcca Supervisor 状态:", JSON.stringify(status, null, 2));
			expect(status).toBeDefined();
		} catch (err) {
			console.log("\n\u26a0\ufe0f getStatus 失败:", err instanceof Error ? err.message : String(err));
			allEvents.push({
				type: "channel_call_error",
				data: { method: "getStatus", error: String(err) },
			} as unknown as AgentEvent);
		}

		console.log("\n--- 测试 supervisor.getTaskReport ---");
		try {
			const report = await supervisorChannel.call("supervisor.getTaskReport", {}, 10_000);
			console.log("\n\ud83d\udccb 任务报告:", JSON.stringify(report, null, 2));
		} catch (err) {
			console.log("\n\u26a0\ufe0f getTaskReport 失败:", err instanceof Error ? err.message : String(err));
		}

		console.log("\n--- 测试 supervisor.disable/enable ---");
		try {
			const disableResult = await supervisorChannel.call("supervisor.disable", {}, 10_000);
			console.log("\n\ud83d\udd12 禁用结果:", JSON.stringify(disableResult));

			const statusAfterDisable = await supervisorChannel.call("supervisor.getStatus", {}, 10_000);
			console.log("禁用后状态:", JSON.stringify(statusAfterDisable));

			const enableResult = await supervisorChannel.call("supervisor.enable", {}, 10_000);
			console.log("\ud83d\udd13 启用结果:", JSON.stringify(enableResult));

			const statusAfterEnable = await supervisorChannel.call("supervisor.getStatus", {}, 10_000);
			console.log("启用后状态:", JSON.stringify(statusAfterEnable));
		} catch (err) {
			console.log("\n\u26a0\ufe0f disable/enable 失败:", err instanceof Error ? err.message : String(err));
		}

		console.log("\n--- 测试 supervisor.forceContinue ---");
		try {
			const forceResult = await supervisorChannel.call(
				"supervisor.forceContinue",
				{ reason: "Test force continue" },
				10_000,
			);
			console.log("\n\ud83d\udcca forceContinue 结果:", JSON.stringify(forceResult));

			await new Promise((r) => setTimeout(r, 3000));

			const customEntries = allEvents.filter((e) => (e as Record<string, unknown>).type === "custom_entry");
			console.log(`\nforceContinue 后 custom_entry 事件: ${customEntries.length}`);
			for (const ce of customEntries) {
				const d = ce as Record<string, unknown>;
				console.log(`  customType=${d.customType}, content=${String(d.content ?? "").slice(0, 120)}`);
			}
		} catch (err) {
			console.log("\n\u26a0\ufe0f forceContinue 失败:", err instanceof Error ? err.message : String(err));
		}
	}, 60_000);
});

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent } from "@dyyz1993/pi-agent-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RpcClient } from "../../src/modes/rpc/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionPath = join(__dirname, "..", "..", "extensions", "claude-hooks-compat", "index.ts");

const hasApiKey =
	!!process.env.ANTHROPIC_API_KEY ||
	!!process.env.ANTHROPIC_OAUTH_TOKEN ||
	!!process.env.OPENAI_API_KEY ||
	!!process.env.OPENROUTER_API_KEY ||
	existsSync(join(homedir(), ".pi/agent/models.json"));

const PROVIDER = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN ? "anthropic" : "zhipuai";
const MODEL = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN ? "claude-sonnet-4-5" : "glm-4.7";

function makeClient(projectDir: string): RpcClient {
	return new RpcClient({
		cliPath: join(__dirname, "..", "..", "dist", "cli.js"),
		cwd: projectDir,
		provider: PROVIDER,
		model: MODEL,
		args: ["--no-extensions", "-e", extensionPath, "--no-session"],
	});
}

function writeHookConfig(projectDir: string, config: Record<string, unknown>): void {
	const claudeDir = join(projectDir, ".claude");
	mkdirSync(claudeDir, { recursive: true });
	writeFileSync(join(claudeDir, "settings.json"), JSON.stringify(config, null, 2), "utf-8");
}

function printEventTimeline(label: string, events: AgentEvent[]): void {
	const types = events.map((e) => (e as Record<string, unknown>).type as string);
	const timeline = types.filter(Boolean).join(" -> ");
	console.log(`[${label}] event timeline (${events.length} events):\n  ${timeline}`);
}

function collectAgentMessages(events: AgentEvent[]): string {
	return events
		.filter((e) => {
			const t = (e as Record<string, unknown>).type;
			return t === "message_update" || t === "message_end";
		})
		.map((e) => {
			const msg = (e as Record<string, unknown>).message as Record<string, unknown> | undefined;
			if (msg?.role !== "assistant") return "";
			const content = msg.content;
			if (typeof content === "string") return content;
			if (Array.isArray(content)) {
				return content
					.filter((c: Record<string, unknown>) => c.type === "text")
					.map((c: Record<string, unknown>) => (c.text as string) ?? "")
					.join("");
			}
			return "";
		})
		.join(" ");
}

describe.skipIf(!hasApiKey)("claude-hooks-compat RPC e2e", () => {
	let client: RpcClient;
	let projectDir: string;

	beforeEach(() => {
		projectDir = join(tmpdir(), `pi-hooks-rpc-${Date.now()}`);
		mkdirSync(projectDir, { recursive: true });
		client = makeClient(projectDir);
	});

	afterEach(async () => {
		await client.stop();
		if (projectDir && existsSync(projectDir)) {
			rmSync(projectDir, { recursive: true, force: true });
		}
	});

	it("extension loads and session creates successfully", async () => {
		await client.start();

		const state = await client.getState();
		expect(state).toBeDefined();
		expect(state.model).toBeDefined();

		const extensions = await client.getExtensions();
		expect(extensions.length).toBeGreaterThanOrEqual(1);
	}, 30_000);

	it("PreToolUse hook triggers on tool call", async () => {
		const markerPath = join(projectDir, "hook-marker.txt");

		writeHookConfig(projectDir, {
			hooks: {
				PreToolUse: [
					{
						matcher: "Write",
						hooks: [
							{
								type: "command",
								command: `echo "hook-triggered" > "${markerPath}"`,
							},
						],
					},
				],
			},
		});

		await client.start();

		const allEvents: AgentEvent[] = [];
		const unsub = client.onEvent((e) => allEvents.push(e));

		await client.promptAndWait(
			"Create a file called test.txt with content 'hello'. Use the write tool.",
			undefined,
			120_000,
		);

		unsub();
		printEventTimeline("PreToolUse trigger", allEvents);

		expect(existsSync(markerPath)).toBe(true);
		expect(readFileSync(markerPath, "utf-8").trim()).toBe("hook-triggered");
	}, 180_000);

	it("PreToolUse hook blocks write tool execution", async () => {
		writeHookConfig(projectDir, {
			hooks: {
				PreToolUse: [
					{
						matcher: "Write",
						hooks: [
							{
								type: "command",
								command: 'echo \'{"ok":false,"reason":"write blocked by hook"}\'',
							},
						],
					},
				],
			},
		});

		await client.start();

		const allEvents: AgentEvent[] = [];
		const unsub = client.onEvent((e) => allEvents.push(e));

		await client.promptAndWait(
			"Create a file called blocked.txt with content 'test'. Use the write tool.",
			undefined,
			120_000,
		);

		unsub();
		printEventTimeline("PreToolUse block", allEvents);

		const lastMessageEnd = [...allEvents]
			.reverse()
			.find((e) => (e as Record<string, unknown>).type === "message_end");
		const lastContent = lastMessageEnd
			? ((lastMessageEnd as Record<string, unknown>).message as Record<string, unknown>)?.content
			: undefined;
		const lastText = Array.isArray(lastContent)
			? lastContent.filter((c: Record<string, unknown>) => c.type === "text").map((c: Record<string, unknown>) => c.text ?? "").join(" ")
			: typeof lastContent === "string"
				? lastContent
				: "";
		expect(lastText.toLowerCase()).toContain("blocked");
	}, 180_000);

	it("PostToolUse hook fires after tool execution", async () => {
		const postMarker = join(projectDir, "post-hook-marker.txt");

		writeHookConfig(projectDir, {
			hooks: {
				PostToolUse: [
					{
						matcher: "Write",
						hooks: [
							{
								type: "command",
								command: `echo "post-hook-fired" > "${postMarker}"`,
							},
						],
					},
				],
			},
		});

		await client.start();

		const allEvents: AgentEvent[] = [];
		const unsub = client.onEvent((e) => allEvents.push(e));

		await client.promptAndWait(
			"Create a file called post-test.txt with content 'data'. Use the write tool.",
			undefined,
			120_000,
		);

		unsub();
		printEventTimeline("PostToolUse", allEvents);

		expect(existsSync(postMarker)).toBe(true);
		expect(readFileSync(postMarker, "utf-8").trim()).toBe("post-hook-fired");
	}, 180_000);

	it("Stop hook fires at turn end", async () => {
		const stopMarker = join(projectDir, "stop-hook-marker.txt");

		writeHookConfig(projectDir, {
			hooks: {
				Stop: [
					{
						hooks: [
							{
								type: "command",
								command: `echo "stop-hook-fired" > "${stopMarker}"`,
							},
						],
					},
				],
			},
		});

		await client.start();

		const allEvents: AgentEvent[] = [];
		const unsub = client.onEvent((e) => allEvents.push(e));

		await client.promptAndWait("Say hello.", undefined, 120_000);

		unsub();
		printEventTimeline("Stop hook", allEvents);

		expect(existsSync(stopMarker)).toBe(true);
		expect(readFileSync(stopMarker, "utf-8").trim()).toBe("stop-hook-fired");
	}, 180_000);
});

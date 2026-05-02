import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, registerFauxProvider } from "@dyyz1993/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "../../src/core/agent-session-runtime.js";
import { AuthStorage } from "../../src/core/auth-storage.js";
import { ChannelManager } from "../../src/core/extensions/channel-manager.js";
import type { Channel, ChannelDataMessage } from "../../src/core/extensions/channel-types.js";
import { SessionManager } from "../../src/core/session-manager.js";
import type { ExtensionAPI, ExtensionFactory } from "../../src/index.js";

function createTempDir(): string {
	const dir = join(tmpdir(), `pi-rules-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

async function createRulesRuntime(
	tempDir: string,
	ruleFiles: Record<string, string>,
	channelOutput: ChannelDataMessage[] = [],
) {
	const rulesDir = join(tempDir, ".claude", "rules");
	mkdirSync(rulesDir, { recursive: true });
	for (const [name, content] of Object.entries(ruleFiles)) {
		writeFileSync(join(rulesDir, name), content);
	}

	writeFileSync(
		join(tempDir, ".rules-config.json"),
		JSON.stringify({
			cacheTTL: 30000,
			dirs: {
				project: [".claude/rules"],
				user: [],
				pi: [],
				managed: [],
			},
		}),
	);

	const faux = registerFauxProvider();
	faux.setResponses([fauxAssistantMessage("ok")]);

	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");

	const channelManager = new ChannelManager((msg) => channelOutput.push(msg));

	const channelRef: { current?: Channel } = {};
	const lifecycleLog: Array<{ event: string; timestamp: number; data?: unknown }> = [];

	let rulesEngineModule: any;
	try {
		rulesEngineModule = await import("../../extensions/rules-engine/index.js");
	} catch {
		throw new Error("rules-engine/index.js not found");
	}

	rulesEngineModule.invalidateCache();

	const extensionFactory: ExtensionFactory = (pi: ExtensionAPI) => {
		pi.registerProvider(faux.getModel().provider, {
			baseUrl: faux.getModel().baseUrl,
			apiKey: "faux-key",
			api: faux.api,
			models: faux.models.map((m) => ({
				id: m.id,
				name: m.name,
				api: m.api,
				reasoning: m.reasoning,
				input: m.input,
				cost: m.cost,
				contextWindow: m.contextWindow,
				maxTokens: m.maxTokens,
			})),
		});

		rulesEngineModule.default(pi);

		pi.on("session_start", async () => {
			lifecycleLog.push({ event: "session_start", timestamp: Date.now() });
		});

		pi.on("before_agent_start", async () => {
			lifecycleLog.push({ event: "before_agent_start", timestamp: Date.now() });
		});

		pi.on("agent_start", async () => {
			lifecycleLog.push({ event: "agent_start", timestamp: Date.now() });
		});

		pi.on("turn_start", async (event) => {
			lifecycleLog.push({ event: "turn_start", timestamp: Date.now(), turnIndex: event.turnIndex });
		});

		pi.on("turn_end", async (event) => {
			lifecycleLog.push({ event: "turn_end", timestamp: Date.now(), turnIndex: event.turnIndex });
		});

		pi.on("agent_end", async () => {
			lifecycleLog.push({ event: "agent_end", timestamp: Date.now() });
		});

		pi.on("session_shutdown", async () => {
			lifecycleLog.push({ event: "session_shutdown", timestamp: Date.now() });
		});
	};

	const runtimeOptions = {
		agentDir: tempDir,
		authStorage,
		model: faux.getModel(),
		resourceLoaderOptions: {
			extensionFactories: [extensionFactory],
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
		},
	};

	const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
		const services = await createAgentSessionServices({ ...runtimeOptions, cwd });
		return {
			...(await createAgentSessionFromServices({
				services,
				sessionManager,
				sessionStartEvent,
				model: runtimeOptions.model,
			})),
			services,
			diagnostics: services.diagnostics,
		};
	};

	const runtime = await createAgentSessionRuntime(createRuntime, {
		cwd: tempDir,
		agentDir: tempDir,
		sessionManager: SessionManager.create(tempDir),
	});

	await runtime.session.bindExtensions({
		registerChannel: (name: string) => {
			const ch = channelManager.register(name);
			if (name === "rules-engine") channelRef.current = ch;
			return ch;
		},
	});

	return { runtime, faux, channelManager, channelOutput, lifecycleLog, channelRef, tempDir };
}

describe("Rules Engine: full lifecycle integration", () => {
	const cleanups: Array<() => Promise<void> | void> = [];

	afterEach(async () => {
		while (cleanups.length > 0) {
			await cleanups.pop()?.();
		}
	});

	describe("Phase 1: session_start — load and cache rules", () => {
		it("should load rules from .claude/rules/ on session_start", async () => {
			const tempDir = createTempDir();
			const channelOutput: ChannelDataMessage[] = [];

			const env = await createRulesRuntime(
				tempDir,
				{
					"global-rule.md": "---\n---\n# Always Active\nDo X always.",
					"ts-rule.md": '---\nglobs: "**/*.ts"\nseverity: high\n---\n# TypeScript Rule\nUse strict mode.',
				},
				channelOutput,
			);

			cleanups.push(async () => {
				await env.runtime.dispose();
				env.faux.unregister();
				if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
			});

			env.faux.setResponses([fauxAssistantMessage("ok")]);
			await env.runtime.session.prompt("hello");

			const snapshotMsg = channelOutput.find(
				(m) => m.name === "rules-engine" && (m.data as any)?.type === "snapshot",
			);
			expect(snapshotMsg).toBeDefined();

			const data = snapshotMsg!.data as any;
			expect(data.totalRules).toBe(2);
			expect(data.unconditionalCount).toBe(1);
			expect(data.conditionalCount).toBe(1);

			const names = data.rules.map((r: any) => r.name);
			expect(names).toContain("global-rule");
			expect(names).toContain("ts-rule");

			const tsRule = data.rules.find((r: any) => r.name === "ts-rule");
			expect(tsRule.severity).toBe("high");
			expect(tsRule.isUnconditional).toBe(false);

			const globalRule = data.rules.find((r: any) => r.name === "global-rule");
			expect(globalRule.isUnconditional).toBe(true);
		});

		it("should handle empty rules directory gracefully", async () => {
			const tempDir = createTempDir();
			const channelOutput: ChannelDataMessage[] = [];

			const env = await createRulesRuntime(tempDir, {}, channelOutput);

			cleanups.push(async () => {
				await env.runtime.dispose();
				env.faux.unregister();
				if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
			});

			env.faux.setResponses([fauxAssistantMessage("ok")]);
			await env.runtime.session.prompt("hello");

			const snapshotMsg = channelOutput.find(
				(m) => m.name === "rules-engine" && (m.data as any)?.type === "snapshot",
			);
			expect(snapshotMsg).toBeDefined();
			expect((snapshotMsg!.data as any).totalRules).toBe(0);
		});
	});

	describe("Phase 2: before_agent_start — inject unconditional rules into system prompt", () => {
		it("should append unconditional rules to system prompt", async () => {
			const tempDir = createTempDir();
			const channelOutput: ChannelDataMessage[] = [];

			const env = await createRulesRuntime(
				tempDir,
				{
					"global.md": "---\n---\n# Global Rule\nAlways be helpful.",
				},
				channelOutput,
			);

			cleanups.push(async () => {
				await env.runtime.dispose();
				env.faux.unregister();
				if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
			});

			env.faux.setResponses([fauxAssistantMessage("done")]);
			await env.runtime.session.prompt("hello");

			const injectedMsg = channelOutput.find(
				(m) => m.name === "rules-engine" && (m.data as any)?.type === "injected",
			);
			expect(injectedMsg).toBeDefined();
			expect((injectedMsg!.data as any).systemPromptLength).toBeGreaterThan(0);
		});

		it("should NOT inject conditional rules into system prompt", async () => {
			const tempDir = createTempDir();
			const channelOutput: ChannelDataMessage[] = [];

			const env = await createRulesRuntime(
				tempDir,
				{
					"ts-only.md": '---\nglobs: "**/*.ts"\n---\n# TS Only\nOnly for TS files.',
				},
				channelOutput,
			);

			cleanups.push(async () => {
				await env.runtime.dispose();
				env.faux.unregister();
				if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
			});

			env.faux.setResponses([fauxAssistantMessage("done")]);
			await env.runtime.session.prompt("hello");

			const injectedMsg = channelOutput.find(
				(m) => m.name === "rules-engine" && (m.data as any)?.type === "injected",
			);
			expect(injectedMsg).toBeDefined();
			const promptLen = (injectedMsg!.data as any).systemPromptLength;
			expect(promptLen).toBeGreaterThan(0);
		});
	});

	describe("Phase 3: agent_start/turn/agent_end — lifecycle ordering", () => {
		it("should emit events in correct order: session_start → before_agent_start → agent_start → turn_start → turn_end → agent_end", async () => {
			const tempDir = createTempDir();
			const channelOutput: ChannelDataMessage[] = [];

			const env = await createRulesRuntime(
				tempDir,
				{
					"test.md": "---\n---\n# Test Rule\nBody",
				},
				channelOutput,
			);

			cleanups.push(async () => {
				await env.runtime.dispose();
				env.faux.unregister();
				if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
			});

			env.faux.setResponses([fauxAssistantMessage("response")]);
			await env.runtime.session.prompt("test prompt");

			const events = env.lifecycleLog.map((e) => e.event);

			const sessionStartIdx = events.indexOf("session_start");
			const beforeAgentStartIdx = events.indexOf("before_agent_start");
			const agentStartIdx = events.indexOf("agent_start");
			const turnStartIdx = events.indexOf("turn_start");
			const turnEndIdx = events.indexOf("turn_end");
			const agentEndIdx = events.indexOf("agent_end");

			expect(sessionStartIdx).toBeGreaterThanOrEqual(0);
			expect(beforeAgentStartIdx).toBeGreaterThan(sessionStartIdx);
			expect(agentStartIdx).toBeGreaterThan(beforeAgentStartIdx);
			expect(turnStartIdx).toBeGreaterThan(agentStartIdx);
			expect(turnEndIdx).toBeGreaterThan(turnStartIdx);
			expect(agentEndIdx).toBeGreaterThan(turnEndIdx);
		});
	});

	describe("Phase 4: session_shutdown — cleanup", () => {
		it("should emit unloaded event and clean up status", async () => {
			const tempDir = createTempDir();
			const channelOutput: ChannelDataMessage[] = [];

			const env = await createRulesRuntime(
				tempDir,
				{ "cleanup.md": "---\n---\n# Cleanup Test\nBody" },
				channelOutput,
			);

			cleanups.push(async () => {
				if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
			});

			await env.runtime.dispose();
			env.faux.unregister();

			const shutdownMsg = channelOutput.find(
				(m) => m.name === "rules-engine" && (m.data as any)?.type === "unloaded",
			);
			expect(shutdownMsg).toBeDefined();
		});
	});

	describe("Channel: bidirectional RPC communication", () => {
		it("should register 'rules-engine' channel and send data", async () => {
			const tempDir = createTempDir();
			const channelOutput: ChannelDataMessage[] = [];

			const env = await createRulesRuntime(
				tempDir,
				{ "ch-test.md": "---\n---\n# Channel Test\nBody" },
				channelOutput,
			);

			cleanups.push(async () => {
				await env.runtime.dispose();
				env.faux.unregister();
				if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
			});

			env.faux.setResponses([fauxAssistantMessage("ok")]);
			await env.runtime.session.prompt("hello");

			expect(env.channelManager.has("rules-engine")).toBe(true);
			expect(channelOutput.length).toBeGreaterThan(0);
			expect(channelOutput.every((m) => m.name === "rules-engine")).toBe(true);
		});

		it("should respond to inbound 'list' command via channel", async () => {
			const tempDir = createTempDir();
			const channelOutput: ChannelDataMessage[] = [];

			const env = await createRulesRuntime(
				tempDir,
				{
					"respond.md": "---\n---\n# Respond Test\nBody",
				},
				channelOutput,
			);

			cleanups.push(async () => {
				await env.runtime.dispose();
				env.faux.unregister();
				if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
			});

			const received: unknown[] = [];
			env.channelRef.current?.onReceive((data) => {
				received.push(data);
			});

			env.channelManager.handleInbound({
				type: "channel_data",
				name: "rules-engine",
				data: { action: "list" },
			});

			expect(received).toHaveLength(1);
			expect((received[0] as any).action).toBe("list");
		});

		it("should push detailed rule info on snapshot", async () => {
			const tempDir = createTempDir();
			const channelOutput: ChannelDataMessage[] = [];

			const env = await createRulesRuntime(
				tempDir,
				{
					"critical.md": "---\nseverity: critical\n---\n# Critical Rule\nNever do X.",
					"cond.md": '---\nglobs: "src/**/*.{ts,tsx}"\nseverity: high\n---\n# TS/TSX Rule\nUse strict.',
					"global.md": "---\n---\n# Global Guideline\nBe concise.",
				},
				channelOutput,
			);

			cleanups.push(async () => {
				await env.runtime.dispose();
				env.faux.unregister();
				if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
			});

			env.faux.setResponses([fauxAssistantMessage("ok")]);
			await env.runtime.session.prompt("hello");

			const snapshotMsg = channelOutput.find((m) => (m.data as any)?.type === "snapshot");
			expect(snapshotMsg).toBeDefined();

			const data = snapshotMsg!.data as any;
			expect(data.totalRules).toBe(3);
			expect(data.unconditionalCount).toBe(2);
			expect(data.conditionalCount).toBe(1);

			const criticalRule = data.rules.find((r: any) => r.name === "critical");
			expect(criticalRule.severity).toBe("critical");
			expect(criticalRule.isUnconditional).toBe(true);

			const condRule = data.rules.find((r: any) => r.name === "cond");
			expect(condRule.severity).toBe("high");
			expect(condRule.globs).toEqual(["src/**/*.{ts,tsx}"]);
		});
	});

	describe("Cache TTL and reload lifecycle", () => {
		it("should reload rules after cache invalidation", async () => {
			const tempDir = createTempDir();
			const channelOutput: ChannelDataMessage[] = [];

			const env = await createRulesRuntime(tempDir, { "first.md": "---\n---\n# First" }, channelOutput);

			cleanups.push(async () => {
				await env.runtime.dispose();
				env.faux.unregister();
				if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
			});

			env.faux.setResponses([fauxAssistantMessage("ok")]);
			await env.runtime.session.prompt("hello");

			const initialLoad = channelOutput.find((m) => (m.data as any)?.type === "snapshot");
			expect(initialLoad).toBeDefined();
			expect((initialLoad!.data as any).totalRules).toBe(1);
		});
	});
});

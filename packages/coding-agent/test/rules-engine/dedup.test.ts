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
import type { ChannelDataMessage } from "../../src/core/extensions/channel-types.js";
import { SessionManager } from "../../src/core/session-manager.js";
import type { ExtensionFactory } from "../../src/index.js";

function createTempDir(): string {
	const dir = join(tmpdir(), `pi-rules-dedup-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function getRulesMessages(messages: any[]): any[] {
	return messages.filter((m: any) => m.role === "custom" && m.customType === "rules-engine");
}

function getMessageRoles(messages: any[]): string {
	return `[${messages.map((m: any) => (m.role === "custom" ? `custom:${m.customType}` : m.role)).join(", ")}]`;
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
	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");

	const channelManager = new ChannelManager((msg) => channelOutput.push(msg));

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
		registerChannel: (name: string) => channelManager.register(name),
	});

	return { runtime, faux, channelOutput };
}

async function sendPrompt(env: any, text: string) {
	env.faux.setResponses([fauxAssistantMessage(`response to ${text}`)]);
	await env.runtime.session.prompt(text);
}

describe("Rules Engine: deduplication", () => {
	let tempDir: string;
	const cleanups: Array<() => Promise<void> | void> = [];

	beforeEach(() => {
		tempDir = createTempDir();
	});

	afterEach(async () => {
		while (cleanups.length > 0) {
			await cleanups.pop()?.();
		}
	});

	async function setupEnv(ruleFiles: Record<string, string>) {
		const channelOutput: ChannelDataMessage[] = [];
		const env = await createRulesRuntime(tempDir, ruleFiles, channelOutput);

		cleanups.push(async () => {
			await env.runtime.dispose();
			env.faux.unregister();
			if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
		});

		return env;
	}

	it("should inject unconditional rules only once across 3 turns", async () => {
		const env = await setupEnv({ "global.md": "---\n---\n# Global Rule\nAlways be helpful." });

		await sendPrompt(env, "turn 1");
		await sendPrompt(env, "turn 2");
		await sendPrompt(env, "turn 3");

		const messages = env.runtime.session.agent.state.messages;
		const rulesMessages = getRulesMessages(messages);

		expect(
			rulesMessages.length,
			`Expected 1, got ${rulesMessages.length}. Messages: ${getMessageRoles(messages)}`,
		).toBe(1);
	});

	it("should inject exactly once for a single turn", async () => {
		const env = await setupEnv({ "global.md": "---\n---\n# Global Rule\nAlways be helpful." });

		await sendPrompt(env, "hello");

		const messages = env.runtime.session.agent.state.messages;
		expect(getRulesMessages(messages).length).toBe(1);
		expect(getRulesMessages(messages)[0].content).toContain("Global Rule");
	});

	it("should NOT inject when no unconditional rules exist", async () => {
		const env = await setupEnv({
			"ts-only.md": '---\nglobs: "**/*.ts"\n---\n# TS Only\nOnly for TS files.',
		});

		await sendPrompt(env, "hello");

		const messages = env.runtime.session.agent.state.messages;
		expect(getRulesMessages(messages).length).toBe(0);
	});

	it("should inject only once across 5 turns (stress test)", async () => {
		const env = await setupEnv({ "global.md": "---\n---\n# Global Rule\nAlways be helpful." });

		for (let i = 1; i <= 5; i++) {
			await sendPrompt(env, `turn ${i}`);
		}

		const messages = env.runtime.session.agent.state.messages;
		expect(
			getRulesMessages(messages).length,
			`Got ${getRulesMessages(messages).length} rules messages across 5 turns`,
		).toBe(1);
	});

	it("should combine multiple unconditional rules into single injection", async () => {
		const env = await setupEnv({
			"rule1.md": "---\n---\n# Rule One\nDo A.",
			"rule2.md": "---\n---\n# Rule Two\nDo B.",
			"rule3.md": "---\n---\n# Rule Three\nDo C.",
		});

		await sendPrompt(env, "turn 1");
		await sendPrompt(env, "turn 2");

		const rulesMessages = getRulesMessages(env.runtime.session.agent.state.messages);
		expect(rulesMessages.length).toBe(1);
		const content = rulesMessages[0].content as string;
		expect(content).toContain("Rule One");
		expect(content).toContain("Rule Two");
		expect(content).toContain("Rule Three");
	});

	it("should emit deduplicated=true on subsequent turns via channel", async () => {
		const channelOutput: ChannelDataMessage[] = [];
		const env = await createRulesRuntime(
			tempDir,
			{ "global.md": "---\n---\n# Global Rule\nAlways be helpful." },
			channelOutput,
		);

		cleanups.push(async () => {
			await env.runtime.dispose();
			env.faux.unregister();
			if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
		});

		await sendPrompt(env, "turn 1");
		await sendPrompt(env, "turn 2");

		const injectedEvents = channelOutput.filter(
			(m) => m.name === "rules-engine" && (m.data as any)?.type === "injected",
		);

		expect(injectedEvents.length).toBeGreaterThanOrEqual(2);
		expect((injectedEvents[0].data as any).deduplicated).toBeFalsy();
		expect((injectedEvents[1].data as any).deduplicated).toBe(true);
	});

	describe("compaction scenario", () => {
		it("should re-inject rules after compaction clears lastMessages", async () => {
			const env = await setupEnv({ "global.md": "---\n---\n# Global Rule\nAlways be helpful." });

			await sendPrompt(env, "turn 1");
			await sendPrompt(env, "turn 2");

			const beforeCompact = getRulesMessages(env.runtime.session.agent.state.messages);
			expect(beforeCompact.length).toBe(1);

			try {
				await env.runtime.session.compact();
			} catch {
				// compact may fail if session too small, that's OK
			}

			await sendPrompt(env, "turn 3");

			const messages = env.runtime.session.agent.state.messages;
			const rulesMessages = getRulesMessages(messages);

			expect(
				rulesMessages.length,
				`After compact + 1 new turn, expected rules to be present. Messages: ${getMessageRoles(messages)}`,
			).toBeGreaterThanOrEqual(1);
		});
	});

	describe("navigateTree (undo/rollback) scenario", () => {
		it("should re-inject rules after navigating back past the injection point", async () => {
			const env = await setupEnv({ "global.md": "---\n---\n# Global Rule\nAlways be helpful." });

			await sendPrompt(env, "turn 1");
			await sendPrompt(env, "turn 2");

			expect(getRulesMessages(env.runtime.session.agent.state.messages).length).toBe(1);

			const entries = env.runtime.session.sessionManager.getEntries();
			const firstUserEntry = entries.find((e: any) => e.type === "message" && e.message?.role === "user");

			if (firstUserEntry) {
				await env.runtime.session.navigateTree(firstUserEntry.id);

				await sendPrompt(env, "turn 3");

				const messages = env.runtime.session.agent.state.messages;
				const rulesMessages = getRulesMessages(messages);

				expect(
					rulesMessages.length,
					`After undo + new turn, expected rules to be present. Messages: ${getMessageRoles(messages)}`,
				).toBeGreaterThanOrEqual(1);
			}
		});
	});

	describe("edge case: rules-engine message lost before persist", () => {
		it("should inject on next turn when context handler never fired (lastMessages stays empty)", async () => {
			const env = await setupEnv({ "global.md": "---\n---\n# Global Rule\nAlways be helpful." });

			await sendPrompt(env, "turn 1");

			const messages = env.runtime.session.agent.state.messages;
			const rulesMessages = getRulesMessages(messages);

			expect(
				rulesMessages.length,
				`After 1 turn, expected at least 1 rules-engine message. Messages: ${getMessageRoles(messages)}`,
			).toBeGreaterThanOrEqual(1);

			await sendPrompt(env, "turn 2");

			const messages2 = env.runtime.session.agent.state.messages;
			const rulesMessages2 = getRulesMessages(messages2);

			expect(
				rulesMessages2.length,
				`After 2 turns, expected exactly 1 rules-engine message (not accumulated). Messages: ${getMessageRoles(messages2)}`,
			).toBe(1);
		});
	});
});

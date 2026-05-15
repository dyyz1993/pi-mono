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
import type { SessionEntry } from "../../src/core/session-manager.js";
import { SessionManager } from "../../src/core/session-manager.js";
import type { ExtensionFactory } from "../../src/index.js";

function createTempDir(): string {
	const dir = join(tmpdir(), `pi-rules-invalidation-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** Find session entry ID for a tool result with given toolCallId */
function findToolResultEntryId(entries: SessionEntry[], toolCallId: string): string | undefined {
	for (const entry of entries) {
		if (entry.type === "message" && (entry as any).message?.role === "toolResult") {
			if ((entry as any).message?.toolCallId === toolCallId) {
				return entry.id;
			}
		}
	}
	return undefined;
}

describe("Rules Engine: entries_invalidated → reloaded status", () => {
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

	async function createRulesRuntime(ruleFiles: Record<string, string>, channelOutput: ChannelDataMessage[] = []) {
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

		mkdirSync(join(tempDir, "src"), { recursive: true });
		writeFileSync(join(tempDir, "src", "foo.ts"), "export const foo = 1;");

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

		rulesEngineModule.invalidateCache?.();

		const extensionFactory: ExtensionFactory = (pi: any) => {
			pi.registerProvider(faux.getModel().provider, {
				baseUrl: faux.getModel().baseUrl,
				apiKey: "faux-key",
				api: faux.api,
				models: faux.models.map((m: any) => ({
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

	it("should mark rule as reloaded after entries_invalidated via appendDeletion", async () => {
		const env = await createRulesRuntime({
			"ts-rule.md": '---\nglobs: "**/*.ts"\n---\n# TypeScript Strict\nAlways use strict types.',
		});

		cleanups.push(async () => {
			await env.runtime.dispose();
			env.faux.unregister();
			if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
		});

		// Turn 1: read src/foo.ts → rule injected (status = "loaded")
		env.faux.setResponses([
			fauxAssistantMessage([
				{ type: "text", text: "reading file" },
				{ type: "toolCall", id: "call_first", name: "read", arguments: { path: "src/foo.ts" } },
			]),
			fauxAssistantMessage("done with first read"),
		]);

		await env.runtime.session.prompt("read the file");

		// Verify first read: status should be loaded (not already_loaded, not reloaded)
		const messagesAfterFirst = env.runtime.session.agent.state.messages;
		const toolResults1 = messagesAfterFirst.filter((m: any) => m.role === "toolResult" && m.details?.rulesMatched);
		expect(toolResults1.length).toBeGreaterThanOrEqual(1);
		const firstDetails = (toolResults1[0] as any).details;
		expect(firstDetails.rulesMatched[0].status).toBe("loaded");
		expect(firstDetails.rulesMatched[0].alreadyLoaded).toBeFalsy();

		// Find the session entry ID for the first tool result
		const entries = env.runtime.session.sessionManager.getEntries();
		const firstToolResultEntryId = findToolResultEntryId(entries, "call_first");
		expect(firstToolResultEntryId).toBeDefined();

		// Simulate compaction-manager deleting the first tool result entry
		env.runtime.session.sessionManager.appendDeletion([firstToolResultEntryId!]);

		// Give the async entries_invalidated event time to propagate
		await new Promise((resolve) => setTimeout(resolve, 100));

		// Turn 2: read src/foo.ts again → rule should be "reloaded" (not "already_loaded")
		env.faux.setResponses([
			fauxAssistantMessage([
				{ type: "text", text: "reading file again" },
				{ type: "toolCall", id: "call_second", name: "read", arguments: { path: "src/foo.ts" } },
			]),
			fauxAssistantMessage("done with second read"),
		]);

		await env.runtime.session.prompt("read the file again after deletion");

		// Verify second read: status should be "reloaded"
		const messagesAfterSecond = env.runtime.session.agent.state.messages;
		const toolResults2 = messagesAfterSecond.filter((m: any) => m.role === "toolResult" && m.details?.rulesMatched);
		expect(toolResults2.length).toBeGreaterThanOrEqual(2);

		// Find the second tool result (from call_second)
		const secondToolResult = toolResults2.find((m: any) => m.toolCallId === "call_second");
		expect(secondToolResult).toBeDefined();
		const secondDetails = (secondToolResult as any).details;
		expect(secondDetails.rulesMatched[0].status).toBe("reloaded");
		// alreadyLoaded should be falsy for reloaded (it's not "already loaded", it's "reloaded")
		expect(secondDetails.rulesMatched[0].alreadyLoaded).toBeFalsy();

		// Rule content should be re-injected (since it was invalidated)
		const injectionCount = messagesAfterSecond.filter(
			(m: any) =>
				m.role === "toolResult" &&
				m.toolCallId === "call_second" &&
				Array.isArray(m.content) &&
				m.content.some((c: any) => typeof c.text === "string" && c.text.includes("TypeScript Strict")),
		).length;
		expect(injectionCount).toBe(1);
	});

	it("should mark rule as reloaded after entries_invalidated via appendFold", async () => {
		const env = await createRulesRuntime({
			"ts-rule.md": '---\nglobs: "**/*.ts"\n---\n# TypeScript Strict\nAlways use strict types.',
		});

		cleanups.push(async () => {
			await env.runtime.dispose();
			env.faux.unregister();
			if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
		});

		// Turn 1: read src/foo.ts
		env.faux.setResponses([
			fauxAssistantMessage([
				{ type: "text", text: "reading file" },
				{ type: "toolCall", id: "call_fold", name: "read", arguments: { path: "src/foo.ts" } },
			]),
			fauxAssistantMessage("done"),
		]);

		await env.runtime.session.prompt("read the file");

		// Verify loaded status
		const messages1 = env.runtime.session.agent.state.messages;
		const tr1 = messages1.filter((m: any) => m.role === "toolResult" && m.details?.rulesMatched);
		expect(tr1.length).toBeGreaterThanOrEqual(1);
		expect((tr1[0] as any).details.rulesMatched[0].status).toBe("loaded");

		// Find entry and fold it
		const entries = env.runtime.session.sessionManager.getEntries();
		const entryId = findToolResultEntryId(entries, "call_fold");
		expect(entryId).toBeDefined();

		// Simulate compaction-manager folding the tool result
		env.runtime.session.sessionManager.appendFold(entryId!, "Summary of tool result", 500);

		await new Promise((resolve) => setTimeout(resolve, 100));

		// Turn 2: read same file → should be reloaded
		env.faux.setResponses([
			fauxAssistantMessage([
				{ type: "text", text: "reading again" },
				{ type: "toolCall", id: "call_fold_2", name: "read", arguments: { path: "src/foo.ts" } },
			]),
			fauxAssistantMessage("done"),
		]);

		await env.runtime.session.prompt("read again after fold");

		const messages2 = env.runtime.session.agent.state.messages;
		const tr2 = messages2.filter((m: any) => m.role === "toolResult" && m.details?.rulesMatched);
		const secondTR = tr2.find((m: any) => m.toolCallId === "call_fold_2");
		expect(secondTR).toBeDefined();
		expect((secondTR as any).details.rulesMatched[0].status).toBe("reloaded");
	});

	it("should emit matched channel event with status=reloaded after invalidation", async () => {
		const channelOutput: ChannelDataMessage[] = [];
		const env = await createRulesRuntime(
			{ "ts-rule.md": '---\nglobs: "**/*.ts"\n---\n# TypeScript Strict\nAlways use strict types.' },
			channelOutput,
		);

		cleanups.push(async () => {
			await env.runtime.dispose();
			env.faux.unregister();
			if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
		});

		// Turn 1: read → loaded
		env.faux.setResponses([
			fauxAssistantMessage([
				{ type: "text", text: "reading" },
				{ type: "toolCall", id: "call_ch", name: "read", arguments: { path: "src/foo.ts" } },
			]),
			fauxAssistantMessage("done"),
		]);

		await env.runtime.session.prompt("read");

		// Delete the entry
		const entries = env.runtime.session.sessionManager.getEntries();
		const entryId = findToolResultEntryId(entries, "call_ch");
		env.runtime.session.sessionManager.appendDeletion([entryId!]);
		await new Promise((resolve) => setTimeout(resolve, 100));

		// Turn 2: read same file → reloaded
		env.faux.setResponses([
			fauxAssistantMessage([
				{ type: "text", text: "reading" },
				{ type: "toolCall", id: "call_ch_2", name: "read", arguments: { path: "src/foo.ts" } },
			]),
			fauxAssistantMessage("done"),
		]);

		await env.runtime.session.prompt("read again");

		// Check channel events
		const matchedEvents = channelOutput.filter(
			(m) => m.name === "rules-engine" && (m.data as any)?.type === "matched",
		);

		// First matched: status = "loaded"
		const firstMatch = matchedEvents.find((m) => (m.data as any).toolCallId === "call_ch");
		expect(firstMatch).toBeDefined();
		expect((firstMatch!.data as any).status).toBe("loaded");
		expect((firstMatch!.data as any).alreadyLoaded).toBeFalsy();

		// Second matched after invalidation: status = "reloaded"
		const secondMatch = matchedEvents.find((m) => (m.data as any).toolCallId === "call_ch_2");
		expect(secondMatch).toBeDefined();
		expect((secondMatch!.data as any).status).toBe("reloaded");
		// alreadyLoaded should be falsy for reloaded
		expect((secondMatch!.data as any).alreadyLoaded).toBeFalsy();

		// Per-rule status should also be "reloaded"
		const reloadedRule = (secondMatch!.data as any).matchedRules[0];
		expect(reloadedRule.status).toBe("reloaded");
	});

	it("should keep already_loaded status when entry is NOT invalidated", async () => {
		const env = await createRulesRuntime({
			"ts-rule.md": '---\nglobs: "**/*.ts"\n---\n# TypeScript Strict\nAlways use strict types.',
		});

		cleanups.push(async () => {
			await env.runtime.dispose();
			env.faux.unregister();
			if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
		});

		// Turn 1: read → loaded
		env.faux.setResponses([
			fauxAssistantMessage([
				{ type: "text", text: "reading" },
				{ type: "toolCall", id: "call_no_inv_1", name: "read", arguments: { path: "src/foo.ts" } },
			]),
			fauxAssistantMessage("done"),
		]);

		await env.runtime.session.prompt("read");

		// NO invalidation — just read again

		// Turn 2: read same file → already_loaded
		env.faux.setResponses([
			fauxAssistantMessage([
				{ type: "text", text: "reading again" },
				{ type: "toolCall", id: "call_no_inv_2", name: "read", arguments: { path: "src/foo.ts" } },
			]),
			fauxAssistantMessage("done"),
		]);

		await env.runtime.session.prompt("read again");

		const messages = env.runtime.session.agent.state.messages;
		const toolResults = messages.filter((m: any) => m.role === "toolResult" && m.details?.rulesMatched);

		const secondTR = toolResults.find((m: any) => m.toolCallId === "call_no_inv_2");
		expect(secondTR).toBeDefined();
		expect((secondTR as any).details.rulesMatched[0].status).toBe("already_loaded");
		expect((secondTR as any).details.rulesMatched[0].alreadyLoaded).toBe(true);
	});
});

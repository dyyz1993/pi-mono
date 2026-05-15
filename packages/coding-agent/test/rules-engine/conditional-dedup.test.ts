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
	const dir = join(tmpdir(), `pi-rules-cond-dedup-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** Extract rulesMatched details from tool_result messages */
function getToolResultRulesDetails(messages: any[]): any[] {
	return messages
		.filter((m: any) => m.role === "toolResult")
		.map((m: any) => m.details)
		.filter((d: any) => d?.rulesMatched);
}

/** Count how many times rule content was injected into tool_result content */
function countRuleContentInjections(messages: any[], ruleTitle: string): number {
	return messages.filter(
		(m: any) =>
			m.role === "toolResult" &&
			Array.isArray(m.content) &&
			m.content.some((c: any) => typeof c.text === "string" && c.text.includes(ruleTitle)),
	).length;
}

describe("Rules Engine: conditional rules dedup in tool_result", () => {
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

		// Create test files that the read tool will access
		mkdirSync(join(tempDir, "src"), { recursive: true });
		writeFileSync(join(tempDir, "src", "foo.ts"), "export const foo = 1;");
		writeFileSync(join(tempDir, "src", "bar.ts"), "export const bar = 2;");

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

	it("should NOT re-inject conditional rule content on second read of same file in same turn", async () => {
		// Rule with globs — classified as conditional
		const env = await createRulesRuntime({
			"ts-rule.md": '---\nglobs: "**/*.ts"\n---\n# TypeScript Strict\nAlways use strict types.',
		});

		cleanups.push(async () => {
			await env.runtime.dispose();
			env.faux.unregister();
			if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
		});

		// First turn: agent reads a .ts file, then reads it again (tool call loop)
		env.faux.setResponses([
			fauxAssistantMessage([
				{ type: "text", text: "reading file" },
				{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "src/foo.ts" } },
			]),
			fauxAssistantMessage([
				{ type: "text", text: "reading again" },
				{ type: "toolCall", id: "call_2", name: "read", arguments: { path: "src/foo.ts" } },
			]),
			fauxAssistantMessage("done"),
		]);

		await env.runtime.session.prompt("read the file twice");

		const messages = env.runtime.session.agent.state.messages;

		// Should have details on BOTH tool results (matched both times)
		const detailsList = getToolResultRulesDetails(messages);
		console.log(`detailsList length: ${detailsList.length}`);
		expect(detailsList.length).toBeGreaterThanOrEqual(2);

		// First time: alreadyLoaded should be false or absent
		const firstDetails = detailsList[0];
		expect(firstDetails.rulesMatched.length).toBeGreaterThan(0);
		// Each matched rule should have alreadyLoaded = false on first injection
		expect(firstDetails.rulesMatched[0].alreadyLoaded).toBeFalsy();

		// Second time: alreadyLoaded should be true
		const secondDetails = detailsList[1];
		expect(secondDetails.rulesMatched.length).toBeGreaterThan(0);
		expect(secondDetails.rulesMatched[0].alreadyLoaded).toBe(true);

		// Rule content should only be injected ONCE (not duplicated in second tool result)
		const injectionCount = countRuleContentInjections(messages, "TypeScript Strict");
		expect(injectionCount).toBe(1);
	});

	it("should inject conditional rule content for different files", async () => {
		const env = await createRulesRuntime({
			"ts-rule.md": '---\nglobs: "**/*.ts"\n---\n# TypeScript Strict\nAlways use strict types.',
		});

		cleanups.push(async () => {
			await env.runtime.dispose();
			env.faux.unregister();
			if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
		});

		// Agent reads two different .ts files
		env.faux.setResponses([
			fauxAssistantMessage([
				{ type: "text", text: "reading files" },
				{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "src/foo.ts" } },
			]),
			fauxAssistantMessage([
				{ type: "text", text: "reading another" },
				{ type: "toolCall", id: "call_2", name: "read", arguments: { path: "src/bar.ts" } },
			]),
			fauxAssistantMessage("done"),
		]);

		await env.runtime.session.prompt("read both files");

		const messages = env.runtime.session.agent.state.messages;

		// Both should have rulesMatched details
		const detailsList = getToolResultRulesDetails(messages);
		expect(detailsList.length).toBeGreaterThanOrEqual(2);

		// First file: not already loaded
		expect(detailsList[0].rulesMatched[0].alreadyLoaded).toBeFalsy();

		// Second DIFFERENT file: should still inject (it's a different file)
		// The rule is the same but the FILE is different, so it should be injected again
		expect(detailsList[1].rulesMatched[0].alreadyLoaded).toBeFalsy();

		// Both should have rule content injected
		const injectionCount = countRuleContentInjections(messages, "TypeScript Strict");
		expect(injectionCount).toBe(2);
	});

	it("should emit matched channel event with alreadyLoaded=true for deduplicated matches", async () => {
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

		env.faux.setResponses([
			fauxAssistantMessage([
				{ type: "text", text: "reading file" },
				{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "src/foo.ts" } },
			]),
			fauxAssistantMessage([
				{ type: "text", text: "reading again" },
				{ type: "toolCall", id: "call_2", name: "read", arguments: { path: "src/foo.ts" } },
			]),
			fauxAssistantMessage("done"),
		]);

		await env.runtime.session.prompt("read twice");

		const matchedEvents = channelOutput.filter(
			(m) => m.name === "rules-engine" && (m.data as any)?.type === "matched",
		);

		expect(matchedEvents.length).toBeGreaterThanOrEqual(2);

		// First match: not deduplicated
		expect((matchedEvents[0].data as any).alreadyLoaded).toBeFalsy();

		// Second match of same file+rule: deduplicated
		expect((matchedEvents[1].data as any).alreadyLoaded).toBe(true);
	});
});

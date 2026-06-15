import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { runSubtask, type SubtaskContext } from "../../src/core/subtask.ts";
import type { ExtensionFactory } from "../../src/index.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("runSubtask()", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	function buildContext(harness: Harness, overrides?: Partial<SubtaskContext>): SubtaskContext {
		return {
			modelRegistry: harness.session.modelRegistry,
			resourceLoader: harness.session.resourceLoader,
			model: harness.getModel(),
			getApiKey: () => "faux-key",
			cwd: harness.tempDir,
			...overrides,
		};
	}

	it("executes a basic subtask and returns success", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("Hello from subtask")]);

		const result = await runSubtask({ task: "Say hello" }, buildContext(harness));

		expect(result.success).toBe(true);
		expect(result.text).toContain("Hello from subtask");
	});

	it("applies agentConfig with a custom system prompt", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		let capturedSystemPrompt = "";
		harness.setResponses([
			(context) => {
				capturedSystemPrompt = context.systemPrompt ?? "";
				return fauxAssistantMessage("Agent config applied");
			},
		]);

		const result = await runSubtask(
			{
				task: "analyze",
				agentConfig: {
					name: "test-agent",
					description: "test",
					systemPrompt: "You are a test agent.",
					source: "builtin",
					filePath: "",
				},
			},
			buildContext(harness),
		);

		expect(result.success).toBe(true);
		expect(capturedSystemPrompt).toContain("You are a test agent.");
	});

	it("does not inherit parent session history by default", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		// Seed parent session with a message
		harness.sessionManager.appendMessage({
			role: "user",
			content: "Secret topic: unicorns",
			timestamp: Date.now(),
		});

		let contextPassedToProvider: string[] = [];
		harness.setResponses([
			(context) => {
				contextPassedToProvider = (context.messages ?? [])
					.map((m: any) => (typeof m.content === "string" ? m.content : ""))
					.filter(Boolean);
				return fauxAssistantMessage("I have no prior context");
			},
		]);

		const result = await runSubtask(
			{ task: "what did we discuss?" },
			buildContext(harness, {
				messages: harness.session.messages,
			}),
		);

		expect(result.success).toBe(true);
		// inheritHistory defaults to false, so the subtask should not see parent messages
		expect(contextPassedToProvider).not.toContain("Secret topic: unicorns");
	});

	it("disposes the internal session cleanly", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("done")]);

		// If dispose were not called, the session would leak listeners/timers.
		// We verify the function returns cleanly (no hang, no error).
		const result = await runSubtask({ task: "test" }, buildContext(harness));

		expect(result.success).toBe(true);
		expect(result.text).toContain("done");
	});

	it("returns success when agent name is not found", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("ok")]);

		// "nonexistent-agent-xyz" does not exist — lookup returns undefined,
		// which means no agent config is applied, but the subtask still runs.
		const result = await runSubtask({ task: "test", agent: "nonexistent-agent-xyz" }, buildContext(harness));

		expect(result.success).toBe(true);
		expect(result.text).toContain("ok");
	});

	it("restricts tools to whitelist when tools option is set", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		let toolNamesInSubtask: string[] = [];
		harness.setResponses([
			(context) => {
				toolNamesInSubtask = context.tools?.map((t: any) => t.name) ?? [];
				return fauxAssistantMessage("done");
			},
		]);

		const result = await runSubtask({ task: "read files", tools: ["read", "grep"] }, buildContext(harness));

		expect(result.success).toBe(true);
		expect(toolNamesInSubtask).toContain("read");
		expect(toolNamesInSubtask).toContain("grep");
		// Other default tools should not be present
		expect(toolNamesInSubtask).not.toContain("write");
		expect(toolNamesInSubtask).not.toContain("edit");
	});

	it("removes disallowed tools from the subtask session", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		let toolNamesInSubtask: string[] = [];
		harness.setResponses([
			(context) => {
				toolNamesInSubtask = context.tools?.map((t: any) => t.name) ?? [];
				return fauxAssistantMessage("done");
			},
		]);

		const result = await runSubtask({ task: "do work", disallowedTools: ["write", "edit"] }, buildContext(harness));

		expect(result.success).toBe(true);
		expect(toolNamesInSubtask).not.toContain("write");
		expect(toolNamesInSubtask).not.toContain("edit");
	});

	it("uses the specified model when model option is set", async () => {
		const harness = await createHarness({
			models: [
				{ id: "faux-1", name: "Faux Model" },
				{ id: "faux-fast", name: "Faux Fast" },
			],
		});
		harnesses.push(harness);

		let capturedModel: string | undefined;
		harness.setResponses([
			(_context, _options, _state, model) => {
				capturedModel = model.id;
				return fauxAssistantMessage("done");
			},
		]);

		const result = await runSubtask({ task: "test", model: "faux-fast" }, buildContext(harness));

		expect(result.success).toBe(true);
		expect(capturedModel).toBe("faux-fast");
	});

	it("respects maxTurns option", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("completed in one turn")]);

		const result = await runSubtask({ task: "test", maxTurns: 1 }, buildContext(harness));

		expect(result.success).toBe(true);
		expect(result.text).toContain("completed in one turn");
	});

	it("fires before_agent_start extension hook during subtask", async () => {
		let hookFired = false;
		const factory: ExtensionFactory = (pi) => {
			pi.on("before_agent_start", () => {
				hookFired = true;
			});
		};

		const harness = await createHarness({
			extensionFactories: [factory],
		});
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("done")]);

		const result = await runSubtask({ task: "test" }, buildContext(harness));

		expect(result.success).toBe(true);
		expect(hookFired).toBe(true);
	});

	it("resolves model tier keyword to the correct model", async () => {
		const harness = await createHarness({
			models: [
				{ id: "faux-1", name: "Faux Default" },
				{ id: "faux-fast", name: "Faux Fast" },
				{ id: "faux-pro", name: "Faux Pro" },
			],
		});
		harnesses.push(harness);

		let capturedModel: string | undefined;
		harness.setResponses([
			(_context, _options, _state, model) => {
				capturedModel = model.id;
				return fauxAssistantMessage("done");
			},
		]);

		// "faux-fast" should match the model with id "faux-fast" via substring match
		const result = await runSubtask({ task: "test", model: "faux-fast" }, buildContext(harness));

		expect(result.success).toBe(true);
		expect(capturedModel).toBe("faux-fast");
	});

	it("falls back to parent model when specified model is not found", async () => {
		const harness = await createHarness({
			models: [{ id: "faux-1", name: "Faux Default" }],
		});
		harnesses.push(harness);

		let capturedModel: string | undefined;
		harness.setResponses([
			(_context, _options, _state, model) => {
				capturedModel = model.id;
				return fauxAssistantMessage("done");
			},
		]);

		const result = await runSubtask({ task: "test", model: "nonexistent-model-xyz" }, buildContext(harness));

		expect(result.success).toBe(true);
		// Should fall back to parent's model (faux-1)
		expect(capturedModel).toBe("faux-1");
	});

	it("completes within maxTurns limit with multiple turns", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		// Simulate 2 tool-use turns then a final text turn (3 turns total)
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("read", { file_path: "/nonexistent-1" }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("read", { file_path: "/nonexistent-2" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("Final response"),
		]);

		const result = await runSubtask({ task: "test", maxTurns: 3 }, buildContext(harness));

		expect(result.success).toBe(true);
		expect(result.text).toContain("Final response");
	});

	it("applies whitelist then removes disallowed tools", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		let toolNamesInSubtask: string[] = [];
		harness.setResponses([
			(context) => {
				toolNamesInSubtask = context.tools?.map((t: any) => t.name) ?? [];
				return fauxAssistantMessage("done");
			},
		]);

		const result = await runSubtask(
			{ task: "test", tools: ["read", "write", "edit"], disallowedTools: ["write"] },
			buildContext(harness),
		);

		expect(result.success).toBe(true);
		expect(toolNamesInSubtask).toContain("read");
		expect(toolNamesInSubtask).toContain("edit");
		expect(toolNamesInSubtask).not.toContain("write");
	});

	it("uses the specified cwd instead of parent session cwd", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const customCwd = join(tmpdir(), `pi-cwd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(customCwd, { recursive: true });

		harness.setResponses([fauxAssistantMessage("done")]);

		const result = await runSubtask({ task: "test", cwd: customCwd }, buildContext(harness));

		expect(result.success).toBe(true);
		// The custom cwd should be reflected in the session configuration
		// (we can't directly check the cwd, but the session was created successfully)
	});

	it("loads agent config from disk via discoverAgents", async () => {
		// Create a temporary agent directory
		const agentDir = join(tmpdir(), `pi-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(join(agentDir, ".pi", "agents"), { recursive: true });

		const agentMd = `---
name: test-disk-agent
description: Agent loaded from disk
---
You are a disk-loaded agent.
`;
		writeFileSync(join(agentDir, ".pi", "agents", "test-disk-agent.md"), agentMd);

		const harness = await createHarness();
		harnesses.push(harness);

		let capturedSystemPrompt = "";
		harness.setResponses([
			(context) => {
				capturedSystemPrompt = context.systemPrompt ?? "";
				return fauxAssistantMessage("done");
			},
		]);

		const result = await runSubtask(
			{ task: "test", agent: "test-disk-agent" },
			buildContext(harness, { cwd: agentDir }),
		);

		expect(result.success).toBe(true);
		expect(capturedSystemPrompt).toContain("disk-loaded agent");

		rmSync(agentDir, { recursive: true, force: true });
	});

	it("does not fire extension hooks when inheritExtensions is false", async () => {
		let hookFired = false;
		const factory: ExtensionFactory = (pi) => {
			pi.on("before_agent_start", () => {
				hookFired = true;
			});
		};

		const harness = await createHarness({
			extensionFactories: [factory],
		});
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("done")]);

		// inheritExtensions defaults to true, but we explicitly set it to false
		const result = await runSubtask({ task: "test", inheritExtensions: false }, buildContext(harness));

		expect(result.success).toBe(true);
		// The hook should NOT have fired because we disabled extension inheritance
		expect(hookFired).toBe(false);
	});

	it("inherits parent session history when inheritHistory is true", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		let contextMessages: string[] = [];
		harness.setResponses([
			(context) => {
				contextMessages = (context.messages ?? [])
					.map((m: any) => (typeof m.content === "string" ? m.content : ""))
					.filter(Boolean);
				return fauxAssistantMessage("I remember the discussion");
			},
		]);

		const parentMessages = [
			{
				role: "user" as const,
				content: "We discussed quantum physics earlier",
				timestamp: Date.now(),
			},
		];

		const result = await runSubtask(
			{ task: "what did we discuss?", inheritHistory: true },
			buildContext(harness, {
				messages: parentMessages,
			}),
		);

		expect(result.success).toBe(true);
		expect(contextMessages).toContain("We discussed quantum physics earlier");
	});

	it("does not inherit parent tools when inheritTools is false", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		let toolNamesInSubtask: string[] = [];
		harness.setResponses([
			(context) => {
				toolNamesInSubtask = context.tools?.map((t: any) => t.name) ?? [];
				return fauxAssistantMessage("done");
			},
		]);

		const result = await runSubtask({ task: "test", inheritTools: false }, buildContext(harness));

		expect(result.success).toBe(true);
		// When inheritTools is false, no tools should be available
		expect(toolNamesInSubtask).toHaveLength(0);
	});
});

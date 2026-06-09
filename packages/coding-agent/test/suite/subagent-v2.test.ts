/**
 * Integration tests for the subagent-v2 extension.
 *
 * Tests tool registration, parameter handling, renderCall/renderResult,
 * error handling, and the resume flow using the local test harness
 * with the faux provider.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { CoordinatorChannelContract } from "../../extensions/coordinator/types.ts";
import { createTypedChannel } from "../../src/core/extensions/channel-factory.ts";
import { ChannelManager } from "../../src/core/extensions/channel-manager.ts";
import type { Channel, ChannelDataMessage } from "../../src/core/extensions/channel-types.ts";
import type { ExtensionFactory } from "../../src/core/extensions/index.ts";
import type { ToolRenderContext } from "../../src/core/extensions/types.ts";
import type { Theme } from "../../src/modes/interactive/theme/theme.ts";
import { createHarness, type Harness } from "./harness.ts";

// Load subagent-v2 extension factory
const subagentV2Factory: ExtensionFactory = (await import("../../extensions/subagent-v2/index.ts")).default;

// ── Helpers ──

const mockTheme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as unknown as Theme;
const mockContext = {} as ToolRenderContext;

const harnesses: Harness[] = [];
const tempDirs: string[] = [];

afterEach(() => {
	while (harnesses.length > 0) {
		harnesses.pop()?.cleanup();
	}
	while (tempDirs.length > 0) {
		const d = tempDirs.pop();
		if (d) {
			try {
				rmSync(d, { recursive: true, force: true });
			} catch {}
		}
	}
});

function createSubagentHarness(): Promise<Harness> {
	const tempDir = join(tmpdir(), `pi-subagent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });

	// Create a project agent so discoverAgents finds at least one subagent
	const agentsDir = join(tempDir, ".pi", "agents");
	mkdirSync(agentsDir, { recursive: true });
	writeFileSync(
		join(agentsDir, "test-worker.md"),
		[
			"---",
			"name: test-worker",
			"description: A test worker agent",
			"mode: subagent",
			"---",
			"You are a test worker agent.",
		].join("\n"),
	);
	tempDirs.push(tempDir);

	return createHarness({
		extensionFactories: [subagentV2Factory],
	}).then(async (h) => {
		harnesses.push(h);
		await h.session.bindExtensions({});
		return h;
	});
}

// ── Tests ──

describe("subagent-v2 tool registration", () => {
	it("registers the subagent tool", async () => {
		const harness = await createSubagentHarness();
		const tool = harness.session.getToolDefinition("subagent");
		expect(tool).toBeDefined();
		expect(tool!.name).toBe("subagent");
		expect(tool!.label).toBe("Subagent");
	});

	it("registers the subagent_resume tool", async () => {
		const harness = await createSubagentHarness();
		const tool = harness.session.getToolDefinition("subagent_resume");
		expect(tool).toBeDefined();
		expect(tool!.name).toBe("subagent_resume");
	});

	it("subagent tool has description parameter", async () => {
		const harness = await createSubagentHarness();
		const tool = harness.session.getToolDefinition("subagent");
		const schema = tool!.parameters as { properties: Record<string, unknown> };
		expect(schema.properties).toHaveProperty("description");
	});

	it("subagent tool has model parameter", async () => {
		const harness = await createSubagentHarness();
		const tool = harness.session.getToolDefinition("subagent");
		const schema = tool!.parameters as { properties: Record<string, unknown> };
		expect(schema.properties).toHaveProperty("model");
	});

	it("subagent tool has required fields: agent and task", async () => {
		const harness = await createSubagentHarness();
		const tool = harness.session.getToolDefinition("subagent");
		const schema = tool!.parameters as { required: string[] };
		expect(schema.required).toContain("agent");
		expect(schema.required).toContain("task");
	});
});

describe("subagent tool parameter validation", () => {
	it("rejects unknown agent name", async () => {
		const harness = await createSubagentHarness();

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("subagent", {
					agent: "nonexistent-agent",
					task: "do something",
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("The agent was not found."),
		]);

		await harness.session.prompt("run a subagent");

		const toolResults = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResults.length).toBeGreaterThanOrEqual(1);

		const resultText = toolResults[0]!.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");

		expect(resultText).toContain("Unknown agent");
		expect(resultText).toContain("nonexistent-agent");
	});
});

describe("subagent tool renderCall", () => {
	it("renderCall is defined on subagent tool", async () => {
		const harness = await createSubagentHarness();
		const tool = harness.session.getToolDefinition("subagent");
		expect(tool!.renderCall).toBeDefined();
		expect(typeof tool!.renderCall).toBe("function");
	});

	it("renderCall includes agent name in output", async () => {
		const harness = await createSubagentHarness();
		const tool = harness.session.getToolDefinition("subagent");
		const result = tool!.renderCall!({ agent: "test-worker", task: "run tests" }, mockTheme, mockContext);
		const text = result.render(80).join("\n");
		expect(text).toContain("test-worker");
		expect(text).toContain("run tests");
	});

	it("renderCall shows description when provided", async () => {
		const harness = await createSubagentHarness();
		const tool = harness.session.getToolDefinition("subagent");
		const result = tool!.renderCall!(
			{ agent: "test-worker", task: "run tests", description: "Run test suite" },
			mockTheme,
			mockContext,
		);
		const text = result.render(80).join("\n");
		expect(text).toContain("Run test suite");
	});

	it("renderCall omits description when not provided", async () => {
		const harness = await createSubagentHarness();
		const tool = harness.session.getToolDefinition("subagent");
		const result = tool!.renderCall!({ agent: "test-worker", task: "run tests" }, mockTheme, mockContext);
		const text = result.render(80).join("\n");
		expect(text).not.toContain("—");
	});

	it("renderCall truncates long task text", async () => {
		const harness = await createSubagentHarness();
		const tool = harness.session.getToolDefinition("subagent");
		const longTask = "a".repeat(100);
		const result = tool!.renderCall!({ agent: "test-worker", task: longTask }, mockTheme, mockContext);
		const text = result.render(80).join("\n");
		expect(text).toContain("...");
		expect(text).not.toContain(longTask);
	});
});

describe("subagent tool renderResult", () => {
	it("renderResult is defined on subagent tool", async () => {
		const harness = await createSubagentHarness();
		const tool = harness.session.getToolDefinition("subagent");
		expect(tool!.renderResult).toBeDefined();
		expect(typeof tool!.renderResult).toBe("function");
	});

	it("renderResult shows finalText from details", async () => {
		const harness = await createSubagentHarness();
		const tool = harness.session.getToolDefinition("subagent");
		const result = tool!.renderResult!(
			{
				content: [{ type: "text", text: "done" }],
				details: {
					agentScope: "user",
					projectAgentsDir: null,
					result: {
						sessionId: "sess-1",
						status: "completed",
						exitCode: 0,
						finalText: "Task completed successfully!",
					},
				},
			},
			{ expanded: false, isPartial: false },
			mockTheme,
			mockContext,
		);
		const text = result.render(80).join("\n");
		expect(text).toContain("Task completed successfully!");
	});

	it("renderResult shows exit code on error", async () => {
		const harness = await createSubagentHarness();
		const tool = harness.session.getToolDefinition("subagent");
		const result = tool!.renderResult!(
			{
				content: [{ type: "text", text: "error" }],
				details: {
					agentScope: "user",
					projectAgentsDir: null,
					result: {
						sessionId: "sess-1",
						status: "error",
						exitCode: 1,
						finalText: "Something went wrong",
					},
				},
			},
			{ expanded: false, isPartial: false },
			mockTheme,
			mockContext,
		);
		const text = result.render(80).join("\n");
		expect(text).toContain("exit: 1");
	});

	it("renderResult handles missing details gracefully", async () => {
		const harness = await createSubagentHarness();
		const tool = harness.session.getToolDefinition("subagent");
		const result = tool!.renderResult!(
			{
				content: [{ type: "text", text: "simple output" }],
				details: {},
			},
			{ expanded: false, isPartial: false },
			mockTheme,
			mockContext,
		);
		const text = result.render(80).join("\n");
		expect(text).toContain("simple output");
	});
});

describe("subagent_resume tool", () => {
	it("renderCall shows session path or ID", async () => {
		const harness = await createSubagentHarness();
		const tool = harness.session.getToolDefinition("subagent_resume");
		const result = tool!.renderCall!({ sessionId: "sess-abc123" }, mockTheme, mockContext);
		const text = result.render(80).join("\n");
		expect(text).toContain("sess-abc123");
	});

	it("returns error when neither sessionId nor sessionPath provided", async () => {
		const harness = await createSubagentHarness();

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("subagent_resume", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("Cannot resume without session info."),
		]);

		await harness.session.prompt("resume a subagent");

		const toolResults = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResults.length).toBeGreaterThanOrEqual(1);

		const resultText = toolResults[0]!.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");

		expect(resultText).toContain("required");
	});

	it("returns error when sessionId is provided but session file not found", async () => {
		const harness = await createSubagentHarness();

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("subagent_resume", { sessionId: "nonexistent-session" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Session not found."),
		]);

		await harness.session.prompt("resume a subagent");

		const toolResults = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResults.length).toBeGreaterThanOrEqual(1);

		const resultText = toolResults[0]!.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");

		expect(resultText).toContain("not found");
	});
});

describe("subagent tool error handling", () => {
	it("returns error when coordinator channel call fails", async () => {
		const harness = await createSubagentHarness();

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("subagent", {
					agent: "build",
					task: "do something",
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("The subagent failed."),
		]);

		await harness.session.prompt("run a subagent");

		const toolResults = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResults.length).toBeGreaterThanOrEqual(1);

		const resultText = toolResults[0]!.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");

		// Should contain either "Agent failed" (coordinator not available)
		// or "Unknown agent" (if discoverAgents didn't find "build")
		expect(
			resultText.includes("Agent failed") || resultText.includes("Unknown agent") || resultText.includes("error"),
		).toBe(true);
	});
});

// ── Cross-wired channel helpers for normal execution path tests ──

type DelegateSyncHandler = (
	params: CoordinatorChannelContract["methods"]["session_delegate_sync"]["params"],
) =>
	| CoordinatorChannelContract["methods"]["session_delegate_sync"]["return"]
	| Promise<CoordinatorChannelContract["methods"]["session_delegate_sync"]["return"]>;

function createCrossWiredChannels(delegateHandler: DelegateSyncHandler) {
	let clientManager: ChannelManager;
	let serverManager: ChannelManager;

	// Server-side ChannelManager: its output (server responses) routes to client inbound
	serverManager = new ChannelManager((msg: ChannelDataMessage) => {
		// Use setImmediate to avoid synchronous re-entrancy
		setImmediate(() => clientManager.handleInbound(msg));
	});

	// Client-side ChannelManager: its output (client requests) routes to server inbound
	clientManager = new ChannelManager((msg: ChannelDataMessage) => {
		setImmediate(() => serverManager.handleInbound(msg));
	});

	// Register "coordinator_client" on both sides
	const serverRaw = serverManager.register("coordinator_client");
	const clientRaw = clientManager.register("coordinator_client");

	// Set up the server-side mock handler
	const { server: coordinatorServer } = createTypedChannel<CoordinatorChannelContract>(serverRaw);
	coordinatorServer.handle("session_delegate_sync", delegateHandler);

	return {
		clientManager,
		serverManager,
		clientCoordinatorRaw: clientRaw,
		registerChannel: (name: string): Channel => {
			if (name === "coordinator_client") {
				return clientRaw;
			}
			return clientManager.register(name);
		},
	};
}

async function createHarnessWithCoordinator(delegateHandler: DelegateSyncHandler): Promise<{
	harness: Harness;
	channelInfo: ReturnType<typeof createCrossWiredChannels>;
}> {
	const channelInfo = createCrossWiredChannels(delegateHandler);

	const h = await createHarness({
		extensionFactories: [subagentV2Factory],
	});
	harnesses.push(h);

	// Create a project agent in the harness's own cwd so discoverAgents finds it
	const agentsDir = join(h.tempDir, ".pi", "agents");
	mkdirSync(agentsDir, { recursive: true });
	writeFileSync(
		join(agentsDir, "test-worker.md"),
		[
			"---",
			"name: test-worker",
			"description: A test worker agent",
			"mode: subagent",
			"---",
			"You are a test worker agent.",
		].join("\n"),
	);

	await h.session.bindExtensions({
		registerChannel: channelInfo.registerChannel,
	});

	return { harness: h, channelInfo };
}

// ── Normal execution path tests ──

describe("subagent tool normal execution path", () => {
	it("returns successful result when coordinator responds with exitCode 0", async () => {
		const { harness } = await createHarnessWithCoordinator(async () => ({
			sessionId: "sess-ok",
			status: "completed" as const,
			exitCode: 0,
			finalText: "Task done!",
		}));

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("subagent", {
					agent: "test-worker",
					task: "do something useful",
					agentScope: "project",
					confirmProjectAgents: false,
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("The subagent finished."),
		]);

		await harness.session.prompt("run a subagent");

		const toolResults = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResults.length).toBeGreaterThanOrEqual(1);

		const resultText = toolResults[0]!.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");

		expect(resultText).toContain("Task done!");
	});

	it("returns error result when coordinator responds with non-zero exitCode", async () => {
		const { harness } = await createHarnessWithCoordinator(async () => ({
			sessionId: "sess-err",
			status: "error" as const,
			exitCode: 1,
			finalText: "Oops",
			error: "boom",
		}));

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("subagent", {
					agent: "test-worker",
					task: "do something",
					agentScope: "project",
					confirmProjectAgents: false,
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("The subagent errored."),
		]);

		await harness.session.prompt("run a subagent");

		const toolResults = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResults.length).toBeGreaterThanOrEqual(1);

		const resultText = toolResults[0]!.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");

		expect(resultText).toContain("boom");

		// Verify details contain the error result with non-zero exitCode
		const details = (toolResults[0] as { details?: { result?: { exitCode: number; status: string } } }).details;
		expect(details?.result).toBeDefined();
		expect(details!.result!.exitCode).toBe(1);
		expect(details!.result!.status).toBe("error");
	});

	it("passes agent name to coordinator", async () => {
		let capturedParams: Record<string, unknown> | undefined;

		const { harness } = await createHarnessWithCoordinator(async (params) => {
			capturedParams = params as Record<string, unknown>;
			return {
				sessionId: "sess-agent",
				status: "completed" as const,
				exitCode: 0,
				finalText: "ok",
			};
		});

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("subagent", {
					agent: "test-worker",
					task: "check agent param",
					agentScope: "project",
					confirmProjectAgents: false,
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run a subagent");

		expect(capturedParams).toBeDefined();
		expect(capturedParams!.agent).toBe("test-worker");
	});

	it("passes model override to coordinator", async () => {
		let capturedParams: Record<string, unknown> | undefined;

		const { harness } = await createHarnessWithCoordinator(async (params) => {
			capturedParams = params as Record<string, unknown>;
			return {
				sessionId: "sess-model",
				status: "completed" as const,
				exitCode: 0,
				finalText: "ok",
			};
		});

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("subagent", {
					agent: "test-worker",
					task: "check model param",
					model: "test-model",
					agentScope: "project",
					confirmProjectAgents: false,
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run a subagent");

		expect(capturedParams).toBeDefined();
		expect(capturedParams!.model).toBe("test-model");
	});

	it("passes timeout to coordinator as milliseconds", async () => {
		let capturedParams: Record<string, unknown> | undefined;

		const { harness } = await createHarnessWithCoordinator(async (params) => {
			capturedParams = params as Record<string, unknown>;
			return {
				sessionId: "sess-timeout",
				status: "completed" as const,
				exitCode: 0,
				finalText: "ok",
			};
		});

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("subagent", {
					agent: "test-worker",
					task: "check timeout param",
					timeout: 60,
					agentScope: "project",
					confirmProjectAgents: false,
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run a subagent");

		expect(capturedParams).toBeDefined();
		expect(capturedParams!.timeoutMs).toBe(60000);
	});

	it("appends subagent entry on success", async () => {
		const { harness } = await createHarnessWithCoordinator(async () => ({
			sessionId: "sess-entry",
			status: "completed" as const,
			exitCode: 0,
			finalText: "entry test done",
		}));

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("subagent", {
					agent: "test-worker",
					task: "check entry",
					agentScope: "project",
					confirmProjectAgents: false,
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run a subagent");

		// Check that a custom_entry event was emitted for "subagent"
		const customEntries = harness.eventsOfType("custom_entry");
		expect(customEntries.length).toBeGreaterThanOrEqual(1);

		const subagentEntry = customEntries.find((e) => e.customType === "subagent");
		expect(subagentEntry).toBeDefined();
		expect(subagentEntry!.data).toMatchObject({
			sessionId: "sess-entry",
			exitCode: 0,
			finalText: "entry test done",
		});
	});
});

describe("subagent_resume tool normal execution path", () => {
	it("resumes session with sessionPath", async () => {
		const { harness } = await createHarnessWithCoordinator(async () => ({
			sessionId: "sess-resume",
			status: "completed" as const,
			exitCode: 0,
			finalText: "Resumed successfully!",
		}));

		// Create a temp session file
		const sessionDir = join(tmpdir(), `pi-resume-test-${Date.now()}`);
		mkdirSync(sessionDir, { recursive: true });
		const sessionFile = join(sessionDir, "test-session.jsonl");
		writeFileSync(sessionFile, '{"role":"user","content":"hello"}\n');
		tempDirs.push(sessionDir);

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("subagent_resume", {
					sessionPath: sessionFile,
					instruction: "Continue the task",
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Resumed."),
		]);

		await harness.session.prompt("resume a subagent");

		const toolResults = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResults.length).toBeGreaterThanOrEqual(1);

		const resultText = toolResults[0]!.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");

		expect(resultText).toContain("Resumed successfully!");
	});

	it("resumes session with sessionId via resolveSessionPath", async () => {
		// resolveSessionPath looks for sessionId.jsonl under ~/.pi/agent/sessions or a custom base
		// We'll create a session file structure that matches
		const sessionBaseDir = join(tmpdir(), `pi-sessions-base-${Date.now()}`);
		const subDir = join(sessionBaseDir, "sub-123");
		mkdirSync(subDir, { recursive: true });
		writeFileSync(join(subDir, "sess-abc.jsonl"), '{"role":"user","content":"hello"}\n');
		tempDirs.push(sessionBaseDir);

		// We need to test resolveSessionPath directly or set up the session file
		// where resolveSessionPath can find it. Since the function scans directories,
		// we import it and verify it finds our file, then use sessionPath in the tool call.
		const { resolveSessionPath } = await import("../../extensions/subagent-v2/index.ts");
		const foundPath = resolveSessionPath("sess-abc", sessionBaseDir);
		expect(foundPath).toBeTruthy();

		const { harness } = await createHarnessWithCoordinator(async () => ({
			sessionId: "sess-resolved",
			status: "completed" as const,
			exitCode: 0,
			finalText: "Resolved and resumed!",
		}));

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("subagent_resume", {
					sessionPath: foundPath,
					instruction: "Continue",
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Resumed."),
		]);

		await harness.session.prompt("resume a subagent");

		const toolResults = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResults.length).toBeGreaterThanOrEqual(1);

		const resultText = toolResults[0]!.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");

		expect(resultText).toContain("Resolved and resumed!");
	});
});

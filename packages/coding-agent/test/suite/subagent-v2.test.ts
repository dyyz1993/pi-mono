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
const subagentV2Module = await import("../../extensions/subagent-v2/index.ts");
const subagentV2Factory: ExtensionFactory = subagentV2Module.default;
const { resolveSubagentAgentName } = subagentV2Module;

// ── Helpers ──

const mockTheme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as unknown as Theme;
const mockContext = {} as ToolRenderContext;

const harnesses: Harness[] = [];
const tempDirs: string[] = [];
const originalRemoteSshToolProxy = process.env.PI_REMOTE_SSH_TOOL_PROXY;

afterEach(() => {
	if (originalRemoteSshToolProxy === undefined) {
		delete process.env.PI_REMOTE_SSH_TOOL_PROXY;
	} else {
		process.env.PI_REMOTE_SSH_TOOL_PROXY = originalRemoteSshToolProxy;
	}
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

	it("subagent tool only requires task and can resolve agent automatically", async () => {
		const harness = await createSubagentHarness();
		const tool = harness.session.getToolDefinition("subagent");
		const schema = tool!.parameters as { required: string[] };
		expect(schema.required).toContain("task");
		expect(schema.required).not.toContain("agent");
	});

	it("subagent tool description clearly owns ordinary subtask requests", async () => {
		const harness = await createSubagentHarness();
		const tool = harness.session.getToolDefinition("subagent") as { description?: string } | undefined;

		expect(tool?.description).toContain("ordinary subtask");
		expect(tool?.description).toContain("子任务/子代理");
		expect(tool?.description).toContain("Do not use session_delegate");
		expect(tool?.description).toContain("async dispatch/delegation/background execution");
	});

	it("does not mention local agent directories in SSH tool-proxy mode", async () => {
		process.env.PI_REMOTE_SSH_TOOL_PROXY = "1";
		const harness = await createSubagentHarness();
		const tool = harness.session.getToolDefinition("subagent") as { description?: string } | undefined;

		expect(tool?.description).toContain("SSH tool-proxy mode");
		expect(tool?.description).not.toContain("~/.pi/agent/agents");
		expect(tool?.description).not.toContain(".pi/agents");
	});
});

describe("subagent agent resolution", () => {
	it("resolves omitted, default, and auto to worker when available", () => {
		const agents = [{ name: "build" }, { name: "worker" }, { name: "interactive-worker" }];
		expect(resolveSubagentAgentName(undefined, agents)).toMatchObject({
			resolvedAgentName: "worker",
			usedDefaultAgent: true,
		});
		expect(resolveSubagentAgentName("default", agents)).toMatchObject({
			requestedAgentName: "default",
			resolvedAgentName: "worker",
			usedDefaultAgent: true,
		});
		expect(resolveSubagentAgentName("auto", agents)).toMatchObject({
			requestedAgentName: "auto",
			resolvedAgentName: "worker",
			usedDefaultAgent: true,
		});
	});

	it("falls back to build and then first available agent", () => {
		expect(resolveSubagentAgentName("default", [{ name: "build" }, { name: "plan" }])).toMatchObject({
			resolvedAgentName: "build",
			usedDefaultAgent: true,
		});
		expect(resolveSubagentAgentName("default", [{ name: "plan" }])).toMatchObject({
			resolvedAgentName: "plan",
			usedDefaultAgent: true,
		});
	});

	it("keeps explicit non-default names for normal unknown-agent errors", () => {
		expect(resolveSubagentAgentName("reviewer", [{ name: "worker" }])).toMatchObject({
			requestedAgentName: "reviewer",
			resolvedAgentName: "reviewer",
			usedDefaultAgent: false,
		});
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

	// Register the shared "coordinator" channel used by both session_delegate
	// and subagent so tests match app-side routing.
	const serverRaw = serverManager.register("coordinator");
	const clientRaw = clientManager.register("coordinator");

	// Set up the server-side mock handler
	const { server: coordinatorServer } = createTypedChannel<CoordinatorChannelContract>(serverRaw);
	coordinatorServer.handle("session_delegate_sync", delegateHandler);
	coordinatorServer.handle("session_delegate_list", async () => ({ tasks: [] }));

	return {
		clientManager,
		serverManager,
		clientCoordinatorRaw: clientRaw,
		coordinatorServer,
		registerChannel: (name: string): Channel => {
			if (name === "coordinator") {
				return clientRaw;
			}
			return clientManager.register(name);
		},
	};
}

function createCrossWiredCoordinatorOnly(
	delegateHandler: DelegateSyncHandler,
	options: { includeListHandler?: boolean } = {},
) {
	let clientManager: ChannelManager;
	let serverManager: ChannelManager;

	serverManager = new ChannelManager((msg: ChannelDataMessage) => {
		setImmediate(() => clientManager.handleInbound(msg));
	});

	clientManager = new ChannelManager((msg: ChannelDataMessage) => {
		setImmediate(() => serverManager.handleInbound(msg));
	});

	const serverRaw = serverManager.register("coordinator");
	const clientRaw = clientManager.register("coordinator");

	const { server: coordinatorServer } = createTypedChannel<CoordinatorChannelContract>(serverRaw);
	coordinatorServer.handle("session_delegate_sync", delegateHandler);
	if (options.includeListHandler ?? true) {
		coordinatorServer.handle("session_delegate_list", async () => ({ tasks: [] }));
	}

	return {
		clientManager,
		serverManager,
		clientCoordinatorRaw: clientRaw,
		coordinatorServer,
		registerChannel: (name: string): Channel => {
			if (name === "coordinator") {
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
	it("does not require delegate-list probing before dispatching a subagent", async () => {
		const channelInfo = createCrossWiredCoordinatorOnly(
			async () => ({
				sessionId: "sess-no-probe",
				status: "completed" as const,
				exitCode: 0,
				finalText: "Direct sync dispatch works without list probing",
			}),
			{ includeListHandler: false },
		);

		const h = await createHarness({
			extensionFactories: [subagentV2Factory],
		});
		harnesses.push(h);

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

		h.setResponses([
			fauxAssistantMessage(
				fauxToolCall("subagent", {
					agent: "test-worker",
					task: "run without probing list",
					agentScope: "project",
					confirmProjectAgents: false,
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("The subagent finished."),
		]);

		await h.session.prompt("run a subagent");

		const toolResults = h.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResults.length).toBeGreaterThanOrEqual(1);
		const resultText = toolResults[0]!.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");

		expect(resultText).toContain("Direct sync dispatch works without list probing");
		expect(resultText).not.toContain("Coordinator extension is not available");
	});

	it("uses the shared coordinator channel so subagent matches session_delegate routing", async () => {
		const channelInfo = createCrossWiredCoordinatorOnly(async () => ({
			sessionId: "sess-shared-channel",
			status: "completed" as const,
			exitCode: 0,
			finalText: "Shared coordinator channel works",
		}));

		const h = await createHarness({
			extensionFactories: [subagentV2Factory],
		});
		harnesses.push(h);

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

		h.setResponses([
			fauxAssistantMessage(
				fauxToolCall("subagent", {
					agent: "test-worker",
					task: "use the shared channel",
					agentScope: "project",
					confirmProjectAgents: false,
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("The subagent finished."),
		]);

		await h.session.prompt("run a subagent");

		const toolResults = h.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResults.length).toBeGreaterThanOrEqual(1);
		const resultText = toolResults[0]!.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");

		expect(resultText).toContain("Shared coordinator channel works");
	});

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

	it("resolves default agent before calling coordinator", async () => {
		let capturedParams: Record<string, unknown> | undefined;

		const { harness } = await createHarnessWithCoordinator(async (params) => {
			capturedParams = params as Record<string, unknown>;
			return {
				sessionId: "sess-default-agent",
				status: "completed" as const,
				exitCode: 0,
				finalText: "ok",
			};
		});

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("subagent", {
					agent: "default",
					task: "check default agent param",
					agentScope: "project",
					confirmProjectAgents: false,
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run a default subagent");

		expect(capturedParams).toBeDefined();
		expect(capturedParams!.agent).toEqual(expect.any(String));
		expect(capturedParams!.agent).not.toBe("default");
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

	it("uses a 30 minute coordinator timeout when omitted", async () => {
		let capturedParams: Record<string, unknown> | undefined;

		const { harness } = await createHarnessWithCoordinator(async (params) => {
			capturedParams = params as Record<string, unknown>;
			return {
				sessionId: "sess-default-timeout",
				status: "completed" as const,
				exitCode: 0,
				finalText: "ok",
			};
		});

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("subagent", {
					agent: "test-worker",
					task: "check default timeout",
					agentScope: "project",
					confirmProjectAgents: false,
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run a subagent");

		expect(capturedParams).toBeDefined();
		expect(capturedParams!.timeoutMs).toBe(1_800_000);
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

	it("forwards delegate_progress events as subagent_progress custom_entry", async () => {
		// Custom cross-wired setup: handler gets access to coordinatorServer for emit
		const managers: { client?: ChannelManager; server?: ChannelManager } = {};
		const clientManager = new ChannelManager((msg: ChannelDataMessage) => {
			setImmediate(() => managers.server!.handleInbound(msg));
		});
		const serverManager = new ChannelManager((msg: ChannelDataMessage) => {
			setImmediate(() => managers.client!.handleInbound(msg));
		});
		managers.client = clientManager;
		managers.server = serverManager;

		const serverRaw = serverManager.register("coordinator");
		const clientRaw = clientManager.register("coordinator");

		const { server: coordinatorServer } = createTypedChannel<CoordinatorChannelContract>(serverRaw);

		// Handler emits progress events before returning the result
		coordinatorServer.handle("session_delegate_sync", async (params) => {
			// Emit progress events (simulating child process lifecycle)
			coordinatorServer.emit("delegate_progress", {
				sessionId: "sess-prog",
				toolCallId: params.toolCallId ?? "unknown",
				eventType: "agent_start",
			});
			coordinatorServer.emit("delegate_progress", {
				sessionId: "sess-prog",
				toolCallId: params.toolCallId ?? "unknown",
				eventType: "tool_execution_start",
				data: { tool: "read" },
			});
			coordinatorServer.emit("delegate_progress", {
				sessionId: "sess-prog",
				toolCallId: params.toolCallId ?? "unknown",
				eventType: "message_end",
			});

			return {
				sessionId: "sess-prog",
				status: "completed" as const,
				exitCode: 0,
				finalText: "progress test done",
			};
		});
		coordinatorServer.handle("session_delegate_list", async () => ({ tasks: [] }));

		const h = await createHarness({
			extensionFactories: [subagentV2Factory],
		});
		harnesses.push(h);

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
			registerChannel: (name: string): Channel => {
				if (name === "coordinator") return clientRaw;
				return clientManager.register(name);
			},
		});

		h.setResponses([
			fauxAssistantMessage(
				fauxToolCall("subagent", {
					agent: "test-worker",
					task: "emit progress",
					agentScope: "project",
					confirmProjectAgents: false,
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("parent done"),
		]);

		await h.session.prompt("run a subagent with progress");

		// Verify subagent_progress custom_entry events were emitted
		const customEntries = h.eventsOfType("custom_entry");
		const progressEntries = customEntries.filter((e) => e.customType === "subagent_progress");
		expect(progressEntries.length).toBe(3);

		const eventTypes = progressEntries.map((e) => (e.data as { eventType: string }).eventType);
		expect(eventTypes).toContain("agent_start");
		expect(eventTypes).toContain("tool_execution_start");
		expect(eventTypes).toContain("message_end");
	});

	it("subagent entry includes timing (startedAt/completedAt)", async () => {
		const testStartedAt = Date.now();
		const { harness } = await createHarnessWithCoordinator(async () => {
			// Small delay to ensure startedAt < completedAt
			await new Promise((r) => setTimeout(r, 10));
			return {
				sessionId: "sess-timing",
				status: "completed" as const,
				exitCode: 0,
				finalText: "timing test",
			};
		});

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("subagent", {
					agent: "test-worker",
					task: "timing test",
					agentScope: "project",
					confirmProjectAgents: false,
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run a subagent");

		const subagentEntries = harness.eventsOfType("custom_entry").filter((e) => e.customType === "subagent");
		expect(subagentEntries.length).toBe(1);

		const data = subagentEntries[0]!.data as { startedAt: number; completedAt: number };
		expect(data.startedAt).toBeGreaterThanOrEqual(testStartedAt);
		expect(data.completedAt).toBeGreaterThan(data.startedAt);
	});

	it("subagent entry persists to sessionManager for reload recovery", async () => {
		const { harness } = await createHarnessWithCoordinator(async () => ({
			sessionId: "sess-persist",
			status: "completed" as const,
			exitCode: 0,
			finalText: "persist test",
		}));

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("subagent", {
					agent: "test-worker",
					task: "persistence test",
					agentScope: "project",
					confirmProjectAgents: false,
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run a subagent");

		// The subagent custom_entry should be persisted in sessionManager entries
		const entries = harness.sessionManager.getEntries();
		const subagentEntries = entries.filter(
			(e) => e.type === "custom" && (e as { customType: string }).customType === "subagent",
		);
		expect(subagentEntries.length).toBe(1);

		const entryData = (subagentEntries[0] as { data: { sessionId: string; finalText: string } }).data;
		expect(entryData.sessionId).toBe("sess-persist");
		expect(entryData.finalText).toBe("persist test");
	});

	it("subagent_progress events filtered by toolCallId", async () => {
		const managers: { client?: ChannelManager; server?: ChannelManager } = {};
		const clientManager = new ChannelManager((msg: ChannelDataMessage) => {
			setImmediate(() => managers.server!.handleInbound(msg));
		});
		const serverManager = new ChannelManager((msg: ChannelDataMessage) => {
			setImmediate(() => managers.client!.handleInbound(msg));
		});
		managers.client = clientManager;
		managers.server = serverManager;

		const serverRaw = serverManager.register("coordinator");
		const clientRaw = clientManager.register("coordinator");

		const { server: coordinatorServer } = createTypedChannel<CoordinatorChannelContract>(serverRaw);

		coordinatorServer.handle("session_delegate_sync", async (params) => {
			// Emit events with matching toolCallId
			coordinatorServer.emit("delegate_progress", {
				sessionId: "sess-filter",
				toolCallId: params.toolCallId ?? "unknown",
				eventType: "agent_start",
			});
			// Emit events with WRONG toolCallId (should be filtered out)
			coordinatorServer.emit("delegate_progress", {
				sessionId: "sess-filter",
				toolCallId: "wrong-id",
				eventType: "tool_execution_start",
			});

			return {
				sessionId: "sess-filter",
				status: "completed" as const,
				exitCode: 0,
				finalText: "filter test done",
			};
		});
		coordinatorServer.handle("session_delegate_list", async () => ({ tasks: [] }));

		const h = await createHarness({
			extensionFactories: [subagentV2Factory],
		});
		harnesses.push(h);

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
			registerChannel: (name: string): Channel => {
				if (name === "coordinator") return clientRaw;
				return clientManager.register(name);
			},
		});

		h.setResponses([
			fauxAssistantMessage(
				fauxToolCall("subagent", {
					agent: "test-worker",
					task: "filter test",
					agentScope: "project",
					confirmProjectAgents: false,
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await h.session.prompt("run a subagent");

		// Only the event with matching toolCallId should be forwarded
		const progressEntries = h.eventsOfType("custom_entry").filter((e) => e.customType === "subagent_progress");
		expect(progressEntries.length).toBe(1);

		const eventType = (progressEntries[0]!.data as { eventType: string }).eventType;
		expect(eventType).toBe("agent_start");
		// The "tool_execution_start" with wrong toolCallId should NOT be present
		expect(progressEntries.some((e) => (e.data as { eventType: string }).eventType === "tool_execution_start")).toBe(
			false,
		);
	});
});

describe("subagent_resume tool normal execution path", () => {
	it("uses a 30 minute default timeout for resumed subagent tasks", async () => {
		let capturedParams: Record<string, unknown> | undefined;
		const { harness } = await createHarnessWithCoordinator(async (params) => {
			capturedParams = params as Record<string, unknown>;
			return {
				sessionId: "sess-resume-default-timeout",
				status: "completed" as const,
				exitCode: 0,
				finalText: "Resumed successfully!",
			};
		});

		const sessionDir = join(tmpdir(), `pi-resume-default-timeout-${Date.now()}`);
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

		expect(capturedParams).toBeDefined();
		expect(capturedParams!.timeoutMs).toBe(1_800_000);
	});

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

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

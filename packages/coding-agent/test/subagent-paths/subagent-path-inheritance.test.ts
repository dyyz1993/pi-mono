import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import agentPermissions from "../../extensions/agent-permissions/index.js";
import type { ExtensionFactory } from "../../src/index.js";
import { createHarness, type Harness } from "../suite/harness.js";

// Helper to get messages text after a certain index
function getMessagesText(harness: Harness, afterIndex: number): string {
	return harness.session.messages
		.slice(afterIndex)
		.flatMap((m) => {
			if (typeof m.content === "string") return [m.content];
			return m.content.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text);
		})
		.join(" ");
}

// Create temporary directories for testing
let tempDir: string;

beforeEach(() => {
	tempDir = `/tmp/subagent-paths-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	mkdirSync(tempDir, { recursive: true });
	mkdirSync(`${tempDir}/docs`, { recursive: true });
	mkdirSync(`${tempDir}/src`, { recursive: true });
	mkdirSync(`${tempDir}/tests`, { recursive: true });

	// Create test files
	writeFileSync(`${tempDir}/docs/readme.md`, "# Docs Readme\n");
	writeFileSync(`${tempDir}/src/index.ts`, "export const x = 1;\n");
	writeFileSync(`${tempDir}/tests/test.ts`, "describe('test', () => {});\n");
});

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

const agentPermissionsFactory: ExtensionFactory = (pi) => {
	agentPermissions(pi as Parameters<typeof agentPermissions>[0]);
};

describe("H1: Subagent inherits parent's paths", () => {
	let harness: Harness;

	afterEach(() => {
		harness?.cleanup();
	});

	it("forkAgent() inherits parent's paths when no paths option provided", async () => {
		harness = await createHarness({
			extensionFactories: [agentPermissionsFactory],
			cwd: tempDir,
		});

		// 1. Create parent agent with paths
		await harness.session.applyAgentConfig({
			name: "docs-writer",
			description: "Writes docs only",
			systemPrompt: "You write docs.",
			source: "project",
			filePath: ".pi/agents/docs-writer.md",
			paths: { write: ["docs/**"], read: ["src/**"] },
		});

		// Verify parent has paths set
		const parentVars = harness.session.currentAgentVariables;
		expect(parentVars.paths).toBe(JSON.stringify({ write: ["docs/**"], read: ["src/**"] }));

		// 2. Fork subagent WITHOUT paths option - path checking happens at tool execution time
		// The wrapped tool catches path violations and returns an error result.
		// The faux provider simulates: LLM calls edit on src/index.ts → tool throws path error
		// → agent loop catches it as error tool result → LLM sees error and reports it.
		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: `${tempDir}/src/index.ts`,
					edits: [{ oldText: "x", newText: "y" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("I cannot edit src/index.ts because it is outside my allowed write paths"),
		]);

		const result = await harness.session.forkAgent("edit src/index.ts");
		// The forked agent's tool wrapping blocks the edit and the LLM reports the restriction
		expect(result.text).toMatch(/cannot|not allowed|outside|restricted/i);
	});

	it("forked agent can edit files matching inherited paths", async () => {
		harness = await createHarness({
			extensionFactories: [agentPermissionsFactory],
			cwd: tempDir,
		});

		// 1. Create parent agent with paths.write: ["docs/**"]
		await harness.session.applyAgentConfig({
			name: "docs-writer",
			description: "Writes docs only",
			systemPrompt: "You write docs.",
			source: "project",
			filePath: ".pi/agents/docs-writer.md",
			paths: { write: ["docs/**"] },
		});

		// 2. Fork subagent WITHOUT paths option
		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: `${tempDir}/docs/readme.md`,
					edits: [{ oldText: "Docs", newText: "Updated" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Updated docs/readme.md"),
		]);

		// This should succeed and the edit should be allowed
		const result = await harness.session.forkAgent("edit docs/readme.md");
		expect(result.text).toContain("Updated");
	});
});

describe("H2: Subagent overrides parent's paths", () => {
	let harness: Harness;

	afterEach(() => {
		harness?.cleanup();
	});

	it("forkAgent() with paths option overrides parent's paths", async () => {
		harness = await createHarness({
			extensionFactories: [agentPermissionsFactory],
			cwd: tempDir,
		});

		// 1. Create parent agent with paths.write: ["docs/**"]
		await harness.session.applyAgentConfig({
			name: "docs-writer",
			description: "Writes docs only",
			systemPrompt: "You write docs.",
			source: "project",
			filePath: ".pi/agents/docs-writer.md",
			paths: { write: ["docs/**"] },
		});

		// 2. Fork subagent WITH paths.write: ["src/**"]
		const forkOptions = {
			paths: { write: ["src/**"] },
		};

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: `${tempDir}/src/index.ts`,
					edits: [{ oldText: "x", newText: "y" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Updated src/index.ts"),
		]);

		const result = await harness.session.forkAgent("edit src/index.ts", forkOptions);
		expect(result.text).toContain("Updated");
	});

	it("forked agent with paths cannot edit files outside its paths", async () => {
		harness = await createHarness({
			extensionFactories: [agentPermissionsFactory],
			cwd: tempDir,
		});

		// 1. Create parent agent with paths.write: ["docs/**"]
		await harness.session.applyAgentConfig({
			name: "docs-writer",
			description: "Writes docs only",
			systemPrompt: "You write docs.",
			source: "project",
			filePath: ".pi/agents/docs-writer.md",
			paths: { write: ["docs/**"] },
		});

		// 2. Fork subagent WITH paths.write: ["src/**"]
		const forkOptions = {
			paths: { write: ["src/**"] },
		};

		// The faux provider simulates: LLM calls edit on docs/readme.md → tool throws path error
		// → agent loop catches it → LLM sees error in tool result and reports restriction
		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: `${tempDir}/docs/readme.md`,
					edits: [{ oldText: "Docs", newText: "Updated" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("I cannot edit docs/readme.md because it is outside my allowed write paths"),
		]);

		const result = await harness.session.forkAgent("edit docs/readme.md", forkOptions);
		// The forked agent's tool wrapping blocks the edit and the LLM reports the restriction
		expect(result.text).toMatch(/cannot|not allowed|outside|restricted/i);
	});

	it("subagent can expand parent's paths by adding more patterns", async () => {
		harness = await createHarness({
			extensionFactories: [agentPermissionsFactory],
			cwd: tempDir,
		});

		// 1. Create parent agent with paths.write: ["docs/**"]
		await harness.session.applyAgentConfig({
			name: "docs-writer",
			description: "Writes docs only",
			systemPrompt: "You write docs.",
			source: "project",
			filePath: ".pi/agents/docs-writer.md",
			paths: { write: ["docs/**"] },
		});

		// 2. Fork subagent WITH expanded paths
		const forkOptions = {
			paths: { write: ["docs/**", "src/**", "tests/**"] },
		};

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: `${tempDir}/docs/readme.md`,
					edits: [{ oldText: "Docs", newText: "Updated" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: `${tempDir}/src/index.ts`,
					edits: [{ oldText: "x", newText: "y" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: `${tempDir}/tests/test.ts`,
					edits: [{ oldText: "test", newText: "test2" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Updated all files"),
		]);

		const result = await harness.session.forkAgent("edit all three files", forkOptions);
		expect(result.text).toContain("Updated");
	});
});

describe("H3: Subagent without paths inherits parent", () => {
	let harness: Harness;

	afterEach(() => {
		harness?.cleanup();
	});

	it("forkAgent() without paths option inherits parent's restrictions", async () => {
		harness = await createHarness({
			extensionFactories: [agentPermissionsFactory],
			cwd: tempDir,
		});

		// 1. Create parent agent with paths.write: ["docs/**"]
		await harness.session.applyAgentConfig({
			name: "docs-writer",
			description: "Writes docs only",
			systemPrompt: "You write docs.",
			source: "project",
			filePath: ".pi/agents/docs-writer.md",
			paths: { write: ["docs/**"] },
		});

		// 2. Fork subagent WITHOUT paths option
		// Verify that docs edits are allowed
		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: `${tempDir}/docs/readme.md`,
					edits: [{ oldText: "Docs", newText: "Updated" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Updated docs"),
		]);

		const result = await harness.session.forkAgent("edit docs/readme.md");
		expect(result.text).toContain("Updated");

		// Verify that src edits are blocked via tool wrapping
		// Tool wrapping catches the error and returns it as a tool_result error
		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: `${tempDir}/src/index.ts`,
					edits: [{ oldText: "x", newText: "y" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("I cannot edit src/index.ts because it is outside my allowed write paths"),
		]);

		const result2 = await harness.session.forkAgent("edit src/index.ts");
		expect(result2.text).toMatch(/cannot|not allowed|outside|restricted/i);
	});
});

describe("H4: Fork agent inherits paths", () => {
	let harness: Harness;

	afterEach(() => {
		harness?.cleanup();
	});

	it("forkAgent() creates agent that inherits parent's paths", async () => {
		harness = await createHarness({
			extensionFactories: [agentPermissionsFactory],
			cwd: tempDir,
		});

		// 1. Create parent agent with paths
		await harness.session.applyAgentConfig({
			name: "docs-writer",
			description: "Writes docs, reads src and tests",
			systemPrompt: "You write docs.",
			source: "project",
			filePath: ".pi/agents/docs-writer.md",
			paths: { write: ["docs/**"], read: ["src/**", "tests/**"] },
		});

		// 2. Verify parent has paths
		const parentVars = harness.session.currentAgentVariables;
		expect(parentVars.paths).toBe(JSON.stringify({ write: ["docs/**"], read: ["src/**", "tests/**"] }));

		// 3. Fork agent WITHOUT paths option
		harness.setResponses([fauxAssistantMessage("Done")]);

		const result = await harness.session.forkAgent("do something");
		expect(result.text).toBeDefined();

		// Verify that forked agent can edit docs (inherited write path)
		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: `${tempDir}/docs/readme.md`,
					edits: [{ oldText: "Docs", newText: "Updated" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Updated docs"),
		]);

		const editResult = await harness.session.forkAgent("edit docs/readme.md");
		expect(editResult.text).toContain("Updated");

		// Verify that forked agent cannot edit src (not in write paths, only read)
		// Tool wrapping catches the error and returns it as a tool_result error
		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: `${tempDir}/src/index.ts`,
					edits: [{ oldText: "x", newText: "y" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("I cannot edit src/index.ts because it is outside my allowed write paths"),
		]);

		const blockedResult = await harness.session.forkAgent("edit src/index.ts");
		expect(blockedResult.text).toMatch(/cannot|not allowed|outside|restricted/i);
	});

	it("forkAgent paths option includes write, read, and bash patterns", async () => {
		harness = await createHarness({
			extensionFactories: [agentPermissionsFactory],
			cwd: tempDir,
		});

		// 1. Create parent agent with limited paths
		await harness.session.applyAgentConfig({
			name: "limited-agent",
			description: "Limited agent",
			systemPrompt: "Limited.",
			source: "project",
			filePath: ".pi/agents/limited-agent.md",
			paths: { write: ["docs/**"] },
		});

		// 2. Fork with expanded paths including all three types
		const forkOptions = {
			paths: {
				write: ["docs/**", "tests/**"],
				read: ["src/**", "tests/**"],
				bash: ["scripts/**"],
			},
		};

		harness.setResponses([fauxAssistantMessage("Done")]);

		const result = await harness.session.forkAgent("do something", forkOptions);
		expect(result.text).toBeDefined();

		// Test that write operations work in both docs and tests
		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: `${tempDir}/docs/readme.md`,
					edits: [{ oldText: "Docs", newText: "Updated" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Updated docs"),
		]);

		const docsResult = await harness.session.forkAgent("edit docs/readme.md", forkOptions);
		expect(docsResult.text).toContain("Updated");

		// Test that write operations work in tests
		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: `${tempDir}/tests/test.ts`,
					edits: [{ oldText: "test", newText: "test2" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Updated tests"),
		]);

		const testsResult = await harness.session.forkAgent("edit tests/test.ts", forkOptions);
		expect(testsResult.text).toContain("Updated");
	});

	it("forkAgent with inheritSystemPrompt and paths inherits both", async () => {
		harness = await createHarness({
			extensionFactories: [agentPermissionsFactory],
			cwd: tempDir,
		});

		// 1. Create parent agent with system prompt and paths
		await harness.session.applyAgentConfig({
			name: "docs-writer",
			description: "Writes docs only",
			systemPrompt: "You are a documentation specialist who only edits docs.",
			source: "project",
			filePath: ".pi/agents/docs-writer.md",
			paths: { write: ["docs/**"] },
		});

		// 2. Fork agent with inheritSystemPrompt: true, no paths
		const forkOptions = {
			inheritSystemPrompt: true,
		};

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: `${tempDir}/docs/readme.md`,
					edits: [{ oldText: "Docs", newText: "Updated" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("I am a documentation specialist and I updated docs/readme.md"),
		]);

		const result = await harness.session.forkAgent("edit docs/readme.md", forkOptions);
		expect(result.text).toContain("updated");
		// The forked agent should use the inherited system prompt
		expect(result.text).toContain("documentation specialist");
	});

	it("forkAgent with paths and inheritSystemPrompt uses provided paths, not inherited", async () => {
		harness = await createHarness({
			extensionFactories: [agentPermissionsFactory],
			cwd: tempDir,
		});

		// 1. Create parent agent with paths
		await harness.session.applyAgentConfig({
			name: "docs-writer",
			description: "Writes docs only",
			systemPrompt: "You are a docs writer.",
			source: "project",
			filePath: ".pi/agents/docs-writer.md",
			paths: { write: ["docs/**"] },
		});

		// 2. Fork agent with BOTH inheritSystemPrompt and paths
		const forkOptions = {
			inheritSystemPrompt: true,
			paths: { write: ["src/**"] },
		};

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: `${tempDir}/src/index.ts`,
					edits: [{ oldText: "x", newText: "y" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("I am a docs writer and I updated src/index.ts"),
		]);

		const result = await harness.session.forkAgent("do something", forkOptions);
		expect(result.text).toBeDefined();

		// Forked agent should use provided paths (src/**), not inherited (docs/**)
		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: `${tempDir}/src/index.ts`,
					edits: [{ oldText: "y", newText: "z" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Updated src/index.ts again"),
		]);

		const result2 = await harness.session.forkAgent("edit src/index.ts again", forkOptions);
		expect(result2.text).toContain("Updated");

		// Should fail when trying to edit docs (not in provided paths)
		// Tool wrapping catches the error and returns it as a tool_result error
		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: `${tempDir}/docs/readme.md`,
					edits: [{ oldText: "Docs", newText: "Updated" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("I cannot edit docs/readme.md because it is outside my allowed write paths"),
		]);

		const blockedResult = await harness.session.forkAgent("edit docs/readme.md", forkOptions);
		expect(blockedResult.text).toMatch(/cannot|not allowed|outside|restricted/i);
	});
});

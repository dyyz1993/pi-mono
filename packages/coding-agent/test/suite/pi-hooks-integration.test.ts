/**
 * Harness integration tests for pi-hooks extension.
 *
 * Tests the full flow: config file → hook loading → tool_call event →
 * hook execution → allow/deny decision.
 *
 * Uses the faux provider per AGENTS.md rules — no real API calls.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@dyyz1993/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentConfig } from "../../src/core/agent-types.ts";
import type { ExtensionFactory } from "../../src/core/extensions/index.ts";
import type { Skill } from "../../src/core/skills.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "../utilities.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

// Load pi-hooks extension as a factory
const piHooksFactory: ExtensionFactory = (await import("../../extensions/pi-hooks/index.ts")).default;

// Override HOME so global config files don't interfere with tests
const originalHome = process.env.HOME;

beforeEach(() => {
	const fakeHome = mkdtempSync(join(tmpdir(), "pi-hooks-suite-home-"));
	process.env.HOME = fakeHome;
});

afterEach(() => {
	process.env.HOME = originalHome;
});

describe("pi-hooks harness integration", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("allows tool execution when no hooks are configured", async () => {
		const echoTool: AgentTool = {
			name: "echo",
			label: "Echo",
			description: "Echo text",
			parameters: Type.Object({ text: Type.String() }),
			execute: async (_id, params) => ({
				content: [{ type: "text", text: String((params as { text: string }).text) }],
				details: {},
			}),
		};

		const harness = await createHarness({
			tools: [echoTool],
			extensionFactories: [piHooksFactory],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("echo", { text: "hello" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("test");

		const toolResults = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResults).toHaveLength(1);
	});

	it("blocks tool execution when hook exits with code 2", async () => {
		let executed = false;
		const bashTool: AgentTool = {
			name: "Bash",
			label: "Bash",
			description: "Run bash",
			parameters: Type.Object({ command: Type.String() }),
			execute: async () => {
				executed = true;
				return { content: [{ type: "text", text: "should not reach here" }], details: {} };
			},
		};

		const harness = await createHarness({
			tools: [bashTool],
			extensionFactories: [piHooksFactory],
		});
		harnesses.push(harness);

		// Write config AFTER harness creation (config is loaded lazily on each tool_call event)
		mkdirSync(join(harness.tempDir, ".claude"));
		writeFileSync(
			join(harness.tempDir, ".claude", "settings.json"),
			JSON.stringify({
				hooks: {
					PreToolUse: [
						{
							matcher: "Bash",
							hooks: [{ type: "command", command: "echo blocked-by-policy; exit 2" }],
						},
					],
				},
			}),
		);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("ok"),
		]);

		await harness.session.prompt("run ls");

		// The tool should NOT have executed
		expect(executed).toBe(false);
		expect(harness.session.pendingMessageCount).toBe(0);
		expect(getPendingNextTurnMessages(harness)).toHaveLength(0);
		const toolResults = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResults.map(getMessageText).join("\n")).toContain("Hook blocked by project");
	});

	it("delivers async rewake hook blocks on the next user turn and consumes them once", async () => {
		let executed = false;
		const bashTool: AgentTool = {
			name: "bash",
			label: "Bash",
			description: "Run bash",
			parameters: Type.Object({ command: Type.String() }),
			execute: async () => {
				executed = true;
				return { content: [{ type: "text", text: "ran" }], details: {} };
			},
		};

		const harness = await createHarness({
			tools: [bashTool],
			extensionFactories: [piHooksFactory],
		});
		harnesses.push(harness);

		mkdirSync(join(harness.tempDir, ".claude"));
		writeFileSync(
			join(harness.tempDir, ".claude", "settings.json"),
			JSON.stringify({
				hooks: {
					PreToolUse: [
						{
							matcher: "bash",
							hooks: [
								{
									type: "command",
									command: "printf async-block >&2; exit 2",
									asyncRewake: true,
								},
							],
						},
					],
				},
			}),
		);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("bash", { command: "echo hi" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("first done"),
		]);

		await harness.session.prompt("run async hook");

		expect(executed).toBe(true);
		expect(harness.session.pendingMessageCount).toBe(0);
		await waitFor(() => getPendingNextTurnMessages(harness).length === 1);
		expect(
			harness.session.messages
				.filter((m) => m.role === "custom")
				.map(getMessageText)
				.join("\n"),
		).not.toContain("async-block");

		harness.setResponses([fauxAssistantMessage("second done")]);

		await harness.session.prompt("consume async hook message");

		expect(getPendingNextTurnMessages(harness)).toHaveLength(0);
		const customMessages = harness.session.messages
			.filter((m) => m.role === "custom")
			.map(getMessageText)
			.join("\n");
		expect(customMessages).toContain("Hook blocked by project");
		expect(customMessages).toContain("async-block");
	});

	it("loads hooks from .pi/settings.json and allows on exit 0", async () => {
		let executed = false;
		const bashTool: AgentTool = {
			name: "Bash",
			label: "Bash",
			description: "Run bash",
			parameters: Type.Object({ command: Type.String() }),
			execute: async () => {
				executed = true;
				return { content: [{ type: "text", text: "ran" }], details: {} };
			},
		};

		const harness = await createHarness({
			tools: [bashTool],
			extensionFactories: [piHooksFactory],
		});
		harnesses.push(harness);

		// Write config AFTER harness creation (config is loaded lazily on each tool_call event)
		mkdirSync(join(harness.tempDir, ".pi"));
		writeFileSync(
			join(harness.tempDir, ".pi", "settings.json"),
			JSON.stringify({
				hooks: {
					PreToolUse: [
						{
							matcher: "Bash",
							hooks: [{ type: "command", command: "exit 0" }],
						},
					],
				},
			}),
		);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "echo hi" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run echo");

		// Hook returned exit 0 (allow), so tool should execute
		expect(executed).toBe(true);
	});

	it("does not block when hook matcher does not match tool name", async () => {
		let executed = false;
		const readTool: AgentTool = {
			name: "Read",
			label: "Read",
			description: "Read file",
			parameters: Type.Object({ file_path: Type.String() }),
			execute: async () => {
				executed = true;
				return { content: [{ type: "text", text: "file content" }], details: {} };
			},
		};

		const harness = await createHarness({
			tools: [readTool],
			extensionFactories: [piHooksFactory],
		});
		harnesses.push(harness);

		mkdirSync(join(harness.tempDir, ".claude"));
		writeFileSync(
			join(harness.tempDir, ".claude", "settings.json"),
			JSON.stringify({
				hooks: {
					PreToolUse: [
						{
							matcher: "Bash",
							hooks: [{ type: "command", command: "exit 2" }],
						},
					],
				},
			}),
		);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Read", { file_path: "/tmp/test" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("read file");

		// Matcher is "Bash" but tool is "Read" — hook should not fire
		expect(executed).toBe(true);
	});

	it("registers agent frontmatter hooks when an agent config is applied", async () => {
		let executed = false;
		const bashTool: AgentTool = {
			name: "bash",
			label: "Bash",
			description: "Run bash",
			parameters: Type.Object({ command: Type.String() }),
			execute: async () => {
				executed = true;
				return { content: [{ type: "text", text: "ran" }], details: {} };
			},
		};

		const harness = await createHarness({
			tools: [bashTool],
			extensionFactories: [piHooksFactory],
		});
		harnesses.push(harness);
		const markerFile = join(harness.tempDir, "agent-hook.txt");

		const agentConfig: AgentConfig = {
			name: "hooked-agent",
			description: "Agent with hooks",
			systemPrompt: "",
			source: "flag",
			filePath: "",
			hooks: {
				PreToolUse: [
					{
						matcher: "bash",
						hooks: [{ type: "command", command: `printf agent > ${JSON.stringify(markerFile)}; exit 2` }],
					},
				],
			},
		};
		harness.session.applyAgentConfig(agentConfig);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("bash", { command: "echo hi" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run echo");

		expect(executed).toBe(false);
		expect(readFileSync(markerFile, "utf-8")).toBe("agent");
		const toolResults = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResults.map(getMessageText).join("\n")).toContain("Hook blocked by agent:hooked-agent");
	});

	it("registers skill frontmatter hooks when the skill is invoked", async () => {
		let executed = false;
		const tempDir = harnessTempName();
		mkdirSync(tempDir, { recursive: true });
		const markerFile = join(tempDir, "skill-hook.txt");
		const skillDir = join(tempDir, "skills", "hooked-skill");
		mkdirSync(skillDir, { recursive: true });
		const skillPath = join(skillDir, "SKILL.md");
		writeFileSync(skillPath, "---\nname: hooked-skill\ndescription: Hooked skill\n---\nUse hooks.");

		const skill: Skill = {
			name: "hooked-skill",
			description: "Hooked skill",
			filePath: skillPath,
			baseDir: skillDir,
			sourceInfo: createSyntheticSourceInfo(skillPath, { source: "test" }),
			disableModelInvocation: false,
			hooks: {
				PreToolUse: [
					{
						matcher: "bash",
						hooks: [{ type: "command", command: `printf skill > ${JSON.stringify(markerFile)}; exit 2` }],
					},
				],
			},
		};
		const extensionsResult = await createTestExtensionsResult([piHooksFactory], tempDir);
		const resourceLoader = createTestResourceLoader({ extensionsResult });
		resourceLoader.getSkills = () => ({ skills: [skill], diagnostics: [] });
		const bashTool: AgentTool = {
			name: "bash",
			label: "Bash",
			description: "Run bash",
			parameters: Type.Object({ command: Type.String() }),
			execute: async () => {
				executed = true;
				return { content: [{ type: "text", text: "ran" }], details: {} };
			},
		};

		const harness = await createHarness({
			tools: [bashTool],
			resourceLoader,
			cwd: tempDir,
			initialActiveToolNames: ["skill", "bash"],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("skill", { name: "hooked-skill" }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("bash", { command: "echo hi" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("use the hooked skill, then run echo");

		expect(executed).toBe(false);
		expect(readFileSync(markerFile, "utf-8")).toBe("skill");
		const toolResults = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResults.map(getMessageText).join("\n")).toContain("Hook blocked by skill:hooked-skill");
	});
});

function harnessTempName(): string {
	return join(tmpdir(), `pi-hooks-suite-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function getPendingNextTurnMessages(harness: Harness): unknown[] {
	return (harness.session as unknown as { _pendingNextTurnMessages?: unknown[] })._pendingNextTurnMessages ?? [];
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error("Timed out waiting for condition");
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

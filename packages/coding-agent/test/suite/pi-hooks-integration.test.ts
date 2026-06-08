/**
 * Harness integration tests for pi-hooks extension.
 *
 * Tests the full flow: config file → hook loading → tool_call event →
 * hook execution → allow/deny decision.
 *
 * Uses the faux provider per AGENTS.md rules — no real API calls.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@dyyz1993/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionFactory } from "../../src/core/extensions/index.ts";
import { createHarness, type Harness } from "./harness.ts";

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
});

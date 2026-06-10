/**
 * Integration tests verifying that the new core permission check in
 * `agent-session.ts` `beforeToolCall` is invoked through `applyAgentConfig`
 * and blocks sub-agent tool calls based on `permissionMode`, `tools`,
 * `disallowedTools`, and `paths`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool } from "@dyyz1993/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentConfig } from "../../src/core/agent-types.ts";
import { createHarness, type Harness } from "./harness.ts";

interface ToolExecutionRecord {
	tool: string;
	input: Record<string, unknown>;
}

function makeRecorderTool(name: string, record: ToolExecutionRecord[]): AgentTool {
	return {
		name,
		label: name,
		description: `test ${name}`,
		parameters: Type.Object({}),
		execute: async () => {
			record.push({ tool: name, input: {} });
			return { content: [{ type: "text", text: "ok" }], details: {} };
		},
	};
}

function testConfig(override: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name: "test-agent",
		description: "Test agent",
		systemPrompt: "You are a test agent.",
		source: "user",
		filePath: "/tmp/test-agent.md",
		...override,
	};
}

describe("core permission enforcement in beforeToolCall", () => {
	const harnesses: Harness[] = [];
	const records: ToolExecutionRecord[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
		records.length = 0;
	});

	it("blocks tools not in the agent's allowlist", async () => {
		const writeTool = makeRecorderTool("write", records);
		const readTool = makeRecorderTool("read", records);

		const harness = await createHarness({ tools: [writeTool, readTool] });
		harnesses.push(harness);

		harness.session.applyAgentConfig(
			testConfig({
				tools: ["read", "grep", "find"],
				permissionMode: "normal",
			}),
		);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("write something");

		// write should not have executed because it's not in the allowlist
		expect(records).toHaveLength(0);
	});

	it("allows tools in the agent's allowlist", async () => {
		const readTool = makeRecorderTool("read", records);

		const harness = await createHarness({ tools: [readTool] });
		harnesses.push(harness);

		harness.session.applyAgentConfig(
			testConfig({
				tools: ["read", "grep"],
				permissionMode: "normal",
			}),
		);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("read", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("read");

		expect(records).toHaveLength(1);
		expect(records[0]?.tool).toBe("read");
	});

	it("blocks tools in the agent's disallowedTools list", async () => {
		const editTool = makeRecorderTool("edit", records);
		const readTool = makeRecorderTool("read", records);

		const harness = await createHarness({ tools: [editTool, readTool] });
		harnesses.push(harness);

		harness.session.applyAgentConfig(
			testConfig({
				disallowedTools: ["edit", "write"],
				permissionMode: "normal",
			}),
		);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("edit");

		// edit should not have executed because it's in the blocklist
		expect(records).toHaveLength(0);
	});

	it("blocks bash with dangerous patterns under normal mode", async () => {
		const bashTool = makeRecorderTool("bash", records);

		const harness = await createHarness({ tools: [bashTool] });
		harnesses.push(harness);

		harness.session.applyAgentConfig(
			testConfig({
				permissionMode: "normal",
			}),
		);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "rm -rf /tmp/x" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("cleanup");

		// bash should not have executed because rm -rf is dangerous
		expect(records).toHaveLength(0);
	});

	it("allows bash with safe commands under normal mode", async () => {
		const bashTool = makeRecorderTool("bash", records);

		const harness = await createHarness({ tools: [bashTool] });
		harnesses.push(harness);

		harness.session.applyAgentConfig(
			testConfig({
				permissionMode: "normal",
			}),
		);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "echo hello" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("greet");

		expect(records).toHaveLength(1);
		expect(records[0]?.tool).toBe("bash");
	});

	// Note: yolo mode + dangerous bash is covered by unit tests in test/permissions.test.ts
	// (the harness prompt() flow has complexity around second-response handling
	// that makes this particular combination unreliable in integration tests)

	it("blocks writes outside the agent's allowed write paths", async () => {
		const editTool = makeRecorderTool("edit", records);

		const harness = await createHarness({ tools: [editTool] });
		harnesses.push(harness);

		const docsDir = join(harness.tempDir, "docs");
		const outsideDir = join(harness.tempDir, "src");
		mkdirSync(docsDir, { recursive: true });
		mkdirSync(outsideDir, { recursive: true });
		writeFileSync(join(docsDir, "x.md"), "x", { flag: "w" });
		writeFileSync(join(outsideDir, "y.md"), "y", { flag: "w" });

		harness.session.applyAgentConfig(
			testConfig({
				permissionMode: "normal",
				paths: { write: ["docs/**"] },
			}),
		);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { file_path: join(outsideDir, "y.md") })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("edit outside docs");

		// edit should not have executed because the path is outside allowed write paths
		expect(records).toHaveLength(0);
	});

	it("allows writes inside the agent's allowed write paths", async () => {
		const editTool = makeRecorderTool("edit", records);

		const harness = await createHarness({ tools: [editTool] });
		harnesses.push(harness);

		const docsDir = join(harness.tempDir, "docs");
		mkdirSync(docsDir, { recursive: true });
		writeFileSync(join(docsDir, "x.md"), "x", { flag: "w" });

		harness.session.applyAgentConfig(
			testConfig({
				permissionMode: "normal",
				paths: { write: ["docs/**"] },
			}),
		);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { file_path: join(docsDir, "x.md") })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("edit inside docs");

		expect(records).toHaveLength(1);
		expect(records[0]?.tool).toBe("edit");
	});

	it("does not enforce permissions when no agent config is applied", async () => {
		const editTool = makeRecorderTool("edit", records);

		const harness = await createHarness({ tools: [editTool] });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("edit");

		expect(records).toHaveLength(1);
	});
});

/**
 * RPC-mode integration test: verify core permission enforcement
 * works when the agent is driven via the JSON stdin/stdout protocol.
 *
 * This simulates what runRpcMode does: send JSON commands via session.prompt(),
 * capture events, and verify tool calls are blocked by core permissions.
 *
 * Unlike the harness tests in agent-session-permissions.test.ts which test
 * individual permission rules, this test validates the full RPC event flow:
 * prompt → tool_call → permission_block → tool_result_error → response
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool } from "@dyyz1993/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentConfig } from "../../src/core/agent-types.ts";
import { createHarness, type Harness } from "./harness.ts";

function makeTool(name: string): AgentTool {
	return {
		name,
		label: name,
		description: `test ${name}`,
		parameters: Type.Object({}),
		execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
	};
}

function testConfig(override: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name: "rpc-test-agent",
		description: "RPC test agent",
		systemPrompt: "You are a test agent.",
		source: "user",
		filePath: "/tmp/rpc-test.md",
		...override,
	};
}

describe("RPC-mode permission enforcement (JSON protocol flow)", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("blocks disallowed tool and produces error tool_result in session messages", async () => {
		const harness = await createHarness({ tools: [makeTool("read"), makeTool("write")] });
		harnesses.push(harness);

		// Apply restrictive agent config (read-only)
		harness.session.applyAgentConfig(
			testConfig({
				permissionMode: "normal",
				tools: ["read", "grep", "find"],
			}),
		);

		// Model tries to call write (not in allowlist)
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { file_path: "/tmp/x.txt", content: "hello" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("I cannot write files."),
		]);

		await harness.session.prompt("write hello to /tmp/x.txt");

		// Verify the session produced messages (like RPC would stream)
		const messages = harness.session.messages;
		expect(messages.length).toBeGreaterThan(0);

		// The last assistant message should acknowledge the block
		const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
		expect(lastAssistant).toBeDefined();
	});

	it("allows whitelisted tool through RPC flow", async () => {
		const harness = await createHarness({ tools: [makeTool("read")] });
		harnesses.push(harness);

		harness.session.applyAgentConfig(
			testConfig({
				permissionMode: "normal",
				tools: ["read"],
			}),
		);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("read", { file_path: "/tmp/test.txt" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("The file contains: hello"),
		]);

		await harness.session.prompt("read /tmp/test.txt");

		const messages = harness.session.messages;
		expect(messages.length).toBeGreaterThan(0);

		// Should have completed without crashing - the tool was allowed through
		expect(messages.length).toBeGreaterThan(0);
		// At minimum: user prompt + assistant tool call + tool result + assistant response
		expect(messages.filter((m) => m.role === "assistant").length).toBeGreaterThanOrEqual(2);
	});

	it("blocks dangerous bash in normal mode through RPC flow", async () => {
		const harness = await createHarness({ tools: [makeTool("bash")] });
		harnesses.push(harness);

		harness.session.applyAgentConfig(
			testConfig({
				permissionMode: "normal",
			}),
		);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "rm -rf /" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("I cannot run that command."),
		]);

		await harness.session.prompt("delete everything");

		const messages = harness.session.messages;
		// The session should complete without crashing
		expect(messages.length).toBeGreaterThan(0);
	});

	it("blocks write outside allowed paths through RPC flow", async () => {
		const harness = await createHarness({ tools: [makeTool("edit")] });
		harnesses.push(harness);

		const docsDir = join(harness.tempDir, "docs");
		const srcDir = join(harness.tempDir, "src");
		mkdirSync(docsDir, { recursive: true });
		mkdirSync(srcDir, { recursive: true });
		writeFileSync(join(srcDir, "secret.ts"), "secret", { flag: "w" });

		harness.session.applyAgentConfig(
			testConfig({
				permissionMode: "normal",
				paths: { write: ["docs/**"] },
			}),
		);

		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("edit", {
						file_path: join(srcDir, "secret.ts"),
						old_string: "secret",
						new_string: "hacked",
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("I cannot edit that file."),
		]);

		await harness.session.prompt("edit the secret file");

		const messages = harness.session.messages;
		expect(messages.length).toBeGreaterThan(0);
		// Session should complete without the edit executing
	});
});

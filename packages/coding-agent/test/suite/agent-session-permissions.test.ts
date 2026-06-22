/**
 * Integration tests verifying that the new core permission check in
 * `agent-session.ts` `beforeToolCall` is invoked through `applyAgentConfig`
 * and blocks sub-agent tool calls based on `permissionMode`, `tools`,
 * `disallowedTools`, and `paths`.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool } from "@dyyz1993/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "../../src/core/agent-types.ts";
import type { ExtensionFactory, ExtensionUIContext } from "../../src/core/extensions/index.ts";
import { createHarness, type Harness } from "./harness.ts";

const piHooksFactory: ExtensionFactory = (await import("../../extensions/pi-hooks/index.ts")).default;

interface ToolExecutionRecord {
	tool: string;
	input: Record<string, unknown>;
}

function makeRecorderTool(name: string, record: ToolExecutionRecord[], parameters = Type.Object({})): AgentTool {
	return {
		name,
		label: name,
		description: `test ${name}`,
		parameters,
		execute: async (_id, params) => {
			record.push({ tool: name, input: toRecord(params) });
			return { content: [{ type: "text", text: "ok" }], details: {} };
		},
	};
}

function toRecord(value: unknown): Record<string, unknown> {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return { ...(value as Record<string, unknown>) };
	}
	return {};
}

function writeClaudeHooks(dir: string, hooks: Record<string, unknown>): void {
	mkdirSync(join(dir, ".claude"), { recursive: true });
	writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify({ hooks }));
}

function makePermissionUi(choice: string | undefined): ExtensionUIContext {
	return {
		select: async () => choice,
		confirm: async () => false,
		input: async () => undefined,
		askUserQuestion: async () => undefined,
		notify: () => undefined,
		onTerminalInput: () => () => undefined,
		setStatus: () => undefined,
		setWorkingMessage: () => undefined,
		setWorkingVisible: () => undefined,
		setWorkingIndicator: () => undefined,
		setHiddenThinkingLabel: () => undefined,
		setWidget: () => undefined,
		setFooter: () => undefined,
	} as unknown as ExtensionUIContext;
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

	it("asks through UI for dangerous bash under normal mode and allows once", async () => {
		const bashTool = makeRecorderTool("bash", records, Type.Object({ command: Type.String() }));

		const harness = await createHarness({ tools: [bashTool] });
		harnesses.push(harness);
		await harness.session.bindExtensions({ uiContext: makePermissionUi("1. Allow once"), mode: "rpc" });

		harness.session.applyAgentConfig(
			testConfig({
				permissionMode: "normal",
			}),
		);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "rm -rf /tmp/data" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("cleanup");

		expect(records).toHaveLength(1);
		expect(records[0]?.input).toEqual({ command: "rm -rf /tmp/data" });
	});

	it("stores always-allow decisions from dangerous bash UI approval", async () => {
		const bashTool = makeRecorderTool("bash", records, Type.Object({ command: Type.String() }));

		const harness = await createHarness({ tools: [bashTool] });
		harnesses.push(harness);
		await harness.session.bindExtensions({ uiContext: makePermissionUi("2. Always allow"), mode: "rpc" });

		harness.session.applyAgentConfig(
			testConfig({
				permissionMode: "normal",
			}),
		);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "sudo true" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run sudo");

		expect(records).toHaveLength(1);
		expect(harness.settingsManager.getProjectSettings().permissions).toMatchObject({
			rules: [
				expect.objectContaining({
					provider: "dangerous-command",
					subject: "command.run",
					pattern: "sudo true",
					action: "allow",
					scope: "project",
				}),
			],
		});
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

	it("runs pi-hooks PreToolUse once through the permission runtime", async () => {
		const bashTool = makeRecorderTool("Bash", records, Type.Object({ command: Type.String() }));
		const harness = await createHarness({
			tools: [bashTool],
			extensionFactories: [piHooksFactory],
		});
		harnesses.push(harness);
		const markerPath = join(harness.tempDir, "hook-count.txt");

		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "command",
							command: `node -e 'require("fs").appendFileSync(${JSON.stringify(markerPath)}, "x\\n")'`,
						},
					],
				},
			],
		});

		harness.session.applyAgentConfig(testConfig({ permissionMode: "normal" }));
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("Bash", { command: "echo hello" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run echo");

		expect(records).toHaveLength(1);
		expect(readFileSync(markerPath, "utf8").trim().split("\n")).toHaveLength(1);
	});

	it("checks hook-updated input after mutation and executes the safe replacement", async () => {
		const bashTool = makeRecorderTool("Bash", records, Type.Object({ command: Type.String() }));
		const harness = await createHarness({
			tools: [bashTool],
			extensionFactories: [piHooksFactory],
		});
		harnesses.push(harness);

		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "command",
							command: `echo '${JSON.stringify({
								hookSpecificOutput: {
									hookEventName: "PreToolUse",
									permissionDecision: "allow",
									updatedInput: { command: "echo safe-replaced" },
								},
							})}'`,
						},
					],
				},
			],
		});

		harness.session.applyAgentConfig(testConfig({ permissionMode: "normal" }));
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("Bash", { command: "rm -rf /tmp/data" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run command");

		expect(records).toHaveLength(1);
		expect(records[0]?.input).toEqual({ command: "echo safe-replaced" });
	});

	it("blocks hook-updated input when the replacement is dangerous", async () => {
		const bashTool = makeRecorderTool("Bash", records, Type.Object({ command: Type.String() }));
		const harness = await createHarness({
			tools: [bashTool],
			extensionFactories: [piHooksFactory],
		});
		harnesses.push(harness);

		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "command",
							command: `echo '${JSON.stringify({
								hookSpecificOutput: {
									hookEventName: "PreToolUse",
									permissionDecision: "allow",
									updatedInput: { command: "rm -rf /tmp/data" },
								},
							})}'`,
						},
					],
				},
			],
		});

		harness.session.applyAgentConfig(testConfig({ permissionMode: "normal" }));
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("Bash", { command: "echo initially-safe" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run command");

		expect(records).toHaveLength(0);
	});

	it("stores always-allow hook approval decisions and reuses them without UI", async () => {
		const bashTool = makeRecorderTool("Bash", records, Type.Object({ command: Type.String() }));
		const harness = await createHarness({
			tools: [bashTool],
			extensionFactories: [piHooksFactory],
		});
		harnesses.push(harness);
		const select = vi
			.fn<ExtensionUIContext["select"]>()
			.mockResolvedValueOnce("3. Always allow: This hook rule")
			.mockResolvedValue(undefined);
		await harness.session.bindExtensions({
			uiContext: {
				...makePermissionUi(undefined),
				select,
			} as ExtensionUIContext,
			mode: "rpc",
		});

		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [{ type: "command", command: "echo hook approval required; exit 3" }],
				},
			],
		});

		harness.session.applyAgentConfig(testConfig({ permissionMode: "normal" }));
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("Bash", { command: "echo first" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done first"),
			fauxAssistantMessage([fauxToolCall("Bash", { command: "echo second" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done second"),
		]);

		await harness.session.prompt("run first");
		await harness.session.prompt("run second");

		expect(records).toHaveLength(2);
		expect(select).toHaveBeenCalledTimes(1);
		expect(harness.settingsManager.getProjectSettings().permissions).toMatchObject({
			rules: [
				expect.objectContaining({
					provider: "pi-hooks",
					subject: "hook.approval",
					action: "allow",
					scope: "project",
				}),
			],
		});
		expect(harness.settingsManager.getProjectSettings().permissions?.rules?.[0]?.pattern).toContain("|*");
	});

	it("allows dangerous bash commands under yolo profile", async () => {
		const bashTool = makeRecorderTool("bash", records, Type.Object({ command: Type.String() }));

		const harness = await createHarness({ tools: [bashTool] });
		harnesses.push(harness);

		harness.session.applyAgentConfig(
			testConfig({
				permissionMode: "yolo",
			}),
		);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "rm -rf /tmp/data" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("cleanup");

		expect(records).toHaveLength(1);
		expect(records[0]?.input).toEqual({ command: "rm -rf /tmp/data" });
	});

	it("blocks mutating tools under readonly profile", async () => {
		const writeTool = makeRecorderTool("write", records);

		const harness = await createHarness({ tools: [writeTool] });
		harnesses.push(harness);

		harness.session.applyAgentConfig(testConfig({ permissionMode: "readonly" }));
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { file_path: join(harness.tempDir, "x.txt") })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("write file");

		expect(records).toHaveLength(0);
	});

	it("blocks bash commands under readonly profile", async () => {
		const bashTool = makeRecorderTool("bash", records, Type.Object({ command: Type.String() }));

		const harness = await createHarness({ tools: [bashTool] });
		harnesses.push(harness);

		harness.session.applyAgentConfig(testConfig({ permissionMode: "readonly" }));
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "echo hello" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run echo");

		expect(records).toHaveLength(0);
	});

	it("allows read-like tools under readonly profile", async () => {
		const readTool = makeRecorderTool("read", records);

		const harness = await createHarness({ tools: [readTool] });
		harnesses.push(harness);

		harness.session.applyAgentConfig(testConfig({ permissionMode: "readonly" }));
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("read", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("read file");

		expect(records).toHaveLength(1);
		expect(records[0]?.tool).toBe("read");
	});

	it("auto-approves safe bash commands under autopilot profile", async () => {
		const bashTool = makeRecorderTool("bash", records, Type.Object({ command: Type.String() }));

		const harness = await createHarness({ tools: [bashTool] });
		harnesses.push(harness);

		harness.session.applyAgentConfig(testConfig({ permissionMode: "autopilot" }));
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "echo hello" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run echo");

		expect(records).toHaveLength(1);
		expect(records[0]?.input).toEqual({ command: "echo hello" });
	});

	it("keeps dangerous bash commands gated under autopilot profile", async () => {
		const bashTool = makeRecorderTool("bash", records, Type.Object({ command: Type.String() }));

		const harness = await createHarness({ tools: [bashTool] });
		harnesses.push(harness);

		harness.session.applyAgentConfig(testConfig({ permissionMode: "autopilot" }));
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "rm -rf /tmp/data" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("cleanup");

		expect(records).toHaveLength(0);
	});

	it("auto-approves workspace writes under autopilot profile", async () => {
		const writeTool = makeRecorderTool("write", records, Type.Object({ file_path: Type.String() }));

		const harness = await createHarness({ tools: [writeTool] });
		harnesses.push(harness);

		harness.session.applyAgentConfig(testConfig({ permissionMode: "autopilot" }));
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { file_path: join(harness.tempDir, "safe.txt") })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("write file");

		expect(records).toHaveLength(1);
		expect(records[0]?.input).toEqual({ file_path: join(harness.tempDir, "safe.txt") });
	});

	it("allows default temporary paths without prompting in normal profile", async () => {
		const writeTool = makeRecorderTool("write", records, Type.Object({ file_path: Type.String() }));

		const harness = await createHarness({ tools: [writeTool] });
		harnesses.push(harness);

		harness.session.applyAgentConfig(testConfig({ permissionMode: "normal" }));
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { file_path: "/tmp/pi-agent-system-allowlist.txt" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("write temp file");

		expect(records).toHaveLength(1);
		expect(records[0]?.input).toEqual({ file_path: "/tmp/pi-agent-system-allowlist.txt" });
	});

	it("keeps outside-project writes gated under autopilot profile", async () => {
		const writeTool = makeRecorderTool("write", records, Type.Object({ file_path: Type.String() }));

		const harness = await createHarness({ tools: [writeTool] });
		harnesses.push(harness);

		harness.session.applyAgentConfig(testConfig({ permissionMode: "autopilot" }));
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { file_path: "/opt/autopilot-outside.txt" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("write outside project");

		expect(records).toHaveLength(0);
	});

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

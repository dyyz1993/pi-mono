import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool } from "@dyyz1993/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import claudeHooksCompatFactory from "../../extensions/claude-hooks-compat/index.js";
import { createHarness, getAssistantTexts, type Harness } from "./harness.js";

function writeSettingsJson(tempDir: string, settings: Record<string, unknown>): void {
	const claudeDir = join(tempDir, ".claude");
	mkdirSync(claudeDir, { recursive: true });
	writeFileSync(join(claudeDir, "settings.json"), JSON.stringify(settings, null, 2), "utf-8");
}

const echoTool: AgentTool = {
	name: "echo",
	label: "Echo",
	description: "Echo text back",
	parameters: Type.Object({ text: Type.String() }),
	execute: async (_toolCallId, params) => {
		const text = typeof params === "object" && params !== null && "text" in params ? String(params.text) : "";
		return { content: [{ type: "text", text }] };
	},
};

describe("claude-hooks-compat e2e", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("PreToolUse command hook blocks tool execution", async () => {
		const harness = await createHarness({
			tools: [echoTool],
			extensionFactories: [claudeHooksCompatFactory],
		});
		harnesses.push(harness);

		writeSettingsJson(harness.tempDir, {
			hooks: {
				PreToolUse: [
					{
						matcher: "echo",
						hooks: [
							{
								type: "command",
								command: 'echo \'{"ok":false,"reason":"blocked by test hook"}\'',
							},
						],
					},
				],
			},
		});

		await harness.session.bindExtensions({ shutdownHandler: () => {} });

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], { stopReason: "toolUse" }),
			(context) => {
				const toolResult = context.messages.find((message) => message.role === "toolResult");
				const errorText =
					toolResult?.role === "toolResult"
						? toolResult.content
								.filter((part): part is { type: "text"; text: string } => part.type === "text")
								.map((part) => part.text)
								.join("\n")
						: "";
				return fauxAssistantMessage(errorText);
			},
		]);

		await harness.session.prompt("hi");

		const errorToolResult = harness.session.messages.find(
			(message) => message.role === "toolResult" && message.isError,
		);
		expect(errorToolResult).toBeDefined();
		expect(getAssistantTexts(harness).join(" ")).toContain("blocked by test hook");
	});

	it("PreToolUse command hook allows tool execution", async () => {
		const harness = await createHarness({
			tools: [echoTool],
			extensionFactories: [claudeHooksCompatFactory],
		});
		harnesses.push(harness);

		writeSettingsJson(harness.tempDir, {
			hooks: {
				PreToolUse: [
					{
						matcher: "echo",
						hooks: [
							{
								type: "command",
								command: "echo '{\"ok\":true}'",
							},
						],
					},
				],
			},
		});

		await harness.session.bindExtensions({ shutdownHandler: () => {} });

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], { stopReason: "toolUse" }),
			(context) => {
				const toolResult = context.messages.find((message) => message.role === "toolResult");
				const text =
					toolResult?.role === "toolResult"
						? toolResult.content
								.filter((part): part is { type: "text"; text: string } => part.type === "text")
								.map((part) => part.text)
								.join("\n")
						: "";
				return fauxAssistantMessage(text);
			},
		]);

		await harness.session.prompt("hi");

		expect(getAssistantTexts(harness)).toContain("hello");
		expect(
			harness.session.messages.find((message) => message.role === "toolResult" && message.isError),
		).toBeUndefined();
	});

	it("PreToolUse hook with exit code 2 blocks tool", async () => {
		const harness = await createHarness({
			tools: [echoTool],
			extensionFactories: [claudeHooksCompatFactory],
		});
		harnesses.push(harness);

		writeSettingsJson(harness.tempDir, {
			hooks: {
				PreToolUse: [
					{
						matcher: "echo",
						hooks: [
							{
								type: "command",
								command: "echo blocked >&2 && exit 2",
							},
						],
					},
				],
			},
		});

		await harness.session.bindExtensions({ shutdownHandler: () => {} });

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], { stopReason: "toolUse" }),
			(context) => {
				const toolResult = context.messages.find((message) => message.role === "toolResult");
				const errorText =
					toolResult?.role === "toolResult"
						? toolResult.content
								.filter((part): part is { type: "text"; text: string } => part.type === "text")
								.map((part) => part.text)
								.join("\n")
						: "";
				return fauxAssistantMessage(errorText);
			},
		]);

		await harness.session.prompt("hi");

		const errorToolResult = harness.session.messages.find(
			(message) => message.role === "toolResult" && message.isError,
		);
		expect(errorToolResult).toBeDefined();
		expect(getAssistantTexts(harness).join(" ")).toContain("blocked");
	});

	it("PostToolUse hook fires after tool execution", async () => {
		const harness = await createHarness({
			tools: [echoTool],
			extensionFactories: [claudeHooksCompatFactory],
		});
		harnesses.push(harness);

		const markerFile = join(harness.tempDir, "post-hook-marker.txt");

		writeSettingsJson(harness.tempDir, {
			hooks: {
				PostToolUse: [
					{
						matcher: "echo",
						hooks: [
							{
								type: "command",
								command: `echo "hook fired" > "${markerFile}"`,
							},
						],
					},
				],
			},
		});

		await harness.session.bindExtensions({ shutdownHandler: () => {} });

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("hi");

		const { existsSync, readFileSync } = await import("node:fs");
		expect(existsSync(markerFile)).toBe(true);
		expect(readFileSync(markerFile, "utf-8").trim()).toBe("hook fired");
	});

	it("UserPromptSubmit hook blocks prompt via exit code 2", async () => {
		const harness = await createHarness({
			extensionFactories: [claudeHooksCompatFactory],
		});
		harnesses.push(harness);

		writeSettingsJson(harness.tempDir, {
			hooks: {
				UserPromptSubmit: [
					{
						hooks: [
							{
								type: "command",
								command: "echo 'prompt blocked' >&2 && exit 2",
							},
						],
					},
				],
			},
		});

		await harness.session.bindExtensions({ shutdownHandler: () => {} });

		harness.setResponses([fauxAssistantMessage("should not see this")]);

		await harness.session.prompt("hi");

		const customMessages = harness.session.messages.filter(
			(message) => message.role === "custom" && message.customType === "hook_block",
		);
		expect(customMessages.length).toBeGreaterThanOrEqual(1);
		if (customMessages.length > 0 && customMessages[0].role === "custom") {
			expect(customMessages[0].content).toContain("prompt blocked");
		}
	});

	it("session_start loads config and hooks remain inactive without config", async () => {
		const harness = await createHarness({
			tools: [echoTool],
			extensionFactories: [claudeHooksCompatFactory],
		});
		harnesses.push(harness);

		await harness.session.bindExtensions({ shutdownHandler: () => {} });

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], { stopReason: "toolUse" }),
			(context) => {
				const toolResult = context.messages.find((message) => message.role === "toolResult");
				const text =
					toolResult?.role === "toolResult"
						? toolResult.content
								.filter((part): part is { type: "text"; text: string } => part.type === "text")
								.map((part) => part.text)
								.join("\n")
						: "";
				return fauxAssistantMessage(text);
			},
		]);

		await harness.session.prompt("hi");

		expect(getAssistantTexts(harness)).toContain("hello");
		expect(
			harness.session.messages.find((message) => message.role === "toolResult" && message.isError),
		).toBeUndefined();
	});

	it("disableAllHooks skips all hook processing", async () => {
		const harness = await createHarness({
			tools: [echoTool],
			extensionFactories: [claudeHooksCompatFactory],
		});
		harnesses.push(harness);

		writeSettingsJson(harness.tempDir, {
			disableAllHooks: true,
			hooks: {
				PreToolUse: [
					{
						matcher: "echo",
						hooks: [
							{
								type: "command",
								command: "echo blocked >&2 && exit 2",
							},
						],
					},
				],
			},
		});

		await harness.session.bindExtensions({ shutdownHandler: () => {} });

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], { stopReason: "toolUse" }),
			(context) => {
				const toolResult = context.messages.find((message) => message.role === "toolResult");
				const text =
					toolResult?.role === "toolResult"
						? toolResult.content
								.filter((part): part is { type: "text"; text: string } => part.type === "text")
								.map((part) => part.text)
								.join("\n")
						: "";
				return fauxAssistantMessage(text);
			},
		]);

		await harness.session.prompt("hi");

		expect(getAssistantTexts(harness)).toContain("hello");
		expect(
			harness.session.messages.find((message) => message.role === "toolResult" && message.isError),
		).toBeUndefined();
	});

	it("matcher filters hooks by tool name", async () => {
		const otherTool: AgentTool = {
			name: "other",
			label: "Other",
			description: "Other tool",
			parameters: Type.Object({ value: Type.String() }),
			execute: async (_toolCallId, params) => {
				const value =
					typeof params === "object" && params !== null && "value" in params ? String(params.value) : "";
				return { content: [{ type: "text", text: value }] };
			},
		};

		const harness = await createHarness({
			tools: [echoTool, otherTool],
			extensionFactories: [claudeHooksCompatFactory],
		});
		harnesses.push(harness);

		writeSettingsJson(harness.tempDir, {
			hooks: {
				PreToolUse: [
					{
						matcher: "echo",
						hooks: [
							{
								type: "command",
								command: "echo blocked >&2 && exit 2",
							},
						],
					},
				],
			},
		});

		await harness.session.bindExtensions({ shutdownHandler: () => {} });

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("other", { value: "allowed" })], { stopReason: "toolUse" }),
			(context) => {
				const toolResult = context.messages.find((message) => message.role === "toolResult");
				const text =
					toolResult?.role === "toolResult"
						? toolResult.content
								.filter((part): part is { type: "text"; text: string } => part.type === "text")
								.map((part) => part.text)
								.join("\n")
						: "";
				return fauxAssistantMessage(text);
			},
		]);

		await harness.session.prompt("hi");

		expect(getAssistantTexts(harness)).toContain("allowed");
		expect(
			harness.session.messages.find((message) => message.role === "toolResult" && message.isError),
		).toBeUndefined();
	});

	it("CLAUDE_POLICY_FILE env var provides hooks config", async () => {
		const { writeFileSync: writeSync, mkdirSync: mkdir, unlinkSync, existsSync: exists } = await import("node:fs");
		const { tmpdir } = await import("node:os");

		const policyDir = join(tmpdir(), `pi-policy-test-${Date.now()}`);
		mkdir(policyDir, { recursive: true });
		const policyPath = join(policyDir, "policy.json");
		writeSync(
			policyPath,
			JSON.stringify({
				hooks: {
					PreToolUse: [
						{
							matcher: "echo",
							hooks: [
								{
									type: "command",
									command: 'echo \'{"ok":false,"reason":"policy blocked"}\'',
								},
							],
						},
					],
				},
			}),
			"utf-8",
		);

		const originalPolicyFile = process.env.CLAUDE_POLICY_FILE;
		process.env.CLAUDE_POLICY_FILE = policyPath;

		try {
			const harness = await createHarness({
				tools: [echoTool],
				extensionFactories: [claudeHooksCompatFactory],
			});
			harnesses.push(harness);

			await harness.session.bindExtensions({ shutdownHandler: () => {} });

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], { stopReason: "toolUse" }),
				(context) => {
					const toolResult = context.messages.find((message) => message.role === "toolResult");
					const errorText =
						toolResult?.role === "toolResult"
							? toolResult.content
									.filter((part): part is { type: "text"; text: string } => part.type === "text")
									.map((part) => part.text)
									.join("\n")
							: "";
					return fauxAssistantMessage(errorText);
				},
			]);

			await harness.session.prompt("hi");

			const errorToolResult = harness.session.messages.find(
				(message) => message.role === "toolResult" && message.isError,
			);
			expect(errorToolResult).toBeDefined();
			expect(getAssistantTexts(harness).join(" ")).toContain("policy blocked");
		} finally {
			process.env.CLAUDE_POLICY_FILE = originalPolicyFile;
			try {
				unlinkSync(policyPath);
			} catch {}
			try {
				const { rmSync } = await import("node:fs");
				rmSync(policyDir, { recursive: true });
			} catch {}
		}
	});

	it("command variables: $CLAUDE_PROJECT_DIR resolves to cwd", async () => {
		const harness = await createHarness({
			tools: [echoTool],
			extensionFactories: [claudeHooksCompatFactory],
		});
		harnesses.push(harness);

		const markerFile = join(harness.tempDir, "var-project-dir.txt");
		writeSettingsJson(harness.tempDir, {
			hooks: {
				PreToolUse: [
					{
						matcher: "echo",
						hooks: [
							{
								type: "command",
								command: `echo "$CLAUDE_PROJECT_DIR" > "${markerFile}"`,
							},
						],
					},
				],
			},
		});

		await harness.session.bindExtensions({ shutdownHandler: () => {} });
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("hi");

		expect(existsSync(markerFile)).toBe(true);
		expect(readFileSync(markerFile, "utf-8").trim()).toBe(harness.tempDir);
	});

	it("command variables: $TOOL resolves to tool name", async () => {
		const harness = await createHarness({
			tools: [echoTool],
			extensionFactories: [claudeHooksCompatFactory],
		});
		harnesses.push(harness);

		const markerFile = join(harness.tempDir, "var-tool.txt");
		writeSettingsJson(harness.tempDir, {
			hooks: {
				PreToolUse: [
					{
						matcher: "echo",
						hooks: [
							{
								type: "command",
								command: `echo "$TOOL" > "${markerFile}"`,
							},
						],
					},
				],
			},
		});

		await harness.session.bindExtensions({ shutdownHandler: () => {} });
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("hi");

		expect(existsSync(markerFile)).toBe(true);
		expect(readFileSync(markerFile, "utf-8").trim()).toBe("echo");
	});

	it("command variables: $BASH_COMMAND resolves to bash command content", async () => {
		const bashTool: AgentTool = {
			name: "Bash",
			label: "Bash",
			description: "Run bash",
			parameters: Type.Object({ command: Type.String() }),
			execute: async (_toolCallId, params) => {
				const command =
					typeof params === "object" && params !== null && "command" in params ? String(params.command) : "";
				return { content: [{ type: "text", text: command }] };
			},
		};

		const harness = await createHarness({
			tools: [bashTool],
			extensionFactories: [claudeHooksCompatFactory],
		});
		harnesses.push(harness);

		const markerFile = join(harness.tempDir, "var-bash-command.txt");
		writeSettingsJson(harness.tempDir, {
			hooks: {
				PreToolUse: [
					{
						matcher: "Bash",
						hooks: [
							{
								type: "command",
								command: `echo "$BASH_COMMAND" > "${markerFile}"`,
							},
						],
					},
				],
			},
		});

		await harness.session.bindExtensions({ shutdownHandler: () => {} });
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("Bash", { command: "rm -rf /tmp/test" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("hi");

		expect(existsSync(markerFile)).toBe(true);
		expect(readFileSync(markerFile, "utf-8").trim()).toBe("rm -rf /tmp/test");
	});

	it("command variables: $ARGUMENTS resolves to JSON of tool_input", async () => {
		const harness = await createHarness({
			tools: [echoTool],
			extensionFactories: [claudeHooksCompatFactory],
		});
		harnesses.push(harness);

		const markerFile = join(harness.tempDir, "var-arguments.txt");
		writeSettingsJson(harness.tempDir, {
			hooks: {
				PreToolUse: [
					{
						matcher: "echo",
						hooks: [
							{
								type: "command",
								command: `echo $ARGUMENTS | sed 's/^ //' > "${markerFile}"`,
							},
						],
					},
				],
			},
		});

		await harness.session.bindExtensions({ shutdownHandler: () => {} });
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("hi");

		expect(existsSync(markerFile)).toBe(true);
		const content = readFileSync(markerFile, "utf-8").trim();
		expect(content).toContain("text");
		expect(content).toContain("hello");
	});

	it("stdin JSON contains expected PreToolUse fields", async () => {
		const harness = await createHarness({
			tools: [echoTool],
			extensionFactories: [claudeHooksCompatFactory],
		});
		harnesses.push(harness);

		const markerFile = join(harness.tempDir, "stdin-data.txt");
		writeSettingsJson(harness.tempDir, {
			hooks: {
				PreToolUse: [
					{
						matcher: "echo",
						hooks: [
							{
								type: "command",
								command: `cat > "${markerFile}"`,
							},
						],
					},
				],
			},
		});

		await harness.session.bindExtensions({ shutdownHandler: () => {} });
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("hi");

		expect(existsSync(markerFile)).toBe(true);
		const stdinData = JSON.parse(readFileSync(markerFile, "utf-8"));
		expect(stdinData).toHaveProperty("session_id");
		expect(stdinData.cwd).toBe(harness.tempDir);
		expect(stdinData.hook_event_name).toBe("PreToolUse");
		expect(stdinData.tool_name).toBe("echo");
		expect(stdinData.tool_input).toEqual({ text: "hello" });
		expect(stdinData).toHaveProperty("tool_use_id");
		expect(stdinData.permission_mode).toBe("default");
	});

	it("env var CLAUDE_PROJECT_DIR is set in hook subprocess", async () => {
		const harness = await createHarness({
			tools: [echoTool],
			extensionFactories: [claudeHooksCompatFactory],
		});
		harnesses.push(harness);

		const markerFile = join(harness.tempDir, "env-project-dir.txt");
		writeSettingsJson(harness.tempDir, {
			hooks: {
				PreToolUse: [
					{
						matcher: "echo",
						hooks: [
							{
								type: "command",
								command: `echo "$CLAUDE_PROJECT_DIR" > "${markerFile}"`,
							},
						],
					},
				],
			},
		});

		await harness.session.bindExtensions({ shutdownHandler: () => {} });
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("hi");

		expect(existsSync(markerFile)).toBe(true);
		expect(readFileSync(markerFile, "utf-8").trim()).toBe(harness.tempDir);
	});

	it("env var CLAUDE_CODE_SHELL_PREFIX is empty string in hook subprocess", async () => {
		const harness = await createHarness({
			tools: [echoTool],
			extensionFactories: [claudeHooksCompatFactory],
		});
		harnesses.push(harness);

		const markerFile = join(harness.tempDir, "env-shell-prefix.txt");
		writeSettingsJson(harness.tempDir, {
			hooks: {
				PreToolUse: [
					{
						matcher: "echo",
						hooks: [
							{
								type: "command",
								command: `printf '%s' "$CLAUDE_CODE_SHELL_PREFIX" > "${markerFile}"`,
							},
						],
					},
				],
			},
		});

		await harness.session.bindExtensions({ shutdownHandler: () => {} });
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("hi");

		expect(existsSync(markerFile)).toBe(true);
		expect(readFileSync(markerFile, "utf-8")).toBe("");
	});

	it("input placeholder: ${tool_input.text} resolves in hook command", async () => {
		const harness = await createHarness({
			tools: [echoTool],
			extensionFactories: [claudeHooksCompatFactory],
		});
		harnesses.push(harness);

		const markerFile = join(harness.tempDir, "placeholder-tool-input.txt");
		writeSettingsJson(harness.tempDir, {
			hooks: {
				PreToolUse: [
					{
						matcher: "echo",
						hooks: [
							{
								type: "command",
								command: `cat > "${markerFile}"`,
								input: {
									marker: "${tool_input.text}",
								},
							},
						],
					},
				],
			},
		});

		await harness.session.bindExtensions({ shutdownHandler: () => {} });
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("hi");

		expect(existsSync(markerFile)).toBe(true);
		const stdinData = JSON.parse(readFileSync(markerFile, "utf-8"));
		expect(stdinData.tool_input).toEqual({ text: "hello" });
	});

	it("if clause: Bash(rm *) matches bash command", async () => {
		const bashTool: AgentTool = {
			name: "Bash",
			label: "Bash",
			description: "Run bash",
			parameters: Type.Object({ command: Type.String() }),
			execute: async (_toolCallId, params) => {
				const command =
					typeof params === "object" && params !== null && "command" in params ? String(params.command) : "";
				return { content: [{ type: "text", text: command }] };
			},
		};

		const harness = await createHarness({
			tools: [bashTool],
			extensionFactories: [claudeHooksCompatFactory],
		});
		harnesses.push(harness);

		const markerFile = join(harness.tempDir, "if-clause-match.txt");
		writeSettingsJson(harness.tempDir, {
			hooks: {
				PreToolUse: [
					{
						matcher: "Bash",
						hooks: [
							{
								type: "command",
								command: `echo "hook fired" > "${markerFile}"`,
								if: "Bash(rm *)",
							},
						],
					},
				],
			},
		});

		await harness.session.bindExtensions({ shutdownHandler: () => {} });
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("Bash", { command: "rm -rf /tmp/test" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("hi");

		expect(existsSync(markerFile)).toBe(true);
		expect(readFileSync(markerFile, "utf-8").trim()).toBe("hook fired");
	});

	it("if clause: Bash(rm *) does not match ls command", async () => {
		const bashTool: AgentTool = {
			name: "Bash",
			label: "Bash",
			description: "Run bash",
			parameters: Type.Object({ command: Type.String() }),
			execute: async (_toolCallId, params) => {
				const command =
					typeof params === "object" && params !== null && "command" in params ? String(params.command) : "";
				return { content: [{ type: "text", text: command }] };
			},
		};

		const harness = await createHarness({
			tools: [bashTool],
			extensionFactories: [claudeHooksCompatFactory],
		});
		harnesses.push(harness);

		const markerFile = join(harness.tempDir, "if-clause-no-match.txt");
		writeSettingsJson(harness.tempDir, {
			hooks: {
				PreToolUse: [
					{
						matcher: "Bash",
						hooks: [
							{
								type: "command",
								command: `echo "hook fired" > "${markerFile}"`,
								if: "Bash(rm *)",
							},
						],
					},
				],
			},
		});

		await harness.session.bindExtensions({ shutdownHandler: () => {} });
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("Bash", { command: "ls -la /tmp" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("hi");

		expect(existsSync(markerFile)).toBe(false);
	});

	it("if clause: Edit(src/**) matches file_path", async () => {
		const editTool: AgentTool = {
			name: "Edit",
			label: "Edit",
			description: "Edit file",
			parameters: Type.Object({ file_path: Type.String(), old_string: Type.String(), new_string: Type.String() }),
			execute: async (_toolCallId, params) => {
				const filePath =
					typeof params === "object" && params !== null && "file_path" in params ? String(params.file_path) : "";
				return { content: [{ type: "text", text: filePath }] };
			},
		};

		const harness = await createHarness({
			tools: [editTool],
			extensionFactories: [claudeHooksCompatFactory],
		});
		harnesses.push(harness);

		const markerFile = join(harness.tempDir, "if-clause-edit.txt");
		writeSettingsJson(harness.tempDir, {
			hooks: {
				PreToolUse: [
					{
						matcher: "Edit",
						hooks: [
							{
								type: "command",
								command: `echo "hook fired" > "${markerFile}"`,
								if: "Edit(src/**)",
							},
						],
					},
				],
			},
		});

		await harness.session.bindExtensions({ shutdownHandler: () => {} });
		harness.setResponses([
			fauxAssistantMessage(
				[fauxToolCall("Edit", { file_path: "src/index.ts", old_string: "foo", new_string: "bar" })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("hi");

		expect(existsSync(markerFile)).toBe(true);
		expect(readFileSync(markerFile, "utf-8").trim()).toBe("hook fired");
	});

	it("PostToolUse stdin contains tool_output field", async () => {
		const harness = await createHarness({
			tools: [echoTool],
			extensionFactories: [claudeHooksCompatFactory],
		});
		harnesses.push(harness);

		const markerFile = join(harness.tempDir, "post-stdin.txt");
		writeSettingsJson(harness.tempDir, {
			hooks: {
				PostToolUse: [
					{
						matcher: "echo",
						hooks: [
							{
								type: "command",
								command: `cat > "${markerFile}"`,
							},
						],
					},
				],
			},
		});

		await harness.session.bindExtensions({ shutdownHandler: () => {} });
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("hi");

		expect(existsSync(markerFile)).toBe(true);
		const stdinData = JSON.parse(readFileSync(markerFile, "utf-8"));
		expect(stdinData.hook_event_name).toBe("PostToolUse");
		expect(stdinData.tool_output).toBe("hello");
		expect(stdinData.tool_name).toBe("echo");
	});

	it("UserPromptSubmit stdin contains prompt field", async () => {
		const harness = await createHarness({
			extensionFactories: [claudeHooksCompatFactory],
		});
		harnesses.push(harness);

		const markerFile = join(harness.tempDir, "user-prompt-stdin.txt");
		writeSettingsJson(harness.tempDir, {
			hooks: {
				UserPromptSubmit: [
					{
						hooks: [
							{
								type: "command",
								command: `cat > "${markerFile}"`,
							},
						],
					},
				],
			},
		});

		await harness.session.bindExtensions({ shutdownHandler: () => {} });
		harness.setResponses([fauxAssistantMessage("done")]);
		await harness.session.prompt("test prompt here");

		expect(existsSync(markerFile)).toBe(true);
		const stdinData = JSON.parse(readFileSync(markerFile, "utf-8"));
		expect(stdinData.hook_event_name).toBe("UserPromptSubmit");
		expect(stdinData.tool_input).toHaveProperty("prompt");
	});
});

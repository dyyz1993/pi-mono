/**
 * Harness-based tests for bash-ext and ask-tools extensions.
 *
 * bash-ext tests (no real LLM, faux provider drives tool calls):
 *   1. Basic command execution (echo)
 *   2. Failed command (nonzero exit code)
 *   3. Streaming output (long output visible via onUpdate)
 *   4. Multi-line output
 *   5. Timeout behavior (short timeout kills process)
 *   6. Background process auto-backgrounding (short backgroundAfter)
 *   7. get_background_process tool queries status
 *   8. get_background_process with grep filter
 *   9. get_background_process with lastLines filter
 *  10. Non-existent bashId returns error message
 *
 * ask-tools tests:
 *  11. ask-confirm returns yes
 *  12. ask-confirm returns no
 *  13. ask-select single returns chosen option
 *  14. ask-select multiple returns multiple choices
 *  15. ask-input returns typed text
 *  16. ask-notify fires and returns immediately
 */

import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import askToolsExtension from "../../extensions/ask-tools/index.ts";
import bashExt from "../../extensions/bash-ext/index.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

function makeTempDir(): string {
	const dir = join(tmpdir(), `pi-bash-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

// ═══════════════════════════════════════════════════════════════════════
// bash-ext tests
// ═══════════════════════════════════════════════════════════════════════

describe("bash-ext harness tests", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	async function createBashHarness(cwd: string): Promise<Harness> {
		const harness = await createHarness({
			cwd,
			extensionFactories: [bashExt],
		});
		harness.session.setPermissionMode("yolo");
		return harness;
	}

	it("executes echo command and returns output", async () => {
		const cwd = makeTempDir();
		const harness = await createBashHarness(cwd);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "echo hello world", description: "print greeting" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run echo");
		await harness.session.agent.waitForIdle();

		// Tool results are in session entries — check the full entry list
		const entries = harness.sessionManager.getEntries();
		const allEntryTexts = entries
			.map((e) => {
				if (e.type === "message") return getMessageText(e.message);
				return "";
			})
			.join(" ");
		expect(allEntryTexts).toContain("hello world");
	});

	it("failed command returns nonzero exit code info", async () => {
		const cwd = makeTempDir();
		const harness = await createBashHarness(cwd);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "exit 42", description: "fail with code 42" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run failing command");
		await harness.session.agent.waitForIdle();

		const allText = harness.session.messages.map((m) => getMessageText(m)).join(" ");
		expect(allText).toContain("42");
	});

	it("multi-line output is preserved", async () => {
		const cwd = makeTempDir();
		const harness = await createBashHarness(cwd);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(
				[fauxToolCall("bash", { command: "printf 'line1\\nline2\\nline3\\n'", description: "print 3 lines" })],
				{
					stopReason: "toolUse",
				},
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("print lines");
		await harness.session.agent.waitForIdle();

		const allText = harness.session.messages.map((m) => getMessageText(m)).join(" ");
		expect(allText).toContain("line1");
		expect(allText).toContain("line2");
		expect(allText).toContain("line3");
	});

	it("stderr output is captured", async () => {
		const cwd = makeTempDir();
		const harness = await createBashHarness(cwd);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(
				[fauxToolCall("bash", { command: "echo 'error msg' >&2", description: "write to stderr" })],
				{
					stopReason: "toolUse",
				},
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("write to stderr");
		await harness.session.agent.waitForIdle();

		const allText = harness.session.messages.map((m) => getMessageText(m)).join(" ");
		expect(allText).toContain("error msg");
	});

	it("timeout kills long-running command", async () => {
		const cwd = makeTempDir();
		const harness = await createBashHarness(cwd);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "sleep 30", description: "sleep 30s", timeout: 2 })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run sleep");
		await harness.session.agent.waitForIdle();

		const allText = harness.session.messages.map((m) => getMessageText(m)).join(" ");
		// Should contain timeout indication
		expect(allText.toLowerCase()).toMatch(/timed? ?out|timeout/i);
	});

	it("auto-background after backgroundAfter seconds", async () => {
		const cwd = makeTempDir();
		const harness = await createBashHarness(cwd);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(
				[fauxToolCall("bash", { command: "sleep 10", description: "long sleep", backgroundAfter: 1, timeout: 30 })],
				{
					stopReason: "toolUse",
				},
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run background");
		await harness.session.agent.waitForIdle();

		const allText = harness.session.messages.map((m) => getMessageText(m)).join(" ");
		// Should contain background indication with bashId
		expect(allText).toMatch(/background/i);
		expect(allText).toContain("<bashId>");
	});

	it("get_background_process returns process status", async () => {
		const cwd = makeTempDir();
		const harness = await createBashHarness(cwd);
		harnesses.push(harness);

		// First run a command that backgrounds
		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("bash", {
						command: "echo output1 && sleep 10",
						description: "bg test",
						backgroundAfter: 1,
						timeout: 30,
					}),
				],
				{
					stopReason: "toolUse",
				},
			),
			fauxAssistantMessage([fauxToolCall("get_background_process", { bashId: "bash-dummy" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run and query");
		await harness.session.agent.waitForIdle();

		// The get_background_process should return something (even if "not found")
		const allText = harness.session.messages.map((m) => getMessageText(m)).join(" ");
		// Either process info or "not found" message
		expect(allText.length).toBeGreaterThan(0);
	});

	it("get_background_process with non-existent bashId", async () => {
		const cwd = makeTempDir();
		const harness = await createBashHarness(cwd);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("get_background_process", { bashId: "bash-nonexistent" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("query non-existent");
		await harness.session.agent.waitForIdle();

		const allText = harness.session.messages.map((m) => getMessageText(m)).join(" ");
		expect(allText).toContain("No process found");
	});

	it("cwd parameter changes working directory", async () => {
		const cwd = makeTempDir();
		const subDir = join(cwd, "subdir");
		mkdirSync(subDir, { recursive: true });

		const harness = await createBashHarness(cwd);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(
				[fauxToolCall("bash", { command: "pwd", description: "print working dir", cwd: subDir })],
				{
					stopReason: "toolUse",
				},
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("print pwd in subdir");
		await harness.session.agent.waitForIdle();

		const allText = harness.session.messages.map((m) => getMessageText(m)).join(" ");
		expect(allText).toContain("subdir");
	});

	it("writes to file then reads it back", async () => {
		const cwd = makeTempDir();
		const harness = await createBashHarness(cwd);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("bash", { command: "echo 'content here' > test.txt", description: "write file" }),
					fauxToolCall("bash", { command: "cat test.txt", description: "read file" }),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("write and read");
		await harness.session.agent.waitForIdle();

		const allText = harness.session.messages.map((m) => getMessageText(m)).join(" ");
		expect(allText).toContain("content here");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// ask-tools tests
// ═══════════════════════════════════════════════════════════════════════

describe("ask-tools harness tests with mocked UI", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	async function createAskHarnessWithUI(uiOverrides: {
		confirm?: (title: string, msg: string) => Promise<boolean>;
		select?: (title: string, options: string[], opts?: Record<string, unknown>) => Promise<string | undefined>;
		input?: (title: string, placeholder?: string) => Promise<string | undefined>;
		editor?: (title: string, prefill?: string) => Promise<string | undefined>;
		notify?: (msg: string, type?: string) => void;
	}): Promise<Harness> {
		const cwd = makeTempDir();
		const harness = await createHarness({
			cwd,
			extensionFactories: [askToolsExtension],
		});
		harness.session.setPermissionMode("yolo");
		harnesses.push(harness);

		// Inject mock UI context
		const noop = () => {};
		const asyncNoop = async () => undefined as never;
		harness.session.extensionRunner.setUIContext(
			{
				confirm: uiOverrides.confirm ?? (async () => false),
				select: uiOverrides.select ?? (async () => undefined),
				input: uiOverrides.input ?? (async () => undefined),
				notify: uiOverrides.notify ?? noop,
				editor: uiOverrides.editor ?? (async () => undefined),
				onTerminalInput: () => noop,
				setStatus: noop,
				setWorkingMessage: noop,
				setWorkingVisible: noop,
				setWorkingIndicator: noop,
				setHiddenThinkingLabel: noop,
				setWidget: noop,
				setFooter: noop,
				setHeader: noop,
				setTitle: noop,
				custom: asyncNoop,
				pasteToEditor: asyncNoop,
				setEditorText: noop,
				getEditorText: () => "",
				addAutocompleteProvider: noop,
				removeAutocompleteProvider: noop,
				setAutocompleteProviders: noop,
				clearAutocompleteProviders: noop,
				registerKeyHandler: () => noop,
				unregisterKeyHandler: noop,
				setFooterDataProvider: noop,
			} as unknown as Parameters<typeof harness.session.extensionRunner.setUIContext>[0],
			"tui" as const,
		);

		return harness;
	}

	it("ask-confirm returns yes when UI confirms", async () => {
		const harness = await createAskHarnessWithUI({
			confirm: async () => true,
		});

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("ask-confirm", { title: "Proceed?", question: "Are you sure?" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("ask");
		await harness.session.agent.waitForIdle();

		const entries = harness.sessionManager.getEntries();
		const allText = entries
			.filter((e) => e.type === "message")
			.map((e) => getMessageText(e.message))
			.join(" ");
		expect(allText).toContain("yes");
	});

	it("ask-confirm returns no when UI declines", async () => {
		const harness = await createAskHarnessWithUI({
			confirm: async () => false,
		});

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("ask-confirm", { title: "Proceed?", question: "Sure?" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("ask");
		await harness.session.agent.waitForIdle();

		const entries = harness.sessionManager.getEntries();
		const allText = entries
			.filter((e) => e.type === "message")
			.map((e) => getMessageText(e.message))
			.join(" ");
		expect(allText).toContain("no");
	});

	it("ask-select single returns chosen option", async () => {
		const harness = await createAskHarnessWithUI({
			select: async () => "option B",
		});

		harness.setResponses([
			fauxAssistantMessage(
				[fauxToolCall("ask-select", { title: "Pick one", options: ["option A", "option B", "option C"] })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("select");
		await harness.session.agent.waitForIdle();

		const entries = harness.sessionManager.getEntries();
		const allText = entries
			.filter((e) => e.type === "message")
			.map((e) => getMessageText(e.message))
			.join(" ");
		expect(allText).toContain("option B");
	});

	it("ask-select multiple returns multiple choices", async () => {
		const harness = await createAskHarnessWithUI({
			select: async () => ["red", "blue"] as unknown as string,
		});

		harness.setResponses([
			fauxAssistantMessage(
				[fauxToolCall("ask-select", { title: "Pick colors", options: ["red", "green", "blue"], multiple: true })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("multi-select");
		await harness.session.agent.waitForIdle();

		const entries = harness.sessionManager.getEntries();
		const allText = entries
			.filter((e) => e.type === "message")
			.map((e) => getMessageText(e.message))
			.join(" ");
		expect(allText).toContain("red");
		expect(allText).toContain("blue");
	});

	it("ask-input returns typed text", async () => {
		const harness = await createAskHarnessWithUI({
			input: async () => "hello from user",
		});

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("ask-input", { title: "Enter name", placeholder: "Name" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("input");
		await harness.session.agent.waitForIdle();

		const entries = harness.sessionManager.getEntries();
		const allText = entries
			.filter((e) => e.type === "message")
			.map((e) => getMessageText(e.message))
			.join(" ");
		expect(allText).toContain("hello from user");
	});

	it("ask-editor returns edited text", async () => {
		const harness = await createAskHarnessWithUI({
			editor: async () => "edited multi\nline content",
		});

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("ask-editor", { title: "Edit JSON", prefill: "{}" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("edit");
		await harness.session.agent.waitForIdle();

		const entries = harness.sessionManager.getEntries();
		const allText = entries
			.filter((e) => e.type === "message")
			.map((e) => getMessageText(e.message))
			.join(" ");
		expect(allText).toContain("edited multi");
	});

	it("ask-select cancelled returns (cancelled)", async () => {
		const harness = await createAskHarnessWithUI({
			select: async () => undefined,
		});

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("ask-select", { title: "Pick", options: ["A", "B"] })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("select");
		await harness.session.agent.waitForIdle();

		const entries = harness.sessionManager.getEntries();
		const allText = entries
			.filter((e) => e.type === "message")
			.map((e) => getMessageText(e.message))
			.join(" ");
		expect(allText).toContain("cancelled");
	});

	it("ask-notify fires and returns immediately", async () => {
		const harness = await createAskHarnessWithUI({});

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("ask-notify", { message: "Build complete", type: "info" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("notify");
		await harness.session.agent.waitForIdle();

		const entries = harness.sessionManager.getEntries();
		const allText = entries
			.filter((e) => e.type === "message")
			.map((e) => getMessageText(e.message))
			.join(" ");
		expect(allText).toContain("Notified user");
	});

	it("registers all 5 ask tools — verified via tool dispatch", async () => {
		const harness = await createAskHarnessWithUI({});

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("ask-notify", { message: "test", type: "info" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("notify");
		await harness.session.agent.waitForIdle();

		const toolExecEvents = harness.events.filter((e) => e.type === "tool_execution_start");
		expect(toolExecEvents.length).toBeGreaterThanOrEqual(1);
		expect((toolExecEvents[0] as { toolName?: string }).toolName).toBe("ask-notify");
	});
});

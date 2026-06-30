import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool } from "@dyyz1993/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionUIContext } from "../../src/core/extensions/index.ts";
import { createHarness, type Harness } from "./harness.ts";

function makePermissionUi(choice: string): ExtensionUIContext {
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

describe("path boundary approval", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("allows reading files inside cwd", async () => {
		let executed = false;
		const readTool: AgentTool = {
			name: "read",
			label: "Read",
			description: "Read file",
			parameters: Type.Object({ file_path: Type.String() }),
			execute: async () => {
				executed = true;
				return { content: [{ type: "text", text: "ok" }], details: {} };
			},
		};

		const harness = await createHarness({ tools: [readTool] });
		harnesses.push(harness);

		const insidePath = join(harness.tempDir, "foo.txt");
		writeFileSync(insidePath, "hello");

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("read", { file_path: insidePath }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("read file");
		expect(executed).toBe(true);
	});

	it("blocks reading files outside cwd in normal mode (no UI)", async () => {
		let executed = false;
		const readTool: AgentTool = {
			name: "read",
			label: "Read",
			description: "Read file",
			parameters: Type.Object({ file_path: Type.String() }),
			execute: async () => {
				executed = true;
				return { content: [{ type: "text", text: "ok" }], details: {} };
			},
		};

		const harness = await createHarness({ tools: [readTool] });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("read", { file_path: "/etc/passwd" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("read password file");
		expect(executed).toBe(false);
	});

	it("allows benign read-only access outside cwd in normal mode", async () => {
		let executed = false;
		const readTool: AgentTool = {
			name: "read",
			label: "Read",
			description: "Read file",
			parameters: Type.Object({ file_path: Type.String() }),
			execute: async () => {
				executed = true;
				return { content: [{ type: "text", text: "ok" }], details: {} };
			},
		};

		const cwd = join(process.cwd(), ".tmp", `path-boundary-cwd-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(cwd, { recursive: true });
		const harness = await createHarness({ cwd, tools: [readTool] });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("read", { file_path: join(process.cwd(), "README.md") }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("read a harmless file outside cwd");
		expect(executed).toBe(true);
	});

	it("blocks writing files outside cwd in normal mode (no UI)", async () => {
		let executed = false;
		const writeTool: AgentTool = {
			name: "write",
			label: "Write",
			description: "Write file",
			parameters: Type.Object({ file_path: Type.String(), content: Type.String() }),
			execute: async () => {
				executed = true;
				return { content: [{ type: "text", text: "ok" }], details: {} };
			},
		};

		const harness = await createHarness({ tools: [writeTool] });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { file_path: "/etc/pi-outside.txt", content: "data" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("write file outside");
		expect(executed).toBe(false);
	});

	it("stores always-allow path boundary decisions in the permission store", async () => {
		let executed = false;
		const writeTool: AgentTool = {
			name: "write",
			label: "Write",
			description: "Write file",
			parameters: Type.Object({ file_path: Type.String(), content: Type.String() }),
			execute: async () => {
				executed = true;
				return { content: [{ type: "text", text: "ok" }], details: {} };
			},
		};

		const harness = await createHarness({ tools: [writeTool] });
		harnesses.push(harness);
		await harness.session.bindExtensions({ uiContext: makePermissionUi("2. Always allow"), mode: "rpc" });

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { file_path: "/etc/pi-outside.txt", content: "data" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("write file outside");

		expect(executed).toBe(true);
		expect(harness.settingsManager.getProjectSettings().permissions?.rules).toEqual([
			expect.objectContaining({
				provider: "path-access",
				subject: "file.write",
				pattern: "/etc/**",
				action: "allow",
				scope: "project",
			}),
		]);
	});

	it("allows tools without file paths (e.g. bash)", async () => {
		let executed = false;
		const bashTool: AgentTool = {
			name: "bash",
			label: "Bash",
			description: "Run command",
			parameters: Type.Object({ command: Type.String() }),
			execute: async () => {
				executed = true;
				return { content: [{ type: "text", text: "ok" }], details: {} };
			},
		};

		const harness = await createHarness({ tools: [bashTool] });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("bash", { command: "ls /tmp" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("list tmp");
		expect(executed).toBe(true);
	});
});

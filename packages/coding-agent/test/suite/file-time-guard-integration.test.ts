/**
 * Harness integration tests for the file-time-guard extension.
 *
 * Exercises the full AgentSession pipeline:
 *   createHarness → bindExtensions (session_start) → faux provider →
 *   beforeToolCall (tool_call event) → tool execute → afterToolCall (tool_result event)
 *
 * Uses the faux provider per AGENTS.md rules — no real API calls.
 */

import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool } from "@dyyz1993/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import fileTimeGuardFactory from "../../extensions/file-time-guard/index.ts";
import { createHarness, type Harness } from "./harness.ts";

/** Set a file's mtime/atime to a fixed point in the past. */
function ageFile(filePath: string, secondsAgo = 3600): void {
	const past = (Date.now() - secondsAgo * 1000) / 1000;
	utimesSync(filePath, past, past);
}

describe("file-time-guard harness integration", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("allows second edit on same file after first edit succeeds", async () => {
		let cwd = "";
		let editExecutions = 0;

		const readTool: AgentTool = {
			name: "read",
			label: "Read",
			description: "Read file",
			parameters: Type.Object({ path: Type.String() }),
			execute: async (_id, params) => {
				const p = (params as { path: string }).path;
				const content = readFileSync(p, "utf-8");
				return { content: [{ type: "text", text: content }], details: {} };
			},
		};

		const editTool: AgentTool = {
			name: "edit",
			label: "Edit",
			description: "Edit file",
			parameters: Type.Object({ path: Type.String() }),
			execute: async (_id, params) => {
				const p = (params as { path: string }).path;
				editExecutions++;
				writeFileSync(p, `edited-v${editExecutions}`);
				return { content: [{ type: "text", text: "edited" }], details: {} };
			},
		};

		const harness = await createHarness({
			tools: [readTool, editTool],
			extensionFactories: [fileTimeGuardFactory],
		});
		harnesses.push(harness);
		cwd = harness.tempDir;

		const filePath = join(cwd, "target.txt");
		writeFileSync(filePath, "original");
		ageFile(filePath);

		await harness.session.bindExtensions({});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("read", { path: filePath }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("edit", { path: filePath }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("edit", { path: filePath }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("test");

		// Both edits must execute — the second must NOT be blocked as "externally modified".
		expect(editExecutions).toBe(2);
	});

	it("allows edit on a file that was just written", async () => {
		let cwd = "";
		let editExecutions = 0;

		const writeTool: AgentTool = {
			name: "write",
			label: "Write",
			description: "Write file",
			parameters: Type.Object({ path: Type.String() }),
			execute: async (_id, params) => {
				const p = (params as { path: string }).path;
				writeFileSync(p, "written");
				return { content: [{ type: "text", text: "written" }], details: {} };
			},
		};

		const editTool: AgentTool = {
			name: "edit",
			label: "Edit",
			description: "Edit file",
			parameters: Type.Object({ path: Type.String() }),
			execute: async (_id, params) => {
				const p = (params as { path: string }).path;
				editExecutions++;
				writeFileSync(p, "edited");
				return { content: [{ type: "text", text: "edited" }], details: {} };
			},
		};

		const harness = await createHarness({
			tools: [writeTool, editTool],
			extensionFactories: [fileTimeGuardFactory],
		});
		harnesses.push(harness);
		cwd = harness.tempDir;

		const filePath = join(cwd, "created.txt");

		await harness.session.bindExtensions({});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: filePath }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("edit", { path: filePath }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("test");

		// Edit after write must NOT be blocked as "not read".
		expect(editExecutions).toBe(1);
	});

	it("ignores files under node_modules (no read required)", async () => {
		let cwd = "";
		let editExecutions = 0;

		const editTool: AgentTool = {
			name: "edit",
			label: "Edit",
			description: "Edit file",
			parameters: Type.Object({ path: Type.String() }),
			execute: async (_id, params) => {
				const p = (params as { path: string }).path;
				editExecutions++;
				writeFileSync(p, "edited");
				return { content: [{ type: "text", text: "edited" }], details: {} };
			},
		};

		const harness = await createHarness({
			tools: [editTool],
			extensionFactories: [fileTimeGuardFactory],
		});
		harnesses.push(harness);
		cwd = harness.tempDir;

		mkdirSync(join(cwd, "node_modules", "pkg"), { recursive: true });
		const filePath = join(cwd, "node_modules", "pkg", "index.js");
		writeFileSync(filePath, "original");

		await harness.session.bindExtensions({});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("edit", { path: filePath }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("test");

		// node_modules file must be editable without prior read.
		expect(editExecutions).toBe(1);
	});

	it("allows repeated bash sed -i on same file", async () => {
		let cwd = "";
		let bashExecutions = 0;

		const readTool: AgentTool = {
			name: "read",
			label: "Read",
			description: "Read file",
			parameters: Type.Object({ path: Type.String() }),
			execute: async (_id, params) => {
				const p = (params as { path: string }).path;
				const content = readFileSync(p, "utf-8");
				return { content: [{ type: "text", text: content }], details: {} };
			},
		};

		const bashTool: AgentTool = {
			name: "bash",
			label: "Bash",
			description: "Run command",
			parameters: Type.Object({ command: Type.String() }),
			execute: async () => {
				bashExecutions++;
				// Simulate sed -i by writing to the file (changes mtime).
				writeFileSync(join(cwd, "data.txt"), `modified-v${bashExecutions}`);
				return { content: [{ type: "text", text: "done" }], details: {} };
			},
		};

		const harness = await createHarness({
			tools: [readTool, bashTool],
			extensionFactories: [fileTimeGuardFactory],
		});
		harnesses.push(harness);
		cwd = harness.tempDir;

		const filePath = join(cwd, "data.txt");
		writeFileSync(filePath, "original");
		ageFile(filePath);

		await harness.session.bindExtensions({});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("read", { path: filePath }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("bash", { command: "sed -i 's/a/b/' data.txt" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage(fauxToolCall("bash", { command: "sed -i 's/b/c/' data.txt" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("test");

		// Both bash sed -i calls must execute — the second must NOT be blocked.
		expect(bashExecutions).toBe(2);
	});
});

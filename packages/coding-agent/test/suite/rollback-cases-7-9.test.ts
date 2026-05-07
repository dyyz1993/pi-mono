import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../../src/core/session-manager.js";
import { createHarness, type Harness } from "./harness.js";

function readFile(tempDir: string, relativePath: string): string {
	const absolute = join(tempDir, relativePath);
	return existsSync(absolute) ? readFileSync(absolute, "utf-8") : "";
}

function writeFile(tempDir: string, relativePath: string, content: string): void {
	const absolute = join(tempDir, relativePath);
	mkdirSync(join(absolute, ".."), { recursive: true });
	writeFileSync(absolute, content, "utf-8");
}

function deleteFile(tempDir: string, relativePath: string): void {
	const absolute = join(tempDir, relativePath);
	if (existsSync(absolute)) {
		rmSync(absolute);
	}
}

function isOnPathTo(
	entries: Array<{ id: string; parentId: string | null }>,
	startId: string | null,
	targetId: string,
): boolean {
	if (!startId) return false;
	const byId = new Map(entries.map((e) => [e.id, e]));
	let current: string | null = startId;
	while (current !== null) {
		if (current === targetId) return true;
		const entry = byId.get(current);
		if (!entry) break;
		current = entry.parentId;
	}
	return false;
}

function findSnapshotsOnPath(
	entries: Array<{ id: string; parentId: string | null; type: string; customType?: string; data?: unknown }>,
	leafId: string | null,
): Map<string, string> {
	const result = new Map<string, string>();
	if (!leafId) return result;

	const snapEntries = entries.filter(
		(e) => e.type === "custom" && e.customType === "file-snapshot" && isOnPathTo(entries, leafId, e.id),
	);

	for (const entry of snapEntries) {
		if (entry.type !== "custom") continue;
		const data = entry.data as { path?: string; content?: string };
		if (data?.path && data.content !== undefined) {
			result.set(data.path, data.content);
		}
	}
	return result;
}

function createSnapshotAndRestoreExtension() {
	return (pi: import("../../src/core/extensions/types.js").ExtensionAPI) => {
		pi.on("tool_result", async (event, ctx) => {
			if (event.toolName === "write" || event.toolName === "edit") {
				const path = event.input?.path as string | undefined;
				if (path) {
					try {
						pi.appendEntry("file-snapshot", {
							path,
							content: readFileSync(join(ctx.cwd, path), "utf-8"),
						});
					} catch {
						// ignore
					}
				}
			}
		});

		pi.on("session_tree", async (event, ctx) => {
			const targetId = event.newLeafId;
			if (!targetId) return;

			const entries = ctx.sessionManager.getEntries();
			const targetFiles = findSnapshotsOnPath(entries, targetId);
			const currentFiles = findSnapshotsOnPath(entries, event.oldLeafId);
			const filesToRestore = new Map<string, string | undefined>();
			for (const [path, content] of targetFiles) {
				filesToRestore.set(path, content);
			}
			for (const path of currentFiles.keys()) {
				if (!targetFiles.has(path)) {
					filesToRestore.set(path, undefined);
				}
			}

			if (filesToRestore.size === 0) return;

			for (const [path, content] of filesToRestore) {
				if (content === undefined) {
					deleteFile(ctx.cwd, path);
				} else {
					writeFile(ctx.cwd, path, content);
				}
			}
		});
	};
}

function compactionExtension() {
	return (pi: import("../../src/core/extensions/types.js").ExtensionAPI) => {
		pi.on("session_before_compact", async (event) => ({
			compaction: {
				summary: `compacted: ${event.preparation.firstKeptEntryId}`,
				firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
				details: {},
			},
		}));
	};
}

describe("rollback cases 7-9", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	describe("Case 7a: fork does not carry file snapshots", () => {
		it("forked session has independent snapshot index via SessionManager", async () => {
			const sm = SessionManager.inMemory();

			sm.appendMessage({
				role: "user",
				content: [{ type: "text", text: "turn 1" }],
				timestamp: Date.now(),
			});
			sm.appendMessage({
				role: "assistant",
				content: [{ type: "text", text: "response 1" }],
				timestamp: Date.now(),
			});

			const turn1LeafId = sm.getLeafId()!;
			expect(turn1LeafId).toBeTruthy();

			sm.appendMessage({
				role: "user",
				content: [{ type: "text", text: "turn 2" }],
				timestamp: Date.now(),
			});
			sm.appendMessage({
				role: "assistant",
				content: [{ type: "text", text: "response 2" }],
				timestamp: Date.now(),
			});

			const originalBranch = sm.getBranch();
			expect(originalBranch.filter((e) => e.type === "message").length).toBe(4);

			sm.branch(turn1LeafId);

			sm.appendMessage({
				role: "user",
				content: [{ type: "text", text: "fork turn" }],
				timestamp: Date.now(),
			});
			sm.appendMessage({
				role: "assistant",
				content: [{ type: "text", text: "fork response" }],
				timestamp: Date.now(),
			});

			const forkBranch = sm.getBranch();
			const forkUserMsgs = forkBranch
				.filter((e) => e.type === "message" && e.message.role === "user")
				.map((e) => {
					const c = e.message.content;
					if (typeof c === "string") return c;
					return c
						.filter((p): p is { type: "text"; text: string } => p.type === "text")
						.map((p) => p.text)
						.join("");
				});
			expect(forkUserMsgs).toEqual(["turn 1", "fork turn"]);

			sm.branch(turn1LeafId);
			const rolledBackBranch = sm.getBranch();
			const rolledBackUserMsgs = rolledBackBranch
				.filter((e) => e.type === "message" && e.message.role === "user")
				.map((e) => {
					const c = e.message.content;
					if (typeof c === "string") return c;
					return c
						.filter((p): p is { type: "text"; text: string } => p.type === "text")
						.map((p) => p.text)
						.join("");
				});
			expect(rolledBackUserMsgs).toEqual(["turn 1"]);
		});
	});

	describe("Case 7b: fork rollback independent of original", () => {
		it("rollback in fork does not affect original session", async () => {
			const harness = await createHarness({
				extensionFactories: [createSnapshotAndRestoreExtension()],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "shared.ts", content: "original" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create shared.ts");

			const turn1LeafId = harness.sessionManager.getLeafId()!;

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "shared.ts", content: "modified" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("modify shared.ts");

			expect(readFile(harness.tempDir, "shared.ts")).toBe("modified");

			const originalMessages = harness.session.messages.length;
			const originalLeafId = harness.sessionManager.getLeafId();

			harness.sessionManager.branch(turn1LeafId);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "fork.ts", content: "fork-work" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("fork work");

			expect(readFile(harness.tempDir, "fork.ts")).toBe("fork-work");

			harness.sessionManager.branch(turn1LeafId);

			const context = harness.sessionManager.buildSessionContext();
			expect(context.messages.length).toBeLessThan(originalMessages + 2);

			expect(harness.sessionManager.getLeafId()).not.toBe(originalLeafId);
		});
	});

	describe("Case 7c: fork of fork works independently", () => {
		it("nested fork rollback does not affect parent fork or original", async () => {
			const harness = await createHarness({
				extensionFactories: [createSnapshotAndRestoreExtension()],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "root.ts", content: "root" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create root.ts");

			const rootLeafId = harness.sessionManager.getLeafId()!;

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "fork1.ts", content: "f1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("fork1 work");

			const fork1LeafId = harness.sessionManager.getLeafId()!;

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "fork2.ts", content: "f2" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("fork2 work");

			const originalEntries = harness.sessionManager.getEntries().length;

			harness.sessionManager.branch(fork1LeafId);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "nested.ts", content: "nested" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("nested fork work");

			expect(readFile(harness.tempDir, "nested.ts")).toBe("nested");

			harness.sessionManager.branch(rootLeafId);

			const rootBranch = harness.sessionManager.getBranch();
			const rootBranchUserMsgs = rootBranch.filter((e) => e.type === "message" && e.message.role === "user");
			expect(rootBranchUserMsgs.length).toBe(1);

			harness.sessionManager.branch(fork1LeafId);
			const fork1Branch = harness.sessionManager.getBranch();
			const fork1UserMsgs = fork1Branch.filter((e) => e.type === "message" && e.message.role === "user");
			expect(fork1UserMsgs.length).toBe(2);

			expect(harness.sessionManager.getEntries().length).toBeGreaterThanOrEqual(originalEntries);
		});
	});

	describe("Case 8: rollback across multiple compactions", () => {
		it("rollback past two compactions restores original messages and file state", async () => {
			const harness = await createHarness({
				extensionFactories: [createSnapshotAndRestoreExtension(), compactionExtension()],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "case8.ts", content: "turn1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("turn 1");

			expect(readFile(harness.tempDir, "case8.ts")).toBe("turn1");

			const turn1LeafId = harness.sessionManager.getLeafId()!;

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "case8.ts", content: "turn2" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("turn 2");

			expect(readFile(harness.tempDir, "case8.ts")).toBe("turn2");

			await harness.session.compact();

			let compactionEntries = harness.sessionManager.getEntries().filter((e) => e.type === "compaction");
			expect(compactionEntries.length).toBe(1);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "case8.ts", content: "turn3" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("turn 3");

			expect(readFile(harness.tempDir, "case8.ts")).toBe("turn3");

			await harness.session.compact();

			compactionEntries = harness.sessionManager.getEntries().filter((e) => e.type === "compaction");
			expect(compactionEntries.length).toBe(2);

			await harness.session.navigateTree(turn1LeafId, { summarize: false });

			const messages = harness.session.messages;
			expect(messages.some((m) => m.role === "compactionSummary")).toBe(false);

			expect(readFile(harness.tempDir, "case8.ts")).toBe("turn1");
		});
	});

	describe("Case 9: rollback, continue, rollback again", () => {
		it("second rollback restores same state as first rollback", async () => {
			const harness = await createHarness({
				extensionFactories: [createSnapshotAndRestoreExtension(), compactionExtension()],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "case9.ts", content: "initial" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("turn 1");

			expect(readFile(harness.tempDir, "case9.ts")).toBe("initial");

			const turn1LeafId = harness.sessionManager.getLeafId()!;

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "case9.ts", content: "modified" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("turn 2");

			expect(readFile(harness.tempDir, "case9.ts")).toBe("modified");

			await harness.session.navigateTree(turn1LeafId, { summarize: false });

			expect(readFile(harness.tempDir, "case9.ts")).toBe("initial");

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "case9.ts", content: "turn3-work" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("turn 3");

			expect(readFile(harness.tempDir, "case9.ts")).toBe("turn3-work");

			const messagesAfterTurn3 = harness.session.messages.length;

			await harness.session.navigateTree(turn1LeafId, { summarize: false });

			expect(readFile(harness.tempDir, "case9.ts")).toBe("initial");

			const messagesAfterSecondRollback = harness.session.messages.length;
			expect(messagesAfterSecondRollback).toBeLessThan(messagesAfterTurn3);

			const userMsgs = harness.session.messages.filter((m) => m.role === "user");
			const userTexts = userMsgs.map((m) => {
				if (typeof m.content === "string") return m.content;
				return m.content
					.filter((p): p is { type: "text"; text: string } => p.type === "text")
					.map((p) => p.text)
					.join("");
			});
			expect(userTexts).toEqual(["turn 1"]);
		});
	});
});

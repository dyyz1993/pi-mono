import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.js";

function readFile(tempDir: string, p: string): string {
	const abs = join(tempDir, p);
	return existsSync(abs) ? readFileSync(abs, "utf-8") : "";
}

function fileExists(tempDir: string, p: string): boolean {
	return existsSync(join(tempDir, p));
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
					} catch {}
				}
			}
		});
		pi.on("session_tree", async (event, ctx) => {
			if (event.skipFiles) return;
			const targetId = event.newLeafId;
			if (!targetId) return;
			const entries = ctx.sessionManager.getEntries();
			const byId = new Map(entries.map((e) => [e.id, e]));
			const targetSnapshots = new Map<string, string>();
			const currentSnapshots = new Map<string, string>();
			const collectSnapshots = (leafId: string | null, target: Map<string, string>) => {
				if (!leafId) return;
				let cur: string | null = leafId;
				while (cur) {
					const entry = byId.get(cur);
					if (!entry) break;
					if (entry.type === "custom" && (entry as any).customType === "file-snapshot") {
						const data = entry.data as { path?: string; content?: string };
						if (data?.path && data.content !== undefined && !target.has(data.path)) {
							target.set(data.path, data.content);
						}
					}
					cur = entry.parentId;
				}
			};
			collectSnapshots(targetId, targetSnapshots);
			collectSnapshots(event.oldLeafId, currentSnapshots);
			for (const [path, content] of targetSnapshots) {
				const abs = join(ctx.cwd, path);
				mkdirSync(join(abs, ".."), { recursive: true });
				writeFileSync(abs, content, "utf-8");
			}
			for (const path of currentSnapshots.keys()) {
				if (!targetSnapshots.has(path)) {
					const abs = join(ctx.cwd, path);
					if (existsSync(abs)) rmSync(abs);
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

describe("AgentSession rollback API integration", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	async function doWriteTurn(h: Harness, prompt: string, path: string, content: string) {
		h.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path, content }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await h.session.prompt(prompt);
		return h.sessionManager.getLeafId()!;
	}

	describe("sessionManager.getTree / getBranch", () => {
		it("getEntries returns growing tree after each turn", async () => {
			const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
			harnesses.push(h);

			const count0 = h.sessionManager.getEntries().length;

			await doWriteTurn(h, "T1", "a.ts", "a1");
			const count1 = h.sessionManager.getEntries().length;
			expect(count1).toBeGreaterThan(count0);

			await doWriteTurn(h, "T2", "b.ts", "b1");
			const count2 = h.sessionManager.getEntries().length;
			expect(count2).toBeGreaterThan(count1);

			await doWriteTurn(h, "T3", "c.ts", "c1");
			const count3 = h.sessionManager.getEntries().length;
			expect(count3).toBeGreaterThan(count2);
		});

		it("getLeafId returns current leaf after each turn", async () => {
			const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
			harnesses.push(h);

			const t1 = await doWriteTurn(h, "T1", "a.ts", "a1");
			expect(h.sessionManager.getLeafId()).toBe(t1);

			const t2 = await doWriteTurn(h, "T2", "b.ts", "b1");
			expect(h.sessionManager.getLeafId()).toBe(t2);
			expect(t2).not.toBe(t1);
		});

		it("getBranch returns only entries on active path", async () => {
			const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
			harnesses.push(h);

			const t1 = await doWriteTurn(h, "T1", "a.ts", "a1");
			await doWriteTurn(h, "T2", "b.ts", "b1");
			const t3 = await doWriteTurn(h, "T3", "c.ts", "c1");

			const branchBefore = h.sessionManager.getBranch();
			const msgCountBefore = branchBefore.filter((e) => e.type === "message").length;

			await h.session.navigateTree(t1, { summarize: false });

			const branchAfter = h.sessionManager.getBranch();
			const msgCountAfter = branchAfter.filter((e) => e.type === "message").length;
			expect(msgCountAfter).toBeLessThan(msgCountBefore);

			const userMsgs = branchAfter.filter((e) => e.type === "message" && e.message.role === "user");
			expect(userMsgs.length).toBe(1);
		});
	});

	describe("session.messages (equivalent to getMessages)", () => {
		it("reflects current state after rollback", async () => {
			const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
			harnesses.push(h);

			const t1 = await doWriteTurn(h, "T1", "a.ts", "a1");
			await doWriteTurn(h, "T2", "b.ts", "b1");
			await doWriteTurn(h, "T3", "c.ts", "c1");

			const msgs3 = h.session.messages.filter((m) => m.role === "user");
			expect(msgs3.length).toBe(3);

			await h.session.navigateTree(t1, { summarize: false });
			const msgs1 = h.session.messages.filter((m) => m.role === "user");
			expect(msgs1.length).toBe(1);
		});

		it("reflects state after compaction", async () => {
			const h = await createHarness({
				extensionFactories: [createSnapshotAndRestoreExtension(), compactionExtension()],
			});
			harnesses.push(h);

			await doWriteTurn(h, "T1", "a.ts", "a1");
			await doWriteTurn(h, "T2", "b.ts", "b1");
			await doWriteTurn(h, "T3", "c.ts", "c1");

			await h.session.compact();
			const hasCompaction = h.session.messages.some((m) => m.role === "compactionSummary");
			expect(hasCompaction).toBe(true);
		});
	});

	describe("previewRollback", () => {
		it("returns restored/deleted arrays", async () => {
			const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
			harnesses.push(h);

			const t1 = await doWriteTurn(h, "T1", "a.ts", "a1");
			await doWriteTurn(h, "T2", "a.ts", "a2");

			const preview = await h.session.previewRollback(t1);
			expect(preview).toHaveProperty("restored");
			expect(preview).toHaveProperty("deleted");
			expect(Array.isArray(preview.restored)).toBe(true);
		});
	});

	describe("navigateTree", () => {
		it("skipFiles=true leaves files untouched", async () => {
			const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
			harnesses.push(h);

			const t1 = await doWriteTurn(h, "T1", "a.ts", "a1");
			await doWriteTurn(h, "T2", "a.ts", "a2");
			await doWriteTurn(h, "T3", "b.ts", "b1");

			await h.session.navigateTree(t1, { summarize: false, skipFiles: true });
			expect(readFile(h.tempDir, "a.ts")).toBe("a2");
			expect(fileExists(h.tempDir, "b.ts")).toBe(true);
		});

		it("skipFiles=false (default) restores files", async () => {
			const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
			harnesses.push(h);

			const t1 = await doWriteTurn(h, "T1", "a.ts", "a1");
			await doWriteTurn(h, "T2", "a.ts", "a2");
			await doWriteTurn(h, "T3", "b.ts", "b1");

			await h.session.navigateTree(t1, { summarize: false });
			expect(readFile(h.tempDir, "a.ts")).toBe("a1");
			expect(fileExists(h.tempDir, "b.ts")).toBe(false);
		});

		it("returns cancelled:false on success", async () => {
			const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
			harnesses.push(h);

			const t1 = await doWriteTurn(h, "T1", "a.ts", "a1");
			await doWriteTurn(h, "T2", "b.ts", "b1");

			const result = await h.session.navigateTree(t1, { summarize: false });
			expect(result.cancelled).toBe(false);
		});

		it("no-op returns cancelled:false when targeting current leaf", async () => {
			const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
			harnesses.push(h);

			const t1 = await doWriteTurn(h, "T1", "a.ts", "a1");
			const result = await h.session.navigateTree(t1, { summarize: false });
			expect(result.cancelled).toBe(false);
		});
	});

	describe("sessionManager: getUserMessagesForForking", () => {
		it("returns all user messages with entryId and text", async () => {
			const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
			harnesses.push(h);

			await doWriteTurn(h, "T1", "a.ts", "a1");
			await doWriteTurn(h, "T2", "b.ts", "b1");

			const msgs = h.session.getUserMessagesForForking();
			expect(msgs.length).toBe(2);
			for (const m of msgs) {
				expect(m.entryId).toBeTruthy();
				expect(m.text).toBeTruthy();
			}
		});
	});

	describe("end-to-end: snapshot panel workflow simulation", () => {
		it("Scenario: user opens panel, browses turns, previews, then rolls back", async () => {
			const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
			harnesses.push(h);

			const t1 = await doWriteTurn(h, "create app.ts", "app.ts", "app-v1");
			const t2 = await doWriteTurn(h, "add utils.ts", "utils.ts", "utils-v1");
			const t3 = await doWriteTurn(h, "modify app.ts", "app.ts", "app-v2");

			const entries = h.sessionManager.getEntries();
			expect(entries.length).toBeGreaterThan(6);
			expect(h.sessionManager.getLeafId()).toBeTruthy();

			const preview = await h.session.previewRollback(t2);
			expect(Array.isArray(preview.restored)).toBe(true);

			await h.session.navigateTree(t2, { summarize: false });
			expect(readFile(h.tempDir, "app.ts")).toBe("app-v1");
			expect(readFile(h.tempDir, "utils.ts")).toBe("utils-v1");
			expect(fileExists(h.tempDir, "app.ts")).toBe(true);
		});

		it("Scenario: rollback → continue → rollback again → fork", async () => {
			const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
			harnesses.push(h);

			const t1 = await doWriteTurn(h, "T1", "main.ts", "v1");
			const t2 = await doWriteTurn(h, "T2", "main.ts", "v2");
			await doWriteTurn(h, "T3", "main.ts", "v3");

			await h.session.navigateTree(t1, { summarize: false });
			expect(readFile(h.tempDir, "main.ts")).toBe("v1");

			await doWriteTurn(h, "T4", "main.ts", "v4");

			await h.session.navigateTree(t2, { summarize: false });
			expect(readFile(h.tempDir, "main.ts")).toBe("v2");

			const forkMsgs = h.session.getUserMessagesForForking();
			expect(forkMsgs.length).toBeGreaterThanOrEqual(2);
		});

		it("Scenario: full lifecycle with tree inspection at every step", async () => {
			const h = await createHarness({
				extensionFactories: [createSnapshotAndRestoreExtension(), compactionExtension()],
			});
			harnesses.push(h);

			const t1 = await doWriteTurn(h, "init", "app.ts", "initial");
			const t2 = await doWriteTurn(h, "feat A", "feat-a.ts", "feat-a");
			const t3 = await doWriteTurn(h, "feat B", "feat-b.ts", "feat-b");

			expect(h.sessionManager.getLeafId()).toBe(t3);

			await h.session.navigateTree(t2, { summarize: false });
			expect(readFile(h.tempDir, "app.ts")).toBe("initial");
			expect(readFile(h.tempDir, "feat-a.ts")).toBe("feat-a");
			expect(fileExists(h.tempDir, "feat-b.ts")).toBe(false);
			expect(h.sessionManager.getLeafId()).not.toBe(t3);

			await doWriteTurn(h, "feat C", "feat-c.ts", "feat-c");
			await doWriteTurn(h, "feat D", "feat-d.ts", "feat-d");

			await h.session.compact();

			const msgs = h.session.messages;
			expect(msgs.some((m) => m.role === "compactionSummary")).toBe(true);

			await h.session.navigateTree(t1, { summarize: false });
			expect(readFile(h.tempDir, "app.ts")).toBe("initial");
			expect(fileExists(h.tempDir, "feat-a.ts")).toBe(false);
			expect(fileExists(h.tempDir, "feat-b.ts")).toBe(false);
			expect(fileExists(h.tempDir, "feat-c.ts")).toBe(false);

			const finalMsgs = h.session.messages;
			const finalUserMsgs = finalMsgs.filter((m) => m.role === "user");
			expect(finalUserMsgs.length).toBe(1);
		});
	});
});

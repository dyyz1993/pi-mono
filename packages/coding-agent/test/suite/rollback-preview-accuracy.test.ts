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
			if (!targetId && !event.newLeafId === false) {
				// rollback to root — still need to compute preview
			}
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

			const restored: string[] = [];
			const deleted: string[] = [];

			for (const [path, content] of targetSnapshots) {
				const currentContent = currentSnapshots.get(path);
				if (currentContent !== content) {
					restored.push(path);
				}
			}
			for (const path of currentSnapshots.keys()) {
				if (!targetSnapshots.has(path)) {
					deleted.push(path);
				}
			}

			if (event.preview) {
				return { restored, deleted };
			}

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

			return { restored, deleted };
		});
	};
}

describe("previewRollback accuracy", () => {
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

	it("preview matches actual rollback for modified file", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doWriteTurn(h, "T1", "a.ts", "v1");
		await doWriteTurn(h, "T2", "a.ts", "v2");

		const preview = await h.session.previewRollback(t1);
		expect(preview.restored).toContain("a.ts");
		expect(preview.deleted).toHaveLength(0);

		await h.session.navigateTree(t1, { summarize: false });
		expect(readFile(h.tempDir, "a.ts")).toBe("v1");
	});

	it("preview matches actual rollback for multiple file changes", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doWriteTurn(h, "T1", "a.ts", "v1");
		const t2 = await doWriteTurn(h, "T2", "a.ts", "v2");
		await doWriteTurn(h, "T3", "b.ts", "b1");

		const preview = await h.session.previewRollback(t1);
		expect(preview.restored).toContain("a.ts");
		expect(preview.deleted).toContain("b.ts");

		await h.session.navigateTree(t1, { summarize: false });
		expect(readFile(h.tempDir, "a.ts")).toBe("v1");
		expect(fileExists(h.tempDir, "b.ts")).toBe(false);
	});

	it("preview matches actual rollback for added file", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doWriteTurn(h, "T1", "a.ts", "v1");
		await doWriteTurn(h, "T2", "b.ts", "b1");

		const preview = await h.session.previewRollback(t1);
		expect(preview.deleted).toContain("b.ts");

		await h.session.navigateTree(t1, { summarize: false });
		expect(fileExists(h.tempDir, "b.ts")).toBe(false);
	});

	it("preview matches actual rollback for multiple file changes across 3 turns", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doWriteTurn(h, "T1", "a.ts", "v1");
		await doWriteTurn(h, "T2", "a.ts", "v2");
		h.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "a.ts", content: "v3" }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("write", { path: "c.ts", content: "c1" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await h.session.prompt("T3");

		const preview = await h.session.previewRollback(t1);
		expect(preview.restored).toContain("a.ts");
		expect(preview.deleted).toContain("c.ts");

		await h.session.navigateTree(t1, { summarize: false });
		expect(readFile(h.tempDir, "a.ts")).toBe("v1");
		expect(fileExists(h.tempDir, "c.ts")).toBe(false);
	});

	it("preview for no-op rollback (target = current leaf)", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doWriteTurn(h, "T1", "a.ts", "v1");

		const preview = await h.session.previewRollback(t1);
		expect(preview.restored).toHaveLength(0);
		expect(preview.deleted).toHaveLength(0);
	});

	it("preview does not modify files on disk", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doWriteTurn(h, "T1", "a.ts", "v1");
		await doWriteTurn(h, "T2", "a.ts", "v2");

		await h.session.previewRollback(t1);
		expect(readFile(h.tempDir, "a.ts")).toBe("v2");
	});

	it("preview after preview returns same result", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doWriteTurn(h, "T1", "a.ts", "v1");
		await doWriteTurn(h, "T2", "a.ts", "v2");

		const preview1 = await h.session.previewRollback(t1);
		const preview2 = await h.session.previewRollback(t1);
		expect(preview1.restored).toEqual(preview2.restored);
		expect(preview1.deleted).toEqual(preview2.deleted);
	});
});

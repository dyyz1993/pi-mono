import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.js";

function readFile(tempDir: string, p: string): string {
	const abs = join(tempDir, p);
	return existsSync(abs) ? readFileSync(abs, "utf-8") : "";
}

function writeFile(tempDir: string, p: string, content: string): void {
	const abs = join(tempDir, p);
	mkdirSync(join(abs, ".."), { recursive: true });
	writeFileSync(abs, content, "utf-8");
}

function deleteFile(tempDir: string, p: string): void {
	const abs = join(tempDir, p);
	if (existsSync(abs)) rmSync(abs);
}

function fileExists(tempDir: string, p: string): boolean {
	return existsSync(join(tempDir, p));
}

function isOnPathTo(
	entries: Array<{ id: string; parentId: string | null }>,
	startId: string | null,
	targetId: string,
): boolean {
	if (!startId) return false;
	const byId = new Map(entries.map((e) => [e.id, e]));
	let cur: string | null = startId;
	while (cur !== null) {
		if (cur === targetId) return true;
		const e = byId.get(cur);
		if (!e) break;
		cur = e.parentId;
	}
	return false;
}

function findSnapshotsOnPath(
	entries: Array<{ id: string; parentId: string | null; type: string; customType?: string; data?: unknown }>,
	leafId: string | null,
): Map<string, string> {
	const result = new Map<string, string>();
	if (!leafId) return result;
	for (const entry of entries.filter(
		(e) => e.type === "custom" && e.customType === "file-snapshot" && isOnPathTo(entries, leafId, e.id),
	)) {
		const data = entry.data as { path?: string; content?: string };
		if (data?.path && data.content !== undefined) result.set(data.path, data.content);
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
					} catch {}
				}
			}
		});
		pi.on("session_tree", async (event, ctx) => {
			if (event.skipFiles) return;
			const targetId = event.newLeafId;
			if (!targetId) return;
			const entries = ctx.sessionManager.getEntries();
			const targetFiles = findSnapshotsOnPath(entries, targetId);
			const currentFiles = findSnapshotsOnPath(entries, event.oldLeafId);
			const toRestore = new Map<string, string | undefined>();
			for (const [p, c] of targetFiles) toRestore.set(p, c);
			for (const p of currentFiles.keys()) {
				if (!targetFiles.has(p)) toRestore.set(p, undefined);
			}
			if (toRestore.size === 0) return;
			for (const [p, c] of toRestore) {
				if (c === undefined) deleteFile(ctx.cwd, p);
				else writeFile(ctx.cwd, p, c);
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

function getUserTexts(harness: Harness): string[] {
	return harness.session.messages
		.filter((m) => m.role === "user")
		.map((m) => {
			if (typeof m.content === "string") return m.content;
			return (m.content as Array<{ type: string; text?: string }>)
				.filter((p) => p.type === "text")
				.map((p) => p.text ?? "")
				.join("");
		});
}

function getAssistantTexts(harness: Harness): string[] {
	return harness.session.messages
		.filter((m) => m.role === "assistant")
		.map((m) => {
			if (typeof m.content === "string") return m.content;
			return (m.content as Array<{ type: string; text?: string }>)
				.filter((p) => p.type === "text")
				.map((p) => p.text ?? "")
				.join("");
		});
}

async function doTurn(
	harness: Harness,
	prompt: string,
	toolCalls: Array<{ tool: string; input: Record<string, string> }>,
	finalText: string,
) {
	const steps = toolCalls.map((tc) => fauxToolCall(tc.tool, tc.input));
	const responses = [fauxAssistantMessage(steps[0], { stopReason: steps.length > 1 ? "toolUse" : undefined })];
	for (let i = 1; i < steps.length; i++) {
		responses.push(fauxAssistantMessage(steps[i], { stopReason: i < steps.length - 1 ? "toolUse" : undefined }));
	}
	if (finalText) {
		responses.push(fauxAssistantMessage(finalText));
	}
	harness.setResponses(responses);
	await harness.session.prompt(prompt);
	return harness.sessionManager.getLeafId()!;
}

describe("complex rollback chains", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("Chain A: rollback→continue→rollback→continue→rollback, verify files at each step", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doTurn(h, "T1", [{ tool: "write", input: { path: "main.ts", content: "v1" } }], "done");
		expect(readFile(h.tempDir, "main.ts")).toBe("v1");

		const t2 = await doTurn(h, "T2", [{ tool: "write", input: { path: "main.ts", content: "v2" } }], "done");
		expect(readFile(h.tempDir, "main.ts")).toBe("v2");

		const t3 = await doTurn(
			h,
			"T3",
			[
				{ tool: "write", input: { path: "main.ts", content: "v3" } },
				{ tool: "write", input: { path: "util.ts", content: "util-v1" } },
			],
			"done",
		);
		expect(readFile(h.tempDir, "main.ts")).toBe("v3");
		expect(readFile(h.tempDir, "util.ts")).toBe("util-v1");

		await h.session.navigateTree(t2, { summarize: false });
		expect(readFile(h.tempDir, "main.ts")).toBe("v2");
		expect(fileExists(h.tempDir, "util.ts")).toBe(false);
		expect(getUserTexts(h)).toEqual(["T1", "T2"]);

		const t4 = await doTurn(
			h,
			"T4",
			[
				{ tool: "write", input: { path: "main.ts", content: "v4" } },
				{ tool: "write", input: { path: "extra.ts", content: "extra-v1" } },
			],
			"done",
		);
		expect(readFile(h.tempDir, "main.ts")).toBe("v4");
		expect(readFile(h.tempDir, "extra.ts")).toBe("extra-v1");
		expect(getUserTexts(h)).toEqual(["T1", "T2", "T4"]);

		await h.session.navigateTree(t1, { summarize: false });
		expect(readFile(h.tempDir, "main.ts")).toBe("v1");
		expect(fileExists(h.tempDir, "extra.ts")).toBe(false);
		expect(getUserTexts(h)).toEqual(["T1"]);

		const t5 = await doTurn(h, "T5", [{ tool: "write", input: { path: "main.ts", content: "v5" } }], "done");
		expect(readFile(h.tempDir, "main.ts")).toBe("v5");
		expect(getUserTexts(h)).toEqual(["T1", "T5"]);

		await h.session.navigateTree(t4, { summarize: false });
		expect(readFile(h.tempDir, "main.ts")).toBe("v4");
		expect(readFile(h.tempDir, "extra.ts")).toBe("extra-v1");
		expect(getUserTexts(h)).toEqual(["T1", "T2", "T4"]);
	});

	it("Chain B: skipFiles rollback preserves files, file rollback restores files", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		await doTurn(h, "T1", [{ tool: "write", input: { path: "a.ts", content: "a1" } }], "done");
		const t1 = h.sessionManager.getLeafId()!;

		await doTurn(h, "T2", [{ tool: "write", input: { path: "b.ts", content: "b1" } }], "done");
		const t2 = h.sessionManager.getLeafId()!;

		await doTurn(
			h,
			"T3",
			[
				{ tool: "write", input: { path: "a.ts", content: "a2" } },
				{ tool: "write", input: { path: "b.ts", content: "b2" } },
			],
			"done",
		);
		expect(readFile(h.tempDir, "a.ts")).toBe("a2");
		expect(readFile(h.tempDir, "b.ts")).toBe("b2");

		await h.session.navigateTree(t2, { summarize: false, skipFiles: true });
		expect(readFile(h.tempDir, "a.ts")).toBe("a2");
		expect(readFile(h.tempDir, "b.ts")).toBe("b2");
		expect(getUserTexts(h)).toEqual(["T1", "T2"]);

		await doTurn(h, "T4", [{ tool: "write", input: { path: "a.ts", content: "a3" } }], "done");
		expect(readFile(h.tempDir, "a.ts")).toBe("a3");
		expect(readFile(h.tempDir, "b.ts")).toBe("b2");

		await h.session.navigateTree(t1, { summarize: false });
		expect(readFile(h.tempDir, "a.ts")).toBe("a1");
		expect(fileExists(h.tempDir, "b.ts")).toBe(false);
		expect(getUserTexts(h)).toEqual(["T1"]);
	});

	it("Chain C: 5 turns with interleaved rollback and skipFiles", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doTurn(h, "T1", [{ tool: "write", input: { path: "x.ts", content: "x1" } }], "done");
		expect(readFile(h.tempDir, "x.ts")).toBe("x1");

		const t2 = await doTurn(h, "T2", [{ tool: "write", input: { path: "x.ts", content: "x2" } }], "done");
		expect(readFile(h.tempDir, "x.ts")).toBe("x2");

		const t3 = await doTurn(
			h,
			"T3",
			[
				{ tool: "write", input: { path: "x.ts", content: "x3" } },
				{ tool: "write", input: { path: "y.ts", content: "y1" } },
			],
			"done",
		);
		expect(readFile(h.tempDir, "x.ts")).toBe("x3");
		expect(readFile(h.tempDir, "y.ts")).toBe("y1");

		await h.session.navigateTree(t2, { summarize: false });
		expect(readFile(h.tempDir, "x.ts")).toBe("x2");
		expect(fileExists(h.tempDir, "y.ts")).toBe(false);
		expect(getUserTexts(h)).toEqual(["T1", "T2"]);

		const t4 = await doTurn(
			h,
			"T4",
			[
				{ tool: "write", input: { path: "x.ts", content: "x4" } },
				{ tool: "write", input: { path: "z.ts", content: "z1" } },
			],
			"done",
		);
		expect(readFile(h.tempDir, "x.ts")).toBe("x4");
		expect(readFile(h.tempDir, "z.ts")).toBe("z1");

		await h.session.navigateTree(t4, { summarize: false, skipFiles: true });
		expect(readFile(h.tempDir, "x.ts")).toBe("x4");
		expect(readFile(h.tempDir, "z.ts")).toBe("z1");
		expect(getUserTexts(h)).toEqual(["T1", "T2", "T4"]);

		await h.session.navigateTree(t3, { summarize: false });
		expect(readFile(h.tempDir, "x.ts")).toBe("x3");
		expect(readFile(h.tempDir, "y.ts")).toBe("y1");
		expect(fileExists(h.tempDir, "z.ts")).toBe(false);
		expect(getUserTexts(h)).toEqual(["T1", "T2", "T3"]);

		await h.session.navigateTree(t1, { summarize: false });
		expect(readFile(h.tempDir, "x.ts")).toBe("x1");
		expect(fileExists(h.tempDir, "y.ts")).toBe(false);
		expect(getUserTexts(h)).toEqual(["T1"]);
	});

	it("Chain D: compaction → rollback past compaction → continue → compact again → rollback", async () => {
		const h = await createHarness({
			extensionFactories: [createSnapshotAndRestoreExtension(), compactionExtension()],
		});
		harnesses.push(h);

		const t1 = await doTurn(h, "T1", [{ tool: "write", input: { path: "app.ts", content: "app-v1" } }], "done");
		const t2 = await doTurn(h, "T2", [{ tool: "write", input: { path: "app.ts", content: "app-v2" } }], "done");
		const t3 = await doTurn(h, "T3", [{ tool: "write", input: { path: "app.ts", content: "app-v3" } }], "done");

		await h.session.compact();
		const compactionCount1 = h.sessionManager.getEntries().filter((e) => e.type === "compaction").length;
		expect(compactionCount1).toBeGreaterThanOrEqual(1);

		expect(readFile(h.tempDir, "app.ts")).toBe("app-v3");

		await h.session.navigateTree(t2, { summarize: false });
		expect(readFile(h.tempDir, "app.ts")).toBe("app-v2");
		expect(getUserTexts(h)).toEqual(["T1", "T2"]);
		expect(h.session.messages.some((m) => m.role === "compactionSummary")).toBe(false);

		const t4 = await doTurn(h, "T4", [{ tool: "write", input: { path: "app.ts", content: "app-v4" } }], "done");
		expect(readFile(h.tempDir, "app.ts")).toBe("app-v4");

		await h.session.compact();
		expect(h.sessionManager.getEntries().filter((e) => e.type === "compaction").length).toBeGreaterThanOrEqual(2);

		await h.session.navigateTree(t1, { summarize: false });
		expect(readFile(h.tempDir, "app.ts")).toBe("app-v1");
		expect(getUserTexts(h)).toEqual(["T1"]);
		expect(h.session.messages.some((m) => m.role === "compactionSummary")).toBe(false);
	});

	it("Chain E: rollback to same point twice via different paths", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doTurn(h, "T1", [{ tool: "write", input: { path: "f.ts", content: "v1" } }], "done");
		const t2 = await doTurn(h, "T2", [{ tool: "write", input: { path: "f.ts", content: "v2" } }], "done");
		const t3 = await doTurn(h, "T3", [{ tool: "write", input: { path: "f.ts", content: "v3" } }], "done");

		await h.session.navigateTree(t2, { summarize: false });
		expect(readFile(h.tempDir, "f.ts")).toBe("v2");

		await doTurn(h, "T4a", [{ tool: "write", input: { path: "f.ts", content: "v4a" } }], "done");

		await h.session.navigateTree(t2, { summarize: false });
		expect(readFile(h.tempDir, "f.ts")).toBe("v2");
		expect(getUserTexts(h)).toEqual(["T1", "T2"]);

		await doTurn(h, "T4b", [{ tool: "write", input: { path: "f.ts", content: "v4b" } }], "done");

		await h.session.navigateTree(t2, { summarize: false });
		expect(readFile(h.tempDir, "f.ts")).toBe("v2");
		expect(getUserTexts(h)).toEqual(["T1", "T2"]);
	});

	it("Chain F: nested subdirectory rollback with add/modify/delete across turns", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doTurn(
			h,
			"T1",
			[{ tool: "write", input: { path: "src/index.ts", content: "index-v1" } }],
			"done",
		);
		expect(readFile(h.tempDir, "src/index.ts")).toBe("index-v1");

		const t2 = await doTurn(
			h,
			"T2",
			[
				{ tool: "write", input: { path: "src/index.ts", content: "index-v2" } },
				{ tool: "write", input: { path: "src/utils/helper.ts", content: "helper-v1" } },
			],
			"done",
		);
		expect(readFile(h.tempDir, "src/index.ts")).toBe("index-v2");
		expect(readFile(h.tempDir, "src/utils/helper.ts")).toBe("helper-v1");

		const t3 = await doTurn(
			h,
			"T3",
			[
				{ tool: "write", input: { path: "src/index.ts", content: "index-v3" } },
				{ tool: "write", input: { path: "src/utils/helper.ts", content: "helper-v2" } },
				{ tool: "write", input: { path: "src/types.d.ts", content: "declare module" } },
			],
			"done",
		);
		expect(readFile(h.tempDir, "src/index.ts")).toBe("index-v3");
		expect(readFile(h.tempDir, "src/utils/helper.ts")).toBe("helper-v2");
		expect(readFile(h.tempDir, "src/types.d.ts")).toBe("declare module");

		await h.session.navigateTree(t1, { summarize: false });
		expect(readFile(h.tempDir, "src/index.ts")).toBe("index-v1");
		expect(fileExists(h.tempDir, "src/utils/helper.ts")).toBe(false);
		expect(fileExists(h.tempDir, "src/types.d.ts")).toBe(false);
		expect(getUserTexts(h)).toEqual(["T1"]);

		await h.session.navigateTree(t3, { summarize: false });
		expect(readFile(h.tempDir, "src/index.ts")).toBe("index-v3");
		expect(readFile(h.tempDir, "src/utils/helper.ts")).toBe("helper-v2");
		expect(readFile(h.tempDir, "src/types.d.ts")).toBe("declare module");
		expect(getUserTexts(h)).toEqual(["T1", "T2", "T3"]);

		await h.session.navigateTree(t2, { summarize: false });
		expect(readFile(h.tempDir, "src/index.ts")).toBe("index-v2");
		expect(readFile(h.tempDir, "src/utils/helper.ts")).toBe("helper-v1");
		expect(fileExists(h.tempDir, "src/types.d.ts")).toBe(false);
		expect(getUserTexts(h)).toEqual(["T1", "T2"]);
	});

	it("Chain G: rollback creates new file, rollback again deletes it, rollback restores it", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doTurn(h, "T1", [{ tool: "write", input: { path: "a.ts", content: "a1" } }], "done");
		const t2 = await doTurn(
			h,
			"T2",
			[
				{ tool: "write", input: { path: "b.ts", content: "b1" } },
				{ tool: "write", input: { path: "a.ts", content: "a2" } },
			],
			"done",
		);

		await h.session.navigateTree(t1, { summarize: false });
		expect(readFile(h.tempDir, "a.ts")).toBe("a1");
		expect(fileExists(h.tempDir, "b.ts")).toBe(false);

		const t3 = await doTurn(h, "T3", [{ tool: "write", input: { path: "c.ts", content: "c1" } }], "done");
		expect(readFile(h.tempDir, "c.ts")).toBe("c1");
		expect(fileExists(h.tempDir, "b.ts")).toBe(false);

		await h.session.navigateTree(t2, { summarize: false });
		expect(readFile(h.tempDir, "a.ts")).toBe("a2");
		expect(readFile(h.tempDir, "b.ts")).toBe("b1");
		expect(fileExists(h.tempDir, "c.ts")).toBe(false);

		await h.session.navigateTree(t3, { summarize: false });
		expect(readFile(h.tempDir, "c.ts")).toBe("c1");
	});
});

describe("fork file isolation", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("Fork A: original and fork modify same file independently", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doTurn(
			h,
			"base",
			[{ tool: "write", input: { path: "shared.ts", content: "shared-base" } }],
			"done",
		);
		expect(readFile(h.tempDir, "shared.ts")).toBe("shared-base");

		await doTurn(
			h,
			"original-T2",
			[{ tool: "write", input: { path: "shared.ts", content: "original-mod" } }],
			"done",
		);
		expect(readFile(h.tempDir, "shared.ts")).toBe("original-mod");

		h.sessionManager.branch(t1);

		await doTurn(h, "fork-T2", [{ tool: "write", input: { path: "shared.ts", content: "fork-mod" } }], "done");
		expect(readFile(h.tempDir, "shared.ts")).toBe("fork-mod");

		await doTurn(
			h,
			"fork-T3",
			[{ tool: "write", input: { path: "fork-only.ts", content: "fork-exclusive" } }],
			"done",
		);
		expect(readFile(h.tempDir, "fork-only.ts")).toBe("fork-exclusive");

		h.sessionManager.branch(t1);
		const branchAfterReturn = h.sessionManager.getBranch();
		const branchUserTexts = branchAfterReturn
			.filter((e) => e.type === "message" && e.message.role === "user")
			.map((e) => {
				const c = e.message.content;
				if (typeof c === "string") return c;
				return c
					.filter((p): p is { type: "text"; text: string } => p.type === "text")
					.map((p) => p.text)
					.join("");
			});
		expect(branchUserTexts).toEqual(["base"]);

		await doTurn(
			h,
			"post-fork-return",
			[{ tool: "write", input: { path: "shared.ts", content: "post-fork" } }],
			"done",
		);
		expect(readFile(h.tempDir, "shared.ts")).toBe("post-fork");
		expect(fileExists(h.tempDir, "fork-only.ts")).toBe(true);
	});

	it("Fork B: rollback in fork branch does not pollute snapshot index for other branches", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doTurn(h, "T1", [{ tool: "write", input: { path: "f.ts", content: "v1" } }], "done");
		const t2 = await doTurn(h, "T2", [{ tool: "write", input: { path: "f.ts", content: "v2" } }], "done");
		const t3 = await doTurn(h, "T3", [{ tool: "write", input: { path: "f.ts", content: "v3" } }], "done");

		h.sessionManager.branch(t1);

		await doTurn(h, "fork-A", [{ tool: "write", input: { path: "f.ts", content: "fork-A-v" } }], "done");
		expect(readFile(h.tempDir, "f.ts")).toBe("fork-A-v");

		const forkALeaf = h.sessionManager.getLeafId()!;
		await h.session.navigateTree(t1, { summarize: false });
		expect(readFile(h.tempDir, "f.ts")).toBe("v1");

		await doTurn(h, "fork-B", [{ tool: "write", input: { path: "f.ts", content: "fork-B-v" } }], "done");
		expect(readFile(h.tempDir, "f.ts")).toBe("fork-B-v");

		h.sessionManager.branch(t2);
		expect(readFile(h.tempDir, "f.ts")).toBe("fork-B-v");

		await doTurn(h, "from-t2-continue", [{ tool: "write", input: { path: "f.ts", content: "from-t2-new" } }], "done");
		expect(readFile(h.tempDir, "f.ts")).toBe("from-t2-new");

		h.sessionManager.branch(forkALeaf);
		const branchEntries = h.sessionManager.getBranch();
		const branchUserTexts = branchEntries
			.filter((e) => e.type === "message" && e.message.role === "user")
			.map((e) => {
				const c = e.message.content;
				if (typeof c === "string") return c;
				return c
					.filter((p): p is { type: "text"; text: string } => p.type === "text")
					.map((p) => p.text)
					.join("");
			});
		expect(branchUserTexts).toEqual(["T1", "fork-A"]);
	});

	it("Fork C: fork→modify→rollback→new file→rollback, file states exact", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doTurn(h, "T1", [{ tool: "write", input: { path: "base.ts", content: "base-v1" } }], "done");
		const t2 = await doTurn(
			h,
			"T2",
			[
				{ tool: "write", input: { path: "base.ts", content: "base-v2" } },
				{ tool: "write", input: { path: "extra.ts", content: "extra-v1" } },
			],
			"done",
		);

		h.sessionManager.branch(t1);

		const forkT3 = await doTurn(
			h,
			"fork-T3",
			[
				{ tool: "write", input: { path: "base.ts", content: "fork-base-v3" } },
				{ tool: "write", input: { path: "fork-new.ts", content: "fork-new-v1" } },
			],
			"done",
		);
		expect(readFile(h.tempDir, "base.ts")).toBe("fork-base-v3");
		expect(readFile(h.tempDir, "fork-new.ts")).toBe("fork-new-v1");

		await h.session.navigateTree(t1, { summarize: false });
		expect(readFile(h.tempDir, "base.ts")).toBe("base-v1");
		expect(fileExists(h.tempDir, "fork-new.ts")).toBe(false);

		await doTurn(
			h,
			"fork-T4",
			[
				{ tool: "write", input: { path: "base.ts", content: "fork-another-v4" } },
				{ tool: "write", input: { path: "another.ts", content: "another-v1" } },
			],
			"done",
		);
		expect(readFile(h.tempDir, "base.ts")).toBe("fork-another-v4");
		expect(readFile(h.tempDir, "another.ts")).toBe("another-v1");

		h.sessionManager.branch(t2);
		expect(readFile(h.tempDir, "base.ts")).toBe("fork-another-v4");
		expect(fileExists(h.tempDir, "extra.ts")).toBe(true);
		expect(fileExists(h.tempDir, "fork-new.ts")).toBe(false);
		expect(fileExists(h.tempDir, "another.ts")).toBe(true);

		await h.session.navigateTree(t1, { summarize: false });
		expect(readFile(h.tempDir, "base.ts")).toBe("base-v1");
		expect(fileExists(h.tempDir, "extra.ts")).toBe(false);
	});
});

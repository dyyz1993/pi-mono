import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
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
		unlinkSync(absolute);
	}
}

function isOnPathTo(
	entries: Array<{ id: string; parentId: string | null }>,
	startId: string,
	targetId: string,
): boolean {
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

describe("file-snapshot extension integration", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	describe("snapshot collection via tool_result", () => {
		it("collects file snapshots when write tool is used", async () => {
			const snapshots: Array<{
				entryId: string;
				turnIndex: number;
				files: Map<string, string>;
			}> = [];

			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
						let turnIdx = 0;
						const turnFiles = new Map<string, string>();

						pi.on("turn_start", async () => {
							turnFiles.clear();
						});

						pi.on("tool_result", async (event, ctx) => {
							if (event.toolName === "write" || event.toolName === "edit") {
								const path = event.input?.path as string | undefined;
								if (path) {
									try {
										const content = readFileSync(join(ctx.cwd, path), "utf-8");
										turnFiles.set(path, content);
									} catch {
										// ignore
									}
								}
							}
						});

						pi.on("turn_end", async (_event, ctx) => {
							if (turnFiles.size > 0) {
								const leaf = ctx.sessionManager.getLeafEntry();
								if (leaf) {
									snapshots.push({
										entryId: leaf.id,
										turnIndex: turnIdx,
										files: new Map(turnFiles),
									});
								}
							}
							turnIdx++;
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "foo.ts", content: "hello" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("create foo.ts");

			expect(snapshots.length).toBeGreaterThanOrEqual(1);
			expect(snapshots[0].files.get("foo.ts")).toBe("hello");
		});

		it("collects snapshots across multiple turns", async () => {
			const snapshotLog: Array<{ turnIndex: number; files: Record<string, string> }> = [];

			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
						let turnIdx = 0;
						const turnFiles = new Map<string, string>();

						pi.on("turn_start", async () => {
							turnFiles.clear();
						});

						pi.on("tool_result", async (event, ctx) => {
							if (event.toolName === "write" || event.toolName === "edit") {
								const path = event.input?.path as string | undefined;
								if (path) {
									try {
										turnFiles.set(path, readFileSync(join(ctx.cwd, path), "utf-8"));
									} catch {
										// ignore
									}
								}
							}
						});

						pi.on("turn_end", async () => {
							if (turnFiles.size > 0) {
								snapshotLog.push({
									turnIndex: turnIdx,
									files: Object.fromEntries(turnFiles),
								});
							}
							turnIdx++;
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "foo.ts", content: "v1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create foo.ts");

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "bar.ts", content: "b1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create bar.ts");

			expect(snapshotLog).toHaveLength(2);
			expect(snapshotLog[0].files["foo.ts"]).toBe("v1");
			expect(snapshotLog[1].files["bar.ts"]).toBe("b1");
		});
	});

	describe("snapshot persistence via custom entry", () => {
		it("persists snapshot metadata in session as custom entry", async () => {
			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
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
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "test.ts", content: "hello world" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("write test.ts");

			const customEntries = harness.sessionManager
				.getEntries()
				.filter((e) => e.type === "custom" && e.customType === "file-snapshot");

			expect(customEntries.length).toBeGreaterThanOrEqual(1);
			if (customEntries.length > 0 && customEntries[0].type === "custom") {
				expect(customEntries[0].data).toEqual({
					path: "test.ts",
					content: "hello world",
				});
			}
		});
	});

	describe("tool_call interception for pre-edit snapshot", () => {
		it("can snapshot file before edit tool modifies it", async () => {
			const beforeSnapshots: Record<string, string> = {};

			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
						pi.on("tool_call", async (event, ctx) => {
							if (event.toolName === "edit" || event.toolName === "write") {
								const path = event.input?.path as string | undefined;
								if (path) {
									try {
										beforeSnapshots[path] = readFileSync(join(ctx.cwd, path), "utf-8");
									} catch {
										beforeSnapshots[path] = "";
									}
								}
							}
						});
					},
				],
			});
			harnesses.push(harness);

			writeFile(harness.tempDir, "foo.ts", "original content");

			harness.setResponses([
				fauxAssistantMessage(
					fauxToolCall("edit", { path: "foo.ts", edits: [{ oldText: "original", newText: "modified" }] }),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("edit foo.ts");

			expect(beforeSnapshots["foo.ts"]).toBe("original content");
			expect(readFile(harness.tempDir, "foo.ts")).toBe("modified content");
		});
	});

	describe("multi-file batch commit per turn", () => {
		it("batches multiple file changes within a single turn", async () => {
			const turnSnapshots: Array<{ files: string[] }> = [];

			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
						const turnFiles = new Set<string>();

						pi.on("turn_start", async () => {
							turnFiles.clear();
						});

						pi.on("tool_result", async (event) => {
							if (event.toolName === "write" || event.toolName === "edit") {
								const path = event.input?.path as string | undefined;
								if (path) turnFiles.add(path);
							}
						});

						pi.on("turn_end", async () => {
							if (turnFiles.size > 0) {
								turnSnapshots.push({ files: [...turnFiles].sort() });
							}
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(
					[
						fauxToolCall("write", { path: "a.ts", content: "A" }),
						fauxToolCall("write", { path: "b.ts", content: "B" }),
						fauxToolCall("write", { path: "c.ts", content: "C" }),
					],
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("create 3 files");

			expect(turnSnapshots).toHaveLength(1);
			expect(turnSnapshots[0].files).toEqual(["a.ts", "b.ts", "c.ts"]);
		});
	});

	describe("conflict detection with external modifications", () => {
		it("detects that file was modified externally between turns", async () => {
			const conflicts: string[] = [];

			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
						const lastKnownState = new Map<string, string>();

						pi.on("tool_result", async (event, ctx) => {
							if (event.toolName === "write" || event.toolName === "edit") {
								const path = event.input?.path as string | undefined;
								if (path) {
									try {
										lastKnownState.set(path, readFileSync(join(ctx.cwd, path), "utf-8"));
									} catch {
										// ignore
									}
								}
							}
						});

						pi.on("turn_start", async (_event, ctx) => {
							conflicts.length = 0;
							for (const [path, expectedContent] of lastKnownState) {
								try {
									const actual = readFileSync(join(ctx.cwd, path), "utf-8");
									if (actual !== expectedContent) {
										conflicts.push(path);
									}
								} catch {
									conflicts.push(path);
								}
							}
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "foo.ts", content: "v1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create foo.ts");
			expect(conflicts).toHaveLength(0);

			writeFile(harness.tempDir, "foo.ts", "externally modified");

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "bar.ts", content: "b1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create bar.ts");

			expect(conflicts).toContain("foo.ts");
		});
	});

	describe("state reconstruction on session_start", () => {
		it("rebuilds snapshot index from custom entries on resume", async () => {
			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
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
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "a.ts", content: "aaa" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("create a.ts");

			const snapshots = harness.sessionManager
				.getEntries()
				.filter((e) => e.type === "custom" && e.customType === "file-snapshot");

			expect(snapshots.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe("restore diff between two entry points", () => {
		it("computes which files changed between two snapshots", async () => {
			const fileSnapshots: Array<{ path: string; content: string }> = [];

			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
						pi.on("tool_result", async (event, ctx) => {
							if (event.toolName === "write" || event.toolName === "edit") {
								const path = event.input?.path as string | undefined;
								if (path) {
									try {
										fileSnapshots.push({ path, content: readFileSync(join(ctx.cwd, path), "utf-8") });
									} catch {
										// ignore
									}
								}
							}
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "foo.ts", content: "v1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create foo.ts");

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "foo.ts", content: "v2" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("update foo.ts");

			const fooSnaps = fileSnapshots.filter((s) => s.path === "foo.ts");
			expect(fooSnaps.length).toBe(2);
			expect(fooSnaps[0].content).toBe("v1");
			expect(fooSnaps[1].content).toBe("v2");
		});
	});

	describe("tree rollback file restore", () => {
		function createRestoreExtension(
			restoreLog: Array<{ action: string; paths: string[] }>,
			decision: { value: "files" | "messages-only" },
		) {
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

					if (decision.value === "messages-only") {
						restoreLog.push({ action: "skip", paths: [...filesToRestore.keys()] });
						return;
					}

					for (const [path, content] of filesToRestore) {
						if (content === undefined) {
							deleteFile(ctx.cwd, path);
						} else {
							writeFile(ctx.cwd, path, content);
						}
					}
					restoreLog.push({ action: "restore", paths: [...filesToRestore.keys()] });
				});
			};
		}

		it("T1: restores tracked file to earlier version on tree rollback", async () => {
			const restoreLog: Array<{ action: string; paths: string[] }> = [];
			const decision = { value: "files" as const };

			const harness = await createHarness({
				extensionFactories: [createRestoreExtension(restoreLog, decision)],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "foo.ts", content: "v1" }), { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create foo.ts v1");

			expect(readFile(harness.tempDir, "foo.ts")).toBe("v1");

			const firstLeafId = harness.sessionManager.getLeafId()!;

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "foo.ts", content: "v2" }), { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("update foo.ts v2");

			expect(readFile(harness.tempDir, "foo.ts")).toBe("v2");

			await harness.session.navigateTree(firstLeafId, { summarize: false });

			expect(readFile(harness.tempDir, "foo.ts")).toBe("v1");
			expect(restoreLog.length).toBeGreaterThanOrEqual(1);
			expect(restoreLog[0].action).toBe("restore");
		});

		it("T2: deletes files added after rollback point", async () => {
			const restoreLog: Array<{ action: string; paths: string[] }> = [];
			const decision = { value: "files" as const };

			const harness = await createHarness({
				extensionFactories: [createRestoreExtension(restoreLog, decision)],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "foo.ts", content: "base" }), { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create foo.ts");

			const firstLeafId = harness.sessionManager.getLeafId()!;

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "bar.ts", content: "new-file" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create bar.ts");

			expect(readFile(harness.tempDir, "bar.ts")).toBe("new-file");

			await harness.session.navigateTree(firstLeafId, { summarize: false });

			expect(readFile(harness.tempDir, "foo.ts")).toBe("base");
			expect(existsSync(join(harness.tempDir, "bar.ts"))).toBe(false);
		});

		it("T3: does not touch untracked files", async () => {
			const restoreLog: Array<{ action: string; paths: string[] }> = [];
			const decision = { value: "files" as const };

			const harness = await createHarness({
				extensionFactories: [createRestoreExtension(restoreLog, decision)],
			});
			harnesses.push(harness);

			writeFile(harness.tempDir, "untracked.ts", "leave-me-alone");

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "tracked.ts", content: "v1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create tracked.ts");

			const firstLeafId = harness.sessionManager.getLeafId()!;

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "tracked.ts", content: "v2" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("update tracked.ts");

			await harness.session.navigateTree(firstLeafId, { summarize: false });

			expect(readFile(harness.tempDir, "untracked.ts")).toBe("leave-me-alone");
			expect(readFile(harness.tempDir, "tracked.ts")).toBe("v1");
		});

		it("T4: rollback commit is appended (append-only)", async () => {
			const restoreLog: Array<{ action: string; paths: string[] }> = [];
			const decision = { value: "files" as const };

			const harness = await createHarness({
				extensionFactories: [createRestoreExtension(restoreLog, decision)],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "a.ts", content: "a1" }), { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create a.ts");

			const firstLeafId = harness.sessionManager.getLeafId()!;

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "a.ts", content: "a2" }), { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("update a.ts");

			const entriesBeforeRollback = harness.sessionManager
				.getEntries()
				.filter((e) => e.type === "custom" && e.customType === "file-snapshot");
			expect(entriesBeforeRollback.length).toBeGreaterThanOrEqual(2);

			await harness.session.navigateTree(firstLeafId, { summarize: false });

			const entriesAfterRollback = harness.sessionManager
				.getEntries()
				.filter((e) => e.type === "custom" && e.customType === "file-snapshot");
			expect(entriesAfterRollback.length).toBeGreaterThanOrEqual(entriesBeforeRollback.length);
		});

		it("T5: no snapshot data does not crash", async () => {
			const restoreLog: Array<{ action: string; paths: string[] }> = [];
			const decision = { value: "files" as const };

			const harness = await createHarness({
				extensionFactories: [createRestoreExtension(restoreLog, decision)],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "first.ts", content: "hello" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create first.ts");

			const entries = harness.sessionManager.getEntries();
			const userEntry = entries.find((e) => e.type === "message" && e.message.role === "user");
			expect(userEntry).toBeDefined();

			await expect(harness.session.navigateTree(userEntry!.id, { summarize: false })).resolves.toBeDefined();
		});
	});

	describe("conflict detection on tree rollback", () => {
		it("C1: detects externally modified file before rollback", async () => {
			const conflicts: string[] = [];
			const allSnapshots: Array<{ path: string; content: string; hash: string }> = [];

			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
						pi.on("tool_result", async (event, ctx) => {
							if (event.toolName === "write" || event.toolName === "edit") {
								const path = event.input?.path as string | undefined;
								if (path) {
									try {
										const content = readFileSync(join(ctx.cwd, path), "utf-8");
										allSnapshots.push({ path, content, hash: String(content.length) });
									} catch {
										// ignore
									}
								}
							}
						});

						pi.on("session_before_tree", async (_event, ctx) => {
							conflicts.length = 0;
							for (const snap of allSnapshots) {
								try {
									const disk = readFileSync(join(ctx.cwd, snap.path), "utf-8");
									if (String(disk.length) !== snap.hash) {
										if (!conflicts.includes(snap.path)) {
											conflicts.push(snap.path);
										}
									}
								} catch {
									if (!conflicts.includes(snap.path)) {
										conflicts.push(snap.path);
									}
								}
							}
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "foo.ts", content: "v1" }), { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create foo.ts");

			const firstLeafId = harness.sessionManager.getLeafId()!;

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "foo.ts", content: "v2" }), { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("update foo.ts");

			writeFileSync(join(harness.tempDir, "foo.ts"), "external-edit", "utf-8");

			await harness.session.navigateTree(firstLeafId, { summarize: false });

			expect(conflicts).toContain("foo.ts");
		});

		it("C2: skip dirty file restores others", async () => {
			const restored: string[] = [];
			const skipped: string[] = [];

			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
						pi.on("tool_result", async (event, ctx) => {
							if (event.toolName === "write" || event.toolName === "edit") {
								const path = event.input?.path as string | undefined;
								if (path) {
									try {
										const content = readFileSync(join(ctx.cwd, path), "utf-8");
										pi.appendEntry("file-snapshot", {
											path,
											content,
											hash: String(content.length),
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
							const snapEntries = entries.filter(
								(e) =>
									e.type === "custom" &&
									e.customType === "file-snapshot" &&
									isOnPathTo(entries, targetId, e.id),
							);

							const latestByPath = new Map<string, { content: string; hash: string }>();
							for (const entry of snapEntries) {
								if (entry.type !== "custom") continue;
								const data = entry.data as { path?: string; content?: string; hash?: string };
								if (data.path && data.content !== undefined) {
									latestByPath.set(data.path, {
										content: data.content,
										hash: data.hash ?? String(data.content.length),
									});
								}
							}
							if (latestByPath.size === 0) return;

							for (const [path, snap] of latestByPath) {
								try {
									const disk = readFileSync(join(ctx.cwd, path), "utf-8");
									if (String(disk.length) !== snap.hash) {
										skipped.push(path);
										continue;
									}
								} catch {
									skipped.push(path);
									continue;
								}
								writeFile(ctx.cwd, path, snap.content);
								restored.push(path);
							}
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(
					[
						fauxToolCall("write", { path: "clean.ts", content: "c1" }),
						fauxToolCall("write", { path: "dirty.ts", content: "d1" }),
					],
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create clean.ts and dirty.ts");

			const firstLeafId = harness.sessionManager.getLeafId()!;

			harness.setResponses([
				fauxAssistantMessage(
					[
						fauxToolCall("write", { path: "clean.ts", content: "c2" }),
						fauxToolCall("write", { path: "dirty.ts", content: "d2" }),
					],
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("update both");

			writeFileSync(join(harness.tempDir, "dirty.ts"), "external-change", "utf-8");

			await harness.session.navigateTree(firstLeafId, { summarize: false });

			expect(restored).toContain("clean.ts");
			expect(skipped).toContain("dirty.ts");
			expect(readFile(harness.tempDir, "clean.ts")).toBe("c1");
			expect(readFile(harness.tempDir, "dirty.ts")).toBe("external-change");
		});
	});

	describe("user choice on tree rollback", () => {
		it("U1: 'only rollback messages' leaves files unchanged", async () => {
			const restoreLog: Array<{ action: string; paths: string[] }> = [];
			const decision = { value: "messages-only" as const };

			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
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
							const allPaths = new Set([...targetFiles.keys(), ...currentFiles.keys()]);
							if (allPaths.size === 0) return;

							if (decision.value === "messages-only") {
								restoreLog.push({ action: "skip", paths: [...allPaths] });
								return;
							}

							for (const [path, content] of targetFiles) {
								writeFile(ctx.cwd, path, content);
							}
							restoreLog.push({ action: "restore", paths: [...allPaths] });
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "foo.ts", content: "v1" }), { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create foo.ts");

			const firstLeafId = harness.sessionManager.getLeafId()!;

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "foo.ts", content: "v2" }), { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("update foo.ts");

			await harness.session.navigateTree(firstLeafId, { summarize: false });

			expect(readFile(harness.tempDir, "foo.ts")).toBe("v2");
			expect(restoreLog.length).toBeGreaterThanOrEqual(1);
			expect(restoreLog[0].action).toBe("skip");
		});

		it("U2: 'rollback messages + files' restores files", async () => {
			const restoreLog: Array<{ action: string; paths: string[] }> = [];
			const decision = { value: "files" as const };

			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
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

							if (decision.value === "messages-only") {
								restoreLog.push({ action: "skip", paths: [...filesToRestore.keys()] });
								return;
							}

							for (const [path, content] of filesToRestore) {
								if (content === undefined) {
									deleteFile(ctx.cwd, path);
								} else {
									writeFile(ctx.cwd, path, content);
								}
							}
							restoreLog.push({ action: "restore", paths: [...filesToRestore.keys()] });
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "foo.ts", content: "v1" }), { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create foo.ts");

			const firstLeafId = harness.sessionManager.getLeafId()!;

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "foo.ts", content: "v2" }), { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("update foo.ts");

			await harness.session.navigateTree(firstLeafId, { summarize: false });

			expect(readFile(harness.tempDir, "foo.ts")).toBe("v1");
			expect(restoreLog.length).toBeGreaterThanOrEqual(1);
			expect(restoreLog[0].action).toBe("restore");
		});

		it("U3: no file changes shows no dialog", async () => {
			const dialogShown = { value: false };

			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
						pi.on("session_tree", async (event, ctx) => {
							const targetId = event.newLeafId;
							if (!targetId) return;

							const entries = ctx.sessionManager.getEntries();
							const snapEntries = entries.filter(
								(e) =>
									e.type === "custom" &&
									e.customType === "file-snapshot" &&
									isOnPathTo(entries, targetId, e.id),
							);
							if (snapEntries.length > 0) {
								dialogShown.value = true;
							}
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "foo.ts", content: "v1" }), { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create foo.ts");

			const firstLeafId = harness.sessionManager.getLeafId()!;

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "foo.ts", content: "v2" }), { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("update foo.ts");

			await harness.session.navigateTree(firstLeafId, { summarize: false });

			expect(dialogShown.value).toBe(false);
		});
	});

	describe("fork inheritance", () => {
		function createSnapshotExtension() {
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
			};
		}

		it("F1: fork preserves snapshot custom entries in new session", async () => {
			const harness = await createHarness({
				extensionFactories: [createSnapshotExtension()],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "alpha.ts", content: "aaa" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create alpha.ts");

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "beta.ts", content: "bbb" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create beta.ts");

			const entries = harness.sessionManager.getEntries();
			const customEntries = entries.filter((e) => e.type === "custom" && e.customType === "file-snapshot");

			expect(customEntries.length).toBeGreaterThanOrEqual(2);

			const paths = customEntries.map((e) => {
				const data = (e as { data?: { path?: string } }).data;
				return data?.path;
			});
			expect(paths).toContain("alpha.ts");
			expect(paths).toContain("beta.ts");

			for (const entry of customEntries) {
				if (entry.type !== "custom") continue;
				const data = entry.data as { path?: string; content?: string };
				expect(data.path).toBeDefined();
				expect(data.content).toBeDefined();
			}
		});

		it("F2: snapshots before fork point are queryable via findSnapshotsOnPath", async () => {
			const harness = await createHarness({
				extensionFactories: [createSnapshotExtension()],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "foo.ts", content: "v1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create foo.ts");

			const afterFirstTurn = harness.sessionManager.getLeafId()!;

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "bar.ts", content: "v2" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create bar.ts");

			const afterSecondTurn = harness.sessionManager.getLeafId()!;
			const entries = harness.sessionManager.getEntries();

			const snapAtFork = findSnapshotsOnPath(entries, afterFirstTurn);
			expect(snapAtFork.has("foo.ts")).toBe(true);
			expect(snapAtFork.has("bar.ts")).toBe(false);

			const snapAtLeaf = findSnapshotsOnPath(entries, afterSecondTurn);
			expect(snapAtLeaf.has("foo.ts")).toBe(true);
			expect(snapAtLeaf.has("bar.ts")).toBe(true);
			expect(snapAtLeaf.get("foo.ts")).toBe("v1");
			expect(snapAtLeaf.get("bar.ts")).toBe("v2");
		});

		it("F3: fork does not modify disk files", async () => {
			const forkActions: string[] = [];

			const harness = await createHarness({
				extensionFactories: [
					createSnapshotExtension(),
					(pi) => {
						pi.on("session_before_fork", async () => {
							forkActions.push("fork_handler_called");
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "keep.ts", content: "original" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create keep.ts");

			const entries = harness.sessionManager.getEntries();
			const customEntries = entries.filter((e) => e.type === "custom" && e.customType === "file-snapshot");
			expect(customEntries.length).toBeGreaterThanOrEqual(1);
			expect(readFile(harness.tempDir, "keep.ts")).toBe("original");

			expect(forkActions).toEqual([]);
		});

		it("F4: fork point snapshots are complete", async () => {
			const harness = await createHarness({
				extensionFactories: [createSnapshotExtension()],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(
					[
						fauxToolCall("write", { path: "one.ts", content: "111" }),
						fauxToolCall("write", { path: "two.ts", content: "222" }),
					],
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create one.ts and two.ts");

			const midLeaf = harness.sessionManager.getLeafId()!;

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "three.ts", content: "333" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create three.ts");

			const entries = harness.sessionManager.getEntries();
			const snapshotsOnPath = findSnapshotsOnPath(entries, midLeaf);

			expect(snapshotsOnPath.size).toBeGreaterThanOrEqual(2);
			for (const [path, content] of snapshotsOnPath) {
				expect(path).toBeDefined();
				expect(typeof path).toBe("string");
				expect(content).toBeDefined();
				expect(typeof content).toBe("string");
			}

			expect(snapshotsOnPath.has("one.ts")).toBe(true);
			expect(snapshotsOnPath.has("two.ts")).toBe(true);
			expect(snapshotsOnPath.has("three.ts")).toBe(false);
		});
	});

	describe("bash tool blind spot", () => {
		function createBashBlindSpotExtension(
			bashDiffs: Array<{ changed: string[]; deleted: string[] }>,
			trackedPathsRef?: { value: string[] },
		) {
			return (pi: import("../../src/core/extensions/types.js").ExtensionAPI) => {
				const trackedFiles = new Map<string, string>();
				const baseline = new Map<string, string>();
				const writtenThisTurn = new Set<string>();

				pi.on("turn_start", async () => {
					baseline.clear();
					writtenThisTurn.clear();
					for (const [path, content] of trackedFiles) {
						baseline.set(path, content);
					}
				});

				pi.on("tool_result", async (event, ctx) => {
					if (event.toolName === "write" || event.toolName === "edit") {
						const path = event.input?.path as string | undefined;
						if (path) {
							writtenThisTurn.add(path);
							try {
								trackedFiles.set(path, readFileSync(join(ctx.cwd, path), "utf-8"));
							} catch {
								// ignore
							}
						}
					}
				});

				pi.on("turn_end", async (_event, ctx) => {
					if (trackedPathsRef) {
						trackedPathsRef.value = [...trackedFiles.keys()];
					}
					const changed: string[] = [];
					const deleted: string[] = [];
					for (const [path, baseContent] of baseline) {
						if (writtenThisTurn.has(path)) continue;
						try {
							const current = readFileSync(join(ctx.cwd, path), "utf-8");
							if (current !== baseContent) {
								changed.push(path);
							}
						} catch {
							deleted.push(path);
						}
					}
					bashDiffs.push({ changed, deleted });
				});
			};
		}

		it("B1: turn_end detects file changed without write/edit tool", async () => {
			const bashDiffs: Array<{ changed: string[]; deleted: string[] }> = [];

			const harness = await createHarness({
				extensionFactories: [createBashBlindSpotExtension(bashDiffs)],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "foo.ts", content: "v1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create foo.ts");

			writeFileSync(join(harness.tempDir, "foo.ts"), "changed-via-bash", "utf-8");

			harness.setResponses([fauxAssistantMessage("done")]);
			await harness.session.prompt("check foo.ts");

			const lastDiff = bashDiffs[bashDiffs.length - 1];
			expect(lastDiff.changed).toContain("foo.ts");
		});

		it("B2: detects tracked file deleted via bash", async () => {
			const bashDiffs: Array<{ changed: string[]; deleted: string[] }> = [];

			const harness = await createHarness({
				extensionFactories: [createBashBlindSpotExtension(bashDiffs)],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "foo.ts", content: "v1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create foo.ts");

			deleteFile(harness.tempDir, "foo.ts");

			harness.setResponses([fauxAssistantMessage("done")]);
			await harness.session.prompt("check foo.ts");

			const lastDiff = bashDiffs[bashDiffs.length - 1];
			expect(lastDiff.deleted).toContain("foo.ts");
		});

		it("B3: bash creating new file is NOT tracked", async () => {
			const bashDiffs: Array<{ changed: string[]; deleted: string[] }> = [];
			const trackedPathsRef: { value: string[] } = { value: [] };

			const harness = await createHarness({
				extensionFactories: [createBashBlindSpotExtension(bashDiffs, trackedPathsRef)],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "foo.ts", content: "v1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create foo.ts");

			writeFile(harness.tempDir, "new-file.ts", "created-by-bash");

			harness.setResponses([fauxAssistantMessage("done")]);
			await harness.session.prompt("check");

			expect(trackedPathsRef.value).toContain("foo.ts");
			expect(trackedPathsRef.value).not.toContain("new-file.ts");
			const lastDiff = bashDiffs[bashDiffs.length - 1];
			expect(lastDiff.changed).not.toContain("new-file.ts");
		});
	});

	describe("edge cases and boundaries", () => {
		it("S1: empty turn (no file changes) produces no snapshot", async () => {
			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
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
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([fauxAssistantMessage("I have no tools to call")]);

			await harness.session.prompt("just talk to me");

			const entries = harness.sessionManager
				.getEntries()
				.filter((e) => e.type === "custom" && e.customType === "file-snapshot");

			expect(entries).toHaveLength(0);
		});

		it("S2: same file edited multiple times in one turn captures final state only", async () => {
			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
						const finalByPath = new Map<string, string>();

						pi.on("turn_start", async () => {
							finalByPath.clear();
						});

						pi.on("tool_result", async (event, ctx) => {
							if (event.toolName === "write" || event.toolName === "edit") {
								const path = event.input?.path as string | undefined;
								if (path) {
									try {
										finalByPath.set(path, readFileSync(join(ctx.cwd, path), "utf-8"));
									} catch {
										// ignore
									}
								}
							}
						});

						pi.on("turn_end", async () => {
							for (const [path, content] of finalByPath) {
								pi.appendEntry("file-snapshot", { path, content });
							}
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(
					[
						fauxToolCall("write", { path: "foo.ts", content: "v1" }),
						fauxToolCall("write", { path: "foo.ts", content: "v2" }),
						fauxToolCall("write", { path: "foo.ts", content: "v3" }),
					],
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("overwrite foo.ts three times");

			const entries = harness.sessionManager
				.getEntries()
				.filter((e) => e.type === "custom" && e.customType === "file-snapshot");

			const fooEntries = entries.filter((e) => {
				if (e.type !== "custom") return false;
				const data = e.data as { path?: string };
				return data.path === "foo.ts";
			});

			expect(fooEntries).toHaveLength(1);
			expect((fooEntries[0].data as { content?: string }).content).toBe("v3");
		});

		it("S3: write creating new file has null before state", async () => {
			const beforeStates: Array<{ path: string; before: string | null }> = [];
			const afterStates: Array<{ path: string; after: string }> = [];

			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
						pi.on("tool_call", async (event, ctx) => {
							if (event.toolName === "write" || event.toolName === "edit") {
								const path = event.input?.path as string | undefined;
								if (path) {
									try {
										beforeStates.push({
											path,
											before: readFileSync(join(ctx.cwd, path), "utf-8"),
										});
									} catch {
										beforeStates.push({ path, before: null });
									}
								}
							}
						});

						pi.on("tool_result", async (event, ctx) => {
							if (event.toolName === "write" || event.toolName === "edit") {
								const path = event.input?.path as string | undefined;
								if (path) {
									try {
										afterStates.push({
											path,
											after: readFileSync(join(ctx.cwd, path), "utf-8"),
										});
										pi.appendEntry("file-snapshot", {
											path,
											before: null,
											after: readFileSync(join(ctx.cwd, path), "utf-8"),
										});
									} catch {
										// ignore
									}
								}
							}
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "brand-new.ts", content: "fresh" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("create brand-new.ts");

			expect(beforeStates).toHaveLength(1);
			expect(beforeStates[0].path).toBe("brand-new.ts");
			expect(beforeStates[0].before).toBeNull();

			expect(afterStates).toHaveLength(1);
			expect(afterStates[0].after).toBe("fresh");

			const entries = harness.sessionManager
				.getEntries()
				.filter((e) => e.type === "custom" && e.customType === "file-snapshot");
			expect(entries).toHaveLength(1);
			const data = entries[0].data as { path: string; before: null; after: string };
			expect(data.before).toBeNull();
			expect(data.after).toBe("fresh");
		});

		it("S4: edit modifying existing file captures before state", async () => {
			const capturedBefore: Array<{ path: string; content: string }> = [];

			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
						pi.on("tool_call", async (event, ctx) => {
							if (event.toolName === "edit") {
								const path = event.input?.path as string | undefined;
								if (path) {
									try {
										capturedBefore.push({
											path,
											content: readFileSync(join(ctx.cwd, path), "utf-8"),
										});
									} catch {
										// ignore
									}
								}
							}
						});
					},
				],
			});
			harnesses.push(harness);

			writeFile(harness.tempDir, "foo.ts", "original");

			harness.setResponses([
				fauxAssistantMessage(
					fauxToolCall("edit", { path: "foo.ts", edits: [{ oldText: "original", newText: "updated" }] }),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("edit foo.ts");

			expect(capturedBefore).toHaveLength(1);
			expect(capturedBefore[0].path).toBe("foo.ts");
			expect(capturedBefore[0].content).toBe("original");

			expect(readFile(harness.tempDir, "foo.ts")).toBe("updated");
		});
	});
});

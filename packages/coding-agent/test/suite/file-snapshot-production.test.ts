import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import fileSnapshotFactory from "../../examples/extensions/file-snapshot.ts";
import { createHarness, type Harness } from "./harness.js";

function readFile(tempDir: string, relativePath: string): string {
	const absolute = join(tempDir, relativePath);
	return existsSync(absolute) ? readFileSync(absolute, "utf-8") : "";
}

function _writeFile(tempDir: string, relativePath: string, content: string): void {
	const absolute = join(tempDir, relativePath);
	mkdirSync(join(absolute, ".."), { recursive: true });
	writeFileSync(absolute, content, "utf-8");
}

describe("file-snapshot production extension", () => {
	const harnesses: Harness[] = [];
	const storeDirs: string[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
		for (const dir of storeDirs) {
			try {
				rmSync(dir, { recursive: true, force: true });
			} catch {}
		}
		storeDirs.length = 0;
	});

	describe("step-level snapshots", () => {
		it("creates step-snapshot custom entry when write tool changes files", async () => {
			const harness = await createHarness({
				extensionFactories: [fileSnapshotFactory],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "foo.ts", content: "hello" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("create foo.ts");

			expect(readFile(harness.tempDir, "foo.ts")).toBe("hello");

			const stepSnapshots = harness.sessionManager
				.getEntries()
				.filter((e) => e.type === "custom" && e.customType === "step-snapshot");

			expect(stepSnapshots.length).toBeGreaterThanOrEqual(1);

			const data = stepSnapshots[0]?.data as {
				baselineTreeHash: string | null;
				snapshotTreeHash: string;
				diff: { added: string[]; modified: string[]; deleted: string[] } | null;
				turnIndex: number;
			};

			expect(data.snapshotTreeHash).toBeDefined();
			expect(typeof data.snapshotTreeHash).toBe("string");
			expect(data.turnIndex).toBe(0);
		});

		it("captures diff between baseline and snapshot", async () => {
			const harness = await createHarness({
				extensionFactories: [fileSnapshotFactory],
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

			const stepSnapshots = harness.sessionManager
				.getEntries()
				.filter((e) => e.type === "custom" && e.customType === "step-snapshot");

			const lastSnapshot = stepSnapshots[stepSnapshots.length - 1];
			const data = lastSnapshot?.data as {
				diff: { added: string[]; modified: string[]; deleted: string[] } | null;
			};

			expect(data.diff).toBeDefined();
			expect(data.diff!.modified).toContain("foo.ts");
		});

		it("captures bash-driven file changes (not just write/edit tools)", async () => {
			const harness = await createHarness({
				extensionFactories: [fileSnapshotFactory],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "foo.ts", content: "v1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create foo.ts");

			writeFileSync(join(harness.tempDir, "foo.ts"), "changed-by-bash", "utf-8");
			writeFileSync(join(harness.tempDir, "new-by-bash.ts"), "brand-new", "utf-8");

			harness.setResponses([fauxAssistantMessage("done")]);
			await harness.session.prompt("check files");

			const stepSnapshots = harness.sessionManager
				.getEntries()
				.filter((e) => e.type === "custom" && e.customType === "step-snapshot");

			const lastSnapshot = stepSnapshots[stepSnapshots.length - 1];
			const data = lastSnapshot?.data as {
				diff: { added: string[]; modified: string[]; deleted: string[] } | null;
			};

			expect(data.diff).toBeDefined();
			expect(data.diff!.modified).toContain("foo.ts");
			expect(data.diff!.added).toContain("new-by-bash.ts");
		});
	});

	describe("project-level object store", () => {
		it("stores objects under project hash directory", async () => {
			const harness = await createHarness({
				extensionFactories: [fileSnapshotFactory],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "test.ts", content: "stored" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create test.ts");

			const storeRoot = join(homedir(), ".pi", "agent", "file-store");
			const dirs = existsSync(storeRoot)
				? await import("node:fs").then((fs) =>
						fs.readdirSync(storeRoot).filter((d) => {
							try {
								return fs.statSync(join(storeRoot, d)).isDirectory();
							} catch {
								return false;
							}
						}),
					)
				: [];

			const projectDirs = dirs.filter((d) => d !== "sessions");
			expect(projectDirs.length).toBeGreaterThanOrEqual(1);

			const projectHash = projectDirs[0]!;
			const objectsDir = join(storeRoot, projectHash, "objects");
			storeDirs.push(join(storeRoot, projectHash));

			expect(existsSync(objectsDir)).toBe(true);
		});

		it("two sessions on same project share object store", async () => {
			const harness1 = await createHarness({
				extensionFactories: [fileSnapshotFactory],
			});
			harnesses.push(harness1);

			harness1.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "shared.ts", content: "from-session-1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness1.session.prompt("create shared.ts");

			const harness2 = await createHarness({
				extensionFactories: [fileSnapshotFactory],
			});
			harnesses.push(harness2);

			harness2.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "shared.ts", content: "from-session-1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness2.session.prompt("create same content");

			const storeRoot = join(homedir(), ".pi", "agent", "file-store");
			if (existsSync(storeRoot)) {
				const { readdirSync, statSync } = await import("node:fs");
				const projectDirs = readdirSync(storeRoot).filter((d) => {
					try {
						return statSync(join(storeRoot, d)).isDirectory();
					} catch {
						return false;
					}
				});
				storeDirs.push(...projectDirs.map((d) => join(storeRoot, d)));
			}
		});
	});

	describe("tree rollback with file restore", () => {
		it("restores file to earlier version on tree rollback", async () => {
			const harness = await createHarness({
				extensionFactories: [fileSnapshotFactory],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "foo.ts", content: "v1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create foo.ts v1");

			expect(readFile(harness.tempDir, "foo.ts")).toBe("v1");

			const firstLeafId = harness.sessionManager.getLeafId()!;

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "foo.ts", content: "v2" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("update foo.ts v2");

			expect(readFile(harness.tempDir, "foo.ts")).toBe("v2");

			await harness.session.navigateTree(firstLeafId, { summarize: false });

			expect(readFile(harness.tempDir, "foo.ts")).toBe("v1");
		});

		it("deletes files added after rollback point", async () => {
			const harness = await createHarness({
				extensionFactories: [fileSnapshotFactory],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "base.ts", content: "base" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create base.ts");

			const firstLeafId = harness.sessionManager.getLeafId()!;

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "new.ts", content: "new-file" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create new.ts");

			expect(existsSync(join(harness.tempDir, "new.ts"))).toBe(true);

			await harness.session.navigateTree(firstLeafId, { summarize: false });

			expect(readFile(harness.tempDir, "base.ts")).toBe("base");
			expect(existsSync(join(harness.tempDir, "new.ts"))).toBe(false);
		});

		it("handles rollback with no prior snapshots", async () => {
			const harness = await createHarness({
				extensionFactories: [fileSnapshotFactory],
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

	describe("unrevert", () => {
		it("creates unrevert-point custom entry on rollback", async () => {
			const harness = await createHarness({
				extensionFactories: [fileSnapshotFactory],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "foo.ts", content: "v1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create foo.ts v1");

			const firstLeafId = harness.sessionManager.getLeafId()!;

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "foo.ts", content: "v2" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("update foo.ts v2");

			await harness.session.navigateTree(firstLeafId, { summarize: false });

			const unrevertPoints = harness.sessionManager
				.getEntries()
				.filter((e) => e.type === "custom" && e.customType === "unrevert-point");

			expect(unrevertPoints.length).toBeGreaterThanOrEqual(1);

			const data = unrevertPoints[0]?.data as {
				preRollbackTreeHash: string;
				rolledBackToLeaf: string;
			};

			expect(data.preRollbackTreeHash).toBeDefined();
			expect(typeof data.preRollbackTreeHash).toBe("string");
			expect(data.rolledBackToLeaf).toBe(firstLeafId);
		});

		it("unrevert-point stores state before rollback for potential undo", async () => {
			const harness = await createHarness({
				extensionFactories: [fileSnapshotFactory],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "x.ts", content: "v1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create x.ts");

			const firstLeafId = harness.sessionManager.getLeafId()!;

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "x.ts", content: "v2" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("modify x.ts");

			expect(readFile(harness.tempDir, "x.ts")).toBe("v2");

			await harness.session.navigateTree(firstLeafId, { summarize: false });

			expect(readFile(harness.tempDir, "x.ts")).toBe("v1");

			const unrevertPoints = harness.sessionManager
				.getEntries()
				.filter((e) => e.type === "custom" && e.customType === "unrevert-point");

			expect(unrevertPoints.length).toBeGreaterThanOrEqual(1);

			const data = unrevertPoints[0]?.data as {
				preRollbackTreeHash: string;
				rolledBackToLeaf: string;
			};

			expect(data.preRollbackTreeHash).not.toBe("");
		});
	});

	describe("rollback all (to session start)", () => {
		it("restores file to last snapshot state, then to baseline when rolling back before first snapshot", async () => {
			const harness = await createHarness({
				extensionFactories: [fileSnapshotFactory],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "counter.txt", content: "1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("write 1");

			const r1Leaf = harness.sessionManager.getLeafId()!;

			expect(readFile(harness.tempDir, "counter.txt")).toBe("1");

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "counter.txt", content: "2" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("write 2");

			expect(readFile(harness.tempDir, "counter.txt")).toBe("2");

			await harness.session.navigateTree(r1Leaf, { summarize: false });
			expect(readFile(harness.tempDir, "counter.txt")).toBe("1");
		});

		it("multi-round sequential rollback restores correct state", async () => {
			const harness = await createHarness({
				extensionFactories: [fileSnapshotFactory],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "counter.txt", content: "1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("write 1");

			const r1Leaf = harness.sessionManager.getLeafId()!;

			expect(readFile(harness.tempDir, "counter.txt")).toBe("1");

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "counter.txt", content: "2" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("write 2");

			const r2Leaf = harness.sessionManager.getLeafId()!;
			expect(readFile(harness.tempDir, "counter.txt")).toBe("2");

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "counter.txt", content: "3" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("write 3");

			expect(readFile(harness.tempDir, "counter.txt")).toBe("3");

			await harness.session.navigateTree(r2Leaf, { summarize: false });
			expect(readFile(harness.tempDir, "counter.txt")).toBe("2");

			await harness.session.navigateTree(r1Leaf, { summarize: false });
			expect(readFile(harness.tempDir, "counter.txt")).toBe("1");
		});

		it("can send new message after rollback", async () => {
			const harness = await createHarness({
				extensionFactories: [fileSnapshotFactory],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "msg.txt", content: "first" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create msg.txt");

			const r1Leaf = harness.sessionManager.getLeafId()!;

			expect(readFile(harness.tempDir, "msg.txt")).toBe("first");

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "msg.txt", content: "second" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("modify msg.txt");

			expect(readFile(harness.tempDir, "msg.txt")).toBe("second");

			await harness.session.navigateTree(r1Leaf, { summarize: false });
			expect(readFile(harness.tempDir, "msg.txt")).toBe("first");

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "msg.txt", content: "third" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("modify msg.txt again");

			expect(readFile(harness.tempDir, "msg.txt")).toBe("third");
		});
	});

	describe("no snapshot for empty turns", () => {
		it("does not create step-snapshot when no files change", async () => {
			const harness = await createHarness({
				extensionFactories: [fileSnapshotFactory],
			});
			harnesses.push(harness);

			harness.setResponses([fauxAssistantMessage("I have no tools to call")]);

			await harness.session.prompt("just talk to me");

			const stepSnapshots = harness.sessionManager
				.getEntries()
				.filter((e) => e.type === "custom" && e.customType === "step-snapshot");

			expect(stepSnapshots).toHaveLength(0);
		});
	});

	describe("rollback deletion edge cases", () => {
		it("restores files after rollback from deletion state (Case A)", async () => {
			const harness = await createHarness({
				extensionFactories: [fileSnapshotFactory],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "hello.txt", content: "v1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create hello.txt v1");
			expect(readFile(harness.tempDir, "hello.txt")).toBe("v1");

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "hello.txt", content: "v2" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("modify hello.txt v2");
			expect(readFile(harness.tempDir, "hello.txt")).toBe("v2");

			const r2Leaf = harness.sessionManager.getLeafId()!;

			rmSync(join(harness.tempDir, "hello.txt"), { force: true });

			harness.setResponses([fauxAssistantMessage("done")]);
			await harness.session.prompt("check after delete");
			expect(existsSync(join(harness.tempDir, "hello.txt"))).toBe(false);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "hello.txt", content: "v3" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("recreate hello.txt v3");
			expect(readFile(harness.tempDir, "hello.txt")).toBe("v3");

			await harness.session.navigateTree(r2Leaf, { summarize: false });
			expect(readFile(harness.tempDir, "hello.txt")).toBe("v2");
		});

		it("rollback ALL to root deletes all files (Case C)", async () => {
			const harness = await createHarness({
				extensionFactories: [fileSnapshotFactory],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "a.txt", content: "aaa" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create a.txt");

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "b.txt", content: "bbb" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create b.txt");

			expect(existsSync(join(harness.tempDir, "a.txt"))).toBe(true);
			expect(existsSync(join(harness.tempDir, "b.txt"))).toBe(true);

			const entries = harness.sessionManager.getEntries();
			const rootUserEntry = entries.find((e) => e.type === "message" && e.message.role === "user" && !e.parentId);
			expect(rootUserEntry).toBeDefined();

			await harness.session.navigateTree(rootUserEntry!.id, { summarize: false });

			expect(existsSync(join(harness.tempDir, "a.txt"))).toBe(false);
			expect(existsSync(join(harness.tempDir, "b.txt"))).toBe(false);
		});

		it("rollback ALL after partial rollback (Case D)", async () => {
			const harness = await createHarness({
				extensionFactories: [fileSnapshotFactory],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "base.txt", content: "base" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create base.txt");

			const r1Leaf = harness.sessionManager.getLeafId()!;

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "extra.txt", content: "extra" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create extra.txt");

			expect(existsSync(join(harness.tempDir, "base.txt"))).toBe(true);
			expect(existsSync(join(harness.tempDir, "extra.txt"))).toBe(true);

			await harness.session.navigateTree(r1Leaf, { summarize: false });

			expect(readFile(harness.tempDir, "base.txt")).toBe("base");
			expect(existsSync(join(harness.tempDir, "extra.txt"))).toBe(false);

			const entries = harness.sessionManager.getEntries();
			const rootUserEntry = entries.find((e) => e.type === "message" && e.message.role === "user" && !e.parentId);
			expect(rootUserEntry).toBeDefined();

			await harness.session.navigateTree(rootUserEntry!.id, { summarize: false });

			expect(existsSync(join(harness.tempDir, "base.txt"))).toBe(false);
			expect(existsSync(join(harness.tempDir, "extra.txt"))).toBe(false);
		});

		it("rollback after rollback then new message (Case E)", async () => {
			const harness = await createHarness({
				extensionFactories: [fileSnapshotFactory],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "file.txt", content: "v1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create file.txt v1");
			expect(readFile(harness.tempDir, "file.txt")).toBe("v1");

			const r1Leaf = harness.sessionManager.getLeafId()!;

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "file.txt", content: "v2" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("modify file.txt v2");
			expect(readFile(harness.tempDir, "file.txt")).toBe("v2");

			const r2Leaf = harness.sessionManager.getLeafId()!;

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "file.txt", content: "v3" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("modify file.txt v3");
			expect(readFile(harness.tempDir, "file.txt")).toBe("v3");

			await harness.session.navigateTree(r1Leaf, { summarize: false });
			expect(readFile(harness.tempDir, "file.txt")).toBe("v1");

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "file.txt", content: "v4" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("modify file.txt v4");
			expect(readFile(harness.tempDir, "file.txt")).toBe("v4");

			await harness.session.navigateTree(r2Leaf, { summarize: false });
			expect(readFile(harness.tempDir, "file.txt")).toBe("v2");
		});
	});
});

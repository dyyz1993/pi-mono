import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@dyyz1993/pi-ai";
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

describe("navigateTree with summarize: branch_summary round-trip", () => {
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

	async function doWriteTurnAppended(h: Harness, prompt: string, path: string, content: string) {
		h.appendResponses([
			fauxAssistantMessage(fauxToolCall("write", { path, content }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await h.session.prompt(prompt);
		return h.sessionManager.getLeafId()!;
	}

	it("navigateTree with summarize creates branch_summary entry", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doWriteTurn(h, "T1", "a.ts", "v1");
		await doWriteTurn(h, "T2", "b.ts", "b1");
		await doWriteTurn(h, "T3", "c.ts", "c1");

		h.appendResponses([fauxAssistantMessage("Summary of abandoned branch")]);
		await h.session.navigateTree(t1, { summarize: true });

		const entries = h.sessionManager.getEntries();
		const summaries = entries.filter((e) => e.type === "branch_summary");
		expect(summaries.length).toBe(1);

		const summary = summaries[0] as any;
		expect(summary.summary).toContain("Summary of abandoned branch");
	});

	it("branch_summary entry preserves context about abandoned branch", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doWriteTurn(h, "T1", "a.ts", "v1");
		await doWriteTurn(h, "T2", "b.ts", "b1");

		h.appendResponses([fauxAssistantMessage("Abandoned work: wrote b.ts")]);
		await h.session.navigateTree(t1, { summarize: true });

		const entries = h.sessionManager.getEntries();
		const summary = entries.find((e) => e.type === "branch_summary") as any;
		expect(summary).toBeDefined();
		expect(summary.summary).toContain("Abandoned work");

		const branch = h.sessionManager.getBranch();
		const userMsgs = branch.filter((e) => e.type === "message" && (e as any).message?.role === "user");
		expect(userMsgs.length).toBe(1);

		const branchSummaries = branch.filter((e) => e.type === "branch_summary");
		expect(branchSummaries.length).toBe(1);
	});

	it("navigateTree without summarize does NOT create branch_summary", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doWriteTurn(h, "T1", "a.ts", "v1");
		await doWriteTurn(h, "T2", "b.ts", "b1");

		await h.session.navigateTree(t1, { summarize: false });

		const entries = h.sessionManager.getEntries();
		const summaries = entries.filter((e) => e.type === "branch_summary");
		expect(summaries.length).toBe(0);
	});

	it("rollback with summarize then continue creates new branch", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doWriteTurn(h, "T1", "a.ts", "v1");
		await doWriteTurn(h, "T2", "b.ts", "b1");

		h.appendResponses([fauxAssistantMessage("Summary of b.ts work")]);
		await h.session.navigateTree(t1, { summarize: true });

		expect(fileExists(h.tempDir, "b.ts")).toBe(false);

		await doWriteTurnAppended(h, "T3", "c.ts", "c1");

		expect(fileExists(h.tempDir, "c.ts")).toBe(true);
		expect(readFile(h.tempDir, "a.ts")).toBe("v1");

		const entries = h.sessionManager.getEntries();
		const summaries = entries.filter((e) => e.type === "branch_summary");
		expect(summaries.length).toBe(1);

		const branch = h.sessionManager.getBranch();
		const branchSummariesOnPath = branch.filter((e) => e.type === "branch_summary");
		expect(branchSummariesOnPath.length).toBe(1);
	});

	it("multiple rollbacks with summarize create independent summaries", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doWriteTurn(h, "T1", "a.ts", "v1");
		const t2 = await doWriteTurn(h, "T2", "b.ts", "b1");
		await doWriteTurn(h, "T3", "c.ts", "c1");

		h.appendResponses([fauxAssistantMessage("Summary-1: c.ts branch")]);
		await h.session.navigateTree(t2, { summarize: true });

		h.appendResponses([fauxAssistantMessage("Summary-2: b.ts branch")]);
		await h.session.navigateTree(t1, { summarize: true });

		const entries = h.sessionManager.getEntries();
		const summaries = entries.filter((e) => e.type === "branch_summary");
		expect(summaries.length).toBe(2);

		expect(readFile(h.tempDir, "a.ts")).toBe("v1");
	});

	it("summarize with skipFiles still creates branch_summary", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doWriteTurn(h, "T1", "a.ts", "v1");
		await doWriteTurn(h, "T2", "b.ts", "b1");

		h.appendResponses([fauxAssistantMessage("Summary with skipFiles")]);
		await h.session.navigateTree(t1, { summarize: true, skipFiles: true });

		const entries = h.sessionManager.getEntries();
		const summaries = entries.filter((e) => e.type === "branch_summary");
		expect(summaries.length).toBe(1);

		expect(fileExists(h.tempDir, "b.ts")).toBe(true);
	});

	it("branch_summary is included in buildSessionContext messages after rollback", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doWriteTurn(h, "T1", "a.ts", "v1");
		await doWriteTurn(h, "T2", "b.ts", "b1");

		h.appendResponses([fauxAssistantMessage("Summary for context")]);
		await h.session.navigateTree(t1, { summarize: true });

		const messages = h.session.messages;
		const branchSummaryMsgs = messages.filter((m) => m.role === "branchSummary");
		expect(branchSummaryMsgs.length).toBe(1);
		expect((branchSummaryMsgs[0] as any).summary).toContain("Summary for context");

		const userMsgs = messages.filter((m) => m.role === "user");
		expect(userMsgs.length).toBe(1);
	});
});

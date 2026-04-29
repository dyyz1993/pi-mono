import {
	chmodSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CallLLMFn, MemoryDream, MemoryExtractor, updateMemoryIndex } from "./auto-memory.js";
import { DREAM_MIN_HOURS, DREAM_MIN_SESSIONS, getMemoryDir, scanMemoryFiles } from "./utils.js";

describe("auto-memory rpc-e2e-errors", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `am-err-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		const memoryDir = getMemoryDir(tempDir);
		if (existsSync(memoryDir)) {
			chmodSync(memoryDir, 0o755);
			const entries = readdirSync(memoryDir);
			for (const entry of entries) {
				const p = join(memoryDir, entry);
				try {
					chmodSync(p, 0o755);
				} catch {}
			}
			rmSync(memoryDir, { recursive: true, force: true });
		}
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	});

	describe("MemoryExtractor — write to read-only directory", () => {
		it("does not throw when memory dir is read-only", async () => {
			const memoryDir = join(tempDir, "readonly-mem");
			mkdirSync(memoryDir, { recursive: true });

			const extractor = new MemoryExtractor();
			const messages = [
				{ role: "user" as const, content: [{ type: "text" as const, text: "hello" }], timestamp: Date.now() },
				{ role: "assistant" as const, content: [{ type: "text" as const, text: "hi" }], timestamp: Date.now() },
			] as AgentMessage[];

			const callLLM: CallLLMFn = async () =>
				JSON.stringify({
					actions: [
						{
							op: "create",
							filename: "test.md",
							name: "Test",
							description: "test desc",
							type: "project",
							content: "Some content",
						},
					],
				});

			chmodSync(memoryDir, 0o444);

			await expect(extractor.maybeExtract(messages, memoryDir, callLLM)).resolves.toBeNull();

			chmodSync(memoryDir, 0o755);
		});
	});

	describe("MemoryDream — write lock fails", () => {
		function makeDreamReady(memoryDir: string): void {
			const lockPath = join(memoryDir, ".consolidate-lock");
			writeFileSync(lockPath, "");
			const oldTime = new Date(Date.now() - (DREAM_MIN_HOURS + 1) * 3_600_000);
			utimesSync(lockPath, oldTime, oldTime);
			writeFileSync(join(memoryDir, ".session-count"), String(DREAM_MIN_SESSIONS + 2));
		}

		it("rolls back lock mtime when dream throws", async () => {
			const memoryDir = join(tempDir, "dream-err-mem");
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(join(memoryDir, "test.md"), "---\nname: T\ntype: project\n---\nContent.");
			makeDreamReady(memoryDir);

			const lockPath = join(memoryDir, ".consolidate-lock");
			const originalMtime = statSync(lockPath).mtimeMs;

			const callLLM: CallLLMFn = async () => {
				throw new Error("LLM unavailable");
			};

			const dream = new MemoryDream();
			await expect(dream.maybeRun(memoryDir, callLLM)).resolves.toBeNull();

			const afterMtime = statSync(lockPath).mtimeMs;
			expect(Math.abs(afterMtime - originalMtime)).toBeLessThan(1000);
		});

		it("handles read-only lock file gracefully", async () => {
			const memoryDir = join(tempDir, "dream-ro-mem");
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(join(memoryDir, "test.md"), "---\nname: T\ntype: project\n---\nContent.");
			makeDreamReady(memoryDir);

			const lockPath = join(memoryDir, ".consolidate-lock");
			chmodSync(lockPath, 0o444);

			const dream = new MemoryDream();
			await expect(dream.maybeRun(memoryDir, async () => "{}")).resolves.toEqual({
				merges: 0,
				deletions: 0,
				updates: 0,
			});

			chmodSync(lockPath, 0o644);
		});
	});

	describe("MemoryExtractor — concurrent extraction on same dir", () => {
		it("handles two extractors writing same filename without crash", async () => {
			const memoryDir = join(tempDir, "concurrent-mem");
			mkdirSync(memoryDir, { recursive: true });

			const messages = [
				{ role: "user" as const, content: [{ type: "text" as const, text: "remember X" }], timestamp: Date.now() },
				{ role: "assistant" as const, content: [{ type: "text" as const, text: "got it" }], timestamp: Date.now() },
			] as AgentMessage[];

			const makeCallLLM =
				(label: string): CallLLMFn =>
				async () =>
					JSON.stringify({
						actions: [
							{
								op: "create",
								filename: "shared.md",
								name: label,
								description: `${label} desc`,
								type: "project",
								content: `${label} content`,
							},
						],
					});

			const extractor1 = new MemoryExtractor();
			const extractor2 = new MemoryExtractor();

			const noopLLM: CallLLMFn = async () => "{}";
			await extractor1.maybeExtract(messages, memoryDir, noopLLM);
			await extractor2.maybeExtract(messages, memoryDir, noopLLM);

			const [r1, r2] = await Promise.allSettled([
				extractor1.maybeExtract(messages, memoryDir, makeCallLLM("A")),
				extractor2.maybeExtract(messages, memoryDir, makeCallLLM("B")),
			]);

			expect(r1.status).toBe("fulfilled");
			expect(r2.status).toBe("fulfilled");

			const filePath = join(memoryDir, "shared.md");
			expect(existsSync(filePath)).toBe(true);
			const content = readFileSync(filePath, "utf-8");
			expect(content).toContain("content");
		});
	});

	describe("Extension handles memory dir with corrupted files", () => {
		it("scanMemoryFiles does not crash on files with null bytes", async () => {
			const memoryDir = join(tempDir, "corrupt-mem");
			mkdirSync(memoryDir, { recursive: true });

			writeFileSync(join(memoryDir, "corrupt.md"), Buffer.from([0x00, 0x01, 0x02]));
			writeFileSync(
				join(memoryDir, "valid.md"),
				"---\nname: Valid\ndescription: ok\ntype: project\n---\nGood content.",
			);

			const headers = await scanMemoryFiles(memoryDir);
			expect(headers.length).toBeGreaterThanOrEqual(1);
			const validHeader = headers.find((h) => h.filename === "valid.md");
			expect(validHeader).toBeDefined();
			expect(validHeader!.description).toBe("ok");
		});

		it("prefetch handles corrupt content without crash", async () => {
			const memoryDir = join(tempDir, "corrupt-prefetch");
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(join(memoryDir, "bad.md"), Buffer.from([0x00, 0x01, 0x02, 0x03]));
			writeFileSync(join(memoryDir, "good.md"), "---\nname: Good\ndescription: test\ntype: project\n---\nGood.");

			const { MemoryPrefetch } = await import("./auto-memory.js");
			const prefetch = new MemoryPrefetch();

			const callLLM: CallLLMFn = async () => JSON.stringify({ selected: ["good.md"] });
			prefetch.start("test query", memoryDir, callLLM);

			await new Promise((resolve) => setTimeout(resolve, 100));

			const result = prefetch.collect();
			expect(result).toContain("Good.");
		});
	});

	describe("updateMemoryIndex with special filenames", () => {
		it("handles filenames with leading dashes", async () => {
			const memoryDir = join(tempDir, "special-mem");
			mkdirSync(memoryDir, { recursive: true });

			writeFileSync(
				join(memoryDir, "---.md"),
				"---\nname: Dash\ndescription: dash file\ntype: project\n---\nDash content.",
			);
			writeFileSync(
				join(memoryDir, "normal.md"),
				"---\nname: Normal\ndescription: normal file\ntype: project\n---\nNormal content.",
			);

			await expect(updateMemoryIndex(memoryDir)).resolves.toBeUndefined();

			expect(existsSync(join(memoryDir, "MEMORY.md"))).toBe(true);
			const index = readFileSync(join(memoryDir, "MEMORY.md"), "utf-8");
			expect(index).toContain("normal");
		});

		it("handles filenames with spaces", async () => {
			const memoryDir = join(tempDir, "spaces-mem");
			mkdirSync(memoryDir, { recursive: true });

			writeFileSync(
				join(memoryDir, "my file.md"),
				"---\nname: My File\ndescription: spaced name\ntype: project\n---\nSpaced.",
			);

			await expect(updateMemoryIndex(memoryDir)).resolves.toBeUndefined();

			expect(existsSync(join(memoryDir, "MEMORY.md"))).toBe(true);
			const index = readFileSync(join(memoryDir, "MEMORY.md"), "utf-8");
			expect(index).toContain("my file");
		});

		it("handles empty memory dir", async () => {
			const memoryDir = join(tempDir, "empty-mem");
			mkdirSync(memoryDir, { recursive: true });

			await expect(updateMemoryIndex(memoryDir)).resolves.toBeUndefined();

			expect(existsSync(join(memoryDir, "MEMORY.md"))).toBe(true);
		});
	});
});

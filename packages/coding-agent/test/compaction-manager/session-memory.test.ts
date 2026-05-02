import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CompactionPreparation } from "../../extensions/compaction-manager/session-memory.js";
import { buildMemorySummary, readMemoryFiles } from "../../extensions/compaction-manager/session-memory.js";

function makePreparation(overrides?: Partial<CompactionPreparation>): CompactionPreparation {
	return {
		firstKeptEntryId: "entry-123",
		tokensBefore: 150000,
		messagesToSummarize: [],
		turnPrefixMessages: [],
		isSplitTurn: false,
		fileOps: { read: new Set(), edited: new Set() },
		settings: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
		...overrides,
	} as CompactionPreparation;
}

describe("buildMemorySummary", () => {
	it("builds summary from memory files", () => {
		const memoryFiles = new Map([
			["index.md", "# Project Memory\n## Key Decisions\n- Use TypeScript"],
			["progress.md", "## Done\n- [x] Setup project"],
		]);

		const result = buildMemorySummary(memoryFiles, makePreparation(), 50);
		expect(result).toBeDefined();
		expect(result!.summary).toContain("TypeScript");
		expect(result!.summary).toContain("Setup project");
		expect(result!.firstKeptEntryId).toBe("entry-123");
	});

	it("returns undefined when memory files are empty", () => {
		const result = buildMemorySummary(new Map(), makePreparation(), 50);
		expect(result).toBeUndefined();
	});

	it("returns undefined when summary exceeds reserveTokens budget", () => {
		const hugeContent = "x".repeat(100_000);
		const result = buildMemorySummary(new Map([["big.md", hugeContent]]), makePreparation(), 50);
		expect(result).toBeUndefined();
	});

	it("returns undefined when content below minimum length", () => {
		const result = buildMemorySummary(new Map([["tiny.md", "hi"]]), makePreparation(), 50);
		expect(result).toBeUndefined();
	});

	it("includes tokensBefore from preparation in result", () => {
		const memoryFiles = new Map([
			["notes.md", "## Notes\nSome content that is long enough to pass the minimum length check"],
		]);
		const prep = makePreparation({ tokensBefore: 99999 });
		const result = buildMemorySummary(memoryFiles, prep, 50);
		expect(result).toBeDefined();
		expect(result!.tokensBefore).toBe(99999);
	});

	it("formats multiple files with headers and separators", () => {
		const memoryFiles = new Map([
			["a.md", "content A"],
			["b.md", "content B"],
		]);
		const result = buildMemorySummary(memoryFiles, makePreparation(), 0);
		expect(result).toBeDefined();
		expect(result!.summary).toContain("### a.md");
		expect(result!.summary).toContain("### b.md");
		expect(result!.summary).toContain("---");
	});
});

describe("readMemoryFiles", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "pi-compaction-test-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("reads .md files from memory directory", async () => {
		const memDir = join(tempDir, ".pi", "memory");
		mkdirSync(memDir, { recursive: true });
		writeFileSync(join(memDir, "notes.md"), "# Notes\nSome notes");
		writeFileSync(join(memDir, "decisions.md"), "# Decisions\n- Use React");

		const result = await readMemoryFiles(tempDir, ".pi/memory");
		expect(result.size).toBe(2);
		expect(result.get("notes.md")).toContain("Notes");
		expect(result.get("decisions.md")).toContain("React");
	});

	it("ignores non-.md files", async () => {
		const memDir = join(tempDir, ".pi", "memory");
		mkdirSync(memDir, { recursive: true });
		writeFileSync(join(memDir, "notes.md"), "valid");
		writeFileSync(join(memDir, "data.json"), '{"key": "value"}');
		writeFileSync(join(memDir, "script.ts"), "const x = 1;");

		const result = await readMemoryFiles(tempDir, ".pi/memory");
		expect(result.size).toBe(1);
		expect(result.has("notes.md")).toBe(true);
	});

	it("returns empty map when directory does not exist", async () => {
		const result = await readMemoryFiles(tempDir, ".pi/nonexistent");
		expect(result.size).toBe(0);
	});

	it("returns empty map for empty directory", async () => {
		const memDir = join(tempDir, ".pi", "memory");
		mkdirSync(memDir, { recursive: true });

		const result = await readMemoryFiles(tempDir, ".pi/memory");
		expect(result.size).toBe(0);
	});

	it("reads file with empty content", async () => {
		const memDir = join(tempDir, ".pi", "memory");
		mkdirSync(memDir, { recursive: true });
		writeFileSync(join(memDir, "empty.md"), "");

		const result = await readMemoryFiles(tempDir, ".pi/memory");
		expect(result.size).toBe(1);
		expect(result.get("empty.md")).toBe("");
	});
});

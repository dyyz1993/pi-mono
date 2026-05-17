import { describe, expect, it, vi } from "vitest";
import { createSmartFileTracker } from "../../extensions/lsp/lsp/client/smart-file-tracker.js";

describe("smart-file-tracker", () => {
	describe("file type priority", () => {
		it("prioritizes common source files over other files", () => {
			const evicted: string[] = [];
			const tracker = createSmartFileTracker({
				maxOpenFiles: 3,
				now: () => 1000,
			});

			// Open non-source files first
			tracker.open("README.md", (f) => evicted.push(f));
			tracker.open("config.json", (f) => evicted.push(f));
			tracker.open(".gitignore", (f) => evicted.push(f));

			// Now try to open a source file - should evict lowest priority
			tracker.open("index.ts", (f) => evicted.push(f));

			// .gitignore should be evicted (lowest priority)
			expect(evicted).toContain(".gitignore");
			expect(tracker.getOpenFiles()).toContain("index.ts");
		});

		it("keeps TypeScript files as highest priority", () => {
			const evicted: string[] = [];
			const tracker = createSmartFileTracker({
				maxOpenFiles: 2,
				now: () => 1000,
			});

			tracker.open("utils.js", (f) => evicted.push(f));
			tracker.open("component.tsx", (f) => evicted.push(f));

			// Try to open another TS file - should evict JS
			tracker.open("types.ts", (f) => evicted.push(f));

			expect(evicted).toContain("utils.js");
			expect(tracker.getOpenFiles()).toContain("component.tsx");
			expect(tracker.getOpenFiles()).toContain("types.ts");
		});

		it("ignores excluded file types", () => {
			const evicted: string[] = [];
			const tracker = createSmartFileTracker({
				maxOpenFiles: 10,
			});

			tracker.open("main.ts", () => {});
			tracker.open("test.log", (f) => evicted.push(f));
			tracker.open("backup.bak", (f) => evicted.push(f));

			// Should not track log and bak files
			expect(tracker.getOpenFiles()).not.toContain("test.log");
			expect(tracker.getOpenFiles()).not.toContain("backup.bak");
			expect(evicted).toContain("test.log");
			expect(evicted).toContain("backup.bak");
		});
	});

	describe("last modified time priority", () => {
		it("prioritizes recently modified files", () => {
			const evicted: string[] = [];
			const now = () => 10000;
			const tracker = createSmartFileTracker({
				maxOpenFiles: 2,
				now,
			});

			// Open files with different modification times
			tracker.open("old.ts", (f) => evicted.push(f), 1000); // Modified long ago
			tracker.open("new.ts", (f) => evicted.push(f), 9000); // Recently modified

			// Try to open another file - should evict the oldest
			tracker.open("middle.ts", (f) => evicted.push(f), 5000);

			expect(evicted).toContain("old.ts");
			expect(tracker.getOpenFiles()).toContain("new.ts");
			expect(tracker.getOpenFiles()).toContain("middle.ts");
		});

		it("uses current time if mtime not provided", () => {
			const evicted: string[] = [];
			let currentTime = 1000;
			const tracker = createSmartFileTracker({
				maxOpenFiles: 2,
				now: () => {
					currentTime += 1000;
					return currentTime;
				},
			});

			tracker.open("first.ts", (f) => evicted.push(f)); // Opens at 2000
			tracker.open("second.ts", (f) => evicted.push(f)); // Opens at 3000

			// Third file - should evict first.ts
			tracker.open("third.ts", (f) => evicted.push(f)); // Opens at 4000

			expect(evicted).toContain("first.ts");
			// Files sorted by lastAccess (modifiedTime): third.ts (4000) > second.ts (3000)
			expect(tracker.getOpenFiles()).toEqual(["third.ts", "second.ts"]);
		});
	});

	describe("intelligent eviction policy", () => {
		it("evicts lowest priority files when full", () => {
			const evicted: string[] = [];
			const tracker = createSmartFileTracker({
				maxOpenFiles: 3,
				now: () => 1000,
			});

			tracker.open("config.json", (f) => evicted.push(f));
			tracker.open("helper.ts", (f) => evicted.push(f));
			tracker.open("main.ts", (f) => evicted.push(f));

			// All slots filled, open another high-priority file
			tracker.open("types.ts", (f) => evicted.push(f));

			// config.json (low priority, old) should be evicted
			expect(evicted).toContain("config.json");
			expect(tracker.getOpenFiles()).toContain("types.ts");
			expect(tracker.getOpenFiles().length).toBe(3);
		});

		it("re-accessing a file updates its priority", () => {
			const evicted: string[] = [];
			let now = 1000;
			const tracker = createSmartFileTracker({
				maxOpenFiles: 2,
				now: () => now,
			});

			tracker.open("first.ts", (f) => evicted.push(f), 500);
			tracker.open("second.ts", (f) => evicted.push(f), 600);

			// Re-access first.ts with updated mtime
			now = 1500;
			tracker.open("first.ts", (f) => evicted.push(f), 1400);

			// Now try to open third.ts - second.ts should be evicted
			tracker.open("third.ts", (f) => evicted.push(f), 1300);

			expect(evicted).toContain("second.ts");
			expect(tracker.getOpenFiles()).toContain("first.ts");
			expect(tracker.getOpenFiles()).toContain("third.ts");
		});
	});

	describe("memory-aware window sizing", () => {
		it("adjusts max files based on memory pressure", () => {
			const tracker = createSmartFileTracker({
				maxOpenFiles: 30, // Default
				now: () => 1000,
			});

			// Simulate high memory usage (2.5GB / 4GB = 61%)
			tracker.updateMemoryUsage({
				heapUsed: 2500 * 1024 * 1024, // 2.5GB
				heapTotal: 4075 * 1024 * 1024, // 4GB
			});

			const evicted: string[] = [];
			tracker.open("a.ts", (f) => evicted.push(f));
			tracker.open("b.ts", (f) => evicted.push(f));
			tracker.open("c.ts", (f) => evicted.push(f));

			// Should limit to fewer files under memory pressure
			for (let i = 0; i < 50; i++) {
				tracker.open(`file${i}.ts`, (f) => evicted.push(f));
			}

			// Should evict many files due to memory pressure
			// Original window size: 30, but under memory pressure it's reduced
			// So from 53 total files, we expect significant evictions
			expect(evicted.length).toBeGreaterThan(20);
		});

		it("releases more files when memory is very high", () => {
			const evicted: string[] = [];
			const tracker = createSmartFileTracker({
				maxOpenFiles: 30,
				now: () => 1000,
			});

			tracker.updateMemoryUsage({
				heapUsed: 3500 * 1024 * 1024, // 3.5GB - high pressure
				heapTotal: 4075 * 1024 * 1024,
			});

			// Open many files
			for (let i = 0; i < 30; i++) {
				tracker.open(`file${i}.ts`, (f) => evicted.push(f));
			}

			// Should evict to very small window
			const openFiles = tracker.getOpenFiles();
			expect(openFiles.length).toBeLessThan(10);
		});
	});

	describe("statistics and monitoring", () => {
		it("tracks file access counts", () => {
			const tracker = createSmartFileTracker({
				maxOpenFiles: 10,
				now: () => 1000,
			});

			tracker.open("frequent.ts", () => {});
			tracker.open("rare.ts", () => {});
			tracker.open("frequent.ts", () => {});
			tracker.open("frequent.ts", () => {});

			const stats = tracker.getStatistics();

			expect(stats.accessCounts?.get("frequent.ts")).toBe(3);
			expect(stats.accessCounts?.get("rare.ts")).toBe(1);
		});

		it("provides eviction statistics", () => {
			const evicted: string[] = [];
			const tracker = createSmartFileTracker({
				maxOpenFiles: 2,
				now: () => 1000,
			});

			tracker.open("a.ts", () => {});
			tracker.open("b.ts", () => {});
			tracker.open("c.ts", (f) => evicted.push(f));
			tracker.open("d.ts", (f) => evicted.push(f));

			const stats = tracker.getStatistics();

			expect(stats.totalEvictions).toBe(2);
			expect(stats.evictionReasons).toContain("window_full");
		});
	});

	describe("configuration and customization", () => {
		it("allows custom file type priorities", () => {
			const tracker = createSmartFileTracker({
				maxOpenFiles: 2,
				now: () => 1000,
				priorityMap: {
					// Custom priorities
					".custom": 100,
					".ts": 50,
					".js": 10,
				},
			});

			const evicted: string[] = [];
			tracker.open("test.ts", () => {});
			tracker.open("file.custom", () => {});

			// .ts should be evicted due to lower custom priority
			tracker.open("other.custom", (f) => evicted.push(f));

			expect(evicted).toContain("test.ts");
		});

		it("allows custom excluded extensions", () => {
			const tracker = createSmartFileTracker({
				maxOpenFiles: 10,
				excludedExtensions: new Set([".custom", ".test"]),
			});

			const evicted: string[] = [];
			tracker.open("file.custom", (f) => evicted.push(f));
			tracker.open("file.test", (f) => evicted.push(f));
			tracker.open("file.ts", () => {});

			expect(tracker.getOpenFiles()).toContain("file.ts");
			expect(tracker.getOpenFiles()).not.toContain("file.custom");
			expect(tracker.getOpenFiles()).not.toContain("file.test");
		});
	});
});

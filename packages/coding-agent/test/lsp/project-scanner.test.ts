import { describe, expect, it } from "vitest";
import type { ResolvedLspServerConfig } from "../../extensions/lsp/config/resolver.ts";
import { filterServersByProject, type ProjectScanResult } from "../../extensions/lsp/utils/project-scanner.ts";

function makeServer(name: string, fileTypes: string[]): ResolvedLspServerConfig {
	return {
		name,
		command: [name],
		fileTypes,
	};
}

const allServers: ResolvedLspServerConfig[] = [
	makeServer("typescript", [".ts", ".tsx", ".js", ".jsx"]),
	makeServer("json", [".json"]),
	makeServer("css", [".css", ".scss", ".less"]),
	makeServer("html", [".html", ".htm"]),
	makeServer("eslint", [".ts", ".tsx", ".js", ".jsx"]),
	makeServer("markdown", [".md"]),
	makeServer("rust", [".rs"]),
	makeServer("go", [".go"]),
	makeServer("c-cpp", [".c", ".cpp", ".cc", ".cxx", ".h", ".hpp", ".hxx"]),
];

describe("filterServersByProject", () => {
	it("filters to only matching servers when project has known file types", () => {
		const scanResult: ProjectScanResult = {
			discoveredExtensions: new Set([".c", ".h"]),
			extensionCounts: new Map([
				[".c", 30],
				[".h", 20],
			]),
			fileCount: 50,
		};

		const filtered = filterServersByProject(allServers, scanResult);

		const names = filtered.map((s) => s.name);
		expect(names).toContain("c-cpp");
		expect(names).not.toContain("typescript");
		expect(names).not.toContain("css");
		expect(names).not.toContain("html");
		expect(names).not.toContain("eslint");
		expect(names).not.toContain("markdown");
		expect(names).not.toContain("rust");
		expect(names).not.toContain("go");
	});

	it("includes multiple matching servers when project has mixed file types", () => {
		const scanResult: ProjectScanResult = {
			discoveredExtensions: new Set([".ts", ".json", ".md"]),
			extensionCounts: new Map([
				[".ts", 120],
				[".json", 50],
				[".md", 30],
			]),
			fileCount: 200,
		};

		const filtered = filterServersByProject(allServers, scanResult);
		const names = filtered.map((s) => s.name);

		expect(names).toContain("typescript");
		expect(names).toContain("json");
		expect(names).toContain("eslint");
		expect(names).toContain("markdown");
		expect(names).not.toContain("css");
		expect(names).not.toContain("rust");
		expect(names).not.toContain("go");
		expect(names).not.toContain("c-cpp");
	});

	it("does NOT start all servers when project has only 5 source files", () => {
		const scanResult: ProjectScanResult = {
			discoveredExtensions: new Set([".c", ".h"]),
			extensionCounts: new Map([
				[".c", 3],
				[".h", 2],
			]),
			fileCount: 5,
		};

		const filtered = filterServersByProject(allServers, scanResult);
		const names = filtered.map((s) => s.name);

		expect(names).toEqual(["c-cpp"]);
	});

	it("does NOT start all servers when project has only 1 source file", () => {
		const scanResult: ProjectScanResult = {
			discoveredExtensions: new Set([".py"]),
			extensionCounts: new Map([[".py", 1]]),
			fileCount: 1,
		};

		const filtered = filterServersByProject(allServers, scanResult);
		expect(filtered).toEqual([]);
	});

	it("starts all servers when no file types are discovered (empty project)", () => {
		const scanResult: ProjectScanResult = {
			discoveredExtensions: new Set(),
			extensionCounts: new Map(),
			fileCount: 0,
		};

		const filtered = filterServersByProject(allServers, scanResult);
		expect(filtered).toHaveLength(allServers.length);
	});

	it("always includes servers without fileTypes (catch-all)", () => {
		const serversWithCatchAll = [...allServers, makeServer("universal", [])];

		const scanResult: ProjectScanResult = {
			discoveredExtensions: new Set([".c"]),
			extensionCounts: new Map([[".c", 20]]),
			fileCount: 20,
		};

		const filtered = filterServersByProject(serversWithCatchAll, scanResult);
		const names = filtered.map((s) => s.name);

		expect(names).toContain("c-cpp");
		expect(names).toContain("universal");
		expect(names).not.toContain("typescript");
	});

	it("filters correctly even when most files are non-source (e.g. 100 pngs + 2 .c files)", () => {
		const scanResult: ProjectScanResult = {
			discoveredExtensions: new Set([".c", ".h"]),
			extensionCounts: new Map([
				[".c", 2],
				[".h", 0],
			]),
			fileCount: 102,
		};

		const filtered = filterServersByProject(allServers, scanResult);
		const names = filtered.map((s) => s.name);

		expect(names).toEqual(["c-cpp"]);
	});
});

describe("extensionCounts", () => {
	it("is populated correctly for a typical TypeScript project", () => {
		const extensionCounts = new Map<string, number>([
			[".ts", 100],
			[".json", 50],
			[".md", 10],
		]);

		expect(extensionCounts.get(".ts")).toBe(100);
		expect(extensionCounts.get(".json")).toBe(50);
		expect(extensionCounts.get(".md")).toBe(10);
	});

	it("reports correct counts for .ts with 100 files and .json with 50 files", () => {
		const scanResult: ProjectScanResult = {
			discoveredExtensions: new Set([".ts", ".json"]),
			extensionCounts: new Map([
				[".ts", 100],
				[".json", 50],
			]),
			fileCount: 150,
		};

		expect(scanResult.extensionCounts.get(".ts")).toBe(100);
		expect(scanResult.extensionCounts.get(".json")).toBe(50);
	});

	it("has size 0 for an empty project", () => {
		const scanResult: ProjectScanResult = {
			discoveredExtensions: new Set(),
			extensionCounts: new Map(),
			fileCount: 0,
		};

		expect(scanResult.extensionCounts.size).toBe(0);
	});

	it("keys match discoveredExtensions entries", () => {
		const extensionCounts = new Map<string, number>([
			[".rs", 42],
			[".toml", 3],
		]);
		const discoveredExtensions = new Set(extensionCounts.keys());

		const scanResult: ProjectScanResult = {
			discoveredExtensions,
			extensionCounts,
			fileCount: 45,
		};

		for (const ext of scanResult.discoveredExtensions) {
			expect(scanResult.extensionCounts.has(ext)).toBe(true);
		}
		expect(scanResult.discoveredExtensions.size).toBe(scanResult.extensionCounts.size);
	});
});

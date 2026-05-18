/**
 * Tests for project-scanner file type filtering logic.
 *
 * TDD cycle: these tests define the desired behavior BEFORE the implementation
 * changes. Run them, see red, fix the code, see green.
 */
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
	// -----------------------------------------------------------------------
	// Core behavior: only start servers whose fileTypes match the project
	// -----------------------------------------------------------------------

	it("filters to only matching servers when project has known file types", () => {
		// A pure C project (e.g. Raspberry Pi Pico)
		const scanResult: ProjectScanResult = {
			discoveredExtensions: new Set([".c", ".h"]),
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
			fileCount: 200,
		};

		const filtered = filterServersByProject(allServers, scanResult);
		const names = filtered.map((s) => s.name);

		expect(names).toContain("typescript");
		expect(names).toContain("json");
		expect(names).toContain("eslint"); // shares .ts/.tsx with typescript
		expect(names).toContain("markdown");
		expect(names).not.toContain("css");
		expect(names).not.toContain("rust");
		expect(names).not.toContain("go");
		expect(names).not.toContain("c-cpp");
	});

	// -----------------------------------------------------------------------
	// Bug: fileCount < 10 triggers "start all servers"
	// A pure C project with 5 .c files should NOT start typescript/css/html
	// -----------------------------------------------------------------------

	it("does NOT start all servers when project has only 5 source files", () => {
		const scanResult: ProjectScanResult = {
			discoveredExtensions: new Set([".c", ".h"]),
			fileCount: 5,
		};

		const filtered = filterServersByProject(allServers, scanResult);
		const names = filtered.map((s) => s.name);

		// Should only start c-cpp, NOT everything
		expect(names).toEqual(["c-cpp"]);
	});

	it("does NOT start all servers when project has only 1 source file", () => {
		const scanResult: ProjectScanResult = {
			discoveredExtensions: new Set([".py"]),
			fileCount: 1,
		};

		const filtered = filterServersByProject(allServers, scanResult);
		// No server matches .py, should return empty
		expect(filtered).toEqual([]);
	});

	// -----------------------------------------------------------------------
	// Safe fallback: truly empty project (no files discovered at all)
	// -----------------------------------------------------------------------

	it("starts all servers when no file types are discovered (empty project)", () => {
		const scanResult: ProjectScanResult = {
			discoveredExtensions: new Set(),
			fileCount: 0,
		};

		const filtered = filterServersByProject(allServers, scanResult);
		expect(filtered).toHaveLength(allServers.length);
	});

	// -----------------------------------------------------------------------
	// Catch-all servers (no fileTypes defined)
	// -----------------------------------------------------------------------

	it("always includes servers without fileTypes (catch-all)", () => {
		const serversWithCatchAll = [
			...allServers,
			makeServer("universal", []), // no fileTypes
		];

		const scanResult: ProjectScanResult = {
			discoveredExtensions: new Set([".c"]),
			fileCount: 20,
		};

		const filtered = filterServersByProject(serversWithCatchAll, scanResult);
		const names = filtered.map((s) => s.name);

		expect(names).toContain("c-cpp");
		expect(names).toContain("universal");
		expect(names).not.toContain("typescript");
	});

	// -----------------------------------------------------------------------
	// fileCount should reflect source files, not total files
	// A project with 100 .png files and 2 .c files should filter correctly
	// -----------------------------------------------------------------------

	it("filters correctly even when most files are non-source (e.g. 100 pngs + 2 .c files)", () => {
		const scanResult: ProjectScanResult = {
			discoveredExtensions: new Set([".c", ".h"]),
			fileCount: 102,
		};

		const filtered = filterServersByProject(allServers, scanResult);
		const names = filtered.map((s) => s.name);

		expect(names).toEqual(["c-cpp"]);
	});
});

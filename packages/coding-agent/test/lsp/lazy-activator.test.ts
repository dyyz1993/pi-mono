import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LspRuntimeRegistry } from "../../extensions/lsp/client/registry.js";
import type { ResolvedLspServerConfig } from "../../extensions/lsp/config/resolver.js";
import {
	createLazyActivator,
	type EnsureResult,
	type LazyActivator,
} from "../../extensions/lsp/utils/lazy-activator.js";

function createMockRuntime(): LspRuntimeRegistry {
	return {
		start: vi.fn(),
		stop: vi.fn(),
		reload: vi.fn(),
		request: vi.fn(),
		requestAll: vi.fn(),
		notify: vi.fn(),
		getPublishedDiagnostics: vi.fn(() => []),
		clearPublishedDiagnostics: vi.fn(),
		getStatus: vi.fn(() => ({
			state: "inactive" as const,
			reason: "",
			configuredServers: 0,
			activeServers: 0,
			servers: [],
		})),
		getStatusForPath: vi.fn(() => undefined),
		startSingle: vi.fn(async () => {}),
		stopSingle: vi.fn(async () => {}),
		touchAccess: vi.fn(),
		getIdleServers: vi.fn(() => []),
		setPrimary: vi.fn(),
		getEntryMeta: vi.fn(() => undefined),
	} as unknown as LspRuntimeRegistry;
}

const SERVER_CONFIGS: ResolvedLspServerConfig[] = [
	{ name: "typescript", command: ["typescript-language-server", "--stdio"], fileTypes: [".ts", ".tsx"] },
	{ name: "eslint", command: ["vscode-eslint-language-server", "--stdio"], fileTypes: [".ts", ".tsx", ".js", ".jsx"] },
	{ name: "json", command: ["vscode-json-language-server", "--stdio"], fileTypes: [".json"] },
	{ name: "clangd", command: ["clangd"], fileTypes: [".c", ".cpp", ".h"] },
	{ name: "generic", command: ["some-lsp"] },
];

describe("LazyActivator", () => {
	let mockRuntime: LspRuntimeRegistry;
	let activator: LazyActivator;

	beforeEach(() => {
		mockRuntime = createMockRuntime();
		activator = createLazyActivator(mockRuntime);
	});

	describe("buildIndex", () => {
		it("maps extensions to server names", () => {
			activator.buildIndex(SERVER_CONFIGS);

			const extMap = activator.getExtMap();
			expect(extMap.get(".ts")).toEqual(["typescript", "eslint"]);
			expect(extMap.get(".tsx")).toEqual(["typescript", "eslint"]);
			expect(extMap.get(".json")).toEqual(["json"]);
			expect(extMap.get(".c")).toEqual(["clangd"]);
			expect(extMap.get(".cpp")).toEqual(["clangd"]);
			expect(extMap.get(".h")).toEqual(["clangd"]);
		});

		it("maps .js/.jsx to eslint only", () => {
			activator.buildIndex(SERVER_CONFIGS);

			const extMap = activator.getExtMap();
			expect(extMap.get(".js")).toEqual(["eslint"]);
			expect(extMap.get(".jsx")).toEqual(["eslint"]);
		});

		it("excludes servers without fileTypes from extMap", () => {
			activator.buildIndex(SERVER_CONFIGS);

			const extMap = activator.getExtMap();
			for (const names of extMap.values()) {
				expect(names).not.toContain("generic");
			}
		});

		it("handles empty servers array", () => {
			activator.buildIndex([]);

			expect(activator.getExtMap().size).toBe(0);
		});

		it("clears previous index on repeated calls", () => {
			activator.buildIndex(SERVER_CONFIGS);
			expect(activator.getExtMap().size).toBeGreaterThan(0);

			activator.buildIndex([{ name: "pylsp", command: ["pylsp"], fileTypes: [".py"] }]);
			const extMap = activator.getExtMap();
			expect(extMap.size).toBe(1);
			expect(extMap.get(".py")).toEqual(["pylsp"]);
			expect(extMap.has(".ts")).toBe(false);
		});

		it("normalizes fileTypes to lowercase", () => {
			activator.buildIndex([{ name: "test", command: ["test"], fileTypes: [".TS", ".JSON"] }]);

			const extMap = activator.getExtMap();
			expect(extMap.get(".ts")).toEqual(["test"]);
			expect(extMap.get(".json")).toEqual(["test"]);
		});
	});

	describe("markPrimary", () => {
		it("marks servers for top-2 extensions as primary", () => {
			activator.buildIndex(SERVER_CONFIGS);

			const counts = new Map<string, number>([
				[".ts", 847],
				[".json", 120],
				[".md", 45],
				[".c", 1],
			]);
			activator.markPrimary(counts);

			const primaries = activator.getPrimaryServerNames();
			expect(primaries).toContain("typescript");
			expect(primaries).toContain("eslint");
			expect(primaries).toContain("json");
			expect(primaries).not.toContain("clangd");
		});

		it("marks only 1 primary when all files same extension (primaryThreshold=2)", () => {
			activator.buildIndex(SERVER_CONFIGS);

			const counts = new Map<string, number>([[".ts", 500]]);
			activator.markPrimary(counts);

			const primaries = activator.getPrimaryServerNames();
			expect(primaries).toContain("typescript");
			expect(primaries).toContain("eslint");
		});

		it("empty project has no primaries", () => {
			activator.buildIndex(SERVER_CONFIGS);
			activator.markPrimary(new Map());

			expect(activator.getPrimaryServerNames()).toEqual([]);
		});

		it("respects primaryThreshold=1", () => {
			const a = createLazyActivator(mockRuntime, { primaryThreshold: 1 });
			a.buildIndex(SERVER_CONFIGS);

			const counts = new Map<string, number>([
				[".ts", 847],
				[".json", 120],
			]);
			a.markPrimary(counts);

			const primaries = a.getPrimaryServerNames();
			expect(primaries).toContain("typescript");
			expect(primaries).toContain("eslint");
			expect(primaries).not.toContain("json");
		});

		it("primaryThreshold=3 but only 2 extensions → 2 primaries", () => {
			const a = createLazyActivator(mockRuntime, { primaryThreshold: 3 });
			a.buildIndex(SERVER_CONFIGS);

			const counts = new Map<string, number>([
				[".ts", 847],
				[".json", 120],
			]);
			a.markPrimary(counts);

			const primaries = a.getPrimaryServerNames();
			expect(primaries).toContain("typescript");
			expect(primaries).toContain("eslint");
			expect(primaries).toContain("json");
		});

		it("clears previous primaries on repeated calls", () => {
			activator.buildIndex(SERVER_CONFIGS);

			const counts1 = new Map<string, number>([[".ts", 100]]);
			activator.markPrimary(counts1);
			expect(activator.getPrimaryServerNames()).toContain("typescript");

			const counts2 = new Map<string, number>([[".json", 50]]);
			activator.markPrimary(counts2);

			const primaries = activator.getPrimaryServerNames();
			expect(primaries).not.toContain("typescript");
			expect(primaries).toContain("json");
		});

		it("extensions with no matching servers are ignored", () => {
			activator.buildIndex(SERVER_CONFIGS);

			const counts = new Map<string, number>([
				[".zzz", 999],
				[".ts", 10],
			]);
			activator.markPrimary(counts);

			const primaries = activator.getPrimaryServerNames();
			expect(primaries).toContain("typescript");
			expect(primaries).toContain("eslint");
		});
	});

	describe("startPrimaryServers", () => {
		it("calls startSingle and setPrimary for each primary server", async () => {
			activator.buildIndex(SERVER_CONFIGS);

			const counts = new Map<string, number>([
				[".ts", 100],
				[".json", 50],
			]);
			activator.markPrimary(counts);

			const started = await activator.startPrimaryServers();

			expect(started).toContain("typescript");
			expect(started).toContain("eslint");
			expect(started).toContain("json");
			expect(started).toHaveLength(3);

			expect(mockRuntime.startSingle).toHaveBeenCalledWith(
				"typescript",
				["typescript-language-server", "--stdio"],
				[".ts", ".tsx"],
			);
			expect(mockRuntime.startSingle).toHaveBeenCalledWith(
				"eslint",
				["vscode-eslint-language-server", "--stdio"],
				[".ts", ".tsx", ".js", ".jsx"],
			);
			expect(mockRuntime.startSingle).toHaveBeenCalledWith(
				"json",
				["vscode-json-language-server", "--stdio"],
				[".json"],
			);
			expect(mockRuntime.setPrimary).toHaveBeenCalledWith("typescript");
			expect(mockRuntime.setPrimary).toHaveBeenCalledWith("eslint");
			expect(mockRuntime.setPrimary).toHaveBeenCalledWith("json");
		});

		it("skips servers already in entries (already running)", async () => {
			(mockRuntime.getEntryMeta as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
				if (name === "typescript") {
					return { isPrimary: false, accessCount: 5, lastAccessTime: Date.now() };
				}
				return undefined;
			});

			activator.buildIndex(SERVER_CONFIGS);
			activator.markPrimary(new Map<string, number>([[".ts", 100]]));

			const started = await activator.startPrimaryServers();

			expect(started).toContain("typescript");
			expect(started).toContain("eslint");

			expect(mockRuntime.startSingle).toHaveBeenCalledWith("typescript", expect.any(Array), expect.any(Array));
			expect(mockRuntime.setPrimary).toHaveBeenCalledWith("typescript");
		});

		it("returns empty array if no primaries", async () => {
			activator.buildIndex(SERVER_CONFIGS);
			const started = await activator.startPrimaryServers();
			expect(started).toEqual([]);
		});
	});

	describe("ensureServerForFile", () => {
		it("starts servers for .ts file", async () => {
			activator.buildIndex(SERVER_CONFIGS);

			const results = await activator.ensureServerForFile("src/foo.ts");

			expect(results).toEqual([
				{ name: "typescript", started: true },
				{ name: "eslint", started: true },
			]);
			expect(mockRuntime.startSingle).toHaveBeenCalledWith("typescript", expect.any(Array), expect.any(Array));
			expect(mockRuntime.startSingle).toHaveBeenCalledWith("eslint", expect.any(Array), expect.any(Array));
		});

		it("touches access for already-running servers", async () => {
			(mockRuntime.getEntryMeta as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
				if (name === "typescript") {
					return { isPrimary: false, accessCount: 5, lastAccessTime: Date.now() };
				}
				return undefined;
			});

			activator.buildIndex(SERVER_CONFIGS);

			const results = await activator.ensureServerForFile("src/foo.ts");

			expect(results).toEqual([
				{ name: "typescript", started: false },
				{ name: "eslint", started: true },
			]);
			expect(mockRuntime.touchAccess).toHaveBeenCalledWith("typescript");
			expect(mockRuntime.startSingle).not.toHaveBeenCalledWith("typescript", expect.anything(), expect.anything());
			expect(mockRuntime.startSingle).toHaveBeenCalledWith("eslint", expect.anything(), expect.anything());
		});

		it("returns empty for unknown extension (.py)", async () => {
			activator.buildIndex(SERVER_CONFIGS);

			const results = await activator.ensureServerForFile("script.py");
			expect(results).toEqual([]);
			expect(mockRuntime.startSingle).not.toHaveBeenCalled();
		});

		it("returns empty for file with no extension", async () => {
			activator.buildIndex(SERVER_CONFIGS);

			const results = await activator.ensureServerForFile("Makefile");
			expect(results).toEqual([]);
			expect(mockRuntime.startSingle).not.toHaveBeenCalled();
		});

		it("handles case-insensitive extension", async () => {
			activator.buildIndex(SERVER_CONFIGS);

			const results = await activator.ensureServerForFile("src/foo.TS");
			expect(results).toEqual([
				{ name: "typescript", started: true },
				{ name: "eslint", started: true },
			]);
		});

		it("returns empty before buildIndex is called", async () => {
			const results = await activator.ensureServerForFile("src/foo.ts");
			expect(results).toEqual([]);
		});
	});

	describe("getServerNamesForExt", () => {
		it("returns server names for known extension", () => {
			activator.buildIndex(SERVER_CONFIGS);

			expect(activator.getServerNamesForExt(".ts")).toEqual(["typescript", "eslint"]);
			expect(activator.getServerNamesForExt(".json")).toEqual(["json"]);
			expect(activator.getServerNamesForExt(".c")).toEqual(["clangd"]);
		});

		it("returns empty for unknown extension", () => {
			activator.buildIndex(SERVER_CONFIGS);

			expect(activator.getServerNamesForExt(".py")).toEqual([]);
		});

		it("is case-insensitive", () => {
			activator.buildIndex(SERVER_CONFIGS);

			expect(activator.getServerNamesForExt(".TS")).toEqual(["typescript", "eslint"]);
			expect(activator.getServerNamesForExt(".Json")).toEqual(["json"]);
		});
	});
});

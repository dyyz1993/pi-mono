import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLspRuntimeRegistry, type LspRuntimeRegistry } from "../../extensions/lsp/client/registry.js";
import type { LspClientRuntime, LspRuntimeState } from "../../extensions/lsp/client/runtime.js";
import { createLazyActivator, type LazyActivator } from "../../extensions/lsp/utils/lazy-activator.js";
import { createIdleCleaner, getIdleTimeoutMs, type IdleCleaner } from "../../extensions/lsp/utils/idle-cleaner.js";
import type { ResolvedLspServerConfig } from "../../extensions/lsp/config/resolver.js";

type MockRuntimeMap = Map<string, LspClientRuntime>;

function createMockRuntime(): LspClientRuntime {
	let state: LspRuntimeState = "inactive";
	return {
		start: vi.fn(async () => {
			state = "ready";
		}),
		stop: vi.fn(async () => {
			state = "inactive";
		}),
		reload: vi.fn(async () => {}),
		request: vi.fn(async () => null),
		notify: vi.fn(),
		getPublishedDiagnostics: vi.fn(() => []),
		clearPublishedDiagnostics: vi.fn(),
		getStatus: vi.fn(() => ({
			state,
			reason: state === "ready" ? "Ready" : "Not ready",
			configuredCommand: undefined,
			activeCommand: undefined,
			transport: undefined,
			lspmuxAvailable: false,
			fallbackReason: undefined,
			pid: state === "ready" ? 1234 : undefined,
			diagnosticsCount: 0,
		})),
	};
}

const testServers: ResolvedLspServerConfig[] = [
	{ name: "typescript", command: ["typescript-language-server", "--stdio"], fileTypes: [".ts", ".tsx", ".js", ".jsx"] },
	{ name: "eslint", command: ["eslint-lsp", "--stdio"], fileTypes: [".ts", ".tsx", ".js", ".jsx"] },
	{ name: "json", command: ["vscode-json-language-server", "--stdio"], fileTypes: [".json"] },
	{ name: "css", command: ["vscode-css-language-server", "--stdio"], fileTypes: [".css", ".scss", ".less"] },
	{ name: "html", command: ["vscode-html-language-server", "--stdio"], fileTypes: [".html", ".htm"] },
	{ name: "markdown", command: ["vscode-markdown-language-server", "--stdio"], fileTypes: [".md"] },
	{ name: "rust", command: ["rust-analyzer"], fileTypes: [".rs"] },
	{ name: "go", command: ["gopls"], fileTypes: [".go"] },
	{ name: "clangd", command: ["clangd"], fileTypes: [".c", ".cpp", ".cc", ".cxx", ".h", ".hpp", ".hxx"] },
];

function setupEnvironment() {
	const runtimeMap: MockRuntimeMap = new Map();

	const registry = createLspRuntimeRegistry({
		createRuntime: () => {
			const rt = createMockRuntime();
			return rt;
		},
	});

	const lazyActivator = createLazyActivator(registry, { primaryThreshold: 2 });

	lazyActivator.buildIndex(testServers);

	return { registry, lazyActivator, runtimeMap };
}

describe("LSP lazy activation integration", () => {
	let registry: LspRuntimeRegistry;
	let lazyActivator: LazyActivator;
	let idleCleaner: IdleCleaner;

	beforeEach(() => {
		const env = setupEnvironment();
		registry = env.registry;
		lazyActivator = env.lazyActivator;
	});

	it("session_start only starts primary servers", async () => {
		const extCounts = new Map<string, number>([
			[".ts", 100],
			[".json", 20],
			[".c", 1],
		]);
		lazyActivator.markPrimary(extCounts);

		const started = await lazyActivator.startPrimaryServers();
		const primaries = new Set(lazyActivator.getPrimaryServerNames());

		expect(started.sort()).toEqual(["eslint", "json", "typescript"]);

		const status = registry.getStatus();
		for (const server of status.servers) {
			if (primaries.has(server.name)) {
				expect(server.status.state).toBe("ready");
			}
		}

		expect(status.servers.map((s) => s.name).sort()).toEqual(["eslint", "json", "typescript"]);

		for (const name of ["css", "html", "markdown", "rust", "go", "clangd"]) {
			expect(registry.getEntryMeta(name)).toBeUndefined();
		}
	});

	it("write to .c file triggers clangd lazy activation", async () => {
		const extCounts = new Map<string, number>([
			[".ts", 100],
			[".json", 20],
		]);
		lazyActivator.markPrimary(extCounts);
		await lazyActivator.startPrimaryServers();

		const results = await lazyActivator.ensureServerForFile("src/doom.c");

		const clangdResult = results.find((r) => r.name === "clangd");
		expect(clangdResult).toBeDefined();
		expect(clangdResult!.started).toBe(true);

		expect(registry.getEntryMeta("clangd")).toBeDefined();
		expect(registry.getEntryMeta("clangd")!.accessCount).toBe(0);

		const tsResult = results.find((r) => r.name === "typescript");
		expect(tsResult).toBeUndefined();
	});

	it("idle cleaner unloads secondary after timeout", async () => {
		vi.useFakeTimers({ now: 0 });

		const baseMs = 2 * 60 * 1000;
		const stepMs = 2 * 60 * 1000;

		const env = setupEnvironment();
		registry = env.registry;
		lazyActivator = env.lazyActivator;
		idleCleaner = createIdleCleaner(registry, {
			baseTimeoutMs: baseMs,
			stepTimeoutMs: stepMs,
			maxTimeoutMs: 30 * 60 * 1000,
		});

		const extCounts = new Map<string, number>([
			[".ts", 100],
			[".json", 20],
		]);
		lazyActivator.markPrimary(extCounts);
		await lazyActivator.startPrimaryServers();

		await lazyActivator.ensureServerForFile("src/doom.c");
		expect(registry.getEntryMeta("clangd")).toBeDefined();

		vi.advanceTimersByTime(baseMs + 1);

		await idleCleaner.tick();

		expect(registry.getEntryMeta("clangd")).toBeUndefined();

		expect(registry.getEntryMeta("typescript")).toBeDefined();
		expect(registry.getEntryMeta("typescript")!.isPrimary).toBe(true);

		vi.useRealTimers();
	});

	it("reactivation after unload preserves accessCount", async () => {
		await registry.startSingle("clangd", ["clangd"], [".c", ".cpp"]);
		registry.touchAccess("clangd");
		registry.touchAccess("clangd");
		registry.touchAccess("clangd");
		expect(registry.getEntryMeta("clangd")!.accessCount).toBe(3);

		await registry.stopSingle("clangd");
		expect(registry.getEntryMeta("clangd")).toBeUndefined();

		await registry.startSingle("clangd", ["clangd"], [".c", ".cpp"]);
		expect(registry.getEntryMeta("clangd")!.accessCount).toBe(3);
	});

	it("dynamic timeout — frequent access survives longer", async () => {
		vi.useFakeTimers({ now: 0 });

		const baseMs = 2 * 60 * 1000;
		const stepMs = 2 * 60 * 1000;
		const maxMs = 30 * 60 * 1000;

		const env = setupEnvironment();
		registry = env.registry;
		lazyActivator = env.lazyActivator;
		idleCleaner = createIdleCleaner(registry, {
			baseTimeoutMs: baseMs,
			stepTimeoutMs: stepMs,
			maxTimeoutMs: maxMs,
		});

		const extCounts = new Map<string, number>([
			[".ts", 100],
			[".json", 20],
		]);
		lazyActivator.markPrimary(extCounts);
		await lazyActivator.startPrimaryServers();

		await lazyActivator.ensureServerForFile("src/doom.c");
		for (let i = 0; i < 10; i++) {
			registry.touchAccess("clangd");
		}
		expect(registry.getEntryMeta("clangd")!.accessCount).toBe(10);

		const expectedTimeout = getIdleTimeoutMs(10, { base: baseMs, step: stepMs, max: maxMs });
		expect(expectedTimeout).toBe(baseMs + 10 * stepMs);

		vi.advanceTimersByTime(10 * 60 * 1000);
		await idleCleaner.tick();
		expect(registry.getEntryMeta("clangd")).toBeDefined();

		vi.advanceTimersByTime(15 * 60 * 1000);
		await idleCleaner.tick();
		expect(registry.getEntryMeta("clangd")).toBeUndefined();

		vi.useRealTimers();
	});

	it("multiple file types activate multiple servers", async () => {
		const extCounts = new Map<string, number>([
			[".ts", 100],
			[".json", 20],
		]);
		lazyActivator.markPrimary(extCounts);
		await lazyActivator.startPrimaryServers();

		const results = await lazyActivator.ensureServerForFile("style.css");

		const cssResult = results.find((r) => r.name === "css");
		expect(cssResult).toBeDefined();
		expect(cssResult!.started).toBe(true);
		expect(registry.getEntryMeta("css")).toBeDefined();

		const tsMeta = registry.getEntryMeta("typescript");
		expect(tsMeta).toBeDefined();
		const tsAccessBefore = tsMeta!.accessCount;

		const tsResult = results.find((r) => r.name === "typescript");
		expect(tsResult).toBeUndefined();

		expect(registry.getEntryMeta("typescript")!.accessCount).toBe(tsAccessBefore);
	});
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	LspRuntimeEntryMeta,
	LspRuntimeRegistry,
	LspRuntimeRegistryStatus,
} from "../../extensions/lsp/client/registry.js";
import {
	createIdleCleaner,
	getIdleTimeoutMs,
	type IdleCleaner,
	type IdleCleanerOptions,
} from "../../extensions/lsp/utils/idle-cleaner.js";

function createMockRegistry(overrides?: {
	servers?: Array<{ name: string; state: string }>;
	meta?: Record<string, LspRuntimeEntryMeta>;
}): LspRuntimeRegistry {
	const servers = overrides?.servers ?? [];
	const metaMap = overrides?.meta ?? {};

	const status: LspRuntimeRegistryStatus = {
		state: servers.length > 0 ? "ready" : "inactive",
		reason: "test",
		configuredServers: servers.length,
		activeServers: servers.filter((s) => s.state === "ready").length,
		servers: servers.map((s) => ({
			name: s.name,
			fileTypes: [],
			status: { state: s.state, reason: "test" } as any,
		})),
	};

	return {
		start: vi.fn(async () => {}),
		stop: vi.fn(async () => {}),
		reload: vi.fn(async () => {}),
		request: vi.fn(async () => null),
		requestAll: vi.fn(async () => []),
		notify: vi.fn(),
		getPublishedDiagnostics: vi.fn(() => []),
		clearPublishedDiagnostics: vi.fn(),
		getStatus: vi.fn(() => status),
		getStatusForPath: vi.fn(() => undefined),
		startSingle: vi.fn(async () => {}),
		stopSingle: vi.fn(async () => {}),
		touchAccess: vi.fn(),
		getIdleServers: vi.fn(() => []),
		setPrimary: vi.fn(),
		getEntryMeta: vi.fn((name: string) => metaMap[name] ?? undefined),
	} as unknown as LspRuntimeRegistry;
}

describe("getIdleTimeoutMs", () => {
	it("computes timeout for accessCount=1 → 2 + 1×2 = 4min", () => {
		expect(getIdleTimeoutMs(1)).toBe(4 * 60 * 1000);
	});

	it("computes timeout for accessCount=3 → 2 + 3×2 = 8min", () => {
		expect(getIdleTimeoutMs(3)).toBe(8 * 60 * 1000);
	});

	it("computes timeout for accessCount=10 → 2 + 10×2 = 22min", () => {
		expect(getIdleTimeoutMs(10)).toBe(22 * 60 * 1000);
	});

	it("caps at max 30min for accessCount=50 → min(2+50×2, 30) = 30min", () => {
		expect(getIdleTimeoutMs(50)).toBe(30 * 60 * 1000);
	});

	it("respects custom base/step/max", () => {
		expect(getIdleTimeoutMs(5, { base: 60000, step: 30000, max: 300000 })).toBe(60000 + 5 * 30000);
	});
});

describe("IdleCleaner", () => {
	let cleaner: IdleCleaner;

	afterEach(() => {
		cleaner?.stop();
	});

	describe("tick — unloads idle secondary servers", () => {
		it("stops a secondary server idle beyond its dynamic timeout", async () => {
			const now = Date.now();
			const registry = createMockRegistry({
				servers: [{ name: "clangd", state: "ready" }],
				meta: {
					clangd: { isPrimary: false, accessCount: 1, lastAccessTime: now - 5 * 60 * 1000 },
				},
			});

			cleaner = createIdleCleaner(registry, {
				baseTimeoutMs: 2 * 60 * 1000,
				stepTimeoutMs: 2 * 60 * 1000,
				maxTimeoutMs: 30 * 60 * 1000,
			});
			await cleaner.tick();

			expect(registry.stopSingle).toHaveBeenCalledWith("clangd");
		});
	});

	describe("tick — skips primary servers", () => {
		it("does not stop a primary server even if idle for 30min", async () => {
			const now = Date.now();
			const registry = createMockRegistry({
				servers: [{ name: "typescript", state: "ready" }],
				meta: {
					typescript: { isPrimary: true, accessCount: 1, lastAccessTime: now - 30 * 60 * 1000 },
				},
			});

			cleaner = createIdleCleaner(registry);
			await cleaner.tick();

			expect(registry.stopSingle).not.toHaveBeenCalled();
		});
	});

	describe("tick — skips servers within timeout", () => {
		it("does not stop a server accessed recently", async () => {
			const now = Date.now();
			const registry = createMockRegistry({
				servers: [{ name: "clangd", state: "ready" }],
				meta: {
					clangd: { isPrimary: false, accessCount: 1, lastAccessTime: now - 60 * 1000 },
				},
			});

			cleaner = createIdleCleaner(registry, {
				baseTimeoutMs: 2 * 60 * 1000,
				stepTimeoutMs: 2 * 60 * 1000,
			});
			await cleaner.tick();

			expect(registry.stopSingle).not.toHaveBeenCalled();
		});
	});

	describe("start/stop lifecycle", () => {
		it("start begins interval, stop clears it, no ticks after stop", async () => {
			vi.useFakeTimers();
			const registry = createMockRegistry({
				servers: [{ name: "clangd", state: "ready" }],
				meta: {
					clangd: { isPrimary: false, accessCount: 1, lastAccessTime: Date.now() - 5 * 60 * 1000 },
				},
			});

			cleaner = createIdleCleaner(registry, { checkIntervalMs: 1000 });
			cleaner.start();

			expect(registry.stopSingle).not.toHaveBeenCalled();

			vi.advanceTimersByTime(1000);
			await vi.advanceTimersByTimeAsync(0);

			expect(registry.stopSingle).toHaveBeenCalled();
			registry.stopSingle.mockClear();

			cleaner.stop();
			vi.advanceTimersByTime(5000);
			await vi.advanceTimersByTimeAsync(0);

			expect(registry.stopSingle).not.toHaveBeenCalled();

			vi.useRealTimers();
		});
	});

	describe("dynamic timeout — high accessCount = longer survival", () => {
		it("does NOT unload server with accessCount=10 idle 15min (timeout 22min)", async () => {
			const now = Date.now();
			const registry = createMockRegistry({
				servers: [{ name: "clangd", state: "ready" }],
				meta: {
					clangd: { isPrimary: false, accessCount: 10, lastAccessTime: now - 15 * 60 * 1000 },
				},
			});

			cleaner = createIdleCleaner(registry, {
				baseTimeoutMs: 2 * 60 * 1000,
				stepTimeoutMs: 2 * 60 * 1000,
				maxTimeoutMs: 30 * 60 * 1000,
			});
			await cleaner.tick();

			expect(registry.stopSingle).not.toHaveBeenCalled();
		});

		it("DOES unload server with accessCount=1 idle 5min (timeout 4min)", async () => {
			const now = Date.now();
			const registry = createMockRegistry({
				servers: [{ name: "clangd", state: "ready" }],
				meta: {
					clangd: { isPrimary: false, accessCount: 1, lastAccessTime: now - 5 * 60 * 1000 },
				},
			});

			cleaner = createIdleCleaner(registry, {
				baseTimeoutMs: 2 * 60 * 1000,
				stepTimeoutMs: 2 * 60 * 1000,
				maxTimeoutMs: 30 * 60 * 1000,
			});
			await cleaner.tick();

			expect(registry.stopSingle).toHaveBeenCalledWith("clangd");
		});
	});

	describe("onUnload callback", () => {
		it("calls onUnload with server name when a server is unloaded", async () => {
			const now = Date.now();
			const onUnload = vi.fn();
			const registry = createMockRegistry({
				servers: [{ name: "clangd", state: "ready" }],
				meta: {
					clangd: { isPrimary: false, accessCount: 1, lastAccessTime: now - 5 * 60 * 1000 },
				},
			});

			cleaner = createIdleCleaner(registry, {
				baseTimeoutMs: 2 * 60 * 1000,
				stepTimeoutMs: 2 * 60 * 1000,
				onUnload,
			});
			await cleaner.tick();

			expect(onUnload).toHaveBeenCalledWith("clangd");
		});
	});

	describe("Multiple idle servers", () => {
		it("stops all 3 idle secondary servers in one tick", async () => {
			const now = Date.now();
			const registry = createMockRegistry({
				servers: [
					{ name: "clangd", state: "ready" },
					{ name: "gopls", state: "ready" },
					{ name: "rust-analyzer", state: "ready" },
				],
				meta: {
					clangd: { isPrimary: false, accessCount: 1, lastAccessTime: now - 5 * 60 * 1000 },
					gopls: { isPrimary: false, accessCount: 2, lastAccessTime: now - 10 * 60 * 1000 },
					"rust-analyzer": { isPrimary: false, accessCount: 3, lastAccessTime: now - 20 * 60 * 1000 },
				},
			});

			cleaner = createIdleCleaner(registry, {
				baseTimeoutMs: 2 * 60 * 1000,
				stepTimeoutMs: 2 * 60 * 1000,
				maxTimeoutMs: 30 * 60 * 1000,
			});
			await cleaner.tick();

			expect(registry.stopSingle).toHaveBeenCalledTimes(3);
			expect(registry.stopSingle).toHaveBeenCalledWith("clangd");
			expect(registry.stopSingle).toHaveBeenCalledWith("gopls");
			expect(registry.stopSingle).toHaveBeenCalledWith("rust-analyzer");
		});
	});

	describe("tick — skips non-ready servers", () => {
		it("does not stop a server that is in 'starting' state", async () => {
			const now = Date.now();
			const registry = createMockRegistry({
				servers: [{ name: "clangd", state: "starting" }],
				meta: {
					clangd: { isPrimary: false, accessCount: 1, lastAccessTime: now - 5 * 60 * 1000 },
				},
			});

			cleaner = createIdleCleaner(registry);
			await cleaner.tick();

			expect(registry.stopSingle).not.toHaveBeenCalled();
		});
	});

	describe("tick — handles stopSingle errors gracefully", () => {
		it("continues stopping other servers if one fails", async () => {
			const now = Date.now();
			const registry = createMockRegistry({
				servers: [
					{ name: "clangd", state: "ready" },
					{ name: "gopls", state: "ready" },
				],
				meta: {
					clangd: { isPrimary: false, accessCount: 1, lastAccessTime: now - 5 * 60 * 1000 },
					gopls: { isPrimary: false, accessCount: 1, lastAccessTime: now - 5 * 60 * 1000 },
				},
			});

			(registry.stopSingle as ReturnType<typeof vi.fn>).mockImplementation(async (name: string) => {
				if (name === "clangd") throw new Error("stop failed");
			});

			const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			cleaner = createIdleCleaner(registry, {
				baseTimeoutMs: 2 * 60 * 1000,
				stepTimeoutMs: 2 * 60 * 1000,
			});
			await cleaner.tick();

			expect(registry.stopSingle).toHaveBeenCalledTimes(2);
			expect(consoleWarnSpy).toHaveBeenCalled();
			consoleWarnSpy.mockRestore();
		});
	});
});

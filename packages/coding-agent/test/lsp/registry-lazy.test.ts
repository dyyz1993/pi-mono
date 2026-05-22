import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLspRuntimeRegistry, type LspRuntimeRegistry } from "../../extensions/lsp/client/registry.js";
import type { LspClientRuntime, LspRuntimeStatus } from "../../extensions/lsp/client/runtime.js";
import type { ServerMetricsCollector } from "../../extensions/lsp/monitoring/server-metrics.js";

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

function createMockMetrics(): ServerMetricsCollector {
	return {
		onStarting: vi.fn(),
		onReady: vi.fn(),
		onError: vi.fn(),
		onStop: vi.fn(),
		onRequest: vi.fn(),
		onNotify: vi.fn(),
	} as unknown as ServerMetricsCollector;
}

type LspRuntimeState = "inactive" | "starting" | "ready" | "error";

describe("LspRuntimeRegistry lazy activation", () => {
	let registry: LspRuntimeRegistry;
	let mockRuntime: LspClientRuntime;
	let mockMetrics: ServerMetricsCollector;

	beforeEach(() => {
		mockRuntime = createMockRuntime();
		mockMetrics = createMockMetrics();
		registry = createLspRuntimeRegistry({
			createRuntime: () => mockRuntime,
			metrics: mockMetrics,
		});
	});

	describe("startSingle", () => {
		it("starts a single server and adds to entries", async () => {
			await registry.startSingle!("clangd", ["clangd"], [".c", ".cpp"]);

			const status = registry.getStatus();
			expect(status.servers).toHaveLength(1);
			expect(status.servers[0].name).toBe("clangd");
			expect(status.servers[0].fileTypes).toEqual([".c", ".cpp"]);
			expect(mockRuntime.start).toHaveBeenCalledWith(["clangd"]);
			expect(mockMetrics.onStarting).toHaveBeenCalledWith("clangd", [".c", ".cpp"]);
			expect(mockMetrics.onReady).toHaveBeenCalledWith("clangd", 1234);
		});

		it("is no-op if name already exists in entries", async () => {
			await registry.startSingle!("clangd", ["clangd"]);
			await registry.startSingle!("clangd", ["clangd", "--fallback"]);

			expect(mockRuntime.start).toHaveBeenCalledTimes(1);
			expect(registry.getStatus().servers).toHaveLength(1);
		});

		it("records metadata with isPrimary=false, accessCount=0, lastAccessTime~now", async () => {
			const before = Date.now();
			await registry.startSingle!("clangd", ["clangd"]);
			const after = Date.now();

			const meta = registry.getEntryMeta!("clangd")!;
			expect(meta.isPrimary).toBe(false);
			expect(meta.accessCount).toBe(0);
			expect(meta.lastAccessTime).toBeGreaterThanOrEqual(before);
			expect(meta.lastAccessTime).toBeLessThanOrEqual(after);
		});

		it("preserves accessCount from previous stopSingle cycle", async () => {
			await registry.startSingle!("clangd", ["clangd"]);
			registry.touchAccess!("clangd");
			registry.touchAccess!("clangd");
			registry.touchAccess!("clangd");
			await registry.stopSingle!("clangd");

			await registry.startSingle!("clangd", ["clangd"]);
			expect(registry.getEntryMeta!("clangd")!.accessCount).toBe(3);
		});
	});

	describe("stopSingle", () => {
		it("stops and removes a single server", async () => {
			await registry.startSingle!("clangd", ["clangd"]);
			await registry.stopSingle!("clangd");

			expect(registry.getStatus().servers).toHaveLength(0);
			expect(mockRuntime.stop).toHaveBeenCalled();
			expect(mockMetrics.onStop).toHaveBeenCalledWith("clangd");
		});

		it("is no-op if name not found", async () => {
			await registry.stopSingle!("nonexistent");
			expect(mockRuntime.stop).not.toHaveBeenCalled();
		});

		it("preserves accessCount for reactivation", async () => {
			await registry.startSingle!("clangd", ["clangd"]);
			registry.touchAccess!("clangd");
			registry.touchAccess!("clangd");
			await registry.stopSingle!("clangd");

			await registry.startSingle!("clangd", ["clangd"]);
			const meta = registry.getEntryMeta!("clangd");
			expect(meta!.accessCount).toBe(2);
		});

		it("only stops the specified server, not others", async () => {
			await registry.startSingle!("clangd", ["clangd"]);
			await registry.startSingle!("pylsp", ["pylsp"]);

			await registry.stopSingle!("clangd");

			const status = registry.getStatus();
			expect(status.servers).toHaveLength(1);
			expect(status.servers[0].name).toBe("pylsp");
		});
	});

	describe("touchAccess", () => {
		it("increments accessCount and updates lastAccessTime", async () => {
			await registry.startSingle!("clangd", ["clangd"]);
			const before = Date.now();
			registry.touchAccess!("clangd");
			const after = Date.now();

			const meta = registry.getEntryMeta!("clangd");
			expect(meta!.accessCount).toBe(1);
			expect(meta!.lastAccessTime).toBeGreaterThanOrEqual(before);
			expect(meta!.lastAccessTime).toBeLessThanOrEqual(after);
		});

		it("increments multiple times", async () => {
			await registry.startSingle!("clangd", ["clangd"]);
			registry.touchAccess!("clangd");
			registry.touchAccess!("clangd");
			registry.touchAccess!("clangd");

			expect(registry.getEntryMeta!("clangd")!.accessCount).toBe(3);
		});

		it("is no-op if server not running", () => {
			expect(() => registry.touchAccess!("nonexistent")).not.toThrow();
		});
	});

	describe("getIdleServers", () => {
		it("returns names of idle non-primary servers", async () => {
			await registry.startSingle!("clangd", ["clangd"]);

			const idle = registry.getIdleServers!(-1);
			expect(idle).toContain("clangd");
		});

		it("excludes primary servers", async () => {
			await registry.startSingle!("clangd", ["clangd"]);
			registry.setPrimary!("clangd");

			const idle = registry.getIdleServers!(0);
			expect(idle).toEqual([]);
		});

		it("excludes servers accessed within timeout", async () => {
			await registry.startSingle!("clangd", ["clangd"]);
			registry.touchAccess!("clangd");

			const idle = registry.getIdleServers!(60000);
			expect(idle).toEqual([]);
		});

		it("returns empty array if no servers running", () => {
			const idle = registry.getIdleServers!(0);
			expect(idle).toEqual([]);
		});

		it("returns only idle secondary servers among multiple", async () => {
			vi.useFakeTimers({ now: 1000 });
			await registry.startSingle!("clangd", ["clangd"]);
			await registry.startSingle!("pylsp", ["pylsp"]);
			await registry.startSingle!("tsserver", ["tsserver"]);
			registry.setPrimary!("tsserver");

			vi.advanceTimersByTime(5000);
			registry.touchAccess!("pylsp");

			const idle = registry.getIdleServers!(3000);
			expect(idle).toContain("clangd");
			expect(idle).not.toContain("pylsp");
			expect(idle).not.toContain("tsserver");
			vi.useRealTimers();
		});
	});

	describe("accessCount preservation across cycles", () => {
		it("start → touch 3x → stop → start → accessCount preserved", async () => {
			await registry.startSingle!("clangd", ["clangd"]);
			registry.touchAccess!("clangd");
			registry.touchAccess!("clangd");
			registry.touchAccess!("clangd");
			await registry.stopSingle!("clangd");

			await registry.startSingle!("clangd", ["clangd"]);
			expect(registry.getEntryMeta!("clangd")!.accessCount).toBe(3);

			registry.touchAccess!("clangd");
			expect(registry.getEntryMeta!("clangd")!.accessCount).toBe(4);
		});
	});

	describe("full stop clears preserved counts", () => {
		it("stop() clears preservedAccessCounts", async () => {
			await registry.startSingle!("clangd", ["clangd"]);
			registry.touchAccess!("clangd");
			await registry.stopSingle!("clangd");

			await registry.stop();

			await registry.startSingle!("clangd", ["clangd"]);
			expect(registry.getEntryMeta!("clangd")!.accessCount).toBe(0);
		});
	});
});

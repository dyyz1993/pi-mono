import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockSpawnSync = vi.hoisted(() => vi.fn());
const mockGetBinDir = vi.hoisted(() => vi.fn().mockReturnValue("/fake/bin"));

vi.mock("fs", () => ({
	existsSync: mockExistsSync,
	mkdirSync: vi.fn(),
	readdirSync: vi.fn(() => []),
	chmodSync: vi.fn(),
	renameSync: vi.fn(),
	rmSync: vi.fn(),
	createWriteStream: vi.fn(),
}));

vi.mock("child_process", () => ({
	spawnSync: mockSpawnSync,
}));

vi.mock("chalk", () => ({
	default: {
		yellow: (s: string) => s,
		dim: (s: string) => s,
	},
}));

vi.mock("../../src/config.js", () => ({
	getBinDir: mockGetBinDir,
	APP_NAME: "pi",
}));

vi.mock("extract-zip", () => ({
	default: vi.fn(),
}));

vi.mock("stream/promises", () => ({
	pipeline: vi.fn(),
}));

describe("tools-manager", () => {
	beforeEach(() => {
		mockExistsSync.mockReset();
		mockSpawnSync.mockReset();
		mockGetBinDir.mockReturnValue("/fake/bin");
	});

	describe("offline mode via ensureTool", () => {
		async function load() {
			return import("../../src/utils/tools-manager.js");
		}

		it("returns undefined when PI_OFFLINE=1 and tool missing", async () => {
			process.env.PI_OFFLINE = "1";
			mockExistsSync.mockReturnValue(false);
			mockSpawnSync.mockReturnValue({ error: new Error("not found") });
			const { ensureTool } = await load();
			const result = await ensureTool("fd", true);
			expect(result).toBeUndefined();
			delete process.env.PI_OFFLINE;
		});

		it("returns undefined when PI_OFFLINE=true and tool missing", async () => {
			process.env.PI_OFFLINE = "true";
			mockExistsSync.mockReturnValue(false);
			mockSpawnSync.mockReturnValue({ error: new Error("not found") });
			const { ensureTool } = await load();
			const result = await ensureTool("fd", true);
			expect(result).toBeUndefined();
			delete process.env.PI_OFFLINE;
		});

		it("returns undefined when PI_OFFLINE=yes and tool missing", async () => {
			process.env.PI_OFFLINE = "yes";
			mockExistsSync.mockReturnValue(false);
			mockSpawnSync.mockReturnValue({ error: new Error("not found") });
			const { ensureTool } = await load();
			const result = await ensureTool("fd", true);
			expect(result).toBeUndefined();
			delete process.env.PI_OFFLINE;
		});

		it("attempts download when PI_OFFLINE=false", async () => {
			process.env.PI_OFFLINE = "false";
			mockExistsSync.mockReturnValue(false);
			mockSpawnSync.mockReturnValue({ error: new Error("not found") });
			const { ensureTool } = await load();
			const result = await ensureTool("fd", true);
			expect(result).toBeUndefined();
			delete process.env.PI_OFFLINE;
		});
	});

	describe("getToolPath", () => {
		async function load() {
			return import("../../src/utils/tools-manager.js");
		}

		it("returns local tool path when file exists", async () => {
			mockExistsSync.mockReturnValue(true);
			const { getToolPath } = await load();
			const result = getToolPath("fd");
			expect(result).toContain("fd");
			expect(result).not.toBe("fd");
		});

		it("returns system path when tool in PATH", async () => {
			mockExistsSync.mockReturnValue(false);
			mockSpawnSync.mockReturnValue({ error: undefined, status: 0 });
			const { getToolPath } = await load();
			const result = getToolPath("rg");
			expect(result).toBe("rg");
		});

		it("returns null when tool not found", async () => {
			mockExistsSync.mockReturnValue(false);
			mockSpawnSync.mockReturnValue({ error: new Error("ENOENT") });
			const { getToolPath } = await load();
			const result = getToolPath("fd");
			expect(result).toBeNull();
		});

		it("returns null for unknown tool", async () => {
			const { getToolPath } = await load();
			const result = getToolPath("nonexistent" as "fd");
			expect(result).toBeNull();
		});

		it("prefers local path over system PATH", async () => {
			mockExistsSync.mockReturnValue(true);
			mockSpawnSync.mockReturnValue({ error: undefined, status: 0 });
			const { getToolPath } = await load();
			const result = getToolPath("fd");
			expect(result).toContain("/fake/bin");
		});
	});

	describe("ensureTool", () => {
		async function load() {
			return import("../../src/utils/tools-manager.js");
		}

		it("returns existing tool path without downloading", async () => {
			mockExistsSync.mockReturnValue(true);
			const { ensureTool } = await load();
			const result = await ensureTool("fd");
			expect(result).toContain("fd");
		});

		it("returns undefined in offline mode", async () => {
			process.env.PI_OFFLINE = "1";
			mockExistsSync.mockReturnValue(false);
			mockSpawnSync.mockReturnValue({ error: new Error("not found") });
			const { ensureTool } = await load();
			const result = await ensureTool("fd", true);
			expect(result).toBeUndefined();
			delete process.env.PI_OFFLINE;
		});

		it("returns undefined when tool config missing", async () => {
			mockExistsSync.mockReturnValue(false);
			mockSpawnSync.mockReturnValue({ error: new Error("not found") });
			const { ensureTool } = await load();
			const result = await ensureTool("nonexistent" as "fd");
			expect(result).toBeUndefined();
		});

		it("returns existing rg path", async () => {
			mockExistsSync.mockReturnValue(true);
			const { ensureTool } = await load();
			const result = await ensureTool("rg");
			expect(result).toContain("rg");
		});
	});
});

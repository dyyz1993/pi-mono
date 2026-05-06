import { delimiter } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockGetBinDir = vi.hoisted(() => vi.fn());
const mockSpawnSync = vi.hoisted(() => vi.fn());

vi.mock("node:fs", () => ({
	existsSync: mockExistsSync,
}));

vi.mock("child_process", () => ({
	spawn: vi.fn(),
	spawnSync: mockSpawnSync,
}));

vi.mock("../../src/config.js", () => ({
	getBinDir: mockGetBinDir,
}));

describe("shell utils", () => {
	beforeEach(() => {
		mockExistsSync.mockReset();
		mockSpawnSync.mockReset();
		mockGetBinDir.mockReset();
	});

	describe("getShellConfig", () => {
		test("returns /bin/bash on unix when it exists", async () => {
			mockExistsSync.mockImplementation((p: string) => p === "/bin/bash");
			const { getShellConfig } = await import("../../src/utils/shell.js");
			const result = getShellConfig();
			expect(result).toEqual({ shell: "/bin/bash", args: ["-c"] });
		});

		test("returns bash from PATH when /bin/bash missing on unix", async () => {
			mockExistsSync.mockReturnValue(false);
			mockSpawnSync.mockReturnValue({ status: 0, stdout: "/usr/local/bin/bash\n" });
			const { getShellConfig } = await import("../../src/utils/shell.js");
			const result = getShellConfig();
			expect(result.shell).toBe("/usr/local/bin/bash");
			expect(result.args).toEqual(["-c"]);
		});

		test("falls back to sh on unix when no bash found", async () => {
			mockExistsSync.mockReturnValue(false);
			mockSpawnSync.mockReturnValue({ status: 1, stdout: "" });
			const { getShellConfig } = await import("../../src/utils/shell.js");
			const result = getShellConfig();
			expect(result).toEqual({ shell: "sh", args: ["-c"] });
		});

		test("uses custom shell path when it exists", async () => {
			mockExistsSync.mockImplementation((p: string) => p === "/custom/zsh");
			const { getShellConfig } = await import("../../src/utils/shell.js");
			const result = getShellConfig("/custom/zsh");
			expect(result).toEqual({ shell: "/custom/zsh", args: ["-c"] });
		});

		test("throws when custom shell path does not exist", async () => {
			mockExistsSync.mockReturnValue(false);
			const { getShellConfig } = await import("../../src/utils/shell.js");
			expect(() => getShellConfig("/nonexistent/shell")).toThrow("Custom shell path not found");
		});
	});

	describe("getShellEnv", () => {
		test("prepends binDir to PATH", async () => {
			mockGetBinDir.mockReturnValue("/fake/bin");
			const origPath = process.env.PATH;
			process.env.PATH = "/usr/bin:/bin";
			const { getShellEnv } = await import("../../src/utils/shell.js");
			const env = getShellEnv();
			expect(env.PATH).toContain("/fake/bin");
			expect(env.PATH).toContain("/usr/bin");
			process.env.PATH = origPath;
		});

		test("does not duplicate binDir if already in PATH", async () => {
			mockGetBinDir.mockReturnValue("/already/bin");
			const origPath = process.env.PATH;
			process.env.PATH = `/already/bin${delimiter}/usr/bin`;
			const { getShellEnv } = await import("../../src/utils/shell.js");
			const env = getShellEnv();
			const entries = env.PATH!.split(delimiter);
			const count = entries.filter((e: string) => e === "/already/bin").length;
			expect(count).toBe(1);
			process.env.PATH = origPath;
		});

		test("preserves other env vars", async () => {
			mockGetBinDir.mockReturnValue("/fake/bin");
			process.env.MY_TEST_VAR = "hello";
			const { getShellEnv } = await import("../../src/utils/shell.js");
			const env = getShellEnv();
			expect(env.MY_TEST_VAR).toBe("hello");
			delete process.env.MY_TEST_VAR;
		});
	});

	describe("sanitizeBinaryOutput", () => {
		async function getFn() {
			const mod = await import("../../src/utils/shell.js");
			return mod.sanitizeBinaryOutput;
		}

		test("preserves printable ASCII", async () => {
			const fn = await getFn();
			expect(fn("hello world")).toBe("hello world");
		});

		test("preserves tab, newline, carriage return", async () => {
			const fn = await getFn();
			expect(fn("a\tb\nc\r")).toBe("a\tb\nc\r");
		});

		test("removes control characters", async () => {
			const fn = await getFn();
			expect(fn("a\x00b\x01c\x07d")).toBe("abcd");
		});

		test("removes Unicode format characters (FFF9-FFFB)", async () => {
			const fn = await getFn();
			expect(fn("a\uFFF9b\uFFFAc\uFFFBd")).toBe("abcd");
		});

		test("preserves multibyte unicode", async () => {
			const fn = await getFn();
			expect(fn("日本語")).toBe("日本語");
		});

		test("handles empty string", async () => {
			const fn = await getFn();
			expect(fn("")).toBe("");
		});
	});

	describe("tracked detached children", () => {
		async function load() {
			return import("../../src/utils/shell.js");
		}

		test("killTrackedDetachedChildren clears tracked pids", async () => {
			const { trackDetachedChildPid, killTrackedDetachedChildren } = await load();
			trackDetachedChildPid(99999);
			killTrackedDetachedChildren();
		});

		test("untrack removes a tracked pid", async () => {
			const { trackDetachedChildPid, untrackDetachedChildPid, killTrackedDetachedChildren } = await load();
			trackDetachedChildPid(99998);
			untrackDetachedChildPid(99998);
			killTrackedDetachedChildren();
		});
	});
});

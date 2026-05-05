import type { SpawnSyncReturns } from "child_process";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
	return {
		spawnSync: vi.fn<(command: string, args: string[], options: unknown) => SpawnSyncReturns<Buffer>>(),
		clipboard: {
			hasImage: vi.fn<() => boolean>(),
			getImageBinary: vi.fn<() => Promise<Uint8Array | null>>(),
		},
	};
});

vi.mock("child_process", () => {
	return {
		spawnSync: mocks.spawnSync,
	};
});

vi.mock("../src/utils/clipboard-native.js", () => {
	return {
		clipboard: mocks.clipboard,
	};
});

function spawnOk(stdout: Buffer): SpawnSyncReturns<Buffer> {
	return {
		pid: 123,
		output: [Buffer.alloc(0), stdout, Buffer.alloc(0)],
		stdout,
		stderr: Buffer.alloc(0),
		status: 0,
		signal: null,
	};
}

function spawnError(error: Error): SpawnSyncReturns<Buffer> {
	return {
		pid: 123,
		output: [Buffer.alloc(0), Buffer.alloc(0), Buffer.alloc(0)],
		stdout: Buffer.alloc(0),
		stderr: Buffer.alloc(0),
		status: null,
		signal: null,
		error,
	};
}

describe("readClipboardImage", () => {
	beforeEach(() => {
		vi.resetModules();
		mocks.spawnSync.mockReset();
		mocks.clipboard.hasImage.mockReset();
		mocks.clipboard.getImageBinary.mockReset();
	});

	test("Wayland: uses wl-paste and never calls clipboard", async () => {
		mocks.clipboard.hasImage.mockImplementation(() => {
			throw new Error("clipboard.hasImage should not be called on Wayland");
		});

		mocks.spawnSync.mockImplementation((command, args, _options) => {
			if (command === "wl-paste" && args[0] === "--list-types") {
				return spawnOk(Buffer.from("text/plain\nimage/png\n", "utf-8"));
			}
			if (command === "wl-paste" && args[0] === "--type") {
				return spawnOk(Buffer.from([1, 2, 3]));
			}
			throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
		});

		const { readClipboardImage } = await import("../src/utils/clipboard-image.js");
		const result = await readClipboardImage({ platform: "linux", env: { WAYLAND_DISPLAY: "1" } });
		expect(result).not.toBeNull();
		expect(result?.mimeType).toBe("image/png");
		expect(Array.from(result?.bytes ?? [])).toEqual([1, 2, 3]);
	});

	test("Wayland: falls back to xclip when wl-paste is missing", async () => {
		mocks.clipboard.hasImage.mockImplementation(() => {
			throw new Error("clipboard.hasImage should not be called on Wayland");
		});

		const enoent = new Error("spawn ENOENT");
		(enoent as { code?: string }).code = "ENOENT";

		mocks.spawnSync.mockImplementation((command, args, _options) => {
			if (command === "wl-paste") {
				return spawnError(enoent);
			}

			if (command === "xclip" && args.includes("TARGETS")) {
				return spawnOk(Buffer.from("image/png\n", "utf-8"));
			}

			if (command === "xclip" && args.includes("image/png")) {
				return spawnOk(Buffer.from([9, 8]));
			}

			return spawnOk(Buffer.alloc(0));
		});

		const { readClipboardImage } = await import("../src/utils/clipboard-image.js");
		const result = await readClipboardImage({ platform: "linux", env: { XDG_SESSION_TYPE: "wayland" } });
		expect(result).not.toBeNull();
		expect(result?.mimeType).toBe("image/png");
		expect(Array.from(result?.bytes ?? [])).toEqual([9, 8]);
	});

	test("Non-Wayland: uses clipboard", async () => {
		mocks.spawnSync.mockImplementation(() => {
			throw new Error("spawnSync should not be called for non-Wayland sessions");
		});

		mocks.clipboard.hasImage.mockReturnValue(true);
		mocks.clipboard.getImageBinary.mockResolvedValue(new Uint8Array([7]));

		const { readClipboardImage } = await import("../src/utils/clipboard-image.js");
		const result = await readClipboardImage({ platform: "linux", env: {} });
		expect(result).not.toBeNull();
		expect(result?.mimeType).toBe("image/png");
		expect(Array.from(result?.bytes ?? [])).toEqual([7]);
	});

	test("Non-Wayland: returns null when clipboard has no image", async () => {
		mocks.spawnSync.mockImplementation(() => {
			throw new Error("spawnSync should not be called for non-Wayland sessions");
		});

		mocks.clipboard.hasImage.mockReturnValue(false);

		const { readClipboardImage } = await import("../src/utils/clipboard-image.js");
		const result = await readClipboardImage({ platform: "linux", env: {} });
		expect(result).toBeNull();
	});

	describe("WSL PowerShell path", () => {
		const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

		test("uses PowerShell on WSL when Linux clipboard has no image", async () => {
			mocks.spawnSync.mockImplementation((command, args, _options) => {
				if (command === "wl-paste" && args[0] === "--list-types") {
					return spawnOk(Buffer.from("text/plain\n", "utf-8"));
				}
				if (command === "xclip" && args.includes("TARGETS")) {
					return spawnOk(Buffer.from("text/plain\n", "utf-8"));
				}
				if (command === "wslpath" && args[0] === "-w") {
					return spawnOk(Buffer.from("C:\\Temp\\pi-wsl-clip-test.png\n", "utf-8"));
				}
				if (command === "powershell.exe") {
					return spawnOk(Buffer.from("ok\n", "utf-8"));
				}
				return spawnOk(Buffer.alloc(0));
			});

			mocks.clipboard.hasImage.mockReturnValue(false);

			const { readClipboardImage } = await import("../src/utils/clipboard-image.js");
			const result = await readClipboardImage({
				platform: "linux",
				env: { WAYLAND_DISPLAY: "1", WSL_DISTRO_NAME: "Ubuntu" },
			});

			const wslCall = mocks.spawnSync.mock.calls.find((c) => c[0] === "wslpath");
			expect(wslCall).toBeDefined();

			const tmpPath = (wslCall![1] as string[])[1];
			expect(tmpPath).toContain("pi-wsl-clip-");
			expect(tmpPath.endsWith(".png")).toBe(true);
		});

		test("WSL temp file name contains UUID between pi-wsl-clip- and .png", async () => {
			const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

			mocks.spawnSync.mockImplementation((command, args, _options) => {
				if (command === "wslpath" && args[0] === "-w") {
					const linuxPath = (args as string[])[1];
					const match = linuxPath.match(/pi-wsl-clip-(.+)\.png$/);
					expect(match).toBeDefined();
					expect(UUID_REGEX.test(match![1])).toBe(true);
					return spawnOk(Buffer.from("C:\\Temp\\clip.png\n", "utf-8"));
				}
				if (command === "powershell.exe") {
					return spawnOk(Buffer.from("ok\n", "utf-8"));
				}
				return spawnOk(Buffer.alloc(0));
			});

			mocks.clipboard.hasImage.mockReturnValue(false);

			const { readClipboardImage } = await import("../src/utils/clipboard-image.js");
			await readClipboardImage({ platform: "linux", env: { WAYLAND_DISPLAY: "1", WSL_DISTRO_NAME: "Ubuntu" } });
		});
	});
});

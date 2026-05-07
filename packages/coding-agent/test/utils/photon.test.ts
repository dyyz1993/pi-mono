import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("loadPhoton", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns null when module not available", async () => {
		vi.doMock("@silvia-odwyer/photon-node", () => {
			throw new Error("not found");
		});
		const { loadPhoton } = await import("../../src/utils/photon.js");
		const result = await loadPhoton();
		expect(result).toBeNull();
	});

	it("caches null result on subsequent calls", async () => {
		vi.doMock("@silvia-odwyer/photon-node", () => {
			throw new Error("not found");
		});
		const { loadPhoton } = await import("../../src/utils/photon.js");
		const first = await loadPhoton();
		const second = await loadPhoton();
		expect(first).toBeNull();
		expect(second).toBeNull();
	});

	it("restores original readFileSync after failed load", async () => {
		vi.doMock("@silvia-odwyer/photon-node", () => {
			throw new Error("not found");
		});
		const fs = await import("fs");
		const originalReadFileSync = fs.readFileSync;
		const { loadPhoton } = await import("../../src/utils/photon.js");
		await loadPhoton();
		expect(fs.readFileSync).toBe(originalReadFileSync);
	});
});

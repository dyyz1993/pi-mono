import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

describe("timings (PI_TIMING=1)", () => {
	let resetTimings: () => void;
	let time: (label: string) => void;
	let printTimings: () => void;

	beforeEach(() => {
		vi.resetModules();
		process.env.PI_TIMING = "1";
	});

	afterEach(() => {
		delete process.env.PI_TIMING;
		vi.restoreAllMocks();
	});

	async function importTimings() {
		const mod = await import("../src/core/timings.js");
		resetTimings = mod.resetTimings;
		time = mod.time;
		printTimings = mod.printTimings;
	}

	test("resetTimings clears internal state", async () => {
		await importTimings();
		resetTimings();
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		printTimings();
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	test("time records entries and printTimings outputs them", async () => {
		await importTimings();
		resetTimings();
		time("step1");
		time("step2");
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		printTimings();
		expect(spy).toHaveBeenCalled();
		const output = spy.mock.calls.map((c) => c[0]).join("\n");
		expect(output).toContain("step1");
		expect(output).toContain("step2");
		expect(output).toContain("TOTAL:");
		spy.mockRestore();
	});

	test("printTimings does nothing when no entries recorded", async () => {
		await importTimings();
		resetTimings();
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		printTimings();
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});
});

describe("timings (PI_TIMING unset)", () => {
	test("all functions are no-ops when PI_TIMING is not set", async () => {
		delete process.env.PI_TIMING;
		vi.resetModules();
		const mod = await import("../src/core/timings.js");
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		mod.resetTimings();
		mod.time("test");
		mod.printTimings();
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});
});

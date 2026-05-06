import { afterEach, describe, expect, test, vi } from "vitest";
import { createEventBus } from "../src/core/event-bus.js";

describe("createEventBus", () => {
	const bus = createEventBus();

	afterEach(() => {
		bus.clear();
	});

	test("on/emit lifecycle", () => {
		const handler = vi.fn();
		bus.on("test", handler);
		bus.emit("test", { value: 42 });
		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith({ value: 42 });
	});

	test("multiple listeners on same channel", () => {
		const h1 = vi.fn();
		const h2 = vi.fn();
		bus.on("evt", h1);
		bus.on("evt", h2);
		bus.emit("evt", "data");
		expect(h1).toHaveBeenCalledWith("data");
		expect(h2).toHaveBeenCalledWith("data");
	});

	test("off (unsubscribe) stops delivering events", () => {
		const handler = vi.fn();
		const off = bus.on("off-test", handler);
		bus.emit("off-test", 1);
		off();
		bus.emit("off-test", 2);
		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith(1);
	});

	test("clear removes all listeners", () => {
		const h1 = vi.fn();
		const h2 = vi.fn();
		bus.on("a", h1);
		bus.on("b", h2);
		bus.clear();
		bus.emit("a", null);
		bus.emit("b", null);
		expect(h1).not.toHaveBeenCalled();
		expect(h2).not.toHaveBeenCalled();
	});

	test("error in listener is caught and does not break other listeners", () => {
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const badHandler = vi.fn(() => {
			throw new Error("boom");
		});
		const goodHandler = vi.fn();
		bus.on("err", badHandler);
		bus.on("err", goodHandler);
		bus.emit("err", null);
		expect(badHandler).toHaveBeenCalledTimes(1);
		expect(goodHandler).toHaveBeenCalledTimes(1);
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	test("emit with no listeners does not throw", () => {
		expect(() => bus.emit("nonexistent", null)).not.toThrow();
	});

	test("on returns an off function", () => {
		const off = bus.on("ret", vi.fn());
		expect(typeof off).toBe("function");
	});
});

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CountdownTimer } from "../src/modes/interactive/components/countdown-timer.js";

describe("CountdownTimer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test("calls onTick immediately with correct seconds", () => {
		const onTick = vi.fn();
		const onExpire = vi.fn();
		const tui = { requestRender: vi.fn() };

		new CountdownTimer(5000, tui as any, onTick, onExpire);

		expect(onTick).toHaveBeenCalledTimes(1);
		expect(onTick).toHaveBeenCalledWith(5);
	});

	test("calls tui.requestRender on each tick", () => {
		const onTick = vi.fn();
		const onExpire = vi.fn();
		const tui = { requestRender: vi.fn() };

		new CountdownTimer(3000, tui as any, onTick, onExpire);

		expect(tui.requestRender).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1000);
		expect(tui.requestRender).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(1000);
		expect(tui.requestRender).toHaveBeenCalledTimes(2);
	});

	test("ticks down each second and calls onExpire at zero", () => {
		const onTick = vi.fn();
		const onExpire = vi.fn();
		const tui = { requestRender: vi.fn() };

		new CountdownTimer(2000, tui as any, onTick, onExpire);

		expect(onTick).toHaveBeenCalledWith(2);

		vi.advanceTimersByTime(1000);
		expect(onTick).toHaveBeenCalledWith(1);

		vi.advanceTimersByTime(1000);
		expect(onTick).toHaveBeenCalledWith(0);
		expect(onExpire).toHaveBeenCalledTimes(1);
	});

	test("stops ticking after dispose", () => {
		const onTick = vi.fn();
		const onExpire = vi.fn();
		const tui = { requestRender: vi.fn() };

		const timer = new CountdownTimer(5000, tui as any, onTick, onExpire);

		vi.advanceTimersByTime(1000);
		expect(onTick).toHaveBeenCalledTimes(2);

		timer.dispose();

		vi.advanceTimersByTime(5000);
		expect(onTick).toHaveBeenCalledTimes(2);
		expect(onExpire).not.toHaveBeenCalled();
	});

	test("does not call onExpire when disposed before reaching zero", () => {
		const onTick = vi.fn();
		const onExpire = vi.fn();
		const tui = { requestRender: vi.fn() };

		const timer = new CountdownTimer(3000, tui as any, onTick, onExpire);

		vi.advanceTimersByTime(1000);
		timer.dispose();

		vi.advanceTimersByTime(5000);
		expect(onExpire).not.toHaveBeenCalled();
	});

	test("handles tui being undefined", () => {
		const onTick = vi.fn();
		const onExpire = vi.fn();

		const timer = new CountdownTimer(2000, undefined, onTick, onExpire);

		vi.advanceTimersByTime(1000);
		expect(onTick).toHaveBeenCalledWith(1);

		vi.advanceTimersByTime(1000);
		expect(onExpire).toHaveBeenCalledTimes(1);

		timer.dispose();
	});
});

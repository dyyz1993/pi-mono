import stripAnsi from "strip-ansi";
import { beforeAll, describe, expect, test } from "vitest";
import { DynamicBorder } from "../src/modes/interactive/components/dynamic-border.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

describe("DynamicBorder", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("rendered line length equals width", () => {
		const border = new DynamicBorder();
		const lines = border.render(40);
		expect(lines).toHaveLength(1);
		expect(stripAnsi(lines[0]).length).toBe(40);
	});

	test("applies default theme border color", () => {
		const border = new DynamicBorder();
		const lines = border.render(10);
		expect(lines[0]).not.toBe("─".repeat(10));
		expect(stripAnsi(lines[0])).toBe("─".repeat(10));
	});

	test("applies custom color function", () => {
		const border = new DynamicBorder((s) => `<${s}>`);
		const lines = border.render(3);
		expect(lines[0]).toBe("<───>");
	});

	test("width=1 produces single character", () => {
		const border = new DynamicBorder((s) => s);
		const lines = border.render(1);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toBe("─");
	});

	test("width=0 still produces at least 1 character", () => {
		const border = new DynamicBorder((s) => s);
		const lines = border.render(0);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toBe("─");
	});
});

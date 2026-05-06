import type { ThinkingLevel } from "@dyyz1993/pi-agent-core";
import stripAnsi from "strip-ansi";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { ThinkingSelectorComponent } from "../src/modes/interactive/components/thinking-selector.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

const ALL_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

describe("ThinkingSelectorComponent", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("renders all available levels", () => {
		const onSelect = vi.fn();
		const onCancel = vi.fn();
		const comp = new ThinkingSelectorComponent("medium", ALL_LEVELS, onSelect, onCancel);
		const rendered = stripAnsi(comp.render(80).join("\n"));
		for (const level of ALL_LEVELS) {
			expect(rendered).toContain(level);
		}
	});

	test("renders only provided levels", () => {
		const onSelect = vi.fn();
		const onCancel = vi.fn();
		const levels: ThinkingLevel[] = ["off", "low", "high"];
		const comp = new ThinkingSelectorComponent("off", levels, onSelect, onCancel);
		const rendered = stripAnsi(comp.render(80).join("\n"));
		expect(rendered).toContain("off");
		expect(rendered).toContain("low");
		expect(rendered).toContain("high");
		expect(rendered).not.toContain("minimal");
		expect(rendered).not.toContain("medium");
		expect(rendered).not.toContain("xhigh");
	});

	test("constructs without error for each current level", () => {
		for (const level of ALL_LEVELS) {
			const onSelect = vi.fn();
			const onCancel = vi.fn();
			const comp = new ThinkingSelectorComponent(level, ALL_LEVELS, onSelect, onCancel);
			const rendered = stripAnsi(comp.render(80).join("\n"));
			expect(rendered).toContain(level);
		}
	});

	test("constructs when current level is not in available list", () => {
		const onSelect = vi.fn();
		const onCancel = vi.fn();
		const levels: ThinkingLevel[] = ["off", "minimal"];
		const comp = new ThinkingSelectorComponent("high", levels, onSelect, onCancel);
		const rendered = stripAnsi(comp.render(80).join("\n"));
		expect(rendered).toContain("off");
		expect(rendered).toContain("minimal");
	});

	test("fires onSelect callback when item is selected", () => {
		const onSelect = vi.fn();
		const onCancel = vi.fn();
		const comp = new ThinkingSelectorComponent("medium", ALL_LEVELS, onSelect, onCancel);
		const list = comp.getSelectList();

		list.onSelect!({ value: "high", label: "high", description: "Deep reasoning (~16k tokens)" });

		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(onSelect).toHaveBeenCalledWith("high");
	});

	test("fires onCancel callback when cancelled", () => {
		const onSelect = vi.fn();
		const onCancel = vi.fn();
		const comp = new ThinkingSelectorComponent("medium", ALL_LEVELS, onSelect, onCancel);
		const list = comp.getSelectList();

		list.onCancel!();

		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	test("render output contains border lines", () => {
		const onSelect = vi.fn();
		const onCancel = vi.fn();
		const comp = new ThinkingSelectorComponent("medium", ALL_LEVELS, onSelect, onCancel);
		const lines = comp.render(80);
		expect(lines.length).toBeGreaterThanOrEqual(3);
	});

	test("render output contains level descriptions", () => {
		const onSelect = vi.fn();
		const onCancel = vi.fn();
		const comp = new ThinkingSelectorComponent("medium", ALL_LEVELS, onSelect, onCancel);
		const rendered = stripAnsi(comp.render(80).join("\n"));
		expect(rendered).toContain("No reasoning");
		expect(rendered).toContain("Deep reasoning (~16k tokens)");
		expect(rendered).toContain("Maximum reasoning (~32k tokens)");
	});
});

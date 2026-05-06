import stripAnsi from "strip-ansi";
import { beforeAll, describe, expect, test } from "vitest";
import { UserMessageComponent } from "../src/modes/interactive/components/user-message.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

describe("UserMessageComponent", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("text renders within box", () => {
		const comp = new UserMessageComponent("hello world");
		const lines = comp.render(60);
		expect(lines.length).toBeGreaterThanOrEqual(1);
		const plain = stripAnsi(lines.join("\n"));
		expect(plain).toContain("hello world");
	});

	test("OSC 133 sequences present", () => {
		const comp = new UserMessageComponent("test");
		const lines = comp.render(60);
		expect(lines.length).toBeGreaterThanOrEqual(1);
		expect(lines[0]).toContain("\x1b]133;A\x07");
		expect(lines[lines.length - 1]).toContain("\x1b]133;B\x07");
		expect(lines[lines.length - 1]).toContain("\x1b]133;C\x07");
	});

	test("handles empty text returning zero lines", () => {
		const comp = new UserMessageComponent("");
		const lines = comp.render(60);
		expect(lines).toEqual([]);
	});
});

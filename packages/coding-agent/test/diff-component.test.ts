import stripAnsi from "strip-ansi";
import { beforeAll, describe, expect, test } from "vitest";
import { renderDiff } from "../src/modes/interactive/components/diff.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

describe("renderDiff", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("renders context lines in dim color", () => {
		const diff = " 1 hello\n 2 world";
		const result = renderDiff(diff);
		const plain = stripAnsi(result);
		expect(plain).toContain(" 1 hello");
		expect(plain).toContain(" 2 world");
	});

	test("renders removed lines with - prefix", () => {
		const diff = "-1 old line";
		const result = renderDiff(diff);
		const plain = stripAnsi(result);
		expect(plain).toContain("-1 old line");
	});

	test("renders added lines with + prefix", () => {
		const diff = "+1 new line";
		const result = renderDiff(diff);
		const plain = stripAnsi(result);
		expect(plain).toContain("+1 new line");
	});

	test("returns themed empty context for empty diff", () => {
		const result = renderDiff("");
		expect(stripAnsi(result)).toBe("");
	});

	test("replaces tabs with spaces", () => {
		const diff = "+1 hello\tworld";
		const result = renderDiff(diff);
		const plain = stripAnsi(result);
		expect(plain).toContain("hello   world");
		expect(plain).not.toContain("\t");
	});

	test("renders mixed additions and removals", () => {
		const diff = "-1 removed\n+1 added\n 2 context";
		const result = renderDiff(diff);
		const plain = stripAnsi(result);
		expect(plain).toContain("-1 removed");
		expect(plain).toContain("+1 added");
		expect(plain).toContain(" 2 context");
	});

	test("renders consecutive removals then additions without intra-line diff", () => {
		const diff = "-1 line one\n-2 line two\n+1 new one\n+2 new two";
		const result = renderDiff(diff);
		const plain = stripAnsi(result);
		expect(plain).toContain("-1 line one");
		expect(plain).toContain("-2 line two");
		expect(plain).toContain("+1 new one");
		expect(plain).toContain("+2 new two");
	});

	test("passes through unparseable lines as context", () => {
		const diff = "some header line";
		const result = renderDiff(diff);
		const plain = stripAnsi(result);
		expect(plain).toContain("some header line");
	});
});

import * as os from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
	getTextOutput,
	invalidArgText,
	normalizeDisplayText,
	replaceTabs,
	shortenPath,
	str,
} from "../../src/core/tools/render-utils.js";

describe("shortenPath", () => {
	it("replaces home directory with ~", () => {
		const home = os.homedir();
		expect(shortenPath(`${home}/foo/bar`)).toBe("~/foo/bar");
	});

	it("returns path unchanged if not under home", () => {
		expect(shortenPath("/usr/local/bin")).toBe("/usr/local/bin");
	});

	it("returns empty string for non-string input", () => {
		expect(shortenPath(42)).toBe("");
		expect(shortenPath(null)).toBe("");
		expect(shortenPath(undefined)).toBe("");
	});

	it("returns ~ for exact home directory", () => {
		const home = os.homedir();
		expect(shortenPath(home)).toBe("~");
	});
});

describe("str", () => {
	it("returns the string value", () => {
		expect(str("hello")).toBe("hello");
	});

	it("returns empty string for null", () => {
		expect(str(null)).toBe("");
	});

	it("returns empty string for undefined", () => {
		expect(str(undefined)).toBe("");
	});

	it("returns null for numbers", () => {
		expect(str(42)).toBeNull();
	});

	it("returns null for objects", () => {
		expect(str({})).toBeNull();
	});

	it("returns null for booleans", () => {
		expect(str(true)).toBeNull();
	});

	it("returns empty string for empty string", () => {
		expect(str("")).toBe("");
	});
});

describe("replaceTabs", () => {
	it("replaces tabs with 3 spaces", () => {
		expect(replaceTabs("a\tb")).toBe("a   b");
	});

	it("replaces multiple tabs", () => {
		expect(replaceTabs("a\t\tb")).toBe("a      b");
	});

	it("handles no tabs", () => {
		expect(replaceTabs("no tabs")).toBe("no tabs");
	});

	it("handles empty string", () => {
		expect(replaceTabs("")).toBe("");
	});

	it("handles tab-only string", () => {
		expect(replaceTabs("\t\t")).toBe("      ");
	});
});

describe("normalizeDisplayText", () => {
	it("removes carriage returns", () => {
		expect(normalizeDisplayText("hello\r\nworld")).toBe("hello\nworld");
	});

	it("removes standalone carriage returns", () => {
		expect(normalizeDisplayText("a\rb")).toBe("ab");
	});

	it("handles text without carriage returns", () => {
		expect(normalizeDisplayText("plain text")).toBe("plain text");
	});

	it("handles empty string", () => {
		expect(normalizeDisplayText("")).toBe("");
	});
});

describe("getTextOutput", () => {
	it("returns empty string for undefined result", () => {
		expect(getTextOutput(undefined, true)).toBe("");
	});

	it("extracts text content", () => {
		const result = {
			content: [{ type: "text", text: "hello world" }],
		};
		expect(getTextOutput(result, true)).toBe("hello world");
	});

	it("joins multiple text blocks with newline", () => {
		const result = {
			content: [
				{ type: "text", text: "line1" },
				{ type: "text", text: "line2" },
			],
		};
		expect(getTextOutput(result, true)).toBe("line1\nline2");
	});

	it("strips ANSI codes from text", () => {
		const result = {
			content: [{ type: "text", text: "\x1b[31mred\x1b[0m" }],
		};
		expect(getTextOutput(result, true)).toBe("red");
	});

	it("removes carriage returns from text", () => {
		const result = {
			content: [{ type: "text", text: "hello\r\nworld" }],
		};
		expect(getTextOutput(result, true)).toBe("hello\nworld");
	});

	it("handles empty content array", () => {
		const result = { content: [] };
		expect(getTextOutput(result, true)).toBe("");
	});

	it("handles text with undefined text field", () => {
		const result = {
			content: [{ type: "text" }],
		};
		expect(getTextOutput(result, true)).toBe("");
	});
});

describe("invalidArgText", () => {
	it("returns themed error text", () => {
		const theme = {
			fg: (_name: string, text: string) => `[${text}]`,
		};
		expect(invalidArgText(theme)).toBe("[[invalid arg]]");
	});
});

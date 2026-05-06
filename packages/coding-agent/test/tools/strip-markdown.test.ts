import { describe, expect, it } from "vitest";
import { stripMarkdownCodeBlock } from "../../src/core/tools/strip-markdown.js";

describe("stripMarkdownCodeBlock", () => {
	it("strips fenced code block with language", () => {
		expect(stripMarkdownCodeBlock("```ts\nconsole.log('hi')\n```")).toBe("console.log('hi')");
	});

	it("strips fenced code block without language", () => {
		expect(stripMarkdownCodeBlock("```\ncode\n```")).toBe("code");
	});

	it("strips fenced code block with empty language", () => {
		expect(stripMarkdownCodeBlock("```\nhello\n```")).toBe("hello");
	});

	it("returns text as-is when no code block", () => {
		expect(stripMarkdownCodeBlock("just plain text")).toBe("just plain text");
	});

	it("handles empty string", () => {
		expect(stripMarkdownCodeBlock("")).toBe("");
	});

	it("trims whitespace around code block", () => {
		expect(stripMarkdownCodeBlock("  ```\ncode\n```  ")).toBe("code");
	});

	it("trims content inside code block", () => {
		const result = stripMarkdownCodeBlock("```\n  code  \n```");
		expect(result).toBe("code");
	});

	it("does not strip inline code", () => {
		expect(stripMarkdownCodeBlock("some `inline` code")).toBe("some `inline` code");
	});

	it("handles code block with multiple lines", () => {
		const input = "```js\nline1\nline2\nline3\n```";
		expect(stripMarkdownCodeBlock(input)).toBe("line1\nline2\nline3");
	});

	it("handles code block with language suffix", () => {
		expect(stripMarkdownCodeBlock("```python\nprint('hi')\n```")).toBe("print('hi')");
	});
});

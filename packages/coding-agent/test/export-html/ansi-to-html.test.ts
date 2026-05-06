import { describe, expect, it } from "vitest";
import { ansiLinesToHtml, ansiToHtml } from "../../src/core/export-html/ansi-to-html.js";

describe("ansiToHtml", () => {
	it("returns plain text unchanged", () => {
		expect(ansiToHtml("hello world")).toBe("hello world");
	});

	it("handles empty string", () => {
		expect(ansiToHtml("")).toBe("");
	});

	it("escapes HTML special characters", () => {
		expect(ansiToHtml("<b>&\"'</b>")).toBe("&lt;b&gt;&amp;&quot;&#039;&lt;/b&gt;");
	});

	it("strips reset code and produces no span", () => {
		expect(ansiToHtml("\x1b[0m")).toBe("");
	});

	it("converts bold", () => {
		const result = ansiToHtml("\x1b[1mbold text\x1b[0m");
		expect(result).toContain("font-weight:bold");
		expect(result).toContain("bold text");
		expect(result).toContain("</span>");
	});

	it("converts italic", () => {
		const result = ansiToHtml("\x1b[3mitalic text\x1b[0m");
		expect(result).toContain("font-style:italic");
		expect(result).toContain("italic text");
	});

	it("converts underline", () => {
		const result = ansiToHtml("\x1b[4munderline\x1b[0m");
		expect(result).toContain("text-decoration:underline");
		expect(result).toContain("underline");
	});

	it("converts dim style", () => {
		const result = ansiToHtml("\x1b[2mdim text\x1b[0m");
		expect(result).toContain("opacity:0.6");
		expect(result).toContain("dim text");
	});

	it("converts standard foreground color (red)", () => {
		const result = ansiToHtml("\x1b[31mred\x1b[0m");
		expect(result).toContain("color:#800000");
		expect(result).toContain("red");
	});

	it("converts standard background color (blue)", () => {
		const result = ansiToHtml("\x1b[44mblue bg\x1b[0m");
		expect(result).toContain("background-color:#000080");
		expect(result).toContain("blue bg");
	});

	it("converts bright foreground (90-97)", () => {
		const result = ansiToHtml("\x1b[91mbright red\x1b[0m");
		expect(result).toContain("color:#ff0000");
		expect(result).toContain("bright red");
	});

	it("converts bright background (100-107)", () => {
		const result = ansiToHtml("\x1b[104mbright blue bg\x1b[0m");
		expect(result).toContain("background-color:#0000ff");
	});

	it("converts 256-color foreground (38;5;N)", () => {
		const result = ansiToHtml("\x1b[38;5;196mcolored\x1b[0m");
		expect(result).toContain("color:#ff0000");
		expect(result).toContain("colored");
	});

	it("converts 256-color background (48;5;N)", () => {
		const result = ansiToHtml("\x1b[48;5;21mbg\x1b[0m");
		expect(result).toContain("background-color:#0000ff");
	});

	it("converts RGB true color foreground (38;2;R;G;B)", () => {
		const result = ansiToHtml("\x1b[38;2;128;64;32mrgb\x1b[0m");
		expect(result).toContain("color:rgb(128,64,32)");
	});

	it("converts RGB true color background (48;2;R;G;B)", () => {
		const result = ansiToHtml("\x1b[48;2;10;20;30mrgb bg\x1b[0m");
		expect(result).toContain("background-color:rgb(10,20,30)");
	});

	it("handles reset foreground (39)", () => {
		const result = ansiToHtml("\x1b[31mred\x1b[39mdefault");
		expect(result).toContain("color:#800000");
		expect(result).toContain("red");
		expect(result).toContain("default");
	});

	it("handles reset background (49)", () => {
		const result = ansiToHtml("\x1b[44mbg\x1b[49mno bg");
		expect(result).toContain("background-color:#000080");
		expect(result).toContain("no bg");
	});

	it("resets bold with code 22", () => {
		const result = ansiToHtml("\x1b[1mbold\x1b[22m not bold");
		expect(result).toContain("font-weight:bold");
	});

	it("resets italic with code 23", () => {
		const result = ansiToHtml("\x1b[3mitalic\x1b[23m plain");
		expect(result).toContain("font-style:italic");
	});

	it("resets underline with code 24", () => {
		const result = ansiToHtml("\x1b[4munder\x1b[24m plain");
		expect(result).toContain("text-decoration:underline");
	});

	it("handles nested/stacked styles", () => {
		const result = ansiToHtml("\x1b[1;3;31mbold italic red\x1b[0m");
		expect(result).toContain("font-weight:bold");
		expect(result).toContain("font-style:italic");
		expect(result).toContain("color:#800000");
		expect(result).toContain("bold italic red");
	});

	it("handles multiple color changes in sequence", () => {
		const result = ansiToHtml("\x1b[31mred\x1b[32mgreen\x1b[34mblue");
		expect(result).toContain("color:#800000");
		expect(result).toContain("color:#008000");
		expect(result).toContain("color:#000080");
	});

	it("handles 256-color grayscale (232-255)", () => {
		const result = ansiToHtml("\x1b[38;5;240mgrayscale\x1b[0m");
		expect(result).toMatch(/color:#[0-9a-f]{6}/);
		expect(result).toContain("grayscale");
	});

	it("handles text before and after ANSI codes", () => {
		const result = ansiToHtml("before \x1b[1mstyled\x1b[0m after");
		expect(result).toContain("before ");
		expect(result).toContain("styled");
		expect(result).toContain(" after");
	});
});

describe("ansiLinesToHtml", () => {
	it("wraps each line in a div", () => {
		const result = ansiLinesToHtml(["line1", "line2"]);
		expect(result).toContain('<div class="ansi-line">line1</div>');
		expect(result).toContain('<div class="ansi-line">line2</div>');
	});

	it("uses &nbsp; for empty lines", () => {
		const result = ansiLinesToHtml([""]);
		expect(result).toContain("&nbsp;");
	});

	it("converts ANSI codes within lines", () => {
		const result = ansiLinesToHtml(["\x1b[31mred\x1b[0m"]);
		expect(result).toContain("color:#800000");
	});

	it("handles multiple lines", () => {
		const result = ansiLinesToHtml(["a", "b", "c"]);
		expect(result).toBe(
			'<div class="ansi-line">a</div>\n<div class="ansi-line">b</div>\n<div class="ansi-line">c</div>',
		);
	});
});

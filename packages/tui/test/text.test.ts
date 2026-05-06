import assert from "node:assert";
import { describe, it } from "node:test";
import { Text } from "../src/components/text.js";
import { visibleWidth } from "../src/utils.js";

describe("Text", () => {
	it("empty text renders empty array", () => {
		const text = new Text("");
		const result = text.render(20);
		assert.deepStrictEqual(result, []);
	});

	it("whitespace-only text renders empty array", () => {
		const text = new Text("   ");
		const result = text.render(20);
		assert.deepStrictEqual(result, []);
	});

	it("short text renders with padding", () => {
		const text = new Text("hi", 1, 1);
		const result = text.render(20);
		assert.ok(result.length >= 3);
		assert.ok(result[0].trim() === "");
		assert.ok(result[result.length - 1].trim() === "");
		for (const line of result) {
			assert.strictEqual(visibleWidth(line), 20);
		}
	});

	it("long text wraps", () => {
		const longText = "a".repeat(100);
		const text = new Text(longText, 1, 0);
		const result = text.render(20);
		assert.ok(result.length > 1);
		for (const line of result) {
			assert.ok(visibleWidth(line) <= 20, `line too wide: ${visibleWidth(line)}`);
		}
	});

	it("setText updates output", () => {
		const text = new Text("old", 0, 0);
		const first = text.render(20);
		text.setText("new");
		const second = text.render(20);
		assert.ok(first[0].includes("old"));
		assert.ok(second[0].includes("new"));
	});

	it("invalidate clears cache", () => {
		const text = new Text("cached", 0, 0);
		const first = text.render(20);
		text.invalidate();
		const second = text.render(20);
		assert.deepStrictEqual(first, second);
	});

	it("customBgFn applies background", () => {
		const bgFn = (t: string) => `\x1b[41m${t}\x1b[0m`;
		const text = new Text("hello", 1, 1, bgFn);
		const result = text.render(20);
		for (const line of result) {
			assert.ok(line.includes("\x1b[41m"), `expected bg in: ${JSON.stringify(line)}`);
		}
	});
});

import assert from "node:assert";
import { describe, it } from "node:test";
import { Box } from "../src/components/box.js";
import type { Component } from "../src/tui.js";
import { visibleWidth } from "../src/utils.js";

function mockChild(lines: string[]): Component & { renderCount: number } {
	let renderCount = 0;
	return {
		render(_width: number) {
			renderCount++;
			return lines;
		},
		invalidate() {},
		get renderCount() {
			return renderCount;
		},
	};
}

describe("Box", () => {
	it("empty box renders empty array", () => {
		const box = new Box();
		const result = box.render(40);
		assert.deepStrictEqual(result, []);
	});

	it("single child renders with padding", () => {
		const box = new Box(1, 1);
		box.addChild(mockChild(["hello"]));
		const result = box.render(20);
		assert.ok(result.length >= 3);
		assert.ok(result[0].trim() === "");
		assert.ok(result[result.length - 1].trim() === "");
		assert.ok(result[1].includes("hello"));
	});

	it("multiple children render in order", () => {
		const box = new Box(1, 0);
		box.addChild(mockChild(["aaa"]));
		box.addChild(mockChild(["bbb"]));
		const result = box.render(20);
		assert.ok(result.length >= 2);
		assert.ok(result[0].includes("aaa"));
		assert.ok(result[1].includes("bbb"));
	});

	it("background function is applied", () => {
		const bgFn = (text: string) => `\x1b[44m${text}\x1b[0m`;
		const box = new Box(1, 0, bgFn);
		box.addChild(mockChild(["hello"]));
		const result = box.render(20);
		for (const line of result) {
			assert.ok(line.includes("\x1b[44m"), `expected bg color in: ${JSON.stringify(line)}`);
		}
	});

	it("padding X/Y produce correct spacing", () => {
		const box = new Box(2, 2);
		box.addChild(mockChild(["hi"]));
		const result = box.render(20);
		assert.strictEqual(result.length, 5);
		for (const line of result) {
			assert.strictEqual(visibleWidth(line), 20);
		}
	});

	it("addChild/removeChild/clear", () => {
		const box = new Box(0, 0);
		const child = mockChild(["x"]);
		box.addChild(child);
		assert.strictEqual(box.children.length, 1);
		assert.strictEqual(box.render(20).length, 1);

		box.removeChild(child);
		assert.strictEqual(box.children.length, 0);
		assert.deepStrictEqual(box.render(20), []);

		box.addChild(mockChild(["y"]));
		box.clear();
		assert.strictEqual(box.children.length, 0);
		assert.deepStrictEqual(box.render(20), []);
	});

	it("invalidate propagates to children", () => {
		let invalidated = false;
		const child: Component = {
			render() {
				return ["line"];
			},
			invalidate() {
				invalidated = true;
			},
		};
		const box = new Box();
		box.addChild(child);
		box.invalidate();
		assert.strictEqual(invalidated, true);
	});
});

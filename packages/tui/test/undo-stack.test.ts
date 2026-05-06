import assert from "node:assert";
import { describe, it } from "node:test";
import { UndoStack } from "../src/undo-stack.js";

describe("UndoStack", () => {
	it("push then pop returns pushed state", () => {
		const stack = new UndoStack<{ value: number }>();
		stack.push({ value: 42 });
		const result = stack.pop();
		assert.deepStrictEqual(result, { value: 42 });
	});

	it("push deep-clones (mutating original doesn't affect stack)", () => {
		const stack = new UndoStack<{ items: number[] }>();
		const original = { items: [1, 2, 3] };
		stack.push(original);
		original.items.push(4);
		const result = stack.pop()!;
		assert.deepStrictEqual(result.items, [1, 2, 3]);
	});

	it("pop on empty returns undefined", () => {
		const stack = new UndoStack<string>();
		assert.strictEqual(stack.pop(), undefined);
	});

	it("clear empties stack", () => {
		const stack = new UndoStack<number>();
		stack.push(1);
		stack.push(2);
		stack.clear();
		assert.strictEqual(stack.length, 0);
		assert.strictEqual(stack.pop(), undefined);
	});

	it("length tracking", () => {
		const stack = new UndoStack<string>();
		assert.strictEqual(stack.length, 0);
		stack.push("a");
		assert.strictEqual(stack.length, 1);
		stack.push("b");
		assert.strictEqual(stack.length, 2);
		stack.pop();
		assert.strictEqual(stack.length, 1);
	});

	it("LIFO order", () => {
		const stack = new UndoStack<string>();
		stack.push("first");
		stack.push("second");
		stack.push("third");
		assert.strictEqual(stack.pop(), "third");
		assert.strictEqual(stack.pop(), "second");
		assert.strictEqual(stack.pop(), "first");
	});
});

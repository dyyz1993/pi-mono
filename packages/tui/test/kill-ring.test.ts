import assert from "node:assert";
import { describe, it } from "node:test";
import { KillRing } from "../src/kill-ring.js";

describe("KillRing", () => {
	it("push creates new entry", () => {
		const ring = new KillRing();
		ring.push("hello", { prepend: false });
		assert.strictEqual(ring.peek(), "hello");
		assert.strictEqual(ring.length, 1);
	});

	it("push with accumulate=true appends to last entry", () => {
		const ring = new KillRing();
		ring.push("hello", { prepend: false });
		ring.push(" world", { prepend: false, accumulate: true });
		assert.strictEqual(ring.peek(), "hello world");
		assert.strictEqual(ring.length, 1);
	});

	it("push with accumulate=true and prepend=true prepends to last entry", () => {
		const ring = new KillRing();
		ring.push("world", { prepend: false });
		ring.push("hello ", { prepend: true, accumulate: true });
		assert.strictEqual(ring.peek(), "hello world");
		assert.strictEqual(ring.length, 1);
	});

	it("push ignores empty string", () => {
		const ring = new KillRing();
		ring.push("", { prepend: false });
		assert.strictEqual(ring.length, 0);
	});

	it("peek returns undefined on empty ring", () => {
		const ring = new KillRing();
		assert.strictEqual(ring.peek(), undefined);
	});

	it("peek returns most recent without removing", () => {
		const ring = new KillRing();
		ring.push("first", { prepend: false });
		ring.push("second", { prepend: false });
		assert.strictEqual(ring.peek(), "second");
		assert.strictEqual(ring.peek(), "second");
		assert.strictEqual(ring.length, 2);
	});

	it("rotate cycles entries", () => {
		const ring = new KillRing();
		ring.push("a", { prepend: false });
		ring.push("b", { prepend: false });
		ring.push("c", { prepend: false });
		assert.strictEqual(ring.peek(), "c");
		ring.rotate();
		assert.strictEqual(ring.peek(), "b");
		ring.rotate();
		assert.strictEqual(ring.peek(), "a");
		ring.rotate();
		assert.strictEqual(ring.peek(), "c");
	});

	it("rotate does nothing with single entry", () => {
		const ring = new KillRing();
		ring.push("only", { prepend: false });
		ring.rotate();
		assert.strictEqual(ring.peek(), "only");
		assert.strictEqual(ring.length, 1);
	});

	it("length tracks entries", () => {
		const ring = new KillRing();
		assert.strictEqual(ring.length, 0);
		ring.push("a", { prepend: false });
		assert.strictEqual(ring.length, 1);
		ring.push("b", { prepend: false });
		assert.strictEqual(ring.length, 2);
	});
});

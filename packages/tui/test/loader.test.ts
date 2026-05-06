import assert from "node:assert";
import { afterEach, describe, it } from "node:test";
import { Loader } from "../src/components/loader.js";

function createMockTUI() {
	const renders: number[] = [];
	return {
		requestRender: () => {
			renders.push(Date.now());
		},
		renders,
	};
}

type MockTUI = ReturnType<typeof createMockTUI>;

function createLoader(ui: MockTUI, message = "Loading...") {
	return new Loader(
		ui as any,
		(s) => s,
		(s) => s,
		message,
	);
}

describe("Loader", () => {
	it("constructor sets initial message via updateDisplay", () => {
		const ui = createMockTUI();
		const loader = createLoader(ui, "Hello");
		const lines = loader.render(80);
		assert.ok(lines.length > 0);
		assert.ok(
			lines.some((l) => l.includes("Hello")),
			"rendered lines should contain the message",
		);
	});

	it("constructor uses default message", () => {
		const ui = createMockTUI();
		const loader = createLoader(ui);
		const lines = loader.render(80);
		assert.ok(lines.some((l) => l.includes("Loading...")));
	});

	it("render prepends empty line", () => {
		const ui = createMockTUI();
		const loader = createLoader(ui, "msg");
		const lines = loader.render(80);
		assert.strictEqual(lines[0], "", "first line should be empty");
		assert.ok(lines.length >= 2, "should have more than just the empty line");
	});

	it("setMessage updates displayed text", () => {
		const ui = createMockTUI();
		const loader = createLoader(ui, "old");
		loader.start();
		const before = loader.render(80).join("");
		assert.ok(before.includes("old"));

		loader.setMessage("new");
		const after = loader.render(80).join("");
		assert.ok(after.includes("new"));
		assert.ok(!after.includes("old"));
		loader.stop();
	});

	it("setMessage calls requestRender", () => {
		const ui = createMockTUI();
		const loader = createLoader(ui);
		loader.start();
		const beforeCount = ui.renders.length;
		loader.setMessage("updated");
		assert.ok(ui.renders.length > beforeCount, "requestRender should be called after setMessage");
		loader.stop();
	});

	it("start begins animation interval", async () => {
		const ui = createMockTUI();
		const loader = createLoader(ui);
		loader.start();
		const beforeCount = ui.renders.length;

		await new Promise<void>((resolve) => setTimeout(resolve, 250));
		assert.ok(ui.renders.length > beforeCount, "animation should trigger requestRender calls");
		loader.stop();
	});

	it("stop clears animation interval", () => {
		const ui = createMockTUI();
		const loader = createLoader(ui);
		loader.start();
		loader.stop();

		const countAfterStop = ui.renders.length;
		return new Promise<void>((resolve) => {
			setTimeout(() => {
				assert.strictEqual(ui.renders.length, countAfterStop, "no more renders after stop");
				resolve();
			}, 200);
		});
	});

	it("custom indicator with single frame does not animate", () => {
		const ui = createMockTUI();
		const loader = new Loader(
			ui as any,
			(s) => s,
			(s) => s,
			"Static",
			{
				frames: ["●"],
				intervalMs: 50,
			},
		);
		const countAfterStart = ui.renders.length;

		return new Promise<void>((resolve) => {
			setTimeout(() => {
				assert.strictEqual(ui.renders.length, countAfterStart, "single frame should not animate");
				loader.stop();
				resolve();
			}, 200);
		});
	});

	it("custom indicator with empty frames hides indicator", () => {
		const ui = createMockTUI();
		const loader = new Loader(
			ui as any,
			(s) => s,
			(s) => s,
			"NoIndicator",
			{
				frames: [],
				intervalMs: 50,
			},
		);
		const lines = loader.render(80);
		const joined = lines.join("");
		assert.ok(!joined.includes("⠋"), "should not contain default spinner frame");
		assert.ok(joined.includes("NoIndicator"), "should contain the message");
	});

	it("setIndicator restarts animation with new options", () => {
		const ui = createMockTUI();
		const loader = createLoader(ui);
		loader.start();
		loader.setIndicator({ frames: ["1", "2", "3"], intervalMs: 50 });

		const countAfterSet = ui.renders.length;
		return new Promise<void>((resolve) => {
			setTimeout(() => {
				assert.ok(ui.renders.length > countAfterSet, "new animation should trigger renders");
				loader.stop();
				resolve();
			}, 200);
		});
	});

	it("spinnerColorFn and messageColorFn are applied", () => {
		const ui = createMockTUI();
		const spinner = (s: string) => `\x1b[31m${s}\x1b[0m`;
		const message = (s: string) => `\x1b[32m${s}\x1b[0m`;
		const loader = new Loader(ui as any, spinner, message, "colored");
		const lines = loader.render(80);
		const joined = lines.join("");
		assert.ok(joined.includes("\x1b[31m"), "spinner color should be applied");
		assert.ok(joined.includes("\x1b[32m"), "message color should be applied");
	});
});

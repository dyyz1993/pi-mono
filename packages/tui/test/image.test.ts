import assert from "node:assert";
import { describe, it } from "node:test";
import { Image } from "../src/components/image.js";
import { resetCapabilitiesCache, setCapabilities, type TerminalCapabilities } from "../src/terminal-image.js";

function createImage(opts: { base64Data?: string; mimeType?: string; imageId?: number } = {}) {
	const base64Data = opts.base64Data ?? "dGVzdA==";
	const mimeType = opts.mimeType ?? "image/png";
	return new Image(
		base64Data,
		mimeType,
		{ fallbackColor: (s) => `\x1b[36m${s}\x1b[0m` },
		{ filename: "test.png", imageId: opts.imageId },
		{ widthPx: 100, heightPx: 100 },
	);
}

function withCaps<T>(caps: TerminalCapabilities, fn: () => T): T {
	setCapabilities(caps);
	try {
		return fn();
	} finally {
		resetCapabilitiesCache();
	}
}

describe("Image", () => {
	it("renders fallback when images capability is disabled", () => {
		const img = createImage();
		const lines = withCaps({ images: null, trueColor: false, hyperlinks: false }, () => img.render(80));
		assert.strictEqual(lines.length, 1);
		assert.ok(lines[0].includes("test.png"), "fallback should include filename");
		assert.ok(lines[0].includes("image/png"), "fallback should include mime type");
		assert.ok(lines[0].includes("100x100"), "fallback should include dimensions");
	});

	it("applies fallbackColor to fallback text", () => {
		const img = createImage();
		const lines = withCaps({ images: null, trueColor: false, hyperlinks: false }, () => img.render(80));
		assert.ok(lines[0].includes("\x1b[36m"), "fallback should have color applied");
	});

	it("fallback without filename omits it", () => {
		const img = new Image("dGVzdA==", "image/jpeg", { fallbackColor: (s) => s }, {}, { widthPx: 200, heightPx: 150 });
		const lines = withCaps({ images: null, trueColor: false, hyperlinks: false }, () => img.render(80));
		assert.ok(!lines[0].includes("undefined"), "should not contain undefined");
		assert.ok(lines[0].includes("[image/jpeg]"), "should include mime type");
		assert.ok(lines[0].includes("200x150"), "should include dimensions");
	});

	it("getImageId returns provided imageId", () => {
		const img = createImage({ imageId: 42 });
		assert.strictEqual(img.getImageId(), 42);
	});

	it("getImageId returns undefined when no imageId", () => {
		const img = createImage();
		assert.strictEqual(img.getImageId(), undefined);
	});

	it("invalidate clears cache", () => {
		const img = createImage();
		const first = withCaps({ images: null, trueColor: false, hyperlinks: false }, () => img.render(80));
		img.invalidate();
		const second = withCaps({ images: null, trueColor: false, hyperlinks: false }, () => img.render(80));
		assert.deepStrictEqual(first, second, "after invalidate, re-render produces same result");
	});

	it("caches rendered lines for same width", () => {
		const img = createImage();
		const first = withCaps({ images: null, trueColor: false, hyperlinks: false }, () => img.render(80));
		const second = withCaps({ images: null, trueColor: false, hyperlinks: false }, () => img.render(80));
		assert.strictEqual(first, second, "same object reference when cached");
	});

	it("re-renders for different width", () => {
		const img = createImage();
		const narrow = withCaps({ images: null, trueColor: false, hyperlinks: false }, () => img.render(40));
		const wide = withCaps({ images: null, trueColor: false, hyperlinks: false }, () => img.render(120));
		assert.notStrictEqual(narrow, wide, "different widths should produce different results");
	});

	it("renders kitty image sequence when capability is kitty", () => {
		const img = createImage();
		const lines = withCaps({ images: "kitty", trueColor: true, hyperlinks: true }, () => img.render(80));
		assert.ok(lines.length >= 1, "kitty render should produce lines");
		const lastLine = lines[lines.length - 1];
		assert.ok(lastLine.includes("\x1b_G"), "should contain kitty escape sequence");
	});

	it("renders iterm2 image sequence when capability is iterm2", () => {
		const img = createImage();
		const lines = withCaps({ images: "iterm2", trueColor: true, hyperlinks: true }, () => img.render(80));
		assert.ok(lines.length >= 1, "iterm2 render should produce lines");
		const lastLine = lines[lines.length - 1];
		assert.ok(lastLine.includes("\x1b]1337;File="), "should contain iterm2 escape sequence");
	});

	it("falls back when renderImage returns null despite images capability", () => {
		const img = new Image(
			"dGVzdA==",
			"image/png",
			{ fallbackColor: (s) => s },
			{ filename: "fallback.png" },
			{ widthPx: 100, heightPx: 100 },
		);
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		const lines = img.render(80);
		resetCapabilitiesCache();
		assert.ok(lines.length >= 1);
	});
});

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/image-resize.js", () => ({
	resizeImage: vi.fn(),
	formatDimensionNote: vi.fn(() => undefined),
}));

import { processFileArguments } from "../src/cli/file-processor.ts";
import { createReadTool } from "../src/core/tools/read.ts";
import { resizeImage } from "../src/utils/image-resize.ts";

const TINY_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

describe("image resize callers", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `image-resize-callers-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
		vi.mocked(resizeImage).mockReset();
		vi.mocked(resizeImage).mockResolvedValue(null);
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("read tool returns text-only output when auto-resize cannot produce a safe image", async () => {
		const imagePath = join(testDir, "test.png");
		writeFileSync(imagePath, Buffer.from(TINY_PNG_BASE64, "base64"));

		const tool = createReadTool(testDir);
		const result = await tool.execute("test-read-image", { path: imagePath });

		expect(result.content).toHaveLength(1);
		expect(result.content[0].type).toBe("text");
		expect((result.content[0] as { type: "text"; text: string }).text).toContain("Image omitted");
	});

	it("file processor omits image attachments when auto-resize cannot produce a safe image", async () => {
		const imagePath = join(testDir, "test.png");
		writeFileSync(imagePath, Buffer.from(TINY_PNG_BASE64, "base64"));

		const result = await processFileArguments([imagePath]);

		expect(result.images).toHaveLength(0);
		expect(result.text).toContain("Image omitted");
	});

	it("file processor attaches image asset metadata when resize succeeds", async () => {
		const imagePath = join(testDir, "test.png");
		writeFileSync(imagePath, Buffer.from(TINY_PNG_BASE64, "base64"));
		vi.mocked(resizeImage).mockResolvedValue({
			data: TINY_PNG_BASE64,
			mimeType: "image/png",
			originalWidth: 1,
			originalHeight: 1,
			width: 1,
			height: 1,
			wasResized: false,
		});

		const result = await processFileArguments([imagePath]);

		expect(result.images).toHaveLength(1);
		expect(result.images[0].asset).toMatchObject({
			type: "image",
			mimeType: "image/png",
			storage: "local",
			visibility: "local",
			sourcePath: imagePath,
		});
		expect(result.text).toContain(`[Image asset: ${result.images[0].asset?.id}]`);
		expect(result.images[0].asset?.localPath && existsSync(result.images[0].asset.localPath)).toBe(true);
	});

	it("file processor allows file resolvers to handle @file content", async () => {
		const customPath = join(testDir, "custom.bin");
		writeFileSync(customPath, Buffer.from([1, 2, 3]));

		const result = await processFileArguments([customPath], {
			fileResolvers: [
				{
					name: "custom-file-processor-resolver",
					async resolve(ctx) {
						if (!ctx.absolutePath.endsWith("custom.bin")) return undefined;
						return {
							content: [{ type: "text", text: "ignored by @file" }],
							fileReferenceText: `<file name="${ctx.absolutePath}">custom resolver file text</file>\n`,
							images: [],
						};
					},
				},
			],
		});

		expect(result.text).toContain("custom resolver file text");
		expect(result.images).toHaveLength(0);
	});

	it("file processor truncates large text files referenced by @file", async () => {
		const textPath = join(testDir, "large.txt");
		const lines = Array.from({ length: 2500 }, (_, index) => `Line ${index + 1}`);
		writeFileSync(textPath, lines.join("\n"));

		const result = await processFileArguments([textPath]);

		expect(result.text).toContain(`<file name="${textPath}">`);
		expect(result.text).toContain("Line 1");
		expect(result.text).toContain("Line 2000");
		expect(result.text).not.toContain("Line 2001");
		expect(result.text).toContain("[Showing lines 1-2000 of 2500. Use offset=2001 to continue.]");
	});

	it("file processor avoids injecting a single oversized text line referenced by @file", async () => {
		const textPath = join(testDir, "single-line.txt");
		writeFileSync(textPath, "x".repeat(60 * 1024));

		const result = await processFileArguments([textPath]);

		expect(result.text).toContain("exceeds 50.0KB limit");
		expect(result.text).toContain("head -c 51200");
		expect(result.text.length).toBeLessThan(1024);
	});
});

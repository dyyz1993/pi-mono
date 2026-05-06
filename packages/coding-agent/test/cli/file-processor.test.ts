import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mockDetectMime = vi.hoisted(() => vi.fn());
const mockResizeImage = vi.hoisted(() => vi.fn());
const mockFormatDimensionNote = vi.hoisted(() => vi.fn());
const mockResolveReadPath = vi.hoisted(() => vi.fn());

vi.mock("../../src/utils/mime.js", () => ({
	detectSupportedImageMimeTypeFromFile: mockDetectMime,
}));

vi.mock("../../src/utils/image-resize.js", () => ({
	resizeImage: mockResizeImage,
	formatDimensionNote: mockFormatDimensionNote,
}));

vi.mock("../../src/core/tools/path-utils.js", () => ({
	resolveReadPath: mockResolveReadPath,
}));

describe("processFileArguments", () => {
	let tempDir: string;

	beforeEach(async () => {
		vi.resetModules();
		tempDir = join(tmpdir(), `file-processor-test-${Date.now()}`);
		await mkdir(tempDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	async function loadModule() {
		return import("../../src/cli/file-processor.js");
	}

	test("reads text file content", async () => {
		const filePath = join(tempDir, "test.txt");
		await writeFile(filePath, "hello world");
		mockResolveReadPath.mockReturnValue(filePath);
		mockDetectMime.mockResolvedValue(null);

		const { processFileArguments } = await loadModule();
		const result = await processFileArguments([filePath]);

		expect(result.text).toContain("hello world");
		expect(result.images).toHaveLength(0);
	});

	test("reads multiple text files", async () => {
		const file1 = join(tempDir, "a.txt");
		const file2 = join(tempDir, "b.txt");
		await writeFile(file1, "content a");
		await writeFile(file2, "content b");
		mockResolveReadPath.mockImplementation((p: string) => p);
		mockDetectMime.mockResolvedValue(null);

		const { processFileArguments } = await loadModule();
		const result = await processFileArguments([file1, file2]);

		expect(result.text).toContain("content a");
		expect(result.text).toContain("content b");
	});

	test("processes image file with auto-resize disabled", async () => {
		const filePath = join(tempDir, "test.png");
		await writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
		mockResolveReadPath.mockReturnValue(filePath);
		mockDetectMime.mockResolvedValue("image/png");

		const { processFileArguments } = await loadModule();
		const result = await processFileArguments([filePath], { autoResizeImages: false });

		expect(result.images).toHaveLength(1);
		expect(result.images[0].mimeType).toBe("image/png");
		expect(result.images[0].type).toBe("image");
	});

	test("skips empty files", async () => {
		const filePath = join(tempDir, "empty.txt");
		await writeFile(filePath, "");
		mockResolveReadPath.mockReturnValue(filePath);
		mockDetectMime.mockResolvedValue(null);

		const { processFileArguments } = await loadModule();
		const result = await processFileArguments([filePath]);

		expect(result.text).toBe("");
		expect(result.images).toHaveLength(0);
	});

	test("returns empty result for no files", async () => {
		const { processFileArguments } = await loadModule();
		const result = await processFileArguments([]);

		expect(result.text).toBe("");
		expect(result.images).toHaveLength(0);
	});

	test("exits on non-existent file", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit");
		});
		const filePath = join(tempDir, "nonexistent.txt");
		mockResolveReadPath.mockReturnValue(filePath);

		const { processFileArguments } = await loadModule();
		await expect(processFileArguments([filePath])).rejects.toThrow("process.exit");
		expect(exitSpy).toHaveBeenCalledWith(1);
		exitSpy.mockRestore();
	});

	test("wraps text content in file tags", async () => {
		const filePath = join(tempDir, "tagged.txt");
		await writeFile(filePath, "my content");
		mockResolveReadPath.mockReturnValue(filePath);
		mockDetectMime.mockResolvedValue(null);

		const { processFileArguments } = await loadModule();
		const result = await processFileArguments([filePath]);

		expect(result.text).toContain(`<file name="${filePath}">`);
		expect(result.text).toContain("</file>");
		expect(result.text).toContain("my content");
	});
});

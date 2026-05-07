import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";

function createMinimalPng(): Buffer {
	const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const ihdrLength = Buffer.alloc(4);
	ihdrLength.writeUInt32BE(13, 0);
	const ihdrType = Buffer.from("IHDR");
	const width = Buffer.alloc(4);
	width.writeUInt32BE(1, 0);
	const height = Buffer.alloc(4);
	height.writeUInt32BE(1, 0);
	const ihdrData = Buffer.concat([width, height, Buffer.from([8, 2, 0, 0, 0])]);
	const ihdrCrc = Buffer.alloc(4);
	ihdrCrc.writeUInt32BE(0x927243a5, 0);
	return Buffer.concat([signature, ihdrLength, ihdrType, ihdrData, ihdrCrc]);
}

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const GIF_MAGIC = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP_MAGIC = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

function createTempDir(): string {
	const dir = join(tmpdir(), `mime-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("detectSupportedImageMimeTypeFromFile", () => {
	let tempDir: string;

	afterEach(() => {
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	async function load() {
		return import("../../src/utils/mime.js");
	}

	it("detects PNG from magic bytes", async () => {
		tempDir = createTempDir();
		const filePath = join(tempDir, "test.png");
		writeFileSync(filePath, createMinimalPng());
		const { detectSupportedImageMimeTypeFromFile } = await load();
		const result = await detectSupportedImageMimeTypeFromFile(filePath);
		expect(result).toBe("image/png");
	});

	it("detects JPEG from magic bytes", async () => {
		tempDir = createTempDir();
		const filePath = join(tempDir, "test.jpg");
		writeFileSync(filePath, JPEG_MAGIC);
		const { detectSupportedImageMimeTypeFromFile } = await load();
		const result = await detectSupportedImageMimeTypeFromFile(filePath);
		expect(result).toBe("image/jpeg");
	});

	it("detects GIF from magic bytes", async () => {
		tempDir = createTempDir();
		const filePath = join(tempDir, "test.gif");
		writeFileSync(filePath, GIF_MAGIC);
		const { detectSupportedImageMimeTypeFromFile } = await load();
		const result = await detectSupportedImageMimeTypeFromFile(filePath);
		expect(result).toBe("image/gif");
	});

	it("detects WebP from magic bytes", async () => {
		tempDir = createTempDir();
		const filePath = join(tempDir, "test.webp");
		writeFileSync(filePath, WEBP_MAGIC);
		const { detectSupportedImageMimeTypeFromFile } = await load();
		const result = await detectSupportedImageMimeTypeFromFile(filePath);
		expect(result).toBe("image/webp");
	});

	it("returns null for non-image file", async () => {
		tempDir = createTempDir();
		const filePath = join(tempDir, "test.txt");
		writeFileSync(filePath, "hello world");
		const { detectSupportedImageMimeTypeFromFile } = await load();
		const result = await detectSupportedImageMimeTypeFromFile(filePath);
		expect(result).toBeNull();
	});

	it("returns null for non-existent file", async () => {
		const { detectSupportedImageMimeTypeFromFile } = await load();
		await expect(detectSupportedImageMimeTypeFromFile("/nonexistent/file.png")).rejects.toThrow();
	});

	it("returns null for empty file", async () => {
		tempDir = createTempDir();
		const filePath = join(tempDir, "empty.png");
		writeFileSync(filePath, Buffer.alloc(0));
		const { detectSupportedImageMimeTypeFromFile } = await load();
		const result = await detectSupportedImageMimeTypeFromFile(filePath);
		expect(result).toBeNull();
	});
});

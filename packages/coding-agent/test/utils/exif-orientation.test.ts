import { describe, expect, test } from "vitest";

type Photon = typeof import("@silvia-odwyer/photon-node");

function createMinimalJpegWithOrientation(orientation: number): Uint8Array {
	const tiffHeaderSize = 8;
	const ifdOffset = 8;
	const entryCount = 1;
	const entrySize = 12;
	const ifdSize = 2 + entryCount * entrySize;

	const segmentDataSize = 6 + tiffHeaderSize + ifdSize;

	const buf = new Uint8Array(2 + 2 + 2 + segmentDataSize);

	let off = 0;
	buf[off++] = 0xff;
	buf[off++] = 0xd8;

	buf[off++] = 0xff;
	buf[off++] = 0xe1;
	buf[off++] = (segmentDataSize >> 8) & 0xff;
	buf[off++] = segmentDataSize & 0xff;

	buf[off++] = 0x45;
	buf[off++] = 0x78;
	buf[off++] = 0x69;
	buf[off++] = 0x66;
	buf[off++] = 0x00;
	buf[off++] = 0x00;

	buf[off++] = 0x4d;
	buf[off++] = 0x4d;

	buf[off++] = 0x00;
	buf[off++] = 0x2a;

	buf[off++] = (ifdOffset >> 24) & 0xff;
	buf[off++] = (ifdOffset >> 16) & 0xff;
	buf[off++] = (ifdOffset >> 8) & 0xff;
	buf[off++] = ifdOffset & 0xff;

	buf[off++] = 0x00;
	buf[off++] = entryCount;

	const entryOff = off;
	buf[entryOff] = 0x01;
	buf[entryOff + 1] = 0x12;
	buf[entryOff + 2] = 0x00;
	buf[entryOff + 3] = 0x03;
	buf[entryOff + 4] = 0x00;
	buf[entryOff + 5] = 0x00;
	buf[entryOff + 6] = 0x00;
	buf[entryOff + 7] = 0x01;
	buf[entryOff + 8] = 0x00;
	buf[entryOff + 9] = orientation & 0xff;
	buf[entryOff + 10] = 0x00;
	buf[entryOff + 11] = 0x00;

	return buf;
}

function createJpegWithoutExif(): Uint8Array {
	return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xd9]);
}

function createNonJpeg(): Uint8Array {
	return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function createWebPWithOrientation(orientation: number): Uint8Array {
	const exifData = buildExifBlock(orientation);
	const chunkDataSize = exifData.length;
	const vp8ChunkSize = 10;
	const riffPayload = 4 + (8 + vp8ChunkSize) + (8 + chunkDataSize);

	const totalSize = 8 + riffPayload;
	const buf = new Uint8Array(totalSize);
	let off = 0;

	buf[off++] = 0x52;
	buf[off++] = 0x49;
	buf[off++] = 0x46;
	buf[off++] = 0x46;
	buf[off++] = riffPayload & 0xff;
	buf[off++] = (riffPayload >> 8) & 0xff;
	buf[off++] = (riffPayload >> 16) & 0xff;
	buf[off++] = (riffPayload >> 24) & 0xff;
	buf[off++] = 0x57;
	buf[off++] = 0x45;
	buf[off++] = 0x42;
	buf[off++] = 0x50;

	buf[off++] = 0x56;
	buf[off++] = 0x50;
	buf[off++] = 0x38;
	buf[off++] = 0x20;
	buf[off++] = vp8ChunkSize & 0xff;
	buf[off++] = (vp8ChunkSize >> 8) & 0xff;
	buf[off++] = (vp8ChunkSize >> 16) & 0xff;
	buf[off++] = (vp8ChunkSize >> 24) & 0xff;
	for (let i = 0; i < vp8ChunkSize; i++) buf[off++] = 0x00;

	buf[off++] = 0x45;
	buf[off++] = 0x58;
	buf[off++] = 0x49;
	buf[off++] = 0x46;
	buf[off++] = chunkDataSize & 0xff;
	buf[off++] = (chunkDataSize >> 8) & 0xff;
	buf[off++] = (chunkDataSize >> 16) & 0xff;
	buf[off++] = (chunkDataSize >> 24) & 0xff;

	buf.set(exifData, off);

	return buf;
}

function buildExifBlock(orientation: number): Uint8Array {
	const tiffHeaderSize = 8;
	const ifdOffset = 8;
	const entryCount = 1;
	const entrySize = 12;
	const ifdSize = 2 + entryCount * entrySize;
	const exifPrefixSize = 6;

	const totalSize = exifPrefixSize + tiffHeaderSize + ifdSize;
	const buf = new Uint8Array(totalSize);
	let off = 0;

	buf[off++] = 0x45;
	buf[off++] = 0x78;
	buf[off++] = 0x69;
	buf[off++] = 0x66;
	buf[off++] = 0x00;
	buf[off++] = 0x00;

	buf[off++] = 0x4d;
	buf[off++] = 0x4d;
	buf[off++] = 0x00;
	buf[off++] = 0x2a;
	buf[off++] = (ifdOffset >> 24) & 0xff;
	buf[off++] = (ifdOffset >> 16) & 0xff;
	buf[off++] = (ifdOffset >> 8) & 0xff;
	buf[off++] = ifdOffset & 0xff;

	buf[off++] = 0x00;
	buf[off++] = entryCount;

	const entryOff = off;
	buf[entryOff] = 0x01;
	buf[entryOff + 1] = 0x12;
	buf[entryOff + 2] = 0x00;
	buf[entryOff + 3] = 0x03;
	buf[entryOff + 4] = 0x00;
	buf[entryOff + 5] = 0x00;
	buf[entryOff + 6] = 0x00;
	buf[entryOff + 7] = 0x01;
	buf[entryOff + 8] = 0x00;
	buf[entryOff + 9] = orientation & 0xff;
	buf[entryOff + 10] = 0x00;
	buf[entryOff + 11] = 0x00;

	return buf;
}

function createMockPhoton() {
	return {
		fliph: vi.fn((img: unknown) => img),
		flipv: vi.fn((img: unknown) => img),
		PhotonImage: vi.fn((data: Uint8Array, w: number, h: number) => ({
			get_width: () => w,
			get_height: () => h,
			get_raw_pixels: () => data,
		})),
	};
}

async function loadModule() {
	return import("../../src/utils/exif-orientation.js");
}

describe("exif-orientation", () => {
	describe("getExifOrientation (via applyExifOrientation)", () => {
		test("reads orientation 1 from JPEG", async () => {
			const { applyExifOrientation } = await loadModule();
			const photon = createMockPhoton() as unknown as Photon;
			const img = { get_width: () => 2, get_height: () => 2, get_raw_pixels: () => new Uint8Array(16) } as any;
			const buf = createMinimalJpegWithOrientation(1);
			const result = applyExifOrientation(photon, img, buf);
			expect(result).toBe(img);
			expect(photon.fliph).not.toHaveBeenCalled();
		});

		test("reads orientation 2 from JPEG and applies fliph", async () => {
			const { applyExifOrientation } = await loadModule();
			const photon = createMockPhoton() as unknown as Photon;
			const img = { get_width: () => 2, get_height: () => 2, get_raw_pixels: () => new Uint8Array(16) } as any;
			const buf = createMinimalJpegWithOrientation(2);
			applyExifOrientation(photon, img, buf);
			expect(photon.fliph).toHaveBeenCalledTimes(1);
		});

		test("reads orientation 3 from JPEG and applies fliph+flipv", async () => {
			const { applyExifOrientation } = await loadModule();
			const photon = createMockPhoton() as unknown as Photon;
			const img = { get_width: () => 2, get_height: () => 2, get_raw_pixels: () => new Uint8Array(16) } as any;
			const buf = createMinimalJpegWithOrientation(3);
			applyExifOrientation(photon, img, buf);
			expect(photon.fliph).toHaveBeenCalledTimes(1);
			expect(photon.flipv).toHaveBeenCalledTimes(1);
		});

		test("reads orientation 4 from JPEG and applies flipv", async () => {
			const { applyExifOrientation } = await loadModule();
			const photon = createMockPhoton() as unknown as Photon;
			const img = { get_width: () => 2, get_height: () => 2, get_raw_pixels: () => new Uint8Array(16) } as any;
			const buf = createMinimalJpegWithOrientation(4);
			applyExifOrientation(photon, img, buf);
			expect(photon.flipv).toHaveBeenCalledTimes(1);
			expect(photon.fliph).not.toHaveBeenCalled();
		});

		test("reads orientation 6 from JPEG (rotation)", async () => {
			const { applyExifOrientation } = await loadModule();
			const photon = createMockPhoton() as unknown as Photon;
			const pixels = new Uint8Array(16);
			const img = { get_width: () => 2, get_height: () => 2, get_raw_pixels: () => pixels } as any;
			const buf = createMinimalJpegWithOrientation(6);
			const result = applyExifOrientation(photon, img, buf);
			expect(result).not.toBe(img);
			expect(photon.PhotonImage).toHaveBeenCalledWith(expect.any(Uint8Array), 2, 2);
		});

		test("reads orientation 8 and returns rotated image", async () => {
			const { applyExifOrientation } = await loadModule();
			const photon = createMockPhoton() as unknown as Photon;
			const img = { get_width: () => 2, get_height: () => 2, get_raw_pixels: () => new Uint8Array(16) } as any;
			const buf = createMinimalJpegWithOrientation(8);
			const result = applyExifOrientation(photon, img, buf);
			expect(result).not.toBe(img);
			expect(photon.PhotonImage).toHaveBeenCalled();
		});

		test("orientation 5 applies rotation + fliph", async () => {
			const { applyExifOrientation } = await loadModule();
			const photon = createMockPhoton() as unknown as Photon;
			const img = { get_width: () => 2, get_height: () => 2, get_raw_pixels: () => new Uint8Array(16) } as any;
			const buf = createMinimalJpegWithOrientation(5);
			const result = applyExifOrientation(photon, img, buf);
			expect(photon.PhotonImage).toHaveBeenCalled();
			expect(photon.fliph).toHaveBeenCalledTimes(1);
			expect(result).not.toBe(img);
		});

		test("orientation 7 applies rotation + fliph", async () => {
			const { applyExifOrientation } = await loadModule();
			const photon = createMockPhoton() as unknown as Photon;
			const img = { get_width: () => 2, get_height: () => 2, get_raw_pixels: () => new Uint8Array(16) } as any;
			const buf = createMinimalJpegWithOrientation(7);
			const result = applyExifOrientation(photon, img, buf);
			expect(photon.PhotonImage).toHaveBeenCalled();
			expect(photon.fliph).toHaveBeenCalledTimes(1);
			expect(result).not.toBe(img);
		});

		test("returns orientation 1 for JPEG without EXIF", async () => {
			const { applyExifOrientation } = await loadModule();
			const photon = createMockPhoton() as unknown as Photon;
			const img = { get_width: () => 2, get_height: () => 2, get_raw_pixels: () => new Uint8Array(16) } as any;
			const buf = createJpegWithoutExif();
			const result = applyExifOrientation(photon, img, buf);
			expect(result).toBe(img);
		});

		test("returns orientation 1 for non-JPEG input", async () => {
			const { applyExifOrientation } = await loadModule();
			const photon = createMockPhoton() as unknown as Photon;
			const img = { get_width: () => 2, get_height: () => 2, get_raw_pixels: () => new Uint8Array(16) } as any;
			const buf = createNonJpeg();
			const result = applyExifOrientation(photon, img, buf);
			expect(result).toBe(img);
		});

		test("reads orientation from WebP", async () => {
			const { applyExifOrientation } = await loadModule();
			const photon = createMockPhoton() as unknown as Photon;
			const img = { get_width: () => 2, get_height: () => 2, get_raw_pixels: () => new Uint8Array(16) } as any;
			const buf = createWebPWithOrientation(2);
			applyExifOrientation(photon, img, buf);
			expect(photon.fliph).toHaveBeenCalledTimes(1);
		});

		test("returns image unchanged for orientation > 8", async () => {
			const { applyExifOrientation } = await loadModule();
			const photon = createMockPhoton() as unknown as Photon;
			const img = { get_width: () => 2, get_height: () => 2, get_raw_pixels: () => new Uint8Array(16) } as any;
			const buf = createMinimalJpegWithOrientation(9);
			const result = applyExifOrientation(photon, img, buf);
			expect(result).toBe(img);
		});

		test("returns image unchanged for orientation 0", async () => {
			const { applyExifOrientation } = await loadModule();
			const photon = createMockPhoton() as unknown as Photon;
			const img = { get_width: () => 2, get_height: () => 2, get_raw_pixels: () => new Uint8Array(16) } as any;
			const buf = createMinimalJpegWithOrientation(0);
			const result = applyExifOrientation(photon, img, buf);
			expect(result).toBe(img);
		});
	});
});

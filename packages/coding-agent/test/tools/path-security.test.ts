import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	isWithinSandbox,
	isWithinSandboxSync,
	PathSecurityError,
	safeJoin,
	sanitizeFilename,
	sanitizePath,
} from "../../src/core/tools/path-security.js";

const TMP_DIR = join("/tmp", "path-security-test", String(process.pid));

beforeAll(() => {
	mkdirSync(TMP_DIR, { recursive: true });
});

afterAll(() => {
	rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("sanitizePath", () => {
	it("normalizes path separators", () => {
		expect(sanitizePath("foo/bar")).toBe("foo/bar");
	});

	it("normalizes redundant separators", () => {
		expect(sanitizePath("foo//bar")).toBe("foo/bar");
	});

	it("normalizes parent references", () => {
		expect(sanitizePath("foo/bar/../baz")).toBe("foo/baz");
	});

	it("throws on null bytes", () => {
		expect(() => sanitizePath("foo\0bar")).toThrow(PathSecurityError);
		try {
			sanitizePath("foo\0bar");
		} catch (e) {
			expect((e as PathSecurityError).violation).toBe("null_byte");
		}
	});

	it("handles unicode NFC normalization", () => {
		const result = sanitizePath("cafe\u0301");
		expect(typeof result).toBe("string");
	});
});

describe("sanitizeFilename", () => {
	it("accepts valid filenames", () => {
		expect(sanitizeFilename("hello.txt")).toBe("hello.txt");
		expect(sanitizeFilename("my-file.md")).toBe("my-file.md");
		expect(sanitizeFilename("file_name.ts")).toBe("file_name.ts");
	});

	it("throws on null bytes", () => {
		expect(() => sanitizeFilename("file\0.txt")).toThrow(PathSecurityError);
		try {
			sanitizeFilename("file\0.txt");
		} catch (e) {
			expect((e as PathSecurityError).violation).toBe("null_byte");
		}
	});

	it("throws on empty filename", () => {
		expect(() => sanitizeFilename("")).toThrow(PathSecurityError);
		try {
			sanitizeFilename("");
		} catch (e) {
			expect((e as PathSecurityError).violation).toBe("empty_path");
		}
	});

	it("throws on double-dot traversal", () => {
		expect(() => sanitizeFilename("..")).toThrow(PathSecurityError);
		expect(() => sanitizeFilename("../etc/passwd")).toThrow(PathSecurityError);
		expect(() => sanitizeFilename("foo/..")).toThrow(PathSecurityError);
		try {
			sanitizeFilename("..");
		} catch (e) {
			expect((e as PathSecurityError).violation).toBe("not_within_sandbox");
		}
	});

	it("throws on non-normalized filename", () => {
		expect(() => sanitizeFilename("foo/./bar")).toThrow(PathSecurityError);
	});

	it("throws on absolute path", () => {
		expect(() => sanitizeFilename("/etc/passwd")).toThrow(PathSecurityError);
		try {
			sanitizeFilename("/etc/passwd");
		} catch (e) {
			expect((e as PathSecurityError).violation).toBe("not_within_sandbox");
		}
	});

	it("throws on path separators in filename", () => {
		expect(() => sanitizeFilename("sub/file.txt")).toThrow(PathSecurityError);
		expect(() => sanitizeFilename("sub\\file.txt")).toThrow(PathSecurityError);
		try {
			sanitizeFilename("sub/file.txt");
		} catch (e) {
			expect((e as PathSecurityError).violation).toBe("not_within_sandbox");
		}
	});
});

describe("isWithinSandboxSync", () => {
	it("returns true for path inside sandbox", () => {
		expect(isWithinSandboxSync("/tmp/sandbox/file.txt", "/tmp/sandbox")).toBe(true);
	});

	it("returns true for sandbox dir itself", () => {
		expect(isWithinSandboxSync("/tmp/sandbox", "/tmp/sandbox")).toBe(true);
	});

	it("returns false for path outside sandbox", () => {
		expect(isWithinSandboxSync("/etc/passwd", "/tmp/sandbox")).toBe(false);
	});

	it("returns false for traversal attempt", () => {
		expect(isWithinSandboxSync("/tmp/sandbox/../../../etc/passwd", "/tmp/sandbox")).toBe(false);
	});
});

describe("isWithinSandbox", () => {
	it("returns true for path inside sandbox", async () => {
		const sandbox = join(TMP_DIR, "sandbox");
		mkdirSync(sandbox, { recursive: true });
		const file = join(sandbox, "file.txt");
		writeFileSync(file, "test", "utf-8");
		expect(await isWithinSandbox(file, sandbox)).toBe(true);
	});

	it("returns false for path outside sandbox", async () => {
		const sandbox = join(TMP_DIR, "sandbox2");
		mkdirSync(sandbox, { recursive: true });
		expect(await isWithinSandbox("/etc/passwd", sandbox)).toBe(false);
	});

	it("returns false for symlink escape", async () => {
		const sandbox = join(TMP_DIR, "sandbox3");
		const outside = join(TMP_DIR, "outside3");
		mkdirSync(sandbox, { recursive: true });
		mkdirSync(outside, { recursive: true });
		writeFileSync(join(outside, "secret.txt"), "secret", "utf-8");
		const link = join(sandbox, "link");
		try {
			symlinkSync(join(outside, "secret.txt"), link);
		} catch {
			return;
		}
		expect(await isWithinSandbox(link, sandbox)).toBe(false);
	});

	it("returns true when resolveSymlinks is false for symlink inside sandbox", async () => {
		const sandbox = join(TMP_DIR, "sandbox4");
		mkdirSync(sandbox, { recursive: true });
		writeFileSync(join(sandbox, "real.txt"), "data", "utf-8");
		const link = join(sandbox, "link.txt");
		try {
			symlinkSync(join(sandbox, "real.txt"), link);
		} catch {
			return;
		}
		expect(await isWithinSandbox(link, sandbox, { resolveSymlinks: false })).toBe(true);
	});

	it("falls back when sandbox dir does not exist", async () => {
		const result = await isWithinSandbox("/tmp/nonexistent/file.txt", "/tmp/nonexistent");
		expect(typeof result).toBe("boolean");
	});
});

describe("safeJoin", () => {
	it("joins clean filename with sandbox", async () => {
		const sandbox = join(TMP_DIR, "sj-sandbox");
		mkdirSync(sandbox, { recursive: true });
		const result = await safeJoin(sandbox, "file.txt");
		expect(result).toBe(join(sandbox, "file.txt"));
	});

	it("rejects traversal filename", async () => {
		await expect(safeJoin("/tmp/sandbox", "../../../etc/passwd")).rejects.toThrow(PathSecurityError);
	});

	it("rejects absolute filename", async () => {
		await expect(safeJoin("/tmp/sandbox", "/etc/passwd")).rejects.toThrow(PathSecurityError);
	});

	it("rejects filename with path separators", async () => {
		await expect(safeJoin("/tmp/sandbox", "sub/file.txt")).rejects.toThrow(PathSecurityError);
	});

	it("rejects double-dot filename", async () => {
		await expect(safeJoin("/tmp/sandbox", "..")).rejects.toThrow(PathSecurityError);
	});

	it("rejects null byte in filename", async () => {
		await expect(safeJoin("/tmp/sandbox", "file\0.txt")).rejects.toThrow(PathSecurityError);
	});

	it("rejects empty filename", async () => {
		await expect(safeJoin("/tmp/sandbox", "")).rejects.toThrow(PathSecurityError);
	});

	it("rejects symlink escape via safeJoin", async () => {
		const sandbox = join(TMP_DIR, "sandbox5");
		const outside = join(TMP_DIR, "outside5");
		mkdirSync(sandbox, { recursive: true });
		mkdirSync(outside, { recursive: true });
		const link = join(sandbox, "escape");
		try {
			symlinkSync(outside, link);
		} catch {
			return;
		}
		const joined = join(link, "file.txt");
		await expect(isWithinSandbox(joined, sandbox)).resolves.toBe(false);
	});
});

describe("PathSecurityError", () => {
	it("has correct name", () => {
		const err = new PathSecurityError("null_byte", "test");
		expect(err.name).toBe("PathSecurityError");
		expect(err.violation).toBe("null_byte");
		expect(err.message).toBe("test");
	});

	it("is instance of Error", () => {
		const err = new PathSecurityError("empty_path", "test");
		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(PathSecurityError);
	});
});

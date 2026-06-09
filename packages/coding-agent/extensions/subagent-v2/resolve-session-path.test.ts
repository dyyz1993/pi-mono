/**
 * Tests for resolveSessionPath — locates a session JSONL file
 * by scanning a base directory recursively.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveSessionPath } from "./index.ts";

let tempRoot: string | undefined;

afterEach(() => {
	if (tempRoot) {
		rmSync(tempRoot, { recursive: true, force: true });
		tempRoot = undefined;
	}
});

function makeTemp(): string {
	const dir = mkdtempSync(join(tmpdir(), "resolve-session-"));
	tempRoot = dir;
	return dir;
}

describe("resolveSessionPath", () => {
	it("returns null when sessions base dir does not exist", () => {
		const result = resolveSessionPath("abc123", "/no/such/path/ever");
		expect(result).toBeNull();
	});

	it("returns null when sessionId file does not exist in base dir", () => {
		const base = makeTemp();
		writeFileSync(join(base, "other.jsonl"), "line");
		const result = resolveSessionPath("missing-id", base);
		expect(result).toBeNull();
	});

	it("finds session file directly in base dir", () => {
		const base = makeTemp();
		const expected = join(base, "sess-001.jsonl");
		writeFileSync(expected, "line");
		const result = resolveSessionPath("sess-001", base);
		expect(result).toBe(expected);
	});

	it("finds session file in subdirectory", () => {
		const base = makeTemp();
		const sub = join(base, "subdir");
		mkdirSync(sub);
		const expected = join(sub, "sess-002.jsonl");
		writeFileSync(expected, "line");
		const result = resolveSessionPath("sess-002", base);
		expect(result).toBe(expected);
	});

	it("finds session file in nested subdirectory", () => {
		const base = makeTemp();
		const nested = join(base, "a", "b");
		mkdirSync(nested, { recursive: true });
		const expected = join(nested, "sess-003.jsonl");
		writeFileSync(expected, "line");
		const result = resolveSessionPath("sess-003", base);
		expect(result).toBe(expected);
	});

	it("uses custom sessionsBase when provided", () => {
		const customBase = makeTemp();
		const expected = join(customBase, "custom-session.jsonl");
		writeFileSync(expected, "line");
		const result = resolveSessionPath("custom-session", customBase);
		expect(result).toBe(expected);
	});

	it("handles directories with other files by ignoring non-matching files", () => {
		const base = makeTemp();
		writeFileSync(join(base, "unrelated.txt"), "data");
		writeFileSync(join(base, "other-session.jsonl"), "data");
		const expected = join(base, "target.jsonl");
		writeFileSync(expected, "data");
		const result = resolveSessionPath("target", base);
		expect(result).toBe(expected);
	});

	it("handles empty directories", () => {
		const base = makeTemp();
		const sub = join(base, "empty-sub");
		mkdirSync(sub);
		const result = resolveSessionPath("any-id", base);
		expect(result).toBeNull();
	});

	it("returns first match when multiple matching files exist (depth-first)", () => {
		const base = makeTemp();
		// Create two subdirectories, each containing a matching file.
		// The function scans entries in readdirSync order; whichever directory
		// is listed first will produce the first match.
		const subA = join(base, "aaa");
		mkdirSync(subA);
		writeFileSync(join(subA, "dup.jsonl"), "from-aaa");
		const subB = join(base, "bbb");
		mkdirSync(subB);
		writeFileSync(join(subB, "dup.jsonl"), "from-bbb");
		const result = resolveSessionPath("dup", base);
		// Either match is valid; what matters is that it returns one of them
		expect(result).toBeOneOf([join(subA, "dup.jsonl"), join(subB, "dup.jsonl")]);
	});
});

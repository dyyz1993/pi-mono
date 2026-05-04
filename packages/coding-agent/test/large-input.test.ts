import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { DEFAULT_INPUT_MAX_BYTES, handleLargeInput } from "../src/core/large-input.js";

const createdFiles: string[] = [];

function cleanup() {
	for (const f of createdFiles) {
		try {
			unlinkSync(f);
		} catch {}
	}
	createdFiles.length = 0;
}

afterEach(() => cleanup());

function generateLargeText(sizeBytes: number): string {
	return "a".repeat(sizeBytes);
}

function generateMultilineText(lines: number): string {
	return Array.from({ length: lines }, (_, i) => `Line ${i + 1}: some content here`).join("\n");
}

describe("handleLargeInput", () => {
	test("passes through small text unchanged", () => {
		const text = "Hello, this is a normal message";
		const result = handleLargeInput(text);

		expect(result.wasLarge).toBe(false);
		expect(result.text).toBe(text);
		expect(result.savedFilePath).toBeUndefined();
	});

	test("passes through text at exactly the threshold", () => {
		const text = generateLargeText(DEFAULT_INPUT_MAX_BYTES);
		const result = handleLargeInput(text);

		expect(result.wasLarge).toBe(false);
		expect(result.text).toBe(text);
		expect(result.savedFilePath).toBeUndefined();
	});

	test("triggers on text exceeding threshold by 1 byte", () => {
		const text = generateLargeText(DEFAULT_INPUT_MAX_BYTES + 1);
		const result = handleLargeInput(text);

		expect(result.wasLarge).toBe(true);
		expect(result.savedFilePath).toBeDefined();
		expect(result.text).not.toBe(text);
		expect(result.text).toContain("too large");
		expect(result.text).toContain("temporary file");

		const filePath = result.savedFilePath!;
		createdFiles.push(filePath);
		expect(existsSync(filePath)).toBe(true);
		expect(readFileSync(filePath, "utf-8")).toBe(text);
	});

	test("saves original text to temp file", () => {
		const text = generateLargeText(DEFAULT_INPUT_MAX_BYTES + 1000);
		const result = handleLargeInput(text);

		expect(result.wasLarge).toBe(true);
		const filePath = result.savedFilePath!;
		createdFiles.push(filePath);

		expect(existsSync(filePath)).toBe(true);
		const saved = readFileSync(filePath, "utf-8");
		expect(saved).toBe(text);
	});

	test("temp file is in system tmpdir with pi-input prefix", () => {
		const text = generateLargeText(DEFAULT_INPUT_MAX_BYTES + 100);
		const result = handleLargeInput(text);

		const filePath = result.savedFilePath!;
		createdFiles.push(filePath);

		expect(filePath).toContain("pi-input-");
		expect(filePath.startsWith(tmpdir())).toBe(true);
	});

	test("replaced text contains file path reference", () => {
		const text = generateLargeText(DEFAULT_INPUT_MAX_BYTES + 100);
		const result = handleLargeInput(text);

		const filePath = result.savedFilePath!;
		createdFiles.push(filePath);

		expect(result.text).toContain(filePath);
		expect(result.text).toContain("Read tool");
		expect(result.text).toContain("Grep");
	});

	test("replaced text contains head and tail preview for multiline content", () => {
		const lines = 200;
		const text = generateMultilineText(lines);
		const largeText = `${text}\n${generateLargeText(DEFAULT_INPUT_MAX_BYTES)}`;
		const result = handleLargeInput(largeText);

		const filePath = result.savedFilePath!;
		createdFiles.push(filePath);

		expect(result.wasLarge).toBe(true);
		expect(result.text).toContain("Line 1:");
		expect(result.text).toContain(`Line ${lines}:`);
		expect(result.text).toContain("lines omitted");
	});

	test("handles empty string", () => {
		const result = handleLargeInput("");

		expect(result.wasLarge).toBe(false);
		expect(result.text).toBe("");
		expect(result.savedFilePath).toBeUndefined();
	});

	test("handles multibyte UTF-8 content", () => {
		const text = "你好世界".repeat(Math.ceil(DEFAULT_INPUT_MAX_BYTES / 12) + 1);
		const result = handleLargeInput(text);

		const filePath = result.savedFilePath!;
		createdFiles.push(filePath);

		expect(result.wasLarge).toBe(true);
		expect(existsSync(filePath)).toBe(true);
		const saved = readFileSync(filePath, "utf-8");
		expect(saved).toBe(text);
	});
});

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyEditWithFallback, type EditOptions } from "../src/core/tools/edit-diff.js";

describe("edit tool new features (TDD)", () => {
	let tempDir: string;
	const tempDirs: string[] = [];

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "pi-edit-test-"));
		tempDirs.push(tempDir);
	});

	afterEach(async () => {
		await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
	});

	describe("1. replaceAll feature", () => {
		it("should replace all occurrences when replaceAll is true", async () => {
			const filePath = join(tempDir, "test.js");
			await writeFile(
				filePath,
				`const a = "hello";
const b = "hello";
const c = "hello";`,
			);

			const options: EditOptions = {
				filePath,
				oldText: `"hello"`,
				newText: `"world"`,
				replaceAll: true,
			};
			const result = await applyEditWithFallback(options);

			expect(result.success).toBe(true);
			expect(result.count).toBe(3);

			const content = await readFile(filePath, "utf8");
			expect(content).toBe(`const a = "world";
const b = "world";
const c = "world";`);
		});

		it("should replace only first occurrence when replaceAll is false", async () => {
			const filePath = join(tempDir, "test.js");
			await writeFile(
				filePath,
				`const a = "hello";
const b = "hello";
const c = "hello";`,
			);

			const options: EditOptions = {
				filePath,
				oldText: `"hello"`,
				newText: `"world"`,
				replaceAll: false,
			};
			const result = await applyEditWithFallback(options);

			expect(result.success).toBe(true);
			expect(result.count).toBe(1);

			const content = await readFile(filePath, "utf8");
			expect(content).toBe(`const a = "world";
const b = "hello";
const c = "hello";`);
		});

		it("should fail when oldText not found", async () => {
			const filePath = join(tempDir, "test.js");
			await writeFile(filePath, `const a = "hello";`);

			const options: EditOptions = {
				filePath,
				oldText: `"notexist"`,
				newText: `"world"`,
				replaceAll: true,
			};
			const result = await applyEditWithFallback(options);

			expect(result.success).toBe(false);
			expect(result.error).toContain("not found");
		});
	});

	describe("2. smart deletion feature", () => {
		it("should clean up empty lines after deletion", async () => {
			const filePath = join(tempDir, "test.js");
			await writeFile(
				filePath,
				`function foo() {
  const a = 1;
  const b = 2;
  const c = 3;
  return a + b + c;
}`,
			);

			const options: EditOptions = {
				filePath,
				oldText: `  const b = 2;\n`,
				newText: ``,
			};
			const result = await applyEditWithFallback(options);

			expect(result.success).toBe(true);

			const content = await readFile(filePath, "utf8");
			// 应该清理多余的空行
			expect(content).toBe(`function foo() {
  const a = 1;
  const c = 3;
  return a + b + c;
}`);
		});

		it("should not merge non-empty lines", async () => {
			const filePath = join(tempDir, "test.js");
			await writeFile(
				filePath,
				`const a = 1;
const b = 2;
const c = 3;`,
			);

			const options: EditOptions = {
				filePath,
				oldText: `const b = 2;\n`,
				newText: ``,
			};
			const result = await applyEditWithFallback(options);

			expect(result.success).toBe(true);

			const content = await readFile(filePath, "utf8");
			expect(content).toBe(`const a = 1;
const c = 3;`);
		});
	});

	describe("3. multi-line replacement", () => {
		it("should handle multi-line oldText", async () => {
			const filePath = join(tempDir, "test.js");
			await writeFile(
				filePath,
				`function foo() {
  const a = 1;
  const b = 2;
  return a + b;
}`,
			);

			const options: EditOptions = {
				filePath,
				oldText: `  const a = 1;
  const b = 2;`,
				newText: `  const x = 10;
  const y = 20;`,
			};
			const result = await applyEditWithFallback(options);

			expect(result.success).toBe(true);

			const content = await readFile(filePath, "utf8");
			expect(content).toBe(`function foo() {
  const x = 10;
  const y = 20;
  return a + b;
}`);
		});
	});
});

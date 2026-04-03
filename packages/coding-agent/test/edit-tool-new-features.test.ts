import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyEditWithFallback, type EditOptions, findMatch } from "../src/core/tools/edit-diff.js";

describe("edit tool new features (TDD)", () => {
	let tempDir: string;
	const tempDirs: string[] = [];

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "pi-edit-test-"));
		tempDirs.push(tempDir);
	});

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
	});

	describe("1. replaceAll feature", () => {
		it("should replace all occurrences when replaceAll is true", async () => {
			const filePath = join(tempDir, "test.txt");
			await writeFile(filePath, "old value\nsome text\nold value\nmore text\nold value", "utf8");

			const options: EditOptions = {
				filePath,
				oldText: "old value",
				newText: "new value",
				replaceAll: true,
			};

			const result = await applyEditWithFallback(options);
			expect(result.success).toBe(true);
			expect(result.count).toBe(3);

			const content = await readFile(filePath, "utf8");
			expect(content).toBe("new value\nsome text\nnew value\nmore text\nnew value");
		});

		it("should replace only first occurrence when replaceAll is false (default)", async () => {
			const filePath = join(tempDir, "test.txt");
			await writeFile(filePath, "old value\nsome text\nold value", "utf8");

			const options: EditOptions = {
				filePath,
				oldText: "old value",
				newText: "new value",
				replaceAll: false,
			};

			const result = await applyEditWithFallback(options);
			expect(result.success).toBe(true);
			expect(result.count).toBe(1);

			const content = await readFile(filePath, "utf8");
			expect(content).toBe("new value\nsome text\nold value");
		});

		it("should replace all with fuzzy matching + replaceAll", async () => {
			const filePath = join(tempDir, "test.txt");
			await writeFile(filePath, 'let x = "hello";\nlet y = "hello";', "utf8");

			const options: EditOptions = {
				filePath,
				oldText: 'let x = "hello"', // 原文可能有不同的引号
				newText: 'let x = "world"',
				replaceAll: true,
				enableFuzzyMatch: true,
			};

			const result = await applyEditWithFallback(options);
			expect(result.success).toBe(true);
			expect(result.count).toBe(2);

			const content = await readFile(filePath, "utf8");
			expect(content).toBe('let x = "world";\nlet y = "world";');
		});

		it("should report error when oldText not found with replaceAll", async () => {
			const filePath = join(tempDir, "test.txt");
			await writeFile(filePath, "some content", "utf8");

			const options: EditOptions = {
				filePath,
				oldText: "not exist",
				newText: "new value",
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
				`function test() {
  const x = 1;
  
  // delete this
  const y = 2;
  
  const z = 3;
}`,
				"utf8",
			);

			const options: EditOptions = {
				filePath,
				oldText: "  // delete this\n  const y = 2;\n",
				newText: "",
				smartDeletion: true,
			};

			const result = await applyEditWithFallback(options);
			expect(result.success).toBe(true);

			const content = await readFile(filePath, "utf8");
			// 应该清理掉多余的空行
			expect(content).toBe(`function test() {
  const x = 1;
  const z = 3;
}`);
		});

		it("should preserve necessary spacing", async () => {
			const filePath = join(tempDir, "test.js");
			await writeFile(
				filePath,
				`function test() {
  const x = 1;

  const y = 2;
}`,
				"utf8",
			);

			const options: EditOptions = {
				filePath,
				oldText: "  const y = 2;\n",
				newText: "",
				smartDeletion: true,
			};

			const result = await applyEditWithFallback(options);
			expect(result.success).toBe(true);

			const content = await readFile(filePath, "utf8");
			// 应该保留一个空行
			expect(content).toBe(`function test() {
  const x = 1;

}`);
		});

		it("should not apply smart deletion when disabled", async () => {
			const filePath = join(tempDir, "test.js");
			await writeFile(
				filePath,
				`function test() {
  const x = 1;
  
  const y = 2;
}`,
				"utf8",
			);

			const options: EditOptions = {
				filePath,
				oldText: "  const y = 2;\n",
				newText: "",
				smartDeletion: false,
			};

			const result = await applyEditWithFallback(options);
			expect(result.success).toBe(true);

			const content = await readFile(filePath, "utf8");
			// 应该保持原样，不清理空行
			expect(content).toBe(`function test() {
  const x = 1;
  
}`);
		});
	});

	describe("3. quote style preservation feature", () => {
		it("should preserve single quotes when original uses single quotes", async () => {
			const filePath = join(tempDir, "test.js");
			await writeFile(filePath, "const x = 'hello world';", "utf8");

			const options: EditOptions = {
				filePath,
				oldText: "hello world",
				newText: "goodbye",
				preserveQuoteStyle: true,
			};

			const result = await applyEditWithFallback(options);
			expect(result.success).toBe(true);

			const content = await readFile(filePath, "utf8");
			// 应该保留单引号
			expect(content).toBe("const x = 'goodbye';");
		});

		it("should preserve double quotes when original uses double quotes", async () => {
			const filePath = join(tempDir, "test.js");
			await writeFile(filePath, 'const x = "hello world";', "utf8");

			const options: EditOptions = {
				filePath,
				oldText: "hello world",
				newText: "goodbye",
				preserveQuoteStyle: true,
			};

			const result = await applyEditWithFallback(options);
			expect(result.success).toBe(true);

			const content = await readFile(filePath, "utf8");
			// 应该保留双引号
			expect(content).toBe('const x = "goodbye";');
		});

		it("should handle curly quotes in oldText with preserveQuoteStyle", async () => {
			const filePath = join(tempDir, "test.js");
			await writeFile(filePath, "const x = 'hello world';", "utf8");

			const options: EditOptions = {
				filePath,
				oldText: "const x = 'hello world'", // 弯引号
				newText: "const x = 'goodbye'",
				preserveQuoteStyle: true,
				enableFuzzyMatch: true,
			};

			const result = await applyEditWithFallback(options);
			expect(result.success).toBe(true);

			const content = await readFile(filePath, "utf8");
			// 应该使用文件中的直引号
			expect(content).toBe("const x = 'goodbye';");
		});

		it("should not change quote style when preserveQuoteStyle is false", async () => {
			const filePath = join(tempDir, "test.js");
			await writeFile(filePath, "const x = 'hello world';", "utf8");

			const options: EditOptions = {
				filePath,
				oldText: "'hello world'",
				newText: '"goodbye"',
				preserveQuoteStyle: false,
			};

			const result = await applyEditWithFallback(options);
			expect(result.success).toBe(true);

			const content = await readFile(filePath, "utf8");
			// 应该使用 newText 中的引号
			expect(content).toBe('const x = "goodbye";');
		});

		it("should handle template literals", async () => {
			const filePath = join(tempDir, "test.js");
			await writeFile(filePath, "const x = `hello ${name}`;", "utf8");

			const options: EditOptions = {
				filePath,
				oldText: "hello ${name}",
				newText: "goodbye ${name}",
				preserveQuoteStyle: true,
			};

			const result = await applyEditWithFallback(options);
			expect(result.success).toBe(true);

			const content = await readFile(filePath, "utf8");
			// 应该保留模板字符串
			expect(content).toBe("const x = `goodbye ${name}`;");
		});
	});

	describe("4. sanitize feature", () => {
		it("should sanitize control characters in oldText", async () => {
			const filePath = join(tempDir, "test.txt");
			await writeFile(filePath, "hello\x00world", "utf8");

			const options: EditOptions = {
				filePath,
				oldText: "hello\x00world",
				newText: "goodbye",
				sanitize: true,
			};

			const result = await applyEditWithFallback(options);
			expect(result.success).toBe(true);

			const content = await readFile(filePath, "utf8");
			expect(content).toBe("goodbye");
		});

		it("should not sanitize when sanitize is false", async () => {
			const filePath = join(tempDir, "test.txt");
			await writeFile(filePath, "hello\x00world", "utf8");

			const options: EditOptions = {
				filePath,
				oldText: "hello\x00world",
				newText: "goodbye",
				sanitize: false,
			};

			const result = await applyEditWithFallback(options);
			expect(result.success).toBe(true);

			const content = await readFile(filePath, "utf8");
			expect(content).toBe("goodbye");
		});
	});

	describe("5. combination scenarios", () => {
		it("should combine replaceAll + smartDeletion", async () => {
			const filePath = join(tempDir, "test.js");
			await writeFile(
				filePath,
				`const x = 1;
  
const temp = 'a';
  
const y = 2;
  
const temp = 'b';
  
const z = 3;`,
				"utf8",
			);

			const options: EditOptions = {
				filePath,
				oldText: "const temp = 'a';\n",
				newText: "",
				replaceAll: true,
				smartDeletion: true,
			};

			const result = await applyEditWithFallback(options);
			expect(result.success).toBe(true);
			expect(result.count).toBe(1); // 只匹配一个（内容不同）

			const content = await readFile(filePath, "utf8");
			// 应该清理空行
			expect(content).toContain("const x = 1;");
			expect(content).toContain("const y = 2;");
			expect(content).toContain("const z = 3;");
		});

		it("should combine replaceAll + fuzzyMatch + preserveQuoteStyle", async () => {
			const filePath = join(tempDir, "test.js");
			await writeFile(
				filePath,
				`const a = "hello";
const b = "hello";
const c = "hello";`,
				"utf8",
			);

			const options: EditOptions = {
				filePath,
				oldText: 'const a = "hello"', // 直引号
				newText: 'const a = "world"',
				replaceAll: true,
				enableFuzzyMatch: true,
				preserveQuoteStyle: true,
			};

			const result = await applyEditWithFallback(options);
			expect(result.success).toBe(true);
			expect(result.count).toBe(3);

			const content = await readFile(filePath, "utf8");
			expect(content).toBe(`const a = "world";
const b = "world";
const c = "world";`);
		});
	});
});

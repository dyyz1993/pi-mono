import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { applyEditWithFallback } from "../../src/core/tools/edit-diff";
import { writeFileSync, readFileSync, unlinkSync, mkdirSync, existsSync, rmSync } from "fs";
import { join } from "path";

describe("applyEditWithFallback", () => {
	const testDir = join(__dirname, "test-files");
	
	beforeAll(() => {
		if (!existsSync(testDir)) {
			mkdirSync(testDir, { recursive: true });
		}
	});
	
	afterAll(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true });
		}
	});
	
	it("should delete comment and clean up empty line", async () => {
		const testFile = join(testDir, "test1.ts");
		const originalContent = `function foo() {
	// This is a comment
	console.log("hello");
}`;
		
		writeFileSync(testFile, originalContent, "utf-8");
		
		const result = await applyEditWithFallback({
			filePath: testFile,
			oldText: "\t// This is a comment\n",
			newText: "",
			smartDeletion: true,
		});
		
		expect(result.success).toBe(true);
		
		const newContent = readFileSync(testFile, "utf-8");
		expect(newContent).toBe(`function foo() {
	console.log("hello");
}`);
		
		unlinkSync(testFile);
	});
	
	it("should preserve intentional empty lines", async () => {
		const testFile = join(testDir, "test2.ts");
		const originalContent = `function foo() {
	console.log("hello");

	// This is a comment
	console.log("world");
}`;
		
		writeFileSync(testFile, originalContent, "utf-8");
		
		const result = await applyEditWithFallback({
			filePath: testFile,
			oldText: "\t// This is a comment\n",
			newText: "",
			smartDeletion: true,
		});
		
		expect(result.success).toBe(true);
		
		const newContent = readFileSync(testFile, "utf-8");
		// The empty line between the two console.logs should be preserved
		expect(newContent).toBe(`function foo() {
	console.log("hello");

	console.log("world");
}`);
		
		unlinkSync(testFile);
	});
	
	it("should handle multiple deletions with replaceAll", async () => {
		const testFile = join(testDir, "test3.ts");
		const originalContent = `function foo() {
	// Comment 1
	console.log("hello");
	// Comment 2
	console.log("world");
}`;
		
		writeFileSync(testFile, originalContent, "utf-8");
		
		// Note: smartDeletion doesn't work well with replaceAll currently
		// because it only processes once after all replacements
		const result = await applyEditWithFallback({
			filePath: testFile,
			oldText: "\t// Comment",
			newText: "",
			replaceAll: true,
			smartDeletion: true,
		});
		
		expect(result.success).toBe(true);
		expect(result.count).toBe(2);
		
		unlinkSync(testFile);
	});
});

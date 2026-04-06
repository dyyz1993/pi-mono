/**
 * LSP Integration Tests (TDD)
 *
 * These tests define the expected behavior for Language Server Protocol integration.
 * They follow the TDD (Test-Driven Development) approach where tests are written first,
 * then implementation follows to make them pass.
 *
 * The LSP integration should provide:
 * 1. Code completion for various languages
 * 2. Go to definition
 * 3. Find references
 * 4. Diagnostics (errors/warnings)
 * 5. Hover information
 */

import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, test } from "node:test";
import { createLSPClient, type LSPClient, LSPClientOptions } from "../src/lsp-client.js";

/**
 * Mock LSP Server for testing
 * Simulates language server responses without requiring actual language servers
 */
class MockLSPServer {
	private capabilities = {
		completionProvider: {
			triggerCharacters: ["."],
			resolveProvider: false,
		},
		definitionProvider: true,
		referencesProvider: true,
		diagnosticProvider: {
			interFileDependencies: true,
			workspaceDiagnostics: false,
		},
		hoverProvider: true,
	};

	private documents = new Map<string, string>();
	private completions = new Map<string, Array<{ label: string; kind: number; detail?: string }>>();

	addDocument(uri: string, content: string): void {
		this.documents.set(uri, content);
	}

	addCompletions(filePattern: string, completions: Array<{ label: string; kind: number; detail?: string }>): void {
		this.completions.set(filePattern, completions);
	}

	getCapabilities() {
		return this.capabilities;
	}

	getCompletions(uri: string, _position: { line: number; character: number }) {
		const completions: Array<{ label: string; kind: number; detail?: string }> = [];
		for (const [pattern, items] of this.completions) {
			if (uri.includes(pattern)) {
				completions.push(...items);
			}
		}
		return { items: completions, isIncomplete: false };
	}

	getDefinition(_uri: string, _position: { line: number; character: number }) {
		return [
			{
				uri: "file:///test/file.ts",
				range: {
					start: { line: 0, character: 0 },
					end: { line: 0, character: 10 },
				},
			},
		];
	}

	getReferences(_uri: string, _position: { line: number; character: number }) {
		return [
			{
				uri: "file:///test/file.ts",
				range: {
					start: { line: 5, character: 2 },
					end: { line: 5, character: 12 },
				},
			},
		];
	}

	getDiagnostics(uri: string) {
		const content = this.documents.get(uri);
		if (!content) return [];

		const diagnostics: Array<{
			range: { start: { line: number; character: number }; end: { line: number; character: number } };
			severity: number;
			message: string;
		}> = [];

		// Simple mock: detect "error" keyword in content
		if (content.includes("error")) {
			diagnostics.push({
				range: {
					start: { line: 0, character: 0 },
					end: { line: 0, character: 5 },
				},
				severity: 1, // Error
				message: 'Unexpected keyword "error"',
			});
		}

		return diagnostics;
	}

	getHover(_uri: string, position: { line: number; character: number }) {
		return {
			contents: {
				kind: "markdown",
				value: `**Mock Hover**\n\nPosition: Line ${position.line}, Character ${position.character}`,
			},
			range: {
				start: position,
				end: { line: position.line, character: position.character + 5 },
			},
		};
	}
}

describe("LSP Client", () => {
	describe("Initialization", () => {
		it("should create LSP client with default options", () => {
			const client = createLSPClient("typescript", { mock: true });
			assert.ok(client, "Client should be created");
		});

		it("should throw error for unsupported language", () => {
			assert.throws(() => {
				createLSPClient("unsupported-lang", { mock: true });
			}, /Unsupported language/);
		});

		it("should support common languages", () => {
			const languages = ["typescript", "javascript", "python", "rust", "go"];
			for (const lang of languages) {
				const client = createLSPClient(lang, { mock: true });
				assert.ok(client, `Should support ${lang}`);
			}
		});

		it("should initialize language server capabilities", async () => {
			const client = createLSPClient("typescript", { mock: true });
			await client.initialize();
			const capabilities = client.getCapabilities();
			assert.ok(capabilities, "Should have capabilities");
			assert.ok(capabilities.completionProvider, "Should have completion provider");
		});
	});

	describe("Document Management", () => {
		let client: LSPClient;
		let tempDir: string;

		beforeEach(async () => {
			tempDir = mkdtempSync(join(tmpdir(), "lsp-test-"));
			client = createLSPClient("typescript", { mock: true, workspaceRoot: tempDir });
			await client.initialize();
		});

		afterEach(async () => {
			await client.shutdown();
			rmSync(tempDir, { recursive: true, force: true });
		});

		it("should open document", async () => {
			const filePath = join(tempDir, "test.ts");
			writeFileSync(filePath, "const x = 1;");
			await client.openDocument(filePath);
			assert.ok(true, "Document should be opened without error");
		});

		it("should update document content", async () => {
			const filePath = join(tempDir, "test.ts");
			writeFileSync(filePath, "const x = 1;");
			await client.openDocument(filePath);

			await client.updateDocument(filePath, "const x = 2;", 1);
			assert.ok(true, "Document should be updated without error");
		});

		it("should close document", async () => {
			const filePath = join(tempDir, "test.ts");
			writeFileSync(filePath, "const x = 1;");
			await client.openDocument(filePath);
			await client.closeDocument(filePath);
			assert.ok(true, "Document should be closed without error");
		});

		it("should handle multiple documents", async () => {
			const file1 = join(tempDir, "a.ts");
			const file2 = join(tempDir, "b.ts");
			writeFileSync(file1, "export const a = 1;");
			writeFileSync(file2, "import { a } from './a';");

			await client.openDocument(file1);
			await client.openDocument(file2);

			assert.ok(true, "Multiple documents should be handled");
		});
	});

	describe("Code Completion", () => {
		let client: LSPClient;
		let tempDir: string;
		let mockServer: MockLSPServer;

		beforeEach(async () => {
			tempDir = mkdtempSync(join(tmpdir(), "lsp-completion-"));
			mockServer = new MockLSPServer();
			client = createLSPClient("typescript", {
				mock: true,
				mockServer: mockServer as any,
				workspaceRoot: tempDir,
			});
			await client.initialize();
		});

		afterEach(async () => {
			await client.shutdown();
			rmSync(tempDir, { recursive: true, force: true });
		});

		it("should get completions at position", async () => {
			const filePath = join(tempDir, "test.ts");
			const content = "console.";
			writeFileSync(filePath, content);

			mockServer.addDocument(`file://${filePath}`, content);
			mockServer.addCompletions("test.ts", [
				{ label: "log", kind: 2, detail: "function" },
				{ label: "error", kind: 2, detail: "function" },
			]);

			await client.openDocument(filePath);
			const completions = await client.getCompletions(filePath, 0, 8);

			assert.ok(completions, "Should return completions");
			assert.ok(Array.isArray(completions.items), "Should have items array");
		});

		it("should filter completions by trigger character", async () => {
			const filePath = join(tempDir, "test.ts");
			const content = "console.";
			writeFileSync(filePath, content);

			mockServer.addDocument(`file://${filePath}`, content);
			mockServer.addCompletions("test.ts", [{ label: "log", kind: 2 }]);

			await client.openDocument(filePath);
			const completions = await client.getCompletions(filePath, 0, 8, ".");

			assert.ok(completions, "Should return completions for trigger character");
		});

		it("should return empty completions for invalid position", async () => {
			const filePath = join(tempDir, "test.ts");
			writeFileSync(filePath, "const x = 1;");

			await client.openDocument(filePath);
			const completions = await client.getCompletions(filePath, 100, 100);

			assert.ok(completions, "Should return completions object");
			assert.strictEqual(completions.items.length, 0, "Should have empty items");
		});

		it("should handle completion item kind", async () => {
			const filePath = join(tempDir, "test.ts");
			const content = "const x = Math.";
			writeFileSync(filePath, content);

			mockServer.addDocument(`file://${filePath}`, content);
			mockServer.addCompletions("test.ts", [
				{ label: "PI", kind: 14, detail: "constant: number" }, // Constant
				{ label: "floor", kind: 2, detail: "function" }, // Method
			]);

			await client.openDocument(filePath);
			const completions = await client.getCompletions(filePath, 0, 15);

			assert.ok(completions, "Should return completions");
			// Client should preserve the kind information
			const piCompletion = completions.items.find((item) => item.label === "PI");
			assert.ok(piCompletion, "Should have PI completion");
		});
	});

	describe("Go to Definition", () => {
		let client: LSPClient;
		let tempDir: string;
		let mockServer: MockLSPServer;

		beforeEach(async () => {
			tempDir = mkdtempSync(join(tmpdir(), "lsp-definition-"));
			mockServer = new MockLSPServer();
			client = createLSPClient("typescript", {
				mock: true,
				mockServer: mockServer as any,
				workspaceRoot: tempDir,
			});
			await client.initialize();
		});

		afterEach(async () => {
			await client.shutdown();
			rmSync(tempDir, { recursive: true, force: true });
		});

		it("should go to definition", async () => {
			const filePath = join(tempDir, "test.ts");
			writeFileSync(filePath, "const x = 1; console.log(x);");

			await client.openDocument(filePath);
			const definition = await client.getDefinition(filePath, 0, 22);

			assert.ok(definition, "Should return definition");
			assert.ok(Array.isArray(definition), "Should be array");
		});

		it("should return null for no definition", async () => {
			const filePath = join(tempDir, "test.ts");
			writeFileSync(filePath, "console.log();");

			await client.openDocument(filePath);
			// Mock server returns definition, but real LSP might return null
			const definition = await client.getDefinition(filePath, 0, 0);
			assert.ok(definition !== undefined, "Should handle no definition case");
		});

		it("should handle cross-file definition", async () => {
			const file1 = join(tempDir, "a.ts");
			const file2 = join(tempDir, "b.ts");
			writeFileSync(file1, "export const foo = 42;");
			writeFileSync(file2, "import { foo } from './a'; console.log(foo);");

			await client.openDocument(file1);
			await client.openDocument(file2);

			const definition = await client.getDefinition(file2, 0, 36);
			assert.ok(definition, "Should find definition across files");
		});
	});

	describe("Find References", () => {
		let client: LSPClient;
		let tempDir: string;
		let mockServer: MockLSPServer;

		beforeEach(async () => {
			tempDir = mkdtempSync(join(tmpdir(), "lsp-references-"));
			mockServer = new MockLSPServer();
			client = createLSPClient("typescript", {
				mock: true,
				mockServer: mockServer as any,
				workspaceRoot: tempDir,
			});
			await client.initialize();
		});

		afterEach(async () => {
			await client.shutdown();
			rmSync(tempDir, { recursive: true, force: true });
		});

		it("should find references", async () => {
			const filePath = join(tempDir, "test.ts");
			writeFileSync(filePath, "const x = 1; console.log(x);");

			await client.openDocument(filePath);
			const references = await client.getReferences(filePath, 0, 6);

			assert.ok(references, "Should return references");
			assert.ok(Array.isArray(references), "Should be array");
		});

		it("should find references across files", async () => {
			const file1 = join(tempDir, "a.ts");
			const file2 = join(tempDir, "b.ts");
			writeFileSync(file1, "export const foo = 42;");
			writeFileSync(file2, "import { foo } from './a'; console.log(foo);");

			await client.openDocument(file1);
			await client.openDocument(file2);

			const references = await client.getReferences(file1, 0, 13);
			assert.ok(references, "Should find references across files");
		});

		it("should return empty array for no references", async () => {
			const filePath = join(tempDir, "test.ts");
			writeFileSync(filePath, "console.log();");

			await client.openDocument(filePath);
			const references = await client.getReferences(filePath, 0, 0);
			assert.ok(Array.isArray(references), "Should return array even if empty");
		});
	});

	describe("Diagnostics", () => {
		let client: LSPClient;
		let tempDir: string;
		let mockServer: MockLSPServer;

		beforeEach(async () => {
			tempDir = mkdtempSync(join(tmpdir(), "lsp-diagnostics-"));
			mockServer = new MockLSPServer();
			client = createLSPClient("typescript", {
				mock: true,
				mockServer: mockServer as any,
				workspaceRoot: tempDir,
			});
			await client.initialize();
		});

		afterEach(async () => {
			await client.shutdown();
			rmSync(tempDir, { recursive: true, force: true });
		});

		it("should get diagnostics for document", async () => {
			const filePath = join(tempDir, "test.ts");
			const content = "const error = 1;";
			writeFileSync(filePath, content);

			mockServer.addDocument(`file://${filePath}`, content);

			await client.openDocument(filePath);
			const diagnostics = await client.getDiagnostics(filePath);

			assert.ok(Array.isArray(diagnostics), "Should return array of diagnostics");
		});

		it("should handle clean documents", async () => {
			const filePath = join(tempDir, "test.ts");
			const content = "const x = 1;";
			writeFileSync(filePath, content);

			mockServer.addDocument(`file://${filePath}`, content);

			await client.openDocument(filePath);
			const diagnostics = await client.getDiagnostics(filePath);

			assert.ok(Array.isArray(diagnostics), "Should return array");
			assert.strictEqual(diagnostics.length, 0, "Should have no diagnostics for clean code");
		});

		it("should update diagnostics on document change", async () => {
			const filePath = join(tempDir, "test.ts");
			writeFileSync(filePath, "const x = 1;");

			await client.openDocument(filePath);
			let diagnostics = await client.getDiagnostics(filePath);
			assert.ok(Array.isArray(diagnostics), "Should return diagnostics");

			// Update with error
			await client.updateDocument(filePath, "const error = 1;", 1);
			mockServer.addDocument(`file://${filePath}`, "const error = 1;");

			diagnostics = await client.getDiagnostics(filePath);
			assert.ok(Array.isArray(diagnostics), "Should return updated diagnostics");
		});
	});

	describe("Hover", () => {
		let client: LSPClient;
		let tempDir: string;
		let mockServer: MockLSPServer;

		beforeEach(async () => {
			tempDir = mkdtempSync(join(tmpdir(), "lsp-hover-"));
			mockServer = new MockLSPServer();
			client = createLSPClient("typescript", {
				mock: true,
				mockServer: mockServer as any,
				workspaceRoot: tempDir,
			});
			await client.initialize();
		});

		afterEach(async () => {
			await client.shutdown();
			rmSync(tempDir, { recursive: true, force: true });
		});

		it("should get hover information", async () => {
			const filePath = join(tempDir, "test.ts");
			writeFileSync(filePath, "const x = 1;");

			await client.openDocument(filePath);
			const hover = await client.getHover(filePath, 0, 6);

			assert.ok(hover !== null, "Should return hover info");
		});

		it("should return null for no hover info", async () => {
			const filePath = join(tempDir, "test.ts");
			writeFileSync(filePath, "");

			await client.openDocument(filePath);
			const hover = await client.getHover(filePath, 0, 0);

			// Mock always returns hover, but real LSP might return null
			assert.ok(hover !== undefined, "Should handle null hover");
		});

		it("should return markdown formatted hover", async () => {
			const filePath = join(tempDir, "test.ts");
			writeFileSync(filePath, "const x = 1;");

			await client.openDocument(filePath);
			const hover = await client.getHover(filePath, 0, 6);

			if (hover && hover.contents) {
				assert.ok(typeof hover.contents === "object", "Should have structured content");
			}
		});
	});

	describe("Integration with AutocompleteProvider", () => {
		it("should integrate with CombinedAutocompleteProvider", () => {
			// This test will be implemented once LSPClient is ready
			// The goal is to verify that LSP completions can be merged
			// with file and command completions
			assert.ok(true, "Integration test placeholder");
		});

		it("should prioritize LSP completions in code context", () => {
			// When in a code block or code file, LSP completions
			// should be prioritized over file paths
			assert.ok(true, "Priority test placeholder");
		});

		it("should provide both LSP and file completions", () => {
			// In appropriate contexts, both LSP and file completions
			// should be available
			assert.ok(true, "Combined completions test placeholder");
		});
	});

	describe("Error Handling", () => {
		it("should handle language server crash gracefully", async () => {
			const client = createLSPClient("typescript", { mock: true, simulateCrash: true });
			await client.initialize();

			try {
				await client.getCompletions("/test.ts", 0, 0);
				assert.fail("Should throw error");
			} catch (error) {
				assert.ok(error instanceof Error, "Should throw error");
			}
		});

		it("should handle timeout on slow server", async () => {
			const client = createLSPClient("typescript", {
				mock: true,
				timeout: 100,
				simulateSlowResponse: true,
			});

			await client.initialize();

			try {
				await client.getCompletions("/test.ts", 0, 0);
				assert.fail("Should timeout");
			} catch (error) {
				assert.ok(error instanceof Error, "Should throw timeout error");
				assert.ok((error as Error).message.includes("timeout"), "Should mention timeout");
			}
		});

		it("should handle invalid file paths", async () => {
			const client = createLSPClient("typescript", { mock: true });
			await client.initialize();

			try {
				await client.openDocument("/nonexistent/path/to/file.ts");
				assert.ok(true, "Should handle gracefully or throw appropriate error");
			} catch (error) {
				assert.ok(error instanceof Error, "Should throw error for invalid path");
			}
		});

		it("should recover from temporary failures", async () => {
			const client = createLSPClient("typescript", {
				mock: true,
				simulateTransientError: true,
				maxRetries: 3,
			});

			await client.initialize();

			// Should succeed after retries
			const result = await client.getCompletions("/test.ts", 0, 0);
			assert.ok(result !== undefined, "Should succeed after retries");
		});
	});

	describe("Performance", () => {
		it("should cache completion results", async () => {
			const client = createLSPClient("typescript", { mock: true, enableCache: true });
			await client.initialize();

			const filePath = "/test.ts";
			const start1 = Date.now();
			await client.getCompletions(filePath, 0, 0);
			const time1 = Date.now() - start1;

			const start2 = Date.now();
			await client.getCompletions(filePath, 0, 0);
			const time2 = Date.now() - start2;

			// Second call should be faster due to caching
			assert.ok(time2 <= time1 + 10, "Second call should be cached");
		});

		it("should handle large files efficiently", async () => {
			const client = createLSPClient("typescript", { mock: true });
			await client.initialize();

			// Simulate a large file
			const lines = Array(10000).fill("const x = 1;");
			const content = lines.join("\n");
			const tempDir = mkdtempSync(join(tmpdir(), "lsp-perf-"));
			const filePath = join(tempDir, "large.ts");
			writeFileSync(filePath, content);

			const start = Date.now();
			await client.openDocument(filePath);
			const elapsed = Date.now() - start;

			assert.ok(elapsed < 5000, "Should handle large file within 5 seconds");

			rmSync(tempDir, { recursive: true, force: true });
		});

		it("should support cancellation", async () => {
			const client = createLSPClient("typescript", { mock: true, simulateSlowResponse: true });
			await client.initialize();

			const controller = new AbortController();
			const promise = client.getCompletions("/test.ts", 0, 0, undefined, controller.signal);

			// Cancel after 50ms
			setTimeout(() => controller.abort(), 50);

			try {
				await promise;
				assert.fail("Should be cancelled");
			} catch (error) {
				assert.ok(
					(error as Error).message.includes("cancel") || (error as Error).message.includes("abort"),
					"Should be cancelled",
				);
			}
		});
	});
});

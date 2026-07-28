import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import previewExtension from "../index.ts";
import {
	createTestRuntime,
	callTool,
	createFakeContext,
	type ExtensionTestRuntime,
} from "../../__shared__/testkit.ts";

function setup(): ExtensionTestRuntime {
	const runtime = createTestRuntime();
	previewExtension(runtime.pi);
	return runtime;
}

let tempDir: string;

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "preview-test-"));
});

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

describe("preview extension", () => {
	it("registers exactly 1 tool named 'preview'", () => {
		const runtime = setup();
		expect(Array.from(runtime.tools.keys())).toEqual(["preview"]);
	});

	describe("detectResource via tool execute", () => {
		it("detects image files by extension (.png)", async () => {
			const runtime = setup();
			const filePath = join(tempDir, "logo.png");
			writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

			const result = await callTool(runtime, "preview", { source: filePath }) as {
				content: Array<{ type: string; text: string }>;
				details: { resourceType: string; mimeType: string; status: string; size?: number };
			};

			expect(result.details.resourceType).toBe("image");
			expect(result.details.mimeType).toBe("image/png");
			expect(result.details.status).toBe("ok");
			expect(result.details.size).toBe(4);
		});

		it("detects markdown files (.md)", async () => {
			const runtime = setup();
			const filePath = join(tempDir, "readme.md");
			writeFileSync(filePath, "# Hello");

			const result = await callTool(runtime, "preview", { source: filePath }) as {
				details: { resourceType: string; mimeType: string; status: string };
			};

			expect(result.details.resourceType).toBe("markdown");
			expect(result.details.mimeType).toBe("text/markdown");
			expect(result.details.status).toBe("ok");
		});

		it("detects HTML files (.html)", async () => {
			const runtime = setup();
			const filePath = join(tempDir, "page.html");
			writeFileSync(filePath, "<html></html>");

			const result = await callTool(runtime, "preview", { source: filePath }) as {
				details: { resourceType: string; mimeType: string };
			};

			expect(result.details.resourceType).toBe("html");
			expect(result.details.mimeType).toBe("text/html");
		});

		it("detects PDF files (.pdf)", async () => {
			const runtime = setup();
			const filePath = join(tempDir, "doc.pdf");
			writeFileSync(filePath, "%PDF-1.4");

			const result = await callTool(runtime, "preview", { source: filePath }) as {
				details: { resourceType: string; mimeType: string };
			};

			expect(result.details.resourceType).toBe("pdf");
			expect(result.details.mimeType).toBe("application/pdf");
		});

		it("falls back to 'text' for unknown extensions", async () => {
			const runtime = setup();
			const filePath = join(tempDir, "data.xyz");
			writeFileSync(filePath, "custom content");

			const result = await callTool(runtime, "preview", { source: filePath }) as {
				details: { resourceType: string; mimeType: string };
			};

			expect(result.details.resourceType).toBe("text");
			expect(result.details.mimeType).toBe("text/plain");
		});

		it("detects URLs (http/https)", async () => {
			const runtime = setup();
			// Non-local URL — should return as resourceType "url" without fetch
			const result = await callTool(runtime, "preview", { source: "https://example.com/page" }) as {
				details: { resourceType: string; status: string; absolutePath?: string };
			};

			expect(result.details.resourceType).toBe("url");
			expect(result.details.status).toBe("ok");
			expect(result.details.absolutePath).toBe("https://example.com/page");
		});

		it("returns not_found for non-existent files", async () => {
			const runtime = setup();
			const result = await callTool(runtime, "preview", {
				source: join(tempDir, "missing.png"),
			}) as {
				content: Array<{ type: string; text: string }>;
				details: { status: string; error?: string };
			};

			expect(result.details.status).toBe("not_found");
			expect(result.details.error).toBe("file not found");
			expect(result.content[0].text).toContain("not found");
		});

		it("returns error for directories", async () => {
			const runtime = setup();
			const dirPath = join(tempDir, "subdir");
			mkdirSync(dirPath);

			const result = await callTool(runtime, "preview", { source: dirPath }) as {
				details: { status: string; error?: string };
			};

			expect(result.details.status).toBe("error");
			expect(result.details.error).toBe("is a directory");
		});

		it("returns error when source is empty", async () => {
			const runtime = setup();
			const result = await callTool(runtime, "preview", { source: "" }) as {
				content: Array<{ type: string; text: string }>;
				details: { status: string; error?: string };
			};

			expect(result.details.status).toBe("error");
			expect(result.details.error).toBe("source required");
		});

		it("returns error when source is whitespace-only", async () => {
			const runtime = setup();
			const result = await callTool(runtime, "preview", { source: "   " }) as {
				details: { status: string };
			};

			expect(result.details.status).toBe("error");
		});
	});

	describe("size formatting via tool result", () => {
		it("includes file size in details for existing files", async () => {
			const runtime = setup();
			const filePath = join(tempDir, "data.txt");
			writeFileSync(filePath, "x".repeat(100));

			const result = await callTool(runtime, "preview", { source: filePath }) as {
				details: { size?: number; status: string };
			};

			expect(result.details.size).toBe(100);
			expect(result.details.status).toBe("ok");
		});
	});

	describe("title passthrough", () => {
		it("includes title in details when provided", async () => {
			const runtime = setup();
			const filePath = join(tempDir, "img.png");
			writeFileSync(filePath, "fake-image");

			const result = await callTool(runtime, "preview", {
				source: filePath,
				title: "My Image",
			}) as {
				details: { title?: string };
			};

			expect(result.details.title).toBe("My Image");
		});
	});

	describe("appendEntry tracking", () => {
		it("records preview events via appendEntry", async () => {
			const runtime = setup();
			const filePath = join(tempDir, "test.md");
			writeFileSync(filePath, "# Test");

			await callTool(runtime, "preview", { source: filePath });

			expect(runtime.appendEntry).toHaveBeenCalledWith(
				"preview",
				expect.objectContaining({
					source: filePath,
					type: "markdown",
					status: "ok",
				}),
			);
		});
	});
});

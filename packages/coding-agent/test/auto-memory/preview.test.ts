import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "../../src/core/extensions/index.js";
import previewExtensionDefault, { type PreviewDetails, type ResourceType } from "./preview.js";

function createMockPi() {
	const registeredTools = new Map<string, any>();

	const pi = {
		on: vi.fn(),
		callLLM: vi.fn(async () => "{}"),
		off: vi.fn(),
		once: vi.fn(),
		emit: vi.fn(),
		setStatus: vi.fn(),
		registerProvider: vi.fn(),
		unregisterProvider: vi.fn(),
		events: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), once: vi.fn() },
		registerChannel: vi.fn(),
		registerTool: vi.fn((tool: any) => {
			registeredTools.set(tool.name, tool);
		}),
		appendEntry: vi.fn(),
		registerCommand: vi.fn(),
	} as unknown as ExtensionAPI;

	return { pi, registeredTools };
}

function getTool(mock: ReturnType<typeof createMockPi>) {
	return mock.registeredTools.get("preview")!;
}

function makeCtx(cwd?: string) {
	return { cwd: cwd ?? tmpdir() };
}

let tempDir: string;

beforeEach(() => {
	tempDir = join(tmpdir(), `pi-preview-test-${Date.now()}`);
	mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
	try {
		const { rmSync } = require("node:fs");
		rmSync(tempDir, { recursive: true, force: true });
	} catch {}
});

describe("preview extension", () => {
	describe("registration", () => {
		it("registers preview tool", () => {
			const mock = createMockPi();
			previewExtensionDefault(mock.pi);
			expect(mock.registeredTools.has("preview")).toBe(true);
		});

		it("tool has correct parameter schema", () => {
			const mock = createMockPi();
			previewExtensionDefault(mock.pi);
			const tool = getTool(mock);
			expect(tool.parameters.properties.source).toBeDefined();
			expect(tool.parameters.properties.title).toBeDefined();
			expect(tool.parameters.required).toContain("source");
		});

		it("tool has renderCall and renderResult", () => {
			const mock = createMockPi();
			previewExtensionDefault(mock.pi);
			const tool = getTool(mock);
			expect(typeof tool.renderCall).toBe("function");
			expect(typeof tool.renderResult).toBe("function");
		});
	});

	describe("tool execution - URL", () => {
		it("returns url resourceType for http URL", async () => {
			const mock = createMockPi();
			previewExtensionDefault(mock.pi);
			const tool = getTool(mock);

			const result = await tool.execute(
				"tc_1",
				{ source: "http://localhost:3000" },
				undefined,
				undefined,
				makeCtx(),
			);

			expect(result.content[0].text).toContain("url");
			expect(result.details.resourceType).toBe("url");
			expect(result.details.status).toBe("ok");
			expect(result.details.absolutePath).toBe("http://localhost:3000");
		});

		it("returns url resourceType for https URL", async () => {
			const mock = createMockPi();
			previewExtensionDefault(mock.pi);
			const tool = getTool(mock);

			const result = await tool.execute("tc_1", { source: "https://example.com" }, undefined, undefined, makeCtx());

			expect(result.details.resourceType).toBe("url");
			expect(result.details.status).toBe("ok");
		});

		it("preserves title for URL", async () => {
			const mock = createMockPi();
			previewExtensionDefault(mock.pi);
			const tool = getTool(mock);

			const result = await tool.execute(
				"tc_1",
				{ source: "http://localhost:3000", title: "My App" },
				undefined,
				undefined,
				makeCtx(),
			);

			expect(result.details.title).toBe("My App");
		});
	});

	describe("tool execution - local files", () => {
		it("detects image type from extension", async () => {
			const filePath = join(tempDir, "test.png");
			writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

			const mock = createMockPi();
			previewExtensionDefault(mock.pi);
			const tool = getTool(mock);

			const result = await tool.execute("tc_1", { source: filePath }, undefined, undefined, makeCtx(tempDir));

			expect(result.details.resourceType).toBe("image");
			expect(result.details.mimeType).toBe("image/png");
			expect(result.details.status).toBe("ok");
			expect(result.details.size).toBe(4);
			expect(result.details.absolutePath).toBe(filePath);
		});

		it("detects pdf type", async () => {
			const filePath = join(tempDir, "doc.pdf");
			writeFileSync(filePath, "%PDF-1.4");

			const mock = createMockPi();
			previewExtensionDefault(mock.pi);
			const tool = getTool(mock);

			const result = await tool.execute("tc_1", { source: filePath }, undefined, undefined, makeCtx(tempDir));

			expect(result.details.resourceType).toBe("pdf");
			expect(result.details.mimeType).toBe("application/pdf");
		});

		it("detects video type", async () => {
			const filePath = join(tempDir, "clip.mp4");
			writeFileSync(filePath, "fake video");

			const mock = createMockPi();
			previewExtensionDefault(mock.pi);
			const tool = getTool(mock);

			const result = await tool.execute("tc_1", { source: filePath }, undefined, undefined, makeCtx(tempDir));

			expect(result.details.resourceType).toBe("video");
			expect(result.details.mimeType).toBe("video/mp4");
		});

		it("detects audio type", async () => {
			const filePath = join(tempDir, "song.mp3");
			writeFileSync(filePath, "fake audio");

			const mock = createMockPi();
			previewExtensionDefault(mock.pi);
			const tool = getTool(mock);

			const result = await tool.execute("tc_1", { source: filePath }, undefined, undefined, makeCtx(tempDir));

			expect(result.details.resourceType).toBe("audio");
			expect(result.details.mimeType).toBe("audio/mpeg");
		});

		it("detects markdown type", async () => {
			const filePath = join(tempDir, "README.md");
			writeFileSync(filePath, "# Hello");

			const mock = createMockPi();
			previewExtensionDefault(mock.pi);
			const tool = getTool(mock);

			const result = await tool.execute("tc_1", { source: filePath }, undefined, undefined, makeCtx(tempDir));

			expect(result.details.resourceType).toBe("markdown");
		});

		it("detects html type", async () => {
			const filePath = join(tempDir, "index.html");
			writeFileSync(filePath, "<html></html>");

			const mock = createMockPi();
			previewExtensionDefault(mock.pi);
			const tool = getTool(mock);

			const result = await tool.execute("tc_1", { source: filePath }, undefined, undefined, makeCtx(tempDir));

			expect(result.details.resourceType).toBe("html");
			expect(result.details.mimeType).toBe("text/html");
		});

		it("falls back to text for unknown extension", async () => {
			const filePath = join(tempDir, "data.xyz");
			writeFileSync(filePath, "unknown content");

			const mock = createMockPi();
			previewExtensionDefault(mock.pi);
			const tool = getTool(mock);

			const result = await tool.execute("tc_1", { source: filePath }, undefined, undefined, makeCtx(tempDir));

			expect(result.details.resourceType).toBe("text");
			expect(result.details.mimeType).toBe("text/plain");
		});

		it("resolves relative path using cwd", async () => {
			const filePath = join(tempDir, "photo.jpg");
			writeFileSync(filePath, "jpg data");

			const mock = createMockPi();
			previewExtensionDefault(mock.pi);
			const tool = getTool(mock);

			const result = await tool.execute("tc_1", { source: "photo.jpg" }, undefined, undefined, makeCtx(tempDir));

			expect(result.details.resourceType).toBe("image");
			expect(result.details.status).toBe("ok");
			expect(result.details.absolutePath).toBe(filePath);
		});

		it("returns absolutePath as resolved full path", async () => {
			const filePath = join(tempDir, "doc.pdf");
			writeFileSync(filePath, "pdf content");

			const mock = createMockPi();
			previewExtensionDefault(mock.pi);
			const tool = getTool(mock);

			const result = await tool.execute("tc_1", { source: "doc.pdf" }, undefined, undefined, makeCtx(tempDir));

			expect(result.details.absolutePath).toBe(filePath);
		});
	});

	describe("tool execution - errors", () => {
		it("returns error when source is empty", async () => {
			const mock = createMockPi();
			previewExtensionDefault(mock.pi);
			const tool = getTool(mock);

			const result = await tool.execute("tc_1", { source: "" }, undefined, undefined, makeCtx());

			expect(result.content[0].text).toContain("Error");
			expect(result.details.status).toBe("error");
			expect(result.details.error).toBe("source required");
		});

		it("returns not_found for missing file", async () => {
			const mock = createMockPi();
			previewExtensionDefault(mock.pi);
			const tool = getTool(mock);

			const result = await tool.execute(
				"tc_1",
				{ source: "/nonexistent/file.png" },
				undefined,
				undefined,
				makeCtx(),
			);

			expect(result.content[0].text).toContain("not found");
			expect(result.details.status).toBe("not_found");
			expect(result.details.error).toBe("file not found");
		});

		it("returns error for directory path", async () => {
			const mock = createMockPi();
			previewExtensionDefault(mock.pi);
			const tool = getTool(mock);

			const result = await tool.execute("tc_1", { source: tempDir }, undefined, undefined, makeCtx());

			expect(result.content[0].text).toContain("directory");
			expect(result.details.status).toBe("error");
			expect(result.details.error).toBe("is a directory");
		});
	});

	describe("tool execution - content text", () => {
		it("content text includes resourceType", async () => {
			const filePath = join(tempDir, "test.png");
			writeFileSync(filePath, Buffer.alloc(4));

			const mock = createMockPi();
			previewExtensionDefault(mock.pi);
			const tool = getTool(mock);

			const result = await tool.execute("tc_1", { source: filePath }, undefined, undefined, makeCtx(tempDir));

			expect(result.content[0].text).toContain("image");
		});

		it("content text includes size for files", async () => {
			const filePath = join(tempDir, "big.jpg");
			writeFileSync(filePath, Buffer.alloc(2048));

			const mock = createMockPi();
			previewExtensionDefault(mock.pi);
			const tool = getTool(mock);

			const result = await tool.execute("tc_1", { source: filePath }, undefined, undefined, makeCtx(tempDir));

			expect(result.content[0].text).toContain("2.0KB");
		});

		it("content text does not include file content", async () => {
			const filePath = join(tempDir, "data.txt");
			writeFileSync(filePath, "secret content that should not appear");

			const mock = createMockPi();
			previewExtensionDefault(mock.pi);
			const tool = getTool(mock);

			const result = await tool.execute("tc_1", { source: filePath }, undefined, undefined, makeCtx(tempDir));

			expect(result.content[0].text).not.toContain("secret content");
		});
	});

	describe("renderCall", () => {
		it("renders tool call with source", () => {
			const mock = createMockPi();
			previewExtensionDefault(mock.pi);
			const tool = getTool(mock);
			const theme = {
				fg: (_c: string, t: string) => t,
				bold: (t: string) => `*${t}*`,
				dim: (t: string) => t,
				accent: (t: string) => t,
				error: (t: string) => t,
				strikethrough: (t: string) => t,
			};
			const result = tool.renderCall({ source: "./photo.png" }, theme as any);
			expect(result.text).toContain("preview");
			expect(result.text).toContain("./photo.png");
		});

		it("renders tool call with title", () => {
			const mock = createMockPi();
			previewExtensionDefault(mock.pi);
			const tool = getTool(mock);
			const theme = {
				fg: (_c: string, t: string) => t,
				bold: (t: string) => `*${t}*`,
				dim: (t: string) => t,
				accent: (t: string) => t,
				error: (t: string) => t,
				strikethrough: (t: string) => t,
			};
			const result = tool.renderCall({ source: "http://localhost:3000", title: "My App" }, theme as any);
			expect(result.text).toContain("My App");
		});
	});

	describe("renderResult", () => {
		it("renders success result with icon", () => {
			const mock = createMockPi();
			previewExtensionDefault(mock.pi);
			const tool = getTool(mock);
			const theme = {
				fg: (c: string, t: string) => `<${c}>${t}</${c}>`,
				bold: (t: string) => t,
				dim: (t: string) => t,
				accent: (t: string) => t,
				error: (t: string) => t,
				success: (t: string) => t,
				muted: (t: string) => t,
				strikethrough: (t: string) => t,
			};
			const result = tool.renderResult(
				{
					content: [{ type: "text", text: "Preview: test.png (image)" }],
					details: {
						source: "test.png",
						resourceType: "image",
						status: "ok",
						size: 1024,
					} as PreviewDetails,
				},
				{ expanded: false },
				theme as any,
			);
			expect(result.text).toContain("test.png");
			expect(result.text).toContain("1024B");
		});

		it("renders error result", () => {
			const mock = createMockPi();
			previewExtensionDefault(mock.pi);
			const tool = getTool(mock);
			const theme = {
				fg: (c: string, t: string) => `<${c}>${t}</${c}>`,
				bold: (t: string) => t,
				dim: (t: string) => t,
				accent: (t: string) => t,
				error: (t: string) => t,
				success: (t: string) => t,
				muted: (t: string) => t,
				strikethrough: (t: string) => t,
			};
			const result = tool.renderResult(
				{
					content: [{ type: "text", text: "not found" }],
					details: {
						source: "missing.png",
						resourceType: "image",
						status: "not_found",
						error: "file not found",
					} as PreviewDetails,
				},
				{ expanded: false },
				theme as any,
			);
			expect(result.text).toContain("file not found");
		});
	});

	describe("resource type detection", () => {
		const cases: Array<[string, ResourceType]> = [
			["http://example.com", "url"],
			["https://example.com/path", "url"],
			["photo.png", "image"],
			["photo.jpg", "image"],
			["photo.jpeg", "image"],
			["photo.gif", "image"],
			["photo.webp", "image"],
			["icon.svg", "image"],
			["doc.pdf", "pdf"],
			["page.html", "html"],
			["page.htm", "html"],
			["clip.mp4", "video"],
			["clip.webm", "video"],
			["song.mp3", "audio"],
			["song.wav", "audio"],
			["README.md", "markdown"],
			["data.json", "text"],
		];

		for (const [filename, expectedType] of cases) {
			it(`detects ${filename} as ${expectedType}`, async () => {
				const mock = createMockPi();
				previewExtensionDefault(mock.pi);
				const tool = getTool(mock);

				if (expectedType === "url") {
					const result = await tool.execute("tc_1", { source: filename }, undefined, undefined, makeCtx(tempDir));
					expect(result.details.resourceType).toBe(expectedType);
				} else {
					writeFileSync(join(tempDir, filename), "test");
					const result = await tool.execute("tc_1", { source: filename }, undefined, undefined, makeCtx(tempDir));
					expect(result.details.resourceType).toBe(expectedType);
				}
			});
		}
	});
});

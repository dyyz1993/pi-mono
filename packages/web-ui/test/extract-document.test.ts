import { describe, expect, it, vi } from "vitest";

vi.mock("@dyyz1993/pi-agent-core", () => ({}));
vi.mock("lit", () => ({
	html: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));
vi.mock("lit/directives/ref.js", () => ({
	createRef: () => ({}),
	ref: vi.fn(),
}));
vi.mock("lucide", () => ({
	FileText: "FileText",
	ChevronsUpDown: "ChevronsUpDown",
	ChevronUp: "ChevronUp",
	Loader: "Loader",
}));
vi.mock("@mariozechner/mini-lit", () => ({
	icon: vi.fn(() => "icon"),
}));
vi.mock("../src/utils/attachment-utils.js", () => ({
	loadAttachment: vi.fn(),
}));
vi.mock("../src/utils/proxy-utils.js", () => ({
	isCorsError: vi.fn(() => false),
}));
vi.mock("../src/prompts/prompts.js", () => ({
	EXTRACT_DOCUMENT_DESCRIPTION: "Extract text from a document",
}));

import { createExtractDocumentTool } from "../src/tools/extract-document.js";
import { loadAttachment } from "../src/utils/attachment-utils.js";

describe("createExtractDocumentTool", () => {
	it("creates a tool with correct name and label", () => {
		const tool = createExtractDocumentTool();
		expect(tool.name).toBe("extract_document");
		expect(tool.label).toBe("Extract Document");
	});

	it("has corsProxyUrl initially undefined", () => {
		const tool = createExtractDocumentTool();
		expect(tool.corsProxyUrl).toBeUndefined();
	});

	it("allows setting corsProxyUrl", () => {
		const tool = createExtractDocumentTool();
		tool.corsProxyUrl = "https://corsproxy.io/?";
		expect(tool.corsProxyUrl).toBe("https://corsproxy.io/?");
	});

	it("throws on empty URL", async () => {
		const tool = createExtractDocumentTool();
		await expect(tool.execute("id1", { url: "  " })).rejects.toThrow("URL is required");
	});

	it("throws on invalid URL", async () => {
		const tool = createExtractDocumentTool();
		await expect(tool.execute("id1", { url: "not-a-url" })).rejects.toThrow("Invalid URL");
	});
});

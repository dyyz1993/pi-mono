import { describe, expect, it, vi } from "vitest";

vi.mock("@mariozechner/mini-lit", () => ({
	icon: vi.fn(() => "icon-mock"),
}));

vi.mock("lit", () => ({
	html: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values, __litHtml: true }),
}));

vi.mock("lit/directives/ref.js", () => ({
	createRef: vi.fn(() => ({})),
	ref: vi.fn(),
}));

import { getToolRenderer, registerToolRenderer, toolRenderers } from "../src/tools/renderer-registry.js";

describe("renderer-registry", () => {
	afterEach(() => {
		toolRenderers.clear();
	});

	it("registerToolRenderer adds to the map", () => {
		const renderer = { render: vi.fn() };
		registerToolRenderer("test_tool", renderer as any);
		expect(toolRenderers.get("test_tool")).toBe(renderer);
	});

	it("getToolRenderer returns registered renderer", () => {
		const renderer = { render: vi.fn() };
		registerToolRenderer("my_tool", renderer as any);
		expect(getToolRenderer("my_tool")).toBe(renderer);
	});

	it("getToolRenderer returns undefined for unregistered tool", () => {
		expect(getToolRenderer("nonexistent")).toBeUndefined();
	});

	it("overwrites existing renderer on re-registration", () => {
		const renderer1 = { render: vi.fn() };
		const renderer2 = { render: vi.fn() };
		registerToolRenderer("tool_a", renderer1 as any);
		registerToolRenderer("tool_a", renderer2 as any);
		expect(getToolRenderer("tool_a")).toBe(renderer2);
	});

	it("supports multiple renderers", () => {
		const r1 = { render: vi.fn() };
		const r2 = { render: vi.fn() };
		registerToolRenderer("tool_1", r1 as any);
		registerToolRenderer("tool_2", r2 as any);
		expect(getToolRenderer("tool_1")).toBe(r1);
		expect(getToolRenderer("tool_2")).toBe(r2);
		expect(toolRenderers.size).toBe(2);
	});

	it("clear removes all renderers", () => {
		registerToolRenderer("tool_x", { render: vi.fn() } as any);
		toolRenderers.clear();
		expect(toolRenderers.size).toBe(0);
	});
});

import { describe, expect, it, vi } from "vitest";
import { createToolHtmlRenderer, type ToolHtmlRendererDeps } from "../../src/core/export-html/tool-renderer.js";
import type { ToolDefinition, ToolRenderContext } from "../../src/core/extensions/types.js";

function createMockComponent(lines: string[]) {
	return {
		render(_width?: number) {
			return lines;
		},
	};
}

function createMockTheme(): any {
	return {};
}

describe("createToolHtmlRenderer", () => {
	describe("renderCall", () => {
		it("should return undefined when tool has no renderCall", () => {
			const getToolDefinition = vi.fn().mockReturnValue({
				name: "test",
				renderCall: undefined,
			});
			const renderer = createToolHtmlRenderer({
				getToolDefinition,
				theme: createMockTheme(),
				cwd: "/test",
			});

			const result = renderer.renderCall("tc1", "test", { x: 1 });
			expect(result).toBeUndefined();
			expect(getToolDefinition).toHaveBeenCalledWith("test");
		});

		it("should return undefined when tool definition is not found", () => {
			const getToolDefinition = vi.fn().mockReturnValue(undefined);
			const renderer = createToolHtmlRenderer({
				getToolDefinition,
				theme: createMockTheme(),
				cwd: "/test",
			});

			const result = renderer.renderCall("tc1", "unknown", {});
			expect(result).toBeUndefined();
		});

		it("should render tool call as HTML", () => {
			const getToolDefinition = vi.fn().mockReturnValue({
				name: "mytool",
				renderCall: vi.fn().mockReturnValue(createMockComponent(["Running tool..."])),
			});
			const renderer = createToolHtmlRenderer({
				getToolDefinition,
				theme: createMockTheme(),
				cwd: "/test",
			});

			const result = renderer.renderCall("tc1", "mytool", { cmd: "ls" });
			expect(result).toBeDefined();
			expect(result).toContain("Running tool...");
			expect(result).toContain("ansi-line");
		});

		it("should return undefined on renderCall exception", () => {
			const getToolDefinition = vi.fn().mockReturnValue({
				name: "bad",
				renderCall: vi.fn().mockImplementation(() => {
					throw new Error("render failed");
				}),
			});
			const renderer = createToolHtmlRenderer({
				getToolDefinition,
				theme: createMockTheme(),
				cwd: "/test",
			});

			const result = renderer.renderCall("tc1", "bad", {});
			expect(result).toBeUndefined();
		});

		it("should store args for later use by renderResult", () => {
			let capturedArgs: unknown;
			const getToolDefinition = vi.fn().mockImplementation((name: string) => {
				if (name === "mytool") {
					return {
						name: "mytool",
						renderCall: (_args: unknown, _theme: unknown, ctx: ToolRenderContext) => {
							capturedArgs = ctx.args;
							return createMockComponent(["call"]);
						},
					};
				}
				return undefined;
			});
			const renderer = createToolHtmlRenderer({
				getToolDefinition,
				theme: createMockTheme(),
				cwd: "/test",
			});

			renderer.renderCall("tc1", "mytool", { key: "val" });
			expect(capturedArgs).toEqual({ key: "val" });
		});

		it("should use custom width when provided", () => {
			let usedWidth: number | undefined;
			const getToolDefinition = vi.fn().mockReturnValue({
				name: "wtool",
				renderCall: () => ({
					render(w?: number) {
						usedWidth = w;
						return ["line"];
					},
				}),
			});
			const renderer = createToolHtmlRenderer({
				getToolDefinition,
				theme: createMockTheme(),
				cwd: "/test",
				width: 120,
			});

			renderer.renderCall("tc1", "wtool", {});
			expect(usedWidth).toBe(120);
		});

		it("should default width to 100 when not provided", () => {
			let usedWidth: number | undefined;
			const getToolDefinition = vi.fn().mockReturnValue({
				name: "wtool",
				renderCall: () => ({
					render(w?: number) {
						usedWidth = w;
						return ["line"];
					},
				}),
			});
			const renderer = createToolHtmlRenderer({
				getToolDefinition,
				theme: createMockTheme(),
				cwd: "/test",
			});

			renderer.renderCall("tc1", "wtool", {});
			expect(usedWidth).toBe(100);
		});
	});

	describe("renderResult", () => {
		it("should return undefined when tool has no renderResult", () => {
			const getToolDefinition = vi.fn().mockReturnValue({
				name: "test",
				renderResult: undefined,
			});
			const renderer = createToolHtmlRenderer({
				getToolDefinition,
				theme: createMockTheme(),
				cwd: "/test",
			});

			const result = renderer.renderResult("tc1", "test", [{ type: "text", text: "ok" }], {}, false);
			expect(result).toBeUndefined();
		});

		it("should return undefined when tool definition is not found", () => {
			const getToolDefinition = vi.fn().mockReturnValue(undefined);
			const renderer = createToolHtmlRenderer({
				getToolDefinition,
				theme: createMockTheme(),
				cwd: "/test",
			});

			const result = renderer.renderResult("tc1", "missing", [{ type: "text", text: "ok" }], {}, false);
			expect(result).toBeUndefined();
		});

		it("should render collapsed and expanded HTML", () => {
			let callCount = 0;
			const getToolDefinition = vi.fn().mockReturnValue({
				name: "mytool",
				renderResult: () => {
					callCount++;
					return createMockComponent([`Result ${callCount}`]);
				},
			});
			const renderer = createToolHtmlRenderer({
				getToolDefinition,
				theme: createMockTheme(),
				cwd: "/test",
			});

			const result = renderer.renderResult("tc1", "mytool", [{ type: "text", text: "output" }], {}, false);

			expect(result).toBeDefined();
			expect(result!.expanded).toBeDefined();
			expect(result!.expanded).toContain("Result");
		});

		it("should include collapsed when different from expanded", () => {
			const getToolDefinition = vi.fn().mockReturnValue({
				name: "mytool",
				renderResult: (_result: unknown, options: { expanded: boolean }) => {
					if (options.expanded) {
						return createMockComponent(["Expanded content"]);
					}
					return createMockComponent(["Collapsed content"]);
				},
			});
			const renderer = createToolHtmlRenderer({
				getToolDefinition,
				theme: createMockTheme(),
				cwd: "/test",
			});

			const result = renderer.renderResult("tc1", "mytool", [{ type: "text", text: "output" }], {}, false);

			expect(result).toBeDefined();
			expect(result!.collapsed).toContain("Collapsed content");
			expect(result!.expanded).toContain("Expanded content");
		});

		it("should not include collapsed when same as expanded", () => {
			const getToolDefinition = vi.fn().mockReturnValue({
				name: "sametool",
				renderResult: () => createMockComponent(["Same content"]),
			});
			const renderer = createToolHtmlRenderer({
				getToolDefinition,
				theme: createMockTheme(),
				cwd: "/test",
			});

			const result = renderer.renderResult("tc1", "sametool", [{ type: "text", text: "output" }], {}, false);

			expect(result).toBeDefined();
			expect(result!.collapsed).toBeUndefined();
			expect(result!.expanded).toContain("Same content");
		});

		it("should return undefined on renderResult exception", () => {
			const getToolDefinition = vi.fn().mockReturnValue({
				name: "bad",
				renderResult: () => {
					throw new Error("render failed");
				},
			});
			const renderer = createToolHtmlRenderer({
				getToolDefinition,
				theme: createMockTheme(),
				cwd: "/test",
			});

			const result = renderer.renderResult("tc1", "bad", [{ type: "text", text: "ok" }], {}, false);
			expect(result).toBeUndefined();
		});

		it("should pass isError flag to render context", () => {
			let capturedIsError: boolean | undefined;
			const getToolDefinition = vi.fn().mockReturnValue({
				name: "errtool",
				renderResult: (_result: unknown, _options: unknown, _theme: unknown, ctx: ToolRenderContext) => {
					capturedIsError = ctx.isError;
					return createMockComponent(["line"]);
				},
			});
			const renderer = createToolHtmlRenderer({
				getToolDefinition,
				theme: createMockTheme(),
				cwd: "/test",
			});

			renderer.renderResult("tc1", "errtool", [{ type: "text", text: "fail" }], {}, true);
			expect(capturedIsError).toBe(true);
		});

		it("should handle empty result array", () => {
			const getToolDefinition = vi.fn().mockReturnValue({
				name: "empty",
				renderResult: () => createMockComponent(["done"]),
			});
			const renderer = createToolHtmlRenderer({
				getToolDefinition,
				theme: createMockTheme(),
				cwd: "/test",
			});

			const result = renderer.renderResult("tc1", "empty", [], {}, false);
			expect(result).toBeDefined();
			expect(result!.expanded).toContain("done");
		});
	});

	describe("state persistence", () => {
		it("should maintain state across renderCall and renderResult for same toolCallId", () => {
			let callState: unknown;
			let resultState: unknown;
			const getToolDefinition = vi.fn().mockImplementation((name: string) => ({
				name,
				renderCall: (_args: unknown, _theme: unknown, ctx: ToolRenderContext) => {
					ctx.state.counter = 1;
					callState = ctx.state;
					return createMockComponent(["call"]);
				},
				renderResult: (_result: unknown, _options: unknown, _theme: unknown, ctx: ToolRenderContext) => {
					resultState = ctx.state;
					return createMockComponent(["result"]);
				},
			}));
			const renderer = createToolHtmlRenderer({
				getToolDefinition,
				theme: createMockTheme(),
				cwd: "/test",
			});

			renderer.renderCall("shared-id", "mytool", { x: 1 });
			renderer.renderResult("shared-id", "mytool", [{ type: "text", text: "ok" }], {}, false);

			expect(callState).toBe(resultState);
			expect((resultState as any).counter).toBe(1);
		});
	});
});

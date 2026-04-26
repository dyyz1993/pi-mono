import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, getAssistantTexts, type Harness } from "./harness.js";

function extractToolResultText(context: {
	messages: Array<{ role: string; content?: Array<{ type: string; text?: string }> }>;
}): string {
	const toolResult = context.messages.find((message) => message.role === "toolResult");
	if (!toolResult || !("content" in toolResult) || !Array.isArray(toolResult.content)) {
		return "";
	}
	return toolResult.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

describe("UI Interception E2E", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	describe("plugin responds inside handler (responded)", () => {
		it("extension tool calls ctx.ui.confirm(), interceptor plugin answers confirmed=true", async () => {
			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
						pi.registerTool({
							name: "ask-confirm",
							label: "Ask Confirm",
							description: "Asks a confirmation question",
							parameters: Type.Object({ question: Type.String() }),
							execute: async (_id, params, _signal, _onUpdate, ctx) => {
								const confirmed = await ctx.ui.confirm("Permission", params.question as string);
								return {
									content: [{ type: "text", text: confirmed ? "confirmed" : "denied" }],
								};
							},
						});
					},
					(pi) => {
						pi.on("ui_confirm", async (event) => {
							if (event.message === "May I proceed?") {
								return { action: "responded" as const, confirmed: true };
							}
							return undefined;
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("ask-confirm", { question: "May I proceed?" })], {
					stopReason: "toolUse",
				}),
				(context) => fauxAssistantMessage(extractToolResultText(context)),
			]);

			await harness.session.prompt("ask me");

			expect(getAssistantTexts(harness)).toContain("confirmed");
		});

		it("extension tool calls ctx.ui.confirm(), interceptor plugin answers confirmed=false", async () => {
			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
						pi.registerTool({
							name: "ask-confirm",
							label: "Ask Confirm",
							description: "Asks a confirmation question",
							parameters: Type.Object({ question: Type.String() }),
							execute: async (_id, params, _signal, _onUpdate, ctx) => {
								const confirmed = await ctx.ui.confirm("Permission", params.question as string);
								return {
									content: [{ type: "text", text: confirmed ? "confirmed" : "denied" }],
								};
							},
						});
					},
					(pi) => {
						pi.on("ui_confirm", async () => {
							return { action: "responded" as const, confirmed: false };
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("ask-confirm", { question: "May I proceed?" })], {
					stopReason: "toolUse",
				}),
				(context) => fauxAssistantMessage(extractToolResultText(context)),
			]);

			await harness.session.prompt("ask me");

			expect(getAssistantTexts(harness)).toContain("denied");
		});

		it("extension tool calls ctx.ui.select(), interceptor plugin selects an option", async () => {
			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
						pi.registerTool({
							name: "ask-select",
							label: "Ask Select",
							description: "Asks to pick an option",
							parameters: Type.Object({ prompt: Type.String() }),
							execute: async (_id, params, _signal, _onUpdate, ctx) => {
								const choice = await ctx.ui.select(params.prompt as string, ["Red", "Green", "Blue"]);
								return {
									content: [{ type: "text", text: choice ?? "cancelled" }],
								};
							},
						});
					},
					(pi) => {
						pi.on("ui_select", async () => {
							return { action: "responded" as const, value: "Green" };
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("ask-select", { prompt: "Pick a color" })], { stopReason: "toolUse" }),
				(context) => fauxAssistantMessage(extractToolResultText(context)),
			]);

			await harness.session.prompt("ask me");

			expect(getAssistantTexts(harness)).toContain("Green");
		});
	});

	describe("plugin returns undefined, original UI responds", () => {
		it("interceptor passes through confirm, original UI returns true", async () => {
			const confirmResults: boolean[] = [];
			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
						pi.registerTool({
							name: "ask-confirm",
							label: "Ask Confirm",
							description: "Asks a confirmation question",
							parameters: Type.Object({ question: Type.String() }),
							execute: async (_id, params, _signal, _onUpdate, ctx) => {
								const confirmed = await ctx.ui.confirm("Permission", params.question as string);
								confirmResults.push(confirmed);
								return {
									content: [{ type: "text", text: confirmed ? "confirmed" : "denied" }],
								};
							},
						});
					},
					(pi) => {
						pi.on("ui_confirm", async () => undefined);
					},
				],
			});
			harnesses.push(harness);

			await harness.session.bindExtensions({
				uiContext: {
					confirm: async () => true,
					select: async () => undefined,
					input: async () => undefined,
					notify: () => {},
					onTerminalInput: () => () => {},
					setStatus: () => {},
					setWorkingMessage: () => {},
					setWorkingIndicator: () => {},
					setHiddenThinkingLabel: () => {},
					setWidget: () => {},
					setFooter: () => {},
					setHeader: () => {},
					setTitle: () => {},
					custom: async () => undefined as never,
					pasteToEditor: () => {},
					setEditorText: () => {},
					getEditorText: () => "",
					editor: async () => undefined,
					addAutocompleteProvider: () => {},
					setEditorComponent: () => {},
					get theme() {
						return {} as any;
					},
					getAllThemes: () => [],
					getTheme: () => undefined,
					setTheme: () => ({ success: false }),
					getToolsExpanded: () => false,
					setToolsExpanded: () => {},
				},
				shutdownHandler: () => {},
			});

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("ask-confirm", { question: "May I?" })], { stopReason: "toolUse" }),
				(context) => fauxAssistantMessage(extractToolResultText(context)),
			]);

			await harness.session.prompt("ask me");

			expect(getAssistantTexts(harness)).toContain("confirmed");
			expect(confirmResults).toEqual([true]);
		});

		it("interceptor passes through select, original UI returns a value", async () => {
			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
						pi.registerTool({
							name: "ask-select",
							label: "Ask Select",
							description: "Asks to pick an option",
							parameters: Type.Object({ prompt: Type.String() }),
							execute: async (_id, params, _signal, _onUpdate, ctx) => {
								const choice = await ctx.ui.select(params.prompt as string, ["Red", "Green", "Blue"]);
								return {
									content: [{ type: "text", text: choice ?? "cancelled" }],
								};
							},
						});
					},
					(pi) => {
						pi.on("ui_select", async () => undefined);
					},
				],
			});
			harnesses.push(harness);

			await harness.session.bindExtensions({
				uiContext: {
					confirm: async () => false,
					select: async () => "Red",
					input: async () => undefined,
					notify: () => {},
					onTerminalInput: () => () => {},
					setStatus: () => {},
					setWorkingMessage: () => {},
					setWorkingIndicator: () => {},
					setHiddenThinkingLabel: () => {},
					setWidget: () => {},
					setFooter: () => {},
					setHeader: () => {},
					setTitle: () => {},
					custom: async () => undefined as never,
					pasteToEditor: () => {},
					setEditorText: () => {},
					getEditorText: () => "",
					editor: async () => undefined,
					addAutocompleteProvider: () => {},
					setEditorComponent: () => {},
					get theme() {
						return {} as any;
					},
					getAllThemes: () => [],
					getTheme: () => undefined,
					setTheme: () => ({ success: false }),
					getToolsExpanded: () => false,
					setToolsExpanded: () => {},
				},
				shutdownHandler: () => {},
			});

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("ask-select", { prompt: "Pick a color" })], { stopReason: "toolUse" }),
				(context) => fauxAssistantMessage(extractToolResultText(context)),
			]);

			await harness.session.prompt("ask me");

			expect(getAssistantTexts(harness)).toContain("Red");
		});
	});

	describe("no interceptor, original UI handles everything", () => {
		it("confirm goes directly to original UI (no ui_confirm handler)", async () => {
			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
						pi.registerTool({
							name: "ask-confirm",
							label: "Ask Confirm",
							description: "Asks a confirmation question",
							parameters: Type.Object({ question: Type.String() }),
							execute: async (_id, params, _signal, _onUpdate, ctx) => {
								const confirmed = await ctx.ui.confirm("Permission", params.question as string);
								return {
									content: [{ type: "text", text: confirmed ? "confirmed" : "denied" }],
								};
							},
						});
					},
				],
			});
			harnesses.push(harness);

			await harness.session.bindExtensions({
				uiContext: {
					confirm: async () => true,
					select: async () => undefined,
					input: async () => undefined,
					notify: () => {},
					onTerminalInput: () => () => {},
					setStatus: () => {},
					setWorkingMessage: () => {},
					setWorkingIndicator: () => {},
					setHiddenThinkingLabel: () => {},
					setWidget: () => {},
					setFooter: () => {},
					setHeader: () => {},
					setTitle: () => {},
					custom: async () => undefined as never,
					pasteToEditor: () => {},
					setEditorText: () => {},
					getEditorText: () => "",
					editor: async () => undefined,
					addAutocompleteProvider: () => {},
					setEditorComponent: () => {},
					get theme() {
						return {} as any;
					},
					getAllThemes: () => [],
					getTheme: () => undefined,
					setTheme: () => ({ success: false }),
					getToolsExpanded: () => false,
					setToolsExpanded: () => {},
				},
				shutdownHandler: () => {},
			});

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("ask-confirm", { question: "May I?" })], { stopReason: "toolUse" }),
				(context) => fauxAssistantMessage(extractToolResultText(context)),
			]);

			await harness.session.prompt("ask me");

			expect(getAssistantTexts(harness)).toContain("confirmed");
		});
	});
});

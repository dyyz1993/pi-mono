import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, getAssistantTexts, type Harness } from "./harness.js";

type MessageContent = Array<{ type: string; text?: string }>;

function extractToolResultText(context: { messages: Array<{ role: string; content?: MessageContent }> }): string {
	const toolResult = context.messages.find((message) => message.role === "toolResult");
	if (!toolResult || !Array.isArray(toolResult.content)) return "";
	return toolResult.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function makeUIContext(overrides: Record<string, (...args: any[]) => any> = {}) {
	return {
		confirm: async () => false,
		select: async () => undefined as string | undefined,
		input: async () => undefined as string | undefined,
		editor: async () => undefined as string | undefined,
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
		...overrides,
	};
}

describe("Ask Tools E2E", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	describe("ask-confirm", () => {
		it("returns confirmed=true via UI handler", async () => {
			const harness = await createHarness({
				extensionFactories: [
					(pi: any) => {
						pi.registerTool({
							name: "ask-confirm",
							label: "Ask Confirm",
							description: "Asks a yes/no confirmation question",
							parameters: Type.Object({
								title: Type.String(),
								question: Type.String(),
							}),
							execute: async (_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) => {
								const confirmed = await ctx.ui.confirm(params.title, params.question);
								return {
									content: [{ type: "text", text: confirmed ? "confirmed" : "denied" }],
								};
							},
						});
					},
					(pi: any) => {
						pi.on("ui", async (event: any) => {
							if (event.method === "confirm") {
								return { action: "responded", confirmed: true };
							}
							return undefined;
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("ask-confirm", { title: "Permission", question: "Proceed?" })], {
					stopReason: "toolUse",
				}),
				(context: any) => fauxAssistantMessage(extractToolResultText(context)),
			]);

			await harness.session.prompt("confirm this");
			expect(getAssistantTexts(harness)).toContain("confirmed");
		});

		it("returns confirmed=false via UI handler", async () => {
			const harness = await createHarness({
				extensionFactories: [
					(pi: any) => {
						pi.registerTool({
							name: "ask-confirm",
							label: "Ask Confirm",
							description: "Asks a yes/no confirmation question",
							parameters: Type.Object({ title: Type.String(), question: Type.String() }),
							execute: async (_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) => {
								const confirmed = await ctx.ui.confirm(params.title, params.question);
								return { content: [{ type: "text", text: confirmed ? "confirmed" : "denied" }] };
							},
						});
					},
					(pi: any) => {
						pi.on("ui", async (event: any) => {
							if (event.method === "confirm") {
								return { action: "responded", confirmed: false };
							}
							return undefined;
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("ask-confirm", { title: "Delete", question: "Delete file?" })], {
					stopReason: "toolUse",
				}),
				(context: any) => fauxAssistantMessage(extractToolResultText(context)),
			]);

			await harness.session.prompt("delete");
			expect(getAssistantTexts(harness)).toContain("denied");
		});
	});

	describe("ask-select", () => {
		it("returns selected option via UI handler", async () => {
			const harness = await createHarness({
				extensionFactories: [
					(pi: any) => {
						pi.registerTool({
							name: "ask-select",
							label: "Ask Select",
							description: "Asks to pick an option",
							parameters: Type.Object({ title: Type.String(), options: Type.Array(Type.String()) }),
							execute: async (_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) => {
								const choice = await ctx.ui.select(params.title, params.options);
								return { content: [{ type: "text", text: choice ?? "cancelled" }] };
							},
						});
					},
					(pi: any) => {
						pi.on("ui", async (event: any) => {
							if (event.method === "select") {
								return { action: "responded", value: "Green" };
							}
							return undefined;
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("ask-select", { title: "Color", options: ["Red", "Green", "Blue"] })], {
					stopReason: "toolUse",
				}),
				(context: any) => fauxAssistantMessage(extractToolResultText(context)),
			]);

			await harness.session.prompt("pick a color");
			expect(getAssistantTexts(harness)).toContain("Green");
		});
	});

	describe("ask-input", () => {
		it("returns user text via UI handler", async () => {
			const harness = await createHarness({
				extensionFactories: [
					(pi: any) => {
						pi.registerTool({
							name: "ask-input",
							label: "Ask Input",
							description: "Asks for free-form text input",
							parameters: Type.Object({
								title: Type.String(),
								placeholder: Type.Optional(Type.String()),
							}),
							execute: async (_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) => {
								const text = await ctx.ui.input(params.title, params.placeholder);
								return { content: [{ type: "text", text: text ?? "empty" }] };
							},
						});
					},
					(pi: any) => {
						pi.on("ui", async (event: any) => {
							if (event.method === "input") {
								return { action: "responded", value: "test@example.com" };
							}
							return undefined;
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("ask-input", { title: "Email", placeholder: "Enter email" })], {
					stopReason: "toolUse",
				}),
				(context: any) => fauxAssistantMessage(extractToolResultText(context)),
			]);

			await harness.session.prompt("email");
			expect(getAssistantTexts(harness)).toContain("test@example.com");
		});
	});

	describe("ask-editor", () => {
		it("returns edited text via UI handler", async () => {
			const harness = await createHarness({
				extensionFactories: [
					(pi: any) => {
						pi.registerTool({
							name: "ask-editor",
							label: "Ask Editor",
							description: "Opens a multi-line editor",
							parameters: Type.Object({
								title: Type.String(),
								prefill: Type.Optional(Type.String()),
							}),
							execute: async (_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) => {
								const text = await ctx.ui.editor(params.title, params.prefill);
								return { content: [{ type: "text", text: text ?? "cancelled" }] };
							},
						});
					},
					(pi: any) => {
						pi.on("ui", async (event: any) => {
							if (event.method === "editor") {
								return { action: "responded", value: "edited content here" };
							}
							return undefined;
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("ask-editor", { title: "Edit Config", prefill: "original" })], {
					stopReason: "toolUse",
				}),
				(context: any) => fauxAssistantMessage(extractToolResultText(context)),
			]);

			await harness.session.prompt("edit config");
			expect(getAssistantTexts(harness)).toContain("edited content here");
		});

		it("returns cancelled when user dismisses editor", async () => {
			const harness = await createHarness({
				extensionFactories: [
					(pi: any) => {
						pi.registerTool({
							name: "ask-editor",
							label: "Ask Editor",
							description: "Opens a multi-line editor",
							parameters: Type.Object({
								title: Type.String(),
								prefill: Type.Optional(Type.String()),
							}),
							execute: async (_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) => {
								const text = await ctx.ui.editor(params.title, params.prefill);
								return { content: [{ type: "text", text: text ?? "cancelled" }] };
							},
						});
					},
					(pi: any) => {
						pi.on("ui", async (event: any) => {
							if (event.method === "editor") {
								return { action: "responded", value: undefined };
							}
							return undefined;
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("ask-editor", { title: "Commit Msg" })], { stopReason: "toolUse" }),
				(context: any) => fauxAssistantMessage(extractToolResultText(context)),
			]);

			await harness.session.prompt("write commit");
			expect(getAssistantTexts(harness)).toContain("cancelled");
		});
	});

	describe("ask-notify", () => {
		it("fires notify and returns result", async () => {
			const notifyCalls: Array<{ message: string; type?: string }> = [];

			const harness = await createHarness({
				extensionFactories: [
					(pi: any) => {
						pi.registerTool({
							name: "ask-notify",
							label: "Ask Notify",
							description: "Shows a notification",
							parameters: Type.Object({
								message: Type.String(),
								type: Type.Optional(Type.String()),
							}),
							execute: async (_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) => {
								ctx.ui.notify(params.message, params.type);
								return { content: [{ type: "text", text: "Notified user" }] };
							},
						});
					},
				],
			});
			harnesses.push(harness);

			await harness.session.bindExtensions({
				uiContext: makeUIContext({
					notify: (msg: string, type?: string) => {
						notifyCalls.push({ message: msg, type });
					},
				}),
				shutdownHandler: () => {},
			});

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("ask-notify", { message: "Deploy completed!", type: "info" })], {
					stopReason: "toolUse",
				}),
				(context: any) => fauxAssistantMessage(extractToolResultText(context)),
			]);

			await harness.session.prompt("notify deploy");
			expect(getAssistantTexts(harness)).toContain("Notified user");
			expect(notifyCalls.length).toBeGreaterThanOrEqual(1);
			expect(notifyCalls[0].message).toBe("Deploy completed!");
		});
	});

	describe("ctx.respondUI async injection", () => {
		it("respondUI wins race against hanging original UI", async () => {
			const harness = await createHarness({
				extensionFactories: [
					(pi: any) => {
						pi.registerTool({
							name: "ask-confirm",
							label: "Ask Confirm",
							description: "Asks a confirmation question",
							parameters: Type.Object({ title: Type.String(), question: Type.String() }),
							execute: async (_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) => {
								const confirmed = await ctx.ui.confirm(params.title, params.question);
								return { content: [{ type: "text", text: confirmed ? "confirmed" : "denied" }] };
							},
						});
					},
					(pi: any) => {
						pi.on("ui", async (event: any, ctx: any) => {
							if (event.method === "confirm") {
								setTimeout(() => {
									ctx.respondUI(event.id, { action: "responded", confirmed: true });
								}, 10);
								return undefined;
							}
							return undefined;
						});
					},
				],
			});
			harnesses.push(harness);

			await harness.session.bindExtensions({
				uiContext: makeUIContext({
					confirm: async () => {
						await new Promise(() => {});
						return false;
					},
				}),
				shutdownHandler: () => {},
			});

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("ask-confirm", { title: "Deploy", question: "Deploy to prod?" })], {
					stopReason: "toolUse",
				}),
				(context: any) => fauxAssistantMessage(extractToolResultText(context)),
			]);

			await harness.session.prompt("deploy");
			expect(getAssistantTexts(harness)).toContain("confirmed");
		});
	});
});

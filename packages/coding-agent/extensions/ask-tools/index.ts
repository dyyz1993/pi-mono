/**
 * Ask Tools Extension
 *
 * 注册 ask-confirm / ask-select / ask-multiselect / ask-input / ask-editor / ask-notify 工具，
 * 内部调用 ctx.ui.confirm / select / input / editor / notify 触发 UI 交互。
 * 配合 message-bridge 扩展使用时，confirm/select/input/editor 调用会被推送到 Bridge。
 */

import { Type } from "typebox";

export default function askToolsExtension(pi: any) {
	pi.registerTool({
		name: "ask-confirm",
		label: "Ask Confirm",
		description: "Asks the user a yes/no confirmation question. Use when you need user approval before proceeding.",
		parameters: Type.Object({
			title: Type.String({ description: "Short title for the confirmation" }),
			question: Type.String({ description: "The question to ask" }),
		}),
		execute: async (_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) => {
			const confirmed = await ctx.ui.confirm(params.title, params.question);
			return {
				content: [{ type: "text", text: confirmed ? "User confirmed: yes" : "User confirmed: no" }],
			};
		},
	});

	pi.registerTool({
		name: "ask-select",
		label: "Ask Select",
		description: "Asks the user to select one option from a list. Use when you need the user to make a choice.",
		parameters: Type.Object({
			title: Type.String({ description: "Short title for the selection" }),
			options: Type.Array(Type.String(), { description: "List of options to choose from" }),
		}),
		execute: async (_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) => {
			const choice = await ctx.ui.select(params.title, params.options);
			return {
				content: [{ type: "text", text: `User selected: ${choice ?? "(cancelled)"}` }],
			};
		},
	});

	pi.registerTool({
		name: "ask-multiselect",
		label: "Ask Multiselect",
		description:
			"Asks the user to select multiple options from a list (checkbox style). Use when you need the user to pick one or more options.",
		parameters: Type.Object({
			title: Type.String({ description: "Short title for the selection" }),
			options: Type.Array(Type.String(), { description: "List of options to choose from" }),
		}),
		execute: async (_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) => {
			const choices = await ctx.ui.select(params.title, params.options, { multiple: true });
			if (!choices || !Array.isArray(choices) || choices.length === 0) {
				return {
					content: [{ type: "text", text: "User selected: (none)" }],
				};
			}
			return {
				content: [{ type: "text", text: `User selected: ${choices.join(", ")}` }],
			};
		},
	});

	pi.registerTool({
		name: "ask-input",
		label: "Ask Input",
		description: "Asks user for free-form text input. Use when you need user to provide text.",
		parameters: Type.Object({
			title: Type.String({ description: "Short title for the input" }),
			placeholder: Type.Optional(Type.String({ description: "Placeholder text" })),
		}),
		execute: async (_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) => {
			const text = await ctx.ui.input(params.title, params.placeholder);
			return {
				content: [{ type: "text", text: `User input: ${text ?? "(empty)"}` }],
			};
		},
	});

	pi.registerTool({
		name: "ask-editor",
		label: "Ask Editor",
		description: "Opens a multi-line editor for user to edit text. Use when you need user to edit longer text (code, JSON, configs, commit messages).",
		parameters: Type.Object({
			title: Type.String({ description: "Short title for the editor" }),
			prefill: Type.Optional(Type.String({ description: "Pre-filled content in the editor" })),
		}),
		execute: async (_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) => {
			const text = await ctx.ui.editor(params.title, params.prefill);
			return {
				content: [{ type: "text", text: text ?? "(cancelled)" }],
			};
		},
	});

	pi.registerTool({
		name: "ask-notify",
		label: "Ask Notify",
		description: "Shows a notification to the user. Use for informational messages (fire-and-forget, does not wait for response).",
		parameters: Type.Object({
			message: Type.String({ description: "The message to display" }),
			type: Type.Optional(Type.String({ description: "Notification type: 'info', 'warning', or 'error'" })),
		}),
		execute: async (_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) => {
			ctx.ui.notify(params.message, params.type as any);
			return {
				content: [{ type: "text", text: "Notified user" }],
			};
		},
	});
}

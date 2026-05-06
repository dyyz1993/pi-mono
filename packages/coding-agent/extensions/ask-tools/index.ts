/**
 * Ask Tools Extension
 *
 * 注册 ask-confirm / ask-select / ask-input / ask-editor / ask-notify 工具，
 * 内部调用 ctx.ui.confirm / select / input / editor / notify 触发 UI 交互。
 * ask-select 支持 multiple 参数切换单选/多选模式。
 * 配合 message-bridge 扩展使用时，confirm/select/input/editor 调用会被推送到 Bridge。
 */

import type { ExtensionAPI, ExtensionContext } from "@dyyz1993/pi-coding-agent";
import { type Static, Type } from "@sinclair/typebox";

const ConfirmParams = Type.Object({
	title: Type.String({ description: "Short title for the confirmation" }),
	question: Type.String({ description: "The question to ask" }),
});

const SelectParams = Type.Object({
	title: Type.String({ description: "Short title for the selection" }),
	options: Type.Array(Type.String(), { description: "List of options to choose from" }),
	multiple: Type.Optional(Type.Boolean({ description: "Allow multi-select (checkbox mode). Default: false (single select)." })),
});

const InputParams = Type.Object({
	title: Type.String({ description: "Short title for the input" }),
	placeholder: Type.Optional(Type.String({ description: "Placeholder text" })),
});

const EditorParams = Type.Object({
	title: Type.String({ description: "Short title for the editor" }),
	prefill: Type.Optional(Type.String({ description: "Pre-filled content in the editor" })),
});

const NotifyParams = Type.Object({
	message: Type.String({ description: "The message to display" }),
	type: Type.Optional(Type.String({ description: "Notification type: 'info', 'warning', or 'error'" })),
});

export default function askToolsExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "ask-confirm",
		label: "Ask Confirm",
		description: "Asks the user a yes/no confirmation question. Use when you need user approval before proceeding.",
		parameters: ConfirmParams,
		execute: async (_id: string, params: Static<typeof ConfirmParams>, _signal, _onUpdate, ctx: ExtensionContext) => {
			const confirmed = await ctx.ui.confirm(params.title, params.question);
			return {
				content: [{ type: "text" as const, text: confirmed ? "User confirmed: yes" : "User confirmed: no" }],
				details: undefined,
			};
		},
	});

	pi.registerTool({
		name: "ask-select",
		label: "Ask Select",
		description:
			"Asks the user to select option(s) from a list. By default single-select (returns one choice). Set multiple=true to allow selecting multiple options (checkbox style).",
		parameters: SelectParams,
		execute: async (_id: string, params: Static<typeof SelectParams>, _signal, _onUpdate, ctx: ExtensionContext) => {
			const isMultiple = params.multiple === true;
			const result = await ctx.ui.select(params.title, params.options, { multiple: isMultiple });
			if (isMultiple) {
				if (!result || !Array.isArray(result) || result.length === 0) {
					return { content: [{ type: "text" as const, text: "User selected: (none)" }], details: undefined };
				}
				return { content: [{ type: "text" as const, text: `User selected: ${(result as string[]).join(", ")}` }], details: undefined };
			}
			const choice = result as string | undefined;
			return { content: [{ type: "text" as const, text: `User selected: ${choice ?? "(cancelled)"}` }], details: undefined };
		},
	});

	pi.registerTool({
		name: "ask-input",
		label: "Ask Input",
		description: "Asks user for free-form text input. Use when you need user to provide text.",
		parameters: InputParams,
		execute: async (_id: string, params: Static<typeof InputParams>, _signal, _onUpdate, ctx: ExtensionContext) => {
			const text = await ctx.ui.input(params.title, params.placeholder);
			return {
				content: [{ type: "text" as const, text: `User input: ${text ?? "(empty)"}` }],
				details: undefined,
			};
		},
	});

	pi.registerTool({
		name: "ask-editor",
		label: "Ask Editor",
		description: "Opens a multi-line editor for user to edit text. Use when you need user to edit longer text (code, JSON, configs, commit messages).",
		parameters: EditorParams,
		execute: async (_id: string, params: Static<typeof EditorParams>, _signal, _onUpdate, ctx: ExtensionContext) => {
			const text = await ctx.ui.editor(params.title, params.prefill);
			return {
				content: [{ type: "text" as const, text: text ?? "(cancelled)" }],
				details: undefined,
			};
		},
	});

	pi.registerTool({
		name: "ask-notify",
		label: "Ask Notify",
		description: "Shows a notification to the user. Use for informational messages (fire-and-forget, does not wait for response).",
		parameters: NotifyParams,
		execute: async (_id: string, params: Static<typeof NotifyParams>, _signal, _onUpdate, ctx: ExtensionContext) => {
			ctx.ui.notify(params.message, params.type as "info" | "warning" | "error" | undefined);
			return {
				content: [{ type: "text" as const, text: "Notified user" }],
				details: undefined,
			};
		},
	});
}

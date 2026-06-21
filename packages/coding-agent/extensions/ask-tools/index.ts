/**
 * Ask Tools Extension
 *
 * Registers a single structured ask tool for user questions.
 * Use ask-user-question for single-question, multi-question, single-select,
 * multi-select, and free-text supplement flows.
 */

import type { ExtensionAPI, ExtensionContext } from "@dyyz1993/pi-coding-agent";
import { type Static, Type } from "typebox";

const AskOptionParams = Type.Object({
	label: Type.String({ description: "Short option label shown to the user" }),
	description: Type.String({ description: "One sentence explaining the tradeoff or impact" }),
	preview: Type.Optional(Type.String({ description: "Optional preview text shown with this option" })),
});

const AskQuestionParams = Type.Object({
	id: Type.String({ description: "Stable answer key, e.g. scope, strategy, files" }),
	header: Type.String({ description: "Short section label for this question" }),
	question: Type.String({ description: "The question shown to the user" }),
	options: Type.Array(AskOptionParams, {
		minItems: 2,
		maxItems: 4,
		description: "Two to four explicit choices. Put the recommended option first when applicable.",
	}),
	multiSelect: Type.Optional(Type.Boolean({ description: "Allow selecting multiple options for this question" })),
});

const AskUserQuestionParams = Type.Object({
	title: Type.Optional(Type.String({ description: "Optional title for the whole ask request" })),
	questions: Type.Array(AskQuestionParams, {
		minItems: 1,
		maxItems: 4,
		description: "One to four questions submitted as a single ask request.",
	}),
	timeout: Type.Optional(Type.Number({ description: "Optional timeout in milliseconds" })),
});

const NotifyParams = Type.Object({
	message: Type.String({ description: "The message to display" }),
	type: Type.Optional(Type.String({ description: "Notification type: 'info', 'warning', or 'error'" })),
});

export default function askToolsExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "ask-user-question",
		label: "Ask User Question",
		description:
			"Ask the user one or more structured questions in a single request. Supports single-select, multi-select, and optional free-text supplements. Use this instead of separate confirm/select/input/editor flows.",
		parameters: AskUserQuestionParams,
		execute: async (id: string, params: Static<typeof AskUserQuestionParams>, _signal, _onUpdate, ctx: ExtensionContext) => {
			const result = await ctx.ui.askUserQuestion(params.questions, {
				title: params.title,
				timeout: params.timeout,
				toolCallId: id,
			});

			return {
				content: [
					{
						type: "text" as const,
						text: result ? `User answered: ${JSON.stringify(result.answers)}` : "User did not answer.",
					},
				],
				details: result,
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

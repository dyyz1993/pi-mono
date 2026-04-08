/**
 * Message Summarizer Extension
 *
 * Automatically summarizes each turn's conversation and can provide
 * real-time theme detection for user inputs.
 *
 * Use cases:
 * - Turn summary: After each agent turn, extract a brief summary
 * - Theme detection: Identify the topic/theme of user requests
 * - Topic tracking: Track what topics have been discussed
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

interface TurnSummary {
	turnIndex: number;
	timestamp: number;
	userMessage: string;
	assistantMessage: string;
	theme: string;
	summary: string;
}

const extractText = (content: Array<{ type: string; text?: string }>): string => {
	return content
		.filter((c): c is { type: "text"; text: string } => c.type === "text" && typeof c.text === "string")
		.map((c) => c.text)
		.join("");
};

const state = {
	summaries: [] as TurnSummary[],
	themes: [] as string[],
	lastTurnIndex: -1,
	enabled: true,
};

export default function (pi: ExtensionAPI) {
	pi.registerCommand("summarizer-enable", {
		description: "Enable message summarization",
		handler: async (_args, ctx) => {
			state.enabled = true;
			ctx.ui.notify("Message summarizer enabled", "info");
		},
	});

	pi.registerCommand("summarizer-disable", {
		description: "Disable message summarization",
		handler: async (_args, ctx) => {
			state.enabled = false;
			ctx.ui.notify("Message summarizer disabled", "info");
		},
	});

	pi.registerCommand("summarizer-status", {
		description: "Show summarizer status",
		handler: async (_args, ctx) => {
			const status = state.enabled ? "enabled" : "disabled";
			const summaryCount = state.summaries.length;
			const uniqueThemes = [...new Set(state.themes)];
			ctx.ui.notify(
				`Summarizer Status: ${status}\n` + `Turns summarized: ${summaryCount}\n` + `Themes detected: ${uniqueThemes.join(", ") || "none"}`,
				"info",
			);
		},
	});

	pi.registerCommand("summarizer-recent", {
		description: "Show recent turn summaries",
		handler: async (args, ctx) => {
			const count = parseInt(args || "5", 10);
			const recent = state.summaries.slice(-count);
			if (recent.length === 0) {
				ctx.ui.notify("No summaries yet", "info");
				return;
			}
			const output = recent
				.map(
					(s, i) =>
						`[Turn ${s.turnIndex}] ${s.theme}\n` +
						`User: ${s.userMessage.substring(0, 50)}...\n` +
						`Summary: ${s.summary}`,
				)
				.join("\n\n");
			ctx.ui.notify(output, "info");
		},
	});

	pi.registerCommand("summarizer-themes", {
		description: "Show all detected themes",
		handler: async (_args, ctx) => {
			const themes = [...new Set(state.themes)];
			if (themes.length === 0) {
				ctx.ui.notify("No themes detected yet", "info");
				return;
			}
			const themeCounts = themes.map((t) => {
				const count = state.themes.filter((th) => th === t).length;
				return `${t} (${count})`;
			});
			ctx.ui.notify(`Detected themes:\n${themeCounts.join("\n")}`, "info");
		},
	});

	pi.registerCommand("classify-theme", {
		description: "Classify the theme of input text",
		handler: async (args, ctx) => {
			if (!ctx.model) {
				ctx.ui.notify("No model configured", "error");
				return;
			}

			const input = args || "How do I implement a binary search tree?";
			ctx.ui.setStatus("classify-theme", "Classifying...");

			try {
				const result = await ctx.callModel({
					messages: [
						{
							role: "user",
							content: `Classify this request into ONE of these categories:
- bug: Something is broken or not working
- feature: Adding new functionality
- question: Asking for information or explanation
- refactor: Improving or restructuring existing code
- docs: Documentation related
- test: Testing related
- other: Doesn't fit other categories

Request: "${input}"

Reply with only the category name, lowercase, nothing else.`,
						},
					],
					speed: "off",
				});
				const theme = extractText(result.content).trim().toLowerCase();
				ctx.ui.setStatus("classify-theme", undefined);
				ctx.ui.notify(`Theme for "${input.substring(0, 40)}...": ${theme}`, "info");
			} catch (error) {
				ctx.ui.setStatus("classify-theme", undefined);
				const msg = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed: ${msg}`, "error");
			}
		},
	});

	pi.registerCommand("summarize-turn", {
		description: "Summarize the last turn",
		handler: async (args, ctx) => {
			if (!ctx.model) {
				ctx.ui.notify("No model configured", "error");
				return;
			}

			const turnIndex = parseInt(args || String(state.summaries.length), 10);
			const summary = state.summaries.find((s) => s.turnIndex === turnIndex);

			if (!summary) {
				ctx.ui.notify(`No summary found for turn ${turnIndex}`, "error");
				return;
			}

			ctx.ui.notify(
				`[Turn ${summary.turnIndex}]\n\n` +
					`Theme: ${summary.theme}\n\n` +
					`User: ${summary.userMessage}\n\n` +
					`Assistant: ${summary.assistantMessage.substring(0, 100)}...\n\n` +
					`Summary: ${summary.summary}`,
				"info",
			);
		},
	});

	pi.registerCommand("summarizer-clear", {
		description: "Clear all stored summaries",
		handler: async (_args, ctx) => {
			state.summaries = [];
			state.themes = [];
			state.lastTurnIndex = -1;
			ctx.ui.notify("All summaries cleared", "info");
		},
	});

	pi.on("turn_end", async (event, ctx) => {
		if (!state.enabled) return;
		if (!ctx.model) return;

		try {
			const userMessage = event.message.role === "user" ? extractText(event.message.content) : "";

			const assistantMessages = event.toolResults ?? [];
			const assistantMessage = assistantMessages
				.map((r) => (r.role === "assistant" ? extractText(r.content) : ""))
				.join(" ");

			if (!userMessage && !assistantMessage) return;

			const themeResult = await ctx.callModel({
				messages: [
					{
						role: "user",
						content: `Classify this request into ONE category: bug, feature, question, refactor, docs, test, other

Request: "${userMessage || assistantMessage}"

Reply with only the category, lowercase.`,
					},
				],
				speed: "off",
			});
			const theme = extractText(themeResult.content).trim().toLowerCase();

			const summaryResult = await ctx.callModel({
				messages: [
					{
						role: "user",
						content: `Summarize this conversation turn in 10 words or less:

User: ${userMessage}
Assistant: ${assistantMessage.substring(0, 200)}

Summary:`,
					},
				],
				speed: "minimal",
			});
			const summary = extractText(summaryResult.content).trim();

			const turnSummary: TurnSummary = {
				turnIndex: event.turnIndex,
				timestamp: Date.now(),
				userMessage,
				assistantMessage,
				theme,
				summary,
			};

			state.summaries.push(turnSummary);
			state.themes.push(theme);
			state.lastTurnIndex = event.turnIndex;

			ctx.ui.setStatus("summarizer", `Turn ${event.turnIndex}: ${theme}`);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			ctx.ui.setStatus("summarizer-error", msg);
		}
	});
}

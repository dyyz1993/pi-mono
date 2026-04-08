/**
 * Message Summarizer Extension
 *
 * Automatically summarizes each turn's conversation using context events.
 * Provides real-time theme detection for user inputs.
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

const extractText = (content: unknown): string => {
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		return content
			.filter(
				(c): c is { type: "text"; text: string } =>
					typeof c === "object" && c !== null && (c as any).type === "text",
			)
			.map((c) => (c as { text: string }).text)
			.join("");
	}
	return "";
};

const getMessageText = (msg: any): string => {
	if (!msg) return "";
	const content = msg.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter(
				(c): c is { type: "text"; text: string } =>
					typeof c === "object" && c !== null && (c as any).type === "text",
			)
			.map((c) => (c as { text: string }).text)
			.join("");
	}
	return "";
};

const state = {
	summaries: [] as TurnSummary[],
	themes: [] as string[],
	lastTurnIndex: -1,
	enabled: true,
	currentTurnMessages: [] as any[],
	pendingSummary: false,
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
				`Summarizer Status: ${status}\n` +
					`Turns summarized: ${summaryCount}\n` +
					`Themes detected: ${uniqueThemes.join(", ") || "none"}`,
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
					(s) =>
						`[Turn ${s.turnIndex}] ${s.theme}\n` +
						`User: ${s.userMessage.substring(0, 50)}${s.userMessage.length > 50 ? "..." : ""}\n` +
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

	pi.registerCommand("summarizer-clear", {
		description: "Clear all stored summaries",
		handler: async (_args, ctx) => {
			state.summaries = [];
			state.themes = [];
			state.lastTurnIndex = -1;
			state.currentTurnMessages = [];
			ctx.ui.notify("All summaries cleared", "info");
		},
	});

	pi.on("turn_start", async (event, ctx) => {
		state.currentTurnMessages = [];
		state.pendingSummary = false;
	});

	pi.on("context", async (event, ctx) => {
		if (!state.enabled) return;
		if (!ctx.model) return;

		state.currentTurnMessages = event.messages;

		const userMsgs = event.messages.filter((m) => m.role === "user");
		const assistantMsgs = event.messages.filter((m) => m.role === "assistant");

		const lastUserMsg = userMsgs.length > 0 ? getMessageText(userMsgs[userMsgs.length - 1]) : "";
		const lastAssistantMsg = assistantMsgs.length > 0 ? getMessageText(assistantMsgs[assistantMsgs.length - 1]) : "";

		if (!lastUserMsg && !lastAssistantMsg) return;

		try {
			const themeResult = await ctx.callModel({
				messages: [
					{
						role: "user",
						content: `Classify this request into ONE category: bug, feature, question, refactor, docs, test, other

Request: "${lastUserMsg || lastAssistantMsg}"

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
						content: `Summarize this conversation in 10 words or less:

User: ${lastUserMsg || "(empty)"}
Assistant: ${lastAssistantMsg ? lastAssistantMsg.substring(0, 100) : "(empty)"}

Summary (10 words max):`,
					},
				],
				speed: "minimal",
			});
			const summary = extractText(summaryResult.content).trim();

			state.pendingSummary = true;

			const turnSummary: TurnSummary = {
				turnIndex: event.turnIndex ?? state.summaries.length,
				timestamp: Date.now(),
				userMessage: lastUserMsg,
				assistantMessage: lastAssistantMsg,
				theme,
				summary,
			};

			state.summaries.push(turnSummary);
			state.themes.push(theme);
			state.lastTurnIndex = turnSummary.turnIndex;

			ctx.ui.setStatus("summarizer", `${turnSummary.turnIndex}: ${theme}`);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			ctx.ui.setStatus("summarizer-err", msg.substring(0, 20));
		}
	});
}

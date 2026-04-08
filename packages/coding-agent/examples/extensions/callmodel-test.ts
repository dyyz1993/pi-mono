/**
 * CallModel Test Extension
 *
 * Tests the ctx.callModel() API which allows extensions to perform
 * internal LLM calls using the session's configured model.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const extractText = (content: Array<{ type: string; text?: string }>): string => {
	return content
		.filter((c): c is { type: "text"; text: string } => c.type === "text" && typeof c.text === "string")
		.map((c) => c.text)
		.join("");
};

export default function (pi: ExtensionAPI) {
	pi.registerCommand("test-callmodel", {
		description: "Test the ctx.callModel() internal LLM API",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				console.log("test-callmodel: Running in non-UI mode");
			}

			if (!ctx.model) {
				ctx.ui.notify("No model configured", "error");
				return;
			}

			ctx.ui.notify(`Testing callModel with model: ${ctx.model.name}`, "info");

			try {
				ctx.ui.setStatus("test-callmodel", "Testing speed: off...");
				const result1 = await ctx.callModel({
					messages: [{ role: "user", content: "Reply with just the word 'hello'" }],
					speed: "off",
				});
				const text1 = extractText(result1.content);
				ctx.ui.notify(`speed:off => "${text1}"`, "info");

				ctx.ui.setStatus("test-callmodel", "Testing speed: low...");
				const result2 = await ctx.callModel({
					messages: [{ role: "user", content: "What is 2+2? Just answer with the number." }],
					speed: "low",
				});
				const text2 = extractText(result2.content);
				ctx.ui.notify(`speed:low => "${text2}"`, "info");

				ctx.ui.setStatus("test-callmodel", "Testing speed: medium...");
				const result3 = await ctx.callModel({
					messages: [
						{
							role: "system",
							content: "You are a helpful assistant that gives very brief answers.",
						},
						{
							role: "user",
							content:
								"Explain in one sentence why the sky is blue. Start your answer with 'The sky is blue because'",
						},
					],
					speed: "medium",
				});
				const text3 = extractText(result3.content);
				ctx.ui.notify(`speed:medium => "${text3}"`, "info");

				ctx.ui.setStatus("test-callmodel", "All tests passed!");
				ctx.ui.notify(
					`callModel tests completed successfully!\n\n` +
						`Model: ${ctx.model.name}\n` +
						`Results:\n` +
						`  off:   ${text1}\n` +
						`  low:   ${text2}\n` +
						`  medium: ${text3}`,
					"info",
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`callModel test failed: ${message}`, "error");
				ctx.ui.setStatus("test-callmodel", undefined);
			}
		},
	});

	pi.registerCommand("test-callmodel-theme", {
		description: "Test callModel for theme classification",
		handler: async (args, ctx) => {
			if (!ctx.model) {
				ctx.ui.notify("No model configured", "error");
				return;
			}

			const input = args || "How do I implement a binary search tree in JavaScript?";

			ctx.ui.notify(`Classifying theme for: "${input}"`, "info");

			try {
				const result = await ctx.callModel({
					messages: [
						{
							role: "user",
							content: `Classify this request into one of these themes: bug, feature, question, refactor, docs
Request: "${input}"
Just reply with the theme name, nothing else.`,
						},
					],
					speed: "off",
				});

				const theme = extractText(result.content).trim().toLowerCase();
				ctx.ui.notify(`Theme detected: "${theme}"`, "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Theme classification failed: ${message}`, "error");
			}
		},
	});
}

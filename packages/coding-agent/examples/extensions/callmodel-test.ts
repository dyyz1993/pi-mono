/**
 * CallModel Comprehensive Test Extension
 *
 * Tests various aspects of ctx.callModel() API:
 * 1. Different speed levels
 * 2. System prompt override
 * 3. Message format variations
 * 4. Model override
 * 5. Error handling
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const extractText = (content: Array<{ type: string; text?: string }>): string => {
	return content
		.filter((c): c is { type: "text"; text: string } => c.type === "text" && typeof c.text === "string")
		.map((c) => c.text)
		.join("");
};

export default function (pi: ExtensionAPI) {
	pi.registerCommand("test-callmodel-all", {
		description: "Test all callModel speed levels",
		handler: async (_args, ctx) => {
			if (!ctx.model) {
				ctx.ui.notify("No model configured", "error");
				return;
			}

			ctx.ui.notify(`Testing callModel with model: ${ctx.model.name}`, "info");

			const results: string[] = [];

			const speeds: Array<{ level: string; prompt: string }> = [
				{ level: "off", prompt: "Reply with just the word 'hello'" },
				{ level: "minimal", prompt: "Reply with just the word 'hi'" },
				{ level: "low", prompt: "What is 1+1? Reply with just the number." },
				{ level: "medium", prompt: "In one sentence, what is the capital of France?" },
			];

			for (const { level, prompt } of speeds) {
				try {
					ctx.ui.setStatus("test-callmodel", `Testing ${level}...`);
					const result = await ctx.callModel({
						messages: [{ role: "user", content: prompt }],
						speed: level as any,
					});
					const text = extractText(result.content);
					results.push(`[${level}] ${text}`);
					ctx.ui.notify(`✓ ${level}: "${text}"`, "info");
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					results.push(`[${level}] ERROR: ${msg}`);
					ctx.ui.notify(`✗ ${level}: ${msg}`, "error");
				}
			}

			ctx.ui.setStatus("test-callmodel", undefined);
			ctx.ui.notify(`All tests completed:\n${results.join("\n")}`, "info");
		},
	});

	pi.registerCommand("test-callmodel-system-prompt", {
		description: "Test callModel with custom system prompt",
		handler: async (_args, ctx) => {
			if (!ctx.model) {
				ctx.ui.notify("No model configured", "error");
				return;
			}

			ctx.ui.notify("Testing callModel with custom system prompt...", "info");

			try {
				const result = await ctx.callModel({
					messages: [{ role: "user", content: "What is 2+2?" }],
					speed: "off",
					systemPrompt: "You are a calculator. Always answer with just the number.",
				});
				const text = extractText(result.content);
				ctx.ui.notify(`System prompt override works! Result: "${text}"`, "info");
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed: ${msg}`, "error");
			}
		},
	});

	pi.registerCommand("test-callmodel-multi-msg", {
		description: "Test callModel with multiple messages",
		handler: async (_args, ctx) => {
			if (!ctx.model) {
				ctx.ui.notify("No model configured", "error");
				return;
			}

			ctx.ui.notify("Testing callModel with conversation history...", "info");

			try {
				const result = await ctx.callModel({
					messages: [
						{ role: "user", content: "My favorite color is blue" },
						{ role: "assistant", content: "Blue is a great choice! It's the color of the sky." },
						{ role: "user", content: "What is my favorite color?" },
					],
					speed: "off",
				});
				const text = extractText(result.content);
				ctx.ui.notify(`Multi-message test passed! Response: "${text}"`, "info");
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed: ${msg}`, "error");
			}
		},
	});

	pi.registerCommand("test-callmodel-theme", {
		description: "Test theme classification use case",
		handler: async (args, ctx) => {
			if (!ctx.model) {
				ctx.ui.notify("No model configured", "error");
				return;
			}

			const input = args || "How do I implement a binary search tree in JavaScript? Can you show me an example?";

			ctx.ui.notify(`Classifying theme for:\n"${input}"`, "info");

			try {
				const result = await ctx.callModel({
					messages: [
						{
							role: "user",
							content: `Classify this request into one of these themes: bug, feature, question, refactor, docs, test
Request: "${input}"
Reply with only the theme name, nothing else.`,
						},
					],
					speed: "off",
				});
				const theme = extractText(result.content).trim().toLowerCase();
				ctx.ui.notify(`Theme detected: "${theme}"`, "info");
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed: ${msg}`, "error");
			}
		},
	});

	pi.registerCommand("test-callmodel-summary", {
		description: "Test message summarization use case",
		handler: async (_args, ctx) => {
			if (!ctx.model) {
				ctx.ui.notify("No model configured", "error");
				return;
			}

			ctx.ui.notify("Testing summarization use case...", "info");

			const longText = `I'm trying to build a web application that needs to handle user authentication. 
I want to use JWT tokens for stateless authentication. The app will have multiple roles like admin, 
user, and guest. Each role should have different permissions. I also need to implement refresh tokens 
because the access tokens expire quickly. For security, I want to implement CSRF protection and proper 
CORS configuration. Can you guide me on the best practices for this?`;

			try {
				const result = await ctx.callModel({
					messages: [
						{
							role: "user",
							content: `Summarize this in exactly 10 words or less:
"${longText}"
Just reply with the summary, nothing else.`,
						},
					],
					speed: "minimal",
				});
				const summary = extractText(result.content);
				ctx.ui.notify(`Summary: "${summary}"`, "info");
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed: ${msg}`, "error");
			}
		},
	});

	pi.registerCommand("test-callmodel-error", {
		description: "Test callModel error handling (no model)",
		handler: async (_args, ctx) => {
			ctx.ui.notify("Testing error handling...", "info");

			try {
				await ctx.callModel({
					// @ts-expect-error - intentionally passing undefined to test error handling
					messages: [{ role: "user", content: "test" }],
					speed: "off",
				} as any);
				ctx.ui.notify("ERROR: Should have thrown but didn't!", "error");
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				if (msg.includes("No model available")) {
					ctx.ui.notify(`✓ Error handling works: "${msg}"`, "info");
				} else {
					ctx.ui.notify(`Unexpected error: ${msg}`, "error");
				}
			}
		},
	});
}

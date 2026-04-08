/**
 * CallModel Test Extension v2 - with debug output
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("test-callmodel-debug", {
		description: "Test callModel with debug output",
		handler: async (_args, ctx) => {
			if (!ctx.model) {
				ctx.ui.notify("No model configured", "error");
				return;
			}

			ctx.ui.notify(`Testing callModel with model: ${ctx.model.name}`, "info");

			try {
				const result1 = await ctx.callModel({
					messages: [{ role: "user", content: "Reply with just the word 'hello'" }],
					speed: "off",
				});

				ctx.ui.notify(
					`Raw result1:\n` +
						`  content type: ${typeof result1.content}\n` +
						`  content isArray: ${Array.isArray(result1.content)}\n` +
						`  content: ${JSON.stringify(result1.content, null, 2)}\n` +
						`  stopReason: ${result1.stopReason}\n` +
						`  errorMessage: ${result1.errorMessage ?? "none"}`,
					"info",
				);

				const text1 = result1.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text" && typeof c.text === "string")
					.map((c) => c.text)
					.join("");

				ctx.ui.notify(`Extracted text: "${text1}"`, "info");

				ctx.ui.notify(
					`callModel test debug completed!\n\n` + `Extracted: "${text1}"\n` + `stopReason: ${result1.stopReason}`,
					"info",
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`callModel test failed: ${message}`, "error");
			}
		},
	});
}

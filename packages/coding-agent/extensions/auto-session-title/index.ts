/**
 * Auto Session Title Extension
 *
 * Automatically generates a short, descriptive title for the session
 * based on the first user message using an LLM call.
 *
 * Behavior:
 * - Triggers on the first turn_end event (turnIndex === 0)
 * - Skips if the session already has a name
 * - Uses pi.callLLM() with the user's first message to generate a title
 * - Cleans LLM output: strips think tags, takes first non-empty line, truncates to 100 chars
 * - On failure: silently ignores (does not block the session)
 *
 * Usage:
 *   pi --extension examples/extensions/auto-session-title.ts
 */

import type { ExtensionAPI, SessionEntry, SessionMessageEntry } from "@dyyz1993/pi-coding-agent";

const TITLE_PROMPT =
	"Generate a very short title (max 50 characters) for a coding conversation that starts with this message. Output ONLY the title, nothing else. No quotes, no punctuation at the end.";

const MAX_TITLE_LENGTH = 100;
const MAX_LLM_TOKENS = 30;

function extractFirstUserText(entries: SessionEntry[]): string {
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = (entry as SessionMessageEntry).message;
		if (msg.role !== "user") continue;
		const content = msg.content;
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			const texts = content
				.filter((c): c is { type: "text"; text: string } => c.type === "text" && typeof c.text === "string")
				.map((c) => c.text)
				.join("\n");
			if (texts) return texts;
		}
	}
	return "";
}

function cleanLLMTitle(raw: string): string {
	const withoutThink = raw.replace(/<think[\s\S]*?<\/think\s*>?/g, "");
	return (
		withoutThink
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean)[0]
			?.slice(0, MAX_TITLE_LENGTH)
			.trim() ?? ""
	);
}

export default function autoSessionTitle(pi: ExtensionAPI) {
	pi.on("turn_end", async (event, ctx) => {
		if (event.turnIndex !== 0) return;

		if (pi.getSessionName()) return;

		const entries = ctx.sessionManager.getEntries();
		const userText = extractFirstUserText(entries);
		if (!userText) return;

		let title = "";
		try {
			title = await pi.callLLM({
				systemPrompt: TITLE_PROMPT,
				messages: [{ role: "user", content: userText }],
				maxTokens: MAX_LLM_TOKENS,
			});
		} catch {
			return;
		}

		const cleaned = cleanLLMTitle(title);
		if (cleaned) {
			pi.setSessionName(cleaned);
		}
	});
}

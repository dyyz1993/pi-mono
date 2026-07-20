/**
 * Real LLM e2e test for session-supervisor completion checking.
 *
 * Uses deepseek-v4-flash via opencode-go provider.
 * Skipped unless OPENCODE_API_KEY is set.
 *
 * Tests the actual callLLM completion check flow that the
 * session-supervisor uses in agent_end.
 */

import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { MODELS } from "../../ai/src/models.generated.ts";
import { complete } from "../../ai/src/stream.ts";
import { COMPLETION_CHECK_SYSTEM_PROMPT } from "../extensions/session-supervisor/prompts.ts";
import { CompletionCheckSchema } from "../extensions/session-supervisor/types.ts";

// Prefer opencode-go/deepseek-v4-flash when OPENCODE_API_KEY is set
// (original test target), but fall back to zai-coding-cn/glm-4.7 when
// only a ZhipuAI key is available so the test still exercises the real
// completion-check flow in environments without opencode access.
const OPENCODE_KEY = process.env.OPENCODE_API_KEY;
const ZAI_KEY = process.env.ZAI_CODING_CN_API_KEY || process.env.ZHIPUAI_API_KEY;
const model = OPENCODE_KEY ? MODELS["opencode-go"]["deepseek-v4-flash"] : MODELS["zai-coding-cn"]["glm-4.7"];
const hasKey = !!(OPENCODE_KEY || ZAI_KEY);

describe.skipIf(!hasKey)("session-supervisor: real LLM completion check", () => {
	it("detects completed task", async () => {
		const conversationSummary = `
[assistant]: I have fixed all 3 lint errors in the codebase. Here is a summary:
- Fixed unused import in auth.ts
- Fixed missing return type in utils.ts
- Fixed implicit any in config.ts

All tests pass. No remaining lint errors.
`;

		const response = await complete(model as any, {
			messages: [
				{
					role: "user" as const,
					content: `${COMPLETION_CHECK_SYSTEM_PROMPT}\n\nRespond with JSON matching this schema:\n${JSON.stringify(CompletionCheckSchema, null, 2)}\n\nCheck the following conversation:\n${conversationSummary}`,
					timestamp: Date.now(),
				},
			],
		});

		expect(response.content).toBeTruthy();
		const raw = Array.isArray(response.content)
			? (response.content as Array<{ type: string; text?: string }>)
					.filter((p) => p.type === "text")
					.map((p) => p.text ?? "")
					.join("\n")
			: String(response.content);
		const cleaned = raw
			.replace(/^```(?:json)?\s*\n?/m, "")
			.replace(/\n?```\s*$/m, "")
			.trim();
		const parsed = JSON.parse(cleaned);
		expect(parsed.completed).toBe(true);
		expect(parsed.confidence).toBeGreaterThanOrEqual(0.5);
	}, 60000);

	it("detects incomplete task", async () => {
		const conversationSummary = `
[assistant]: I have fixed 2 out of 5 lint errors. I still have TODO items to handle in auth.ts and config.ts. The remaining 3 errors are related to type safety.
`;

		const response = await complete(model as any, {
			messages: [
				{
					role: "user" as const,
					content: `${COMPLETION_CHECK_SYSTEM_PROMPT}\n\nRespond with JSON matching this schema:\n${JSON.stringify(CompletionCheckSchema, null, 2)}\n\nCheck the following conversation:\n${conversationSummary}`,
					timestamp: Date.now(),
				},
			],
		});

		expect(response.content).toBeTruthy();
		const raw = Array.isArray(response.content)
			? (response.content as Array<{ type: string; text?: string }>)
					.filter((p) => p.type === "text")
					.map((p) => p.text ?? "")
					.join("\n")
			: String(response.content);
		const cleaned = raw
			.replace(/^```(?:json)?\s*\n?/m, "")
			.replace(/\n?```\s*$/m, "")
			.trim();
		const parsed = JSON.parse(cleaned);
		expect(parsed.completed).toBe(false);
		expect(parsed.incompleteTasks.length).toBeGreaterThan(0);
	}, 60000);

	it("returns valid schema from completion check", async () => {
		const conversationSummary = `
[assistant]: Task done. All files updated.
`;

		const response = await complete(model as any, {
			messages: [
				{
					role: "user" as const,
					content: `${COMPLETION_CHECK_SYSTEM_PROMPT}\n\nRespond with JSON matching this schema:\n${JSON.stringify(CompletionCheckSchema, null, 2)}\n\nCheck the following conversation:\n${conversationSummary}`,
					timestamp: Date.now(),
				},
			],
		});

		expect(response.content).toBeTruthy();
		const raw = Array.isArray(response.content)
			? (response.content as Array<{ type: string; text?: string }>)
					.filter((p) => p.type === "text")
					.map((p) => p.text ?? "")
					.join("\n")
			: String(response.content);
		const cleaned = raw
			.replace(/^```(?:json)?\s*\n?/m, "")
			.replace(/\n?```\s*$/m, "")
			.trim();
		const parsed = JSON.parse(cleaned);
		const coerced = Value.Convert(CompletionCheckSchema, parsed);
		expect(Value.Check(CompletionCheckSchema, coerced)).toBe(true);
	}, 60000);
});

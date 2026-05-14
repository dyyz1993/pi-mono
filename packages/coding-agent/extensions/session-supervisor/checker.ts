import type { ExtensionAPI } from "@dyyz1993/pi-coding-agent";
import type {
    SupervisorConfig,
    CheckResult,
} from "./types.js";
import { CompletionCheckSchema } from "./types.js";
import { COMPLETION_CHECK_SYSTEM_PROMPT } from "./prompts.js";
import type { TSchema } from "@sinclair/typebox";
import { Value } from "typebox/value";

export async function checkWithSmallModel(
    messages: Array<{ role: string; content: unknown }>,
    config: SupervisorConfig,
    callLLM: ExtensionAPI["callLLM"],
    signal?: AbortSignal,
): Promise<CheckResult> {
    const recentMessages = messages.slice(-10);
    const conversationSummary = recentMessages
        .map((m) => {
            const content =
                typeof m.content === "string"
                    ? m.content
                    : JSON.stringify(m.content);
            return `[${m.role}]: ${content.slice(0, 500)}`;
        })
        .join("\n\n");

    try {
        const response = await callLLMStructured<{
            completed: boolean;
            confidence: number;
            incompleteTasks: CheckResult["incompleteTasks"];
            reasoning: string;
        }>(
            callLLM,
            {
                systemPrompt: COMPLETION_CHECK_SYSTEM_PROMPT,
                messages: [{ role: "user" as const, content: conversationSummary }],
                model: config.smallModel,
                maxTokens: 1024,
                signal,
            },
            CompletionCheckSchema,
        );

        return {
            completed: response.completed,
            confidence: response.confidence,
            incompleteTasks: response.incompleteTasks,
            modelResponse: response.reasoning,
        };
    } catch (err) {
        return {
            completed: true,
            confidence: 0.5,
            incompleteTasks: [],
            modelResponse: `Check failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

async function callLLMStructured<T>(
    callLLM: ExtensionAPI["callLLM"],
    options: {
        systemPrompt: string;
        messages: Array<{ role: "user" | "assistant"; content: string }>;
        model?: string;
        maxTokens?: number;
        signal?: AbortSignal;
    },
    schema: TSchema,
): Promise<T> {
    const schemaStr = JSON.stringify(schema, null, 2);
    const systemWithSchema = `${options.systemPrompt}\n\nRespond with JSON matching this schema:\n${schemaStr}`;

    const maxRetries = 3;
    const messages = [...options.messages];

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const raw = await callLLM({
            ...options,
            systemPrompt: systemWithSchema,
            messages,
        });

        try {
            const jsonStr = raw
                .replace(/^```(?:json)?\s*\n?/m, "")
                .replace(/\n?```\s*$/m, "")
                .trim();
            const parsed = JSON.parse(jsonStr);
            const coerced = Value.Convert(schema, parsed);

            if (Value.Check(schema, coerced)) {
                return coerced as T;
            }

            const errors = [...Value.Errors(schema, coerced)]
                .map((e) => `${String(e)}: ${e.message}`)
                .join("; ");
            messages.push({ role: "assistant", content: raw });
            messages.push({
                role: "user",
                content: `JSON schema validation failed: ${errors}. Please fix and return valid JSON.`,
            });
        } catch (parseErr) {
            messages.push({ role: "assistant", content: raw });
            messages.push({
                role: "user",
                content: `Failed to parse JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}. Please return valid JSON only.`,
            });
        }
    }

    throw new Error("Failed to get structured response after max retries");
}

import type { ExtensionAPI } from "@dyyz1993/pi-coding-agent";
import type {
    SupervisorConfig,
    CheckResult,
} from "./types.ts";
import { CompletionCheckSchema } from "./types.ts";
import { COMPLETION_CHECK_SYSTEM_PROMPT } from "./prompts.ts";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { appendForensic, forensicTs } from "./forensic.ts";

function truncateText(value: string, max = 4000): string {
    return value.length > max ? `${value.slice(0, max)}…[truncated ${value.length - max} chars]` : value;
}

function summarizeMessages(messages: Array<{ role: string; content: unknown }>): Array<{ role: string; content: string }> {
    return messages.map((message) => {
        const content = typeof message.content === "string"
            ? message.content
            : JSON.stringify(message.content);
        return {
            role: message.role,
            content: truncateText(content ?? "", 4000),
        };
    });
}

export async function checkWithSmallModel(
    messages: Array<{ role: string; content: unknown }>,
    config: SupervisorConfig,
    callLLM: ExtensionAPI["callLLM"],
    signal?: AbortSignal,
): Promise<CheckResult> {
    const recentMessages = messages.slice(-10);
    const checkStartedAt = Date.now();
    const conversationSummary = recentMessages
        .map((m) => {
            const content =
                typeof m.content === "string"
                    ? m.content
                    : JSON.stringify(m.content);
            return `[${m.role}]: ${content.slice(0, 500)}`;
        })
        .join("\n\n");

    appendForensic({
        ts: forensicTs(),
        type: "model_check_start",
        messagesCount: messages.length,
        messagesTruncated: messages.length > recentMessages.length,
        smallModel: config.smallModel,
    });
    appendForensic({
        ts: forensicTs(),
        type: "model_check_raw_input",
        messages: summarizeMessages([{ role: "user", content: conversationSummary }]),
        systemPromptLength: COMPLETION_CHECK_SYSTEM_PROMPT.length,
    });

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

        appendForensic({
            ts: forensicTs(),
            type: "model_check_parsed",
            completed: response.completed,
            confidence: response.confidence,
            incompleteTasks: response.incompleteTasks,
            reasoningLength: response.reasoning.length,
        });

        return {
            completed: response.completed,
            confidence: response.confidence,
            incompleteTasks: response.incompleteTasks,
            modelResponse: response.reasoning,
        };
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        appendForensic({
            ts: forensicTs(),
            type: "model_check_error",
            error,
            durationMs: Date.now() - checkStartedAt,
        });
        appendForensic({
            ts: forensicTs(),
            type: "model_check_fallback",
            reason: "Small model check failed; preserving existing fail-open behavior.",
        });
        return {
            completed: true,
            confidence: 0.5,
            incompleteTasks: [],
            modelResponse: `Check failed: ${error}`,
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
        const attemptStartedAt = Date.now();
        const raw = await callLLM({
            ...options,
            systemPrompt: systemWithSchema,
            messages,
        });
        appendForensic({
            ts: forensicTs(),
            type: "model_check_raw_response",
            raw: truncateText(raw, 8000),
            retryCount: attempt,
            durationMs: Date.now() - attemptStartedAt,
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

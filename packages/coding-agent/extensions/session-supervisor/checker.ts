import type { ExtensionAPI } from "@dyyz1993/pi-coding-agent";
import type {
    SupervisorConfig,
    CheckResult,
    TaskReport,
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
        const response = await callLLMStructured(
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
                .map((e) => `${e.path}: ${e.message}`)
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

import { appendFileSync } from "node:fs";

function log(msg: string) {
    const ts = new Date().toISOString();
    appendFileSync("/tmp/supervisor-debug.log", `[${ts}] [checker] ${msg}\n`);
}

export async function checkTaskRules(
    config: SupervisorConfig,
    callLLM: ExtensionAPI["callLLM"],
    lastAssistantText: string,
    signal?: AbortSignal,
): Promise<TaskReport[]> {
    const reports: TaskReport[] = [];

    log(`checkTaskRules called with ${config.taskRules?.length ?? 0} rules, lastText length=${lastAssistantText.length}`);

    for (const rule of config.taskRules) {
        const report: TaskReport = {
            ruleName: rule.name,
            checkMethod: rule.checkMethod,
            status: "unknown",
        };

        try {
            switch (rule.checkMethod) {
                case "keyword": {
                    const keywords = rule.keywords ?? [];
                    log(`keyword check: keywords=${JSON.stringify(keywords)}`);
                    const found = keywords.filter((kw) =>
                        lastAssistantText.toLowerCase().includes(kw.toLowerCase()),
                    );
                    log(`keyword check: found=${JSON.stringify(found)}`);
                    report.status = found.length > 0 ? "incomplete" : "completed";
                    report.details =
                        found.length > 0
                            ? `Found incomplete keywords: ${found.join(", ")}`
                            : "No incomplete keywords found";
                    break;
                }
                case "model": {
                    const result = await callLLM({
                        systemPrompt: `You are checking if a specific task is complete. Task: ${rule.description ?? rule.name}. Answer only "complete" or "incomplete" followed by a brief reason.`,
                        messages: [
                            {
                                role: "user",
                                content: `Last assistant message:\n${lastAssistantText.slice(0, 1000)}`,
                            },
                        ],
                        model: config.smallModel,
                        maxTokens: 256,
                        signal,
                    });
                    const isComplete =
                        result.toLowerCase().startsWith("complete") &&
                        !result.toLowerCase().includes("incomplete");
                    report.status = isComplete ? "completed" : "incomplete";
                    report.details = result;
                    break;
                }
                case "channel": {
                    report.status = "unknown";
                    report.details = "Channel check must be done at extension level";
                    break;
                }
            }
        } catch (err) {
            report.status = "error";
            report.error = err instanceof Error ? err.message : String(err);
        }

        reports.push(report);
    }

    return reports;
}

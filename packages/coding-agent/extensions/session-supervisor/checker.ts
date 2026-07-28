import type { ExtensionAPI } from "@dyyz1993/pi-coding-agent";
import type {
    SupervisorConfig,
    CheckResult,
    GoalState,
} from "./types.ts";
import { CompletionCheckSchema, GoalProgressSchema } from "./types.ts";
import type { GoalProgressResult } from "./types.ts";
import { INTENT_CHECK_SYSTEM_PROMPT, GOAL_PROGRESS_REASSESSMENT_PROMPT } from "./prompts.ts";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { appendForensic, forensicTs } from "./forensic.ts";

interface FileDiffSummary {
    path: string;
    status: "added" | "modified" | "deleted";
    unifiedDiff: string;
}

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
    goal?: GoalState,
    fileDiffs?: FileDiffSummary[],
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

    // 意图对照检查：如果有 goal，用新 prompt 把目标/checklist/diff 喂给模型
    const hasGoalContext = Boolean(goal && goal.objective.trim());
    const systemPrompt = hasGoalContext ? INTENT_CHECK_SYSTEM_PROMPT : INTENT_CHECK_SYSTEM_PROMPT;
    const userContent = hasGoalContext
        ? buildIntentCheckUserContent(goal!, fileDiffs ?? [], conversationSummary)
        : conversationSummary;

    appendForensic({
        ts: forensicTs(),
        type: "model_check_start",
        messagesCount: messages.length,
        messagesTruncated: messages.length > recentMessages.length,
        smallModel: config.smallModel,
        hasGoalContext,
        fileDiffsCount: fileDiffs?.length ?? 0,
    });
    appendForensic({
        ts: forensicTs(),
        type: "model_check_raw_input",
        messages: summarizeMessages([{ role: "user", content: userContent }]),
        systemPromptLength: systemPrompt.length,
    });

    try {
        const response = await callLLMStructured<{
            completed: boolean;
            confidence: number;
            incompleteTasks: CheckResult["incompleteTasks"];
            findings: Array<{
                dimension: string;
                description: string;
                severity: "high" | "medium" | "low";
            }>;
            adjustmentSuggestion: string;
            reasoning: string;
        }>(
            callLLM,
            {
                systemPrompt,
                messages: [{ role: "user" as const, content: userContent }],
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
            findingsCount: response.findings?.length ?? 0,
            hasAdjustmentSuggestion: Boolean(response.adjustmentSuggestion),
            reasoningLength: response.reasoning.length,
        });

        return {
            completed: response.completed,
            confidence: response.confidence,
            incompleteTasks: response.incompleteTasks,
            modelResponse: response.reasoning,
            findings: response.findings as CheckResult["findings"],
            adjustmentSuggestion: response.adjustmentSuggestion || undefined,
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
            reason: "Small model check failed; fail-closed: never mark goal complete when checker itself errors.",
        });
        return {
            completed: false,
            confidence: 0,
            incompleteTasks: [],
            modelResponse: `Check failed (goal NOT marked complete): ${error}`,
        };
    }
}

function buildIntentCheckUserContent(
    goal: GoalState,
    fileDiffs: FileDiffSummary[],
    conversationSummary: string,
): string {
    const checklistSection = goal.checklist && goal.checklist.length > 0
        ? goal.checklist
            .map((item) => `[${item.status}] ${item.text}${item.evidence ? ` → ${item.evidence}` : ""}`)
            .join("\n")
        : "(no checklist items)";

    const diffSection = fileDiffs.length > 0
        ? fileDiffs
            .map((d) => `--- ${d.path} (${d.status}) ---\n${truncateText(d.unifiedDiff, 2000)}`)
            .join("\n\n")
        : "(no file changes this turn)";

    return `## User Goal
${goal.objective}

## Checklist Progress
${checklistSection}

## File Changes This Turn
${diffSection}

## Recent Conversation
${conversationSummary}`;
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


// ============================================================================
// Goal Progress Reassessment (new goal-driven loop)
// ============================================================================

export interface ReassessmentContext {
    goal: GoalState;
    fileDiffs: FileDiffSummary[];
    conversationSummary: string;
    continueCount: number;
    previousActionPlans: string[];
}

function buildReassessmentUserContent(ctx: ReassessmentContext): string {
    const goal = ctx.goal;

    const checklistSection = goal.checklist && goal.checklist.length > 0
        ? goal.checklist.map((item, i) =>
            `[${i}] [${item.status}] ${item.text}${item.evidence ? ` → ${item.evidence}` : ""}`
          ).join("\n")
        : "(no checklist items)";

    const diffSection = ctx.fileDiffs.length > 0
        ? ctx.fileDiffs
            .map((d) => `--- ${d.path} (${d.status}) ---\n${truncateText(d.unifiedDiff, 2000)}`)
            .join("\n\n")
        : "(no file changes this turn)";

    const previousPlansSection = ctx.previousActionPlans.length > 0
        ? ctx.previousActionPlans
            .map((plan, i) => `[${i + 1}] ${truncateText(plan, 300)}`)
            .join("\n")
        : "(no previous action plans)";

    return `## User Goal
${goal.objective}

## Checklist Progress
${checklistSection}

## File Changes This Turn
${diffSection}

## Recent Conversation
${ctx.conversationSummary}

## Execution History
- Continue count: ${ctx.continueCount}

## Previous Action Plans (avoid repeating these)
${previousPlansSection}`;
}

export async function reassessGoalProgress(
    ctx: ReassessmentContext,
    config: SupervisorConfig,
    callLLM: ExtensionAPI["callLLM"],
    signal?: AbortSignal,
): Promise<GoalProgressResult> {
    const checkStartedAt = Date.now();
    const systemPrompt = GOAL_PROGRESS_REASSESSMENT_PROMPT;
    const userContent = buildReassessmentUserContent(ctx);

    appendForensic({
        ts: forensicTs(),
        type: "goal_reassessment_start",
        continueCount: ctx.continueCount,
        previousPlansCount: ctx.previousActionPlans.length,
        fileDiffsCount: ctx.fileDiffs.length,
        smallModel: config.smallModel,
    });

    try {
        const response = await callLLMStructured<GoalProgressResult>(
            callLLM,
            {
                systemPrompt,
                messages: [{ role: "user" as const, content: userContent }],
                model: config.smallModel,
                maxTokens: 2048,
                signal,
            },
            GoalProgressSchema,
        );

        appendForensic({
            ts: forensicTs(),
            type: "goal_reassessment_parsed",
            overallProgress: response.overallProgress,
            isComplete: response.isComplete,
            confidence: response.confidence,
            completedCount: response.completedItems.length,
            remainingCount: response.remainingItems.length,
            newDiscoveriesCount: response.newDiscoveries.length,
            checklistUpdatesCount: response.checklistUpdates.length,
            newChecklistItemsCount: response.newChecklistItems.length,
            nextActionPlanLength: response.nextActionPlan.length,
            durationMs: Date.now() - checkStartedAt,
        });

        return response;
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        appendForensic({
            ts: forensicTs(),
            type: "goal_reassessment_error",
            error,
            durationMs: Date.now() - checkStartedAt,
        });

        // Fail-closed: return a conservative result that continues but doesn't complete
        return {
            overallProgress: 0,
            completedItems: [],
            remainingItems: ["Reassessment failed, agent should continue working"],
            newDiscoveries: [],
            checklistUpdates: [],
            newChecklistItems: [],
            nextActionPlan: "Continue working on the current task. Previous assessment failed, but the goal is not yet complete.",
            isComplete: false,
            confidence: 0,
            reasoning: `Reassessment failed: ${error}`,
        };
    }
}
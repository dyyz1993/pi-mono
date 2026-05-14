import type { ChannelContract } from "@dyyz1993/pi-coding-agent";
import { Type, type Static } from "@sinclair/typebox";

export const SupervisorConfigSchema = Type.Object({
    enable: Type.Boolean({ default: true }),
    checkOnAgentEnd: Type.Boolean({ default: true }),
    smallModel: Type.String({ default: "fast" }),
    maxContinueCount: Type.Integer({ default: 5 }),
    defaultDelayMs: Type.Integer({ default: 30_000 }),
    pauseThresholdMs: Type.Integer({ default: 300_000 }),
    taskRules: Type.Array(
        Type.Object({
            name: Type.String(),
            checkMethod: Type.Union([
                Type.Literal("channel"),
                Type.Literal("model"),
                Type.Literal("keyword"),
            ]),
            channelName: Type.Optional(Type.String()),
            channelMethod: Type.Optional(Type.String()),
            keywords: Type.Optional(Type.Array(Type.String())),
            description: Type.Optional(Type.String()),
        }),
        { default: [] },
    ),
});

export type SupervisorConfig = Static<typeof SupervisorConfigSchema>;

export interface SupervisorChannelContract extends ChannelContract {
    methods: {
        "supervisor.getStatus": {
            params: Record<string, never>;
            return: SupervisorStatus;
        };
        "supervisor.requestPause": {
            params: { delayMs?: number; reason?: string };
            return: { scheduled: boolean; scheduledAt?: number };
        };
        "supervisor.cancelPause": {
            params: Record<string, never>;
            return: { cancelled: boolean };
        };
        "supervisor.forceContinue": {
            params: { reason?: string };
            return: { triggered: boolean };
        };
        "supervisor.disable": {
            params: Record<string, never>;
            return: { disabled: boolean };
        };
        "supervisor.enable": {
            params: Record<string, never>;
            return: { enabled: boolean };
        };
        "supervisor.getTaskReport": {
            params: Record<string, never>;
            return: { tasks: TaskReport[] };
        };
        "supervisor.checkToolStatus": {
            params: { toolName: string; channelName?: string; method?: string };
            return: { reachable: boolean; status?: string; error?: string };
        };
    };
    events: {
        "supervisor.statusChanged": SupervisorStatus;
        "supervisor.pauseRequested": { delayMs: number; reason?: string };
        "supervisor.pauseCancelled": { reason: string };
        "supervisor.continueTriggered": { reason: string; delayMs: number };
        "supervisor.taskReport": { tasks: TaskReport[] };
    };
}

export interface SupervisorStatus {
    enabled: boolean;
    state: "idle" | "checking" | "paused" | "continuing" | "disabled";
    continueCount: number;
    maxContinueCount: number;
    lastCheckResult?: CheckResult;
    pendingPause?: { scheduledAt: number; delayMs: number; reason?: string };
}

export interface CheckResult {
    completed: boolean;
    confidence: number;
    incompleteTasks: IncompleteTask[];
    modelResponse?: string;
}

export interface IncompleteTask {
    ruleName: string;
    description: string;
    severity: "high" | "medium" | "low";
}

export interface TaskReport {
    ruleName: string;
    checkMethod: string;
    status: "completed" | "incomplete" | "unknown" | "error";
    details?: string;
    error?: string;
}

export const CompletionCheckSchema = Type.Object({
    completed: Type.Boolean({ description: "会话是否已经真正完成" }),
    confidence: Type.Number({ description: "置信度 0-1", minimum: 0, maximum: 1 }),
    incompleteTasks: Type.Array(
        Type.Object({
            ruleName: Type.String(),
            description: Type.String(),
            severity: Type.Union([
                Type.Literal("high"),
                Type.Literal("medium"),
                Type.Literal("low"),
            ]),
        }),
    ),
    reasoning: Type.String({ description: "判断理由" }),
});

export type CompletionCheckResult = Static<typeof CompletionCheckSchema>;

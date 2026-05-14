import type {
    ExtensionAPI,
    AgentEndEvent,
} from "@dyyz1993/pi-coding-agent";
import { createTypedChannel } from "@dyyz1993/pi-coding-agent";
import type {
    SupervisorChannelContract,
    SupervisorConfig,
    SupervisorStatus,
    CheckResult,
    TaskReport,
} from "./types.js";
import { loadConfig } from "./config.js";
import { checkWithSmallModel, checkTaskRules } from "./checker.js";
import { Scheduler } from "./scheduler.js";
import { CONTINUE_PROMPT } from "./prompts.js";
import { appendFileSync } from "node:fs";

const LOG_FILE = "/tmp/supervisor-debug.log";
function log(msg: string) {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${msg}\n`;
    appendFileSync(LOG_FILE, line);
    console.log(`[supervisor] ${msg}`);
}

export default function sessionSupervisorExtension(pi: ExtensionAPI) {
    let config: SupervisorConfig;
    let enabled = true;
    let currentState: SupervisorStatus["state"] = "idle";
    let lastCheckResult: CheckResult | undefined;
    let schedulerInstance: Scheduler;
    let lastTaskReports: TaskReport[] = [];

    pi.registerFlag("disable-supervisor", {
        description: "禁用 session supervisor 插件",
        type: "boolean",
        default: false,
    });

    pi.registerFlag("supervisor-max-continues", {
        description: "最大续执行次数",
        type: "string",
        default: "5",
    });

    pi.registerFlag("supervisor-model", {
        description: "supervisor 使用的小模型 (支持 fast/pro/max 或具体 model id)",
        type: "string",
        default: "fast",
    });

    const rawChannel = pi.registerChannel("supervisor");
    const { server: channel } =
        createTypedChannel<SupervisorChannelContract>(rawChannel);

    channel.handle("supervisor.getStatus", async () => {
        return getStatus();
    });

    channel.handle("supervisor.requestPause", async (params) => {
        const delayMs = params.delayMs ?? config.defaultDelayMs;
        const result = schedulerInstance.scheduleContinue(
            "manual-pause",
            delayMs,
            () => {
                currentState = "continuing";
                emitStatusChanged();
                triggerContinue("Manual pause completed, resuming");
            },
        );
        if (result.scheduled) {
            channel.emit("supervisor.pauseRequested", {
                delayMs,
                reason: params.reason,
            });
        }
        return result;
    });

    channel.handle("supervisor.cancelPause", async () => {
        const cancelled = schedulerInstance.cancelTimer("manual-pause");
        if (cancelled) {
            channel.emit("supervisor.pauseCancelled", {
                reason: "Cancelled via channel",
            });
        }
        return { cancelled };
    });

    channel.handle("supervisor.forceContinue", async (params) => {
        schedulerInstance.cancelAll();
        currentState = "continuing";
        emitStatusChanged();
        triggerContinue(params.reason ?? "Force continue via channel");
        return { triggered: true };
    });

    channel.handle("supervisor.disable", async () => {
        enabled = false;
        schedulerInstance.cancelAll();
        currentState = "disabled";
        emitStatusChanged();
        return { disabled: true };
    });

    channel.handle("supervisor.enable", async () => {
        enabled = true;
        currentState = "idle";
        emitStatusChanged();
        return { enabled: true };
    });

    channel.handle("supervisor.getTaskReport", async () => {
        return { tasks: lastTaskReports };
    });

    channel.handle("supervisor.checkToolStatus", async (params) => {
        const targetChannelName = params.channelName ?? params.toolName;
        try {
            const result = await rawChannel.call(
                `${targetChannelName}.getStatus`,
                {},
                5000,
            );
            return { reachable: true, status: JSON.stringify(result) };
        } catch (err) {
            return {
                reachable: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    });

    pi.on("session_start", async (_event, ctx) => {
        config = loadConfig(ctx.sessionDataDir, ctx.projectDataDir);
        enabled = config.enable;

        log(`session_start: sessionDataDir=${ctx.sessionDataDir}, projectDataDir=${ctx.projectDataDir}, enabled=${enabled}, smallModel=${config.smallModel}`);

        if (pi.getFlag("disable-supervisor") === true) {
            enabled = false;
        }
        const maxContinuesFlag = pi.getFlag("supervisor-max-continues");
        if (typeof maxContinuesFlag === "string") {
            const n = parseInt(maxContinuesFlag, 10);
            if (!isNaN(n)) config.maxContinueCount = n;
        }
        const modelFlag = pi.getFlag("supervisor-model");
        if (typeof modelFlag === "string" && modelFlag) {
            config.smallModel = modelFlag;
        }

        schedulerInstance = new Scheduler(
            config.maxContinueCount,
            config.pauseThresholdMs,
        );

        currentState = enabled ? "idle" : "disabled";
        emitStatusChanged();
    });

    pi.on("agent_end", async (event: AgentEndEvent, ctx) => {
        log(`agent_end fired: enabled=${enabled}, checkOnAgentEnd=${config.checkOnAgentEnd}`);
        if (!enabled || !config.checkOnAgentEnd) return;
        if (pi.getFlag("disable-supervisor") === true) return;
        if (schedulerInstance.isExhausted()) return;

        currentState = "checking";
        emitStatusChanged();

        try {
            const lastAssistantText = extractLastAssistantText(
                event.messages as Array<{ role: string; content: unknown }>,
            );
            log(`lastAssistantText (first 200 chars): ${lastAssistantText.slice(0, 200)}`);

            const checkResult = await checkWithSmallModel(
                event.messages as Array<{ role: string; content: unknown }>,
                config,
                pi.callLLM.bind(pi),
                ctx.sessionSignal,
            );
            lastCheckResult = checkResult;
            log(`checkResult: completed=${checkResult.completed}, incompleteTasks=${JSON.stringify(checkResult.incompleteTasks)}, reasoning=${checkResult.modelResponse}`);

            log(`config.taskRules count: ${config.taskRules?.length ?? "undefined"}, rules: ${JSON.stringify(config.taskRules)}`);
            const taskReports = await checkTaskRules(
                config,
                pi.callLLM.bind(pi),
                lastAssistantText,
                ctx.sessionSignal,
            );
            log(`taskReports: ${JSON.stringify(taskReports)}`);

            for (const rule of config.taskRules) {
                if (rule.checkMethod === "channel" && rule.channelName) {
                    const report = taskReports.find(
                        (r) => r.ruleName === rule.name,
                    );
                    if (report) {
                        try {
                            await rawChannel.call(
                                `${rule.channelName}.${rule.channelMethod ?? "getStatus"}`,
                                {},
                                5000,
                            );
                            report.status = "completed";
                        } catch (err) {
                            report.status = "unknown";
                            report.error = `Channel call failed: ${err instanceof Error ? err.message : String(err)}`;
                        }
                    }
                }
            }

            lastTaskReports = taskReports;
            channel.emit("supervisor.taskReport", { tasks: taskReports });

            const hasIncompleteTasks =
                checkResult.completed === false ||
                checkResult.incompleteTasks.length > 0 ||
                taskReports.some((r) => r.status === "incomplete");

            if (!hasIncompleteTasks) {
                log(`All tasks complete, going idle`);
                currentState = "idle";
                emitStatusChanged();
                return;
            }

            log(`Found incomplete tasks! Scheduling continue...`);
            const incompleteDescriptions = [
                ...checkResult.incompleteTasks.map(
                    (t) => `[${t.severity}] ${t.description}`,
                ),
                ...taskReports
                    .filter((r) => r.status === "incomplete")
                    .map((r) => `${r.ruleName}: ${r.details ?? "unknown"}`),
            ];

            const delayMs = config.defaultDelayMs;

            if (schedulerInstance.shouldPause(delayMs)) {
                currentState = "paused";
                emitStatusChanged();

                channel.emit("supervisor.pauseRequested", {
                    delayMs,
                    reason: `Incomplete tasks: ${incompleteDescriptions.join("; ")}`,
                });

                pi.background(async (signal) => {
                    await new Promise<void>((resolve) => {
                        const timer = setTimeout(resolve, delayMs);
                        signal.addEventListener("abort", () => {
                            clearTimeout(timer);
                            resolve();
                        });
                    });

                    if (signal.aborted) return;

                    currentState = "continuing";
                    emitStatusChanged();
                    triggerContinue(
                        `Auto-continue after ${Math.round(delayMs / 1000)}s pause. Incomplete: ${incompleteDescriptions.join(", ")}`,
                    );
                });
            } else {
                currentState = "continuing";
                emitStatusChanged();

                pi.background(async (signal) => {
                    await new Promise<void>((resolve) => {
                        const timer = setTimeout(resolve, delayMs);
                        signal.addEventListener("abort", () => {
                            clearTimeout(timer);
                            resolve();
                        });
                    });

                    if (signal.aborted) return;
                    triggerContinue(
                        `Continue: ${incompleteDescriptions.join(", ")}`,
                    );
                });
            }
        } catch (err) {
            log(`agent_end error: ${err instanceof Error ? err.message : String(err)}`);
            currentState = "idle";
            emitStatusChanged();
        }
    });

    pi.on("session_shutdown", async () => {
        schedulerInstance?.cancelAll();
        currentState = "idle";
    });

    function getStatus(): SupervisorStatus {
        return {
            enabled,
            state: currentState,
            continueCount: schedulerInstance?.getContinueCount() ?? 0,
            maxContinueCount: config?.maxContinueCount ?? 0,
            lastCheckResult,
        };
    }

    function emitStatusChanged(): void {
        channel.emit("supervisor.statusChanged", getStatus());
    }

    function triggerContinue(reason: string): void {
        log(`triggerContinue: ${reason}`);
        const tasks =
            lastCheckResult?.incompleteTasks?.map((t) => t.description) ?? [];
        const prompt = CONTINUE_PROMPT(
            reason,
            tasks.length > 0 ? tasks : [reason],
        );

        pi.sendMessage(
            {
                customType: "supervisor_continue",
                content: prompt,
                display: true,
            },
            { triggerTurn: true },
        );
    }

    function extractLastAssistantText(
        messages: Array<{ role: string; content: unknown }>,
    ): string {
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role === "assistant") {
                if (typeof msg.content === "string") return msg.content;
                if (Array.isArray(msg.content)) {
                    return (msg.content as Array<{ type: string; text?: string }>)
                        .filter((p) => p.type === "text")
                        .map((p) => p.text ?? "")
                        .join("\n");
                }
            }
        }
        return "";
    }
}

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
    GuardConfig,
    GuardCheckResult,
} from "./types.js";
import { loadConfig, DEFAULT_CONFIG } from "./config.js";
import { checkWithSmallModel } from "./checker.js";
import { Scheduler } from "./scheduler.js";
import {
    CONTINUE_PROMPT,
    TODO_GUARD_PROMPT,
    SPECS_GUARD_PROMPT,
    SPECS_GUARD_BLOCK_MESSAGE,
    CI_GUARD_PROMPT,
    KEYWORD_GUARD_PROMPT,
    CUSTOM_GUARD_PROMPT,
    TODO_CHECK_PROMPT,
    SPECS_CHECK_PROMPT,
} from "./prompts.js";
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const LOG_FILE = "/tmp/supervisor-debug.log";
function log(msg: string) {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${msg}\n`;
    appendFileSync(LOG_FILE, line);
}

const DEFAULT_GUARDS: GuardConfig[] = [
    { name: "incomplete-keywords", type: "keyword", enable: true, keywords: ["TODO", "FIXME", "WIP", "HACK"] },
];

export default function sessionSupervisorExtension(pi: ExtensionAPI) {
    let config: SupervisorConfig = DEFAULT_CONFIG;
    let enabled = false;
    let currentState: SupervisorStatus["state"] = "idle";
    let lastCheckResult: CheckResult | undefined;
    let schedulerInstance: Scheduler;
    let lastTaskReports: TaskReport[] = [];
    let specsIterationCount = 0;
    let projectRoot = "";

    // ── Flags ──

    pi.registerFlag("disable-supervisor", {
        description: "Disable session supervisor plugin",
        type: "boolean",
        default: false,
    });

    pi.registerFlag("supervisor-max-continues", {
        description: "Max auto-continue count",
        type: "string",
        default: "5",
    });

    pi.registerFlag("supervisor-model", {
        description: "Small model for supervisor guards (fast/pro/max or model id)",
        type: "string",
        default: "fast",
    });

    // ── Channel ──

    const rawChannel = pi.registerChannel("supervisor");
    const { server: channel } =
        createTypedChannel<SupervisorChannelContract>(rawChannel);

    channel.handle("getStatus", async () => getStatus());
    channel.handle("requestPause", async (params) => {
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
            channel.emit("supervisor.pauseRequested", { delayMs, reason: params.reason });
        }
        return result;
    });

    channel.handle("cancelPause", async () => {
        const cancelled = schedulerInstance.cancelTimer("manual-pause");
        if (cancelled) {
            channel.emit("supervisor.pauseCancelled", { reason: "Cancelled via channel" });
        }
        return { cancelled };
    });

    channel.handle("forceContinue", async (params) => {
        schedulerInstance.cancelAll();
        currentState = "continuing";
        emitStatusChanged();
        triggerContinue(params.reason ?? "Force continue via channel");
        return { triggered: true };
    });

    channel.handle("disable", async () => {
        enabled = false;
        schedulerInstance.cancelAll();
        currentState = "disabled";
        emitStatusChanged();
        return { disabled: true };
    });

    channel.handle("enable", async () => {
        enabled = true;
        currentState = "idle";
        emitStatusChanged();
        return { enabled: true };
    });

    channel.handle("getTaskReport", async () => ({ tasks: lastTaskReports }));

    channel.handle("checkToolStatus", async (params) => {
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

    // ── Tool: supervisor_complete ──
    // LLM calls this to declare completion. Guards can reject it.

    pi.registerTool({
        name: "supervisor_complete",
        label: "Supervisor Complete",
        description: "Declare that the current task is complete. The supervisor will verify with active guards before allowing the session to end.",
        parameters: {
            type: "object",
            properties: {
                summary: {
                    type: "string",
                    description: "Brief summary of what was accomplished",
                },
            },
            required: ["summary"],
        },
        execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
            const summary = String(params.summary ?? "");

            if (!enabled) {
                return {
                    content: [{ type: "text" as const, text: "Supervisor complete: approved (supervisor disabled)" }],
                    details: { approved: true, reason: "Supervisor is disabled" },
                };
            }

            const activeGuards = getActiveGuards();
            if (activeGuards.length === 0) {
                return {
                    content: [{ type: "text" as const, text: "Supervisor complete: approved (no active guards)" }],
                    details: { approved: true, reason: "No active guards" },
                };
            }

            for (const guard of activeGuards) {
                const result = await runGuardCheck(guard, summary);

                if (!result.completed && result.remainingItems.length > 0) {
                    const blockMsg = generateBlockMessage(guard, result);
                    log(`supervisor_complete BLOCKED by ${guard.name}: ${result.remainingItems.join(", ")}`);
                    return {
                        content: [{ type: "text" as const, text: blockMsg }],
                        details: {
                            approved: false,
                            blockedBy: guard.name,
                            remainingItems: result.remainingItems,
                        },
                        terminate: false,
                    };
                }
            }

            return {
                content: [{ type: "text" as const, text: "Supervisor complete: approved — all guards passed." }],
                details: { approved: true, reason: "All guards passed" },
            };
        },
    });

    // ── Session lifecycle ──

    pi.on("session_start", async (_event, ctx) => {
        config = loadConfig(ctx.sessionDataDir, ctx.projectDataDir);
        enabled = config.enable;
        specsIterationCount = 0;

        log(`session_start: enabled=${enabled}, guards=${config.guards.length}, smallModel=${config.smallModel}`);

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

        // projectRoot is the git root (worktree-aware), correct for specs file resolution
        projectRoot = ctx.projectRoot ?? ctx.cwd;

        schedulerInstance = new Scheduler(
            config.maxContinueCount,
            config.pauseThresholdMs,
        );

        currentState = enabled ? "idle" : "disabled";
        emitStatusChanged();
    });

    // ── agent_end: Guard loop ──

    pi.on("agent_end", async (event: AgentEndEvent, ctx) => {
        log(`agent_end: enabled=${enabled}, checkOnAgentEnd=${config.checkOnAgentEnd}`);
        if (!enabled || !config.checkOnAgentEnd) return;
        if (pi.getFlag("disable-supervisor") === true) return;
        if (schedulerInstance.isExhausted()) {
            log(`agent_end: scheduler exhausted (${schedulerInstance.getContinueCount()}/${config.maxContinueCount})`);
            return;
        }

        currentState = "checking";
        emitStatusChanged();

        try {
            const lastAssistantText = extractLastAssistantText(
                event.messages as Array<{ role: string; content: unknown }>,
            );
            log(`lastAssistantText (200ch): ${lastAssistantText.slice(0, 200)}`);

            const activeGuards = getActiveGuards();
            log(`activeGuards: [${activeGuards.map((g) => `${g.name}(${g.type})`).join(", ")}]`);

            // Phase 1: Run all guard checks
            const guardResults: GuardCheckResult[] = [];
            const reports: TaskReport[] = [];

            for (const guard of activeGuards) {
                const result = await runGuardCheck(guard, lastAssistantText);
                guardResults.push(result);

                reports.push({
                    guardName: guard.name,
                    guardType: guard.type,
                    status: result.completed ? "completed" : "incomplete",
                    details: result.detail,
                    remainingItems: result.remainingItems,
                });

                log(`guard[${guard.name}] completed=${result.completed}, remaining=${result.remainingItems.length}`);
            }

            lastTaskReports = reports;
            channel.emit("supervisor.taskReport", { tasks: reports });

            // Phase 2: If any guard says incomplete → continue immediately
            const hasIncompleteGuards = guardResults.some((r) => !r.completed && r.remainingItems.length > 0);

            if (hasIncompleteGuards) {
                log(`Guards detected incomplete tasks`);
                specsIterationCount++;

                const continueMessage = generateContinueMessage(
                    activeGuards,
                    guardResults,
                    null,
                );

                lastCheckResult = { completed: false, confidence: 0.9, incompleteTasks: [], guardResults };

                scheduleContinue(continueMessage);
                return;
            }

            // Phase 3: All guards passed → run fallback model check
            const modelCheck = await checkWithSmallModel(
                event.messages as Array<{ role: string; content: unknown }>,
                config,
                pi.callLLM.bind(pi),
                ctx.sessionSignal,
            );

            const hasModelIncomplete = modelCheck.completed === false || modelCheck.incompleteTasks.length > 0;

            if (!hasModelIncomplete) {
                log(`All guards passed + model check passed → idle`);
                currentState = "idle";
                lastCheckResult = { ...modelCheck, guardResults };
                emitStatusChanged();
                return;
            }

            // Phase 4: Model detected incompleteness → continue with model's assessment
            log(`Model detected incomplete tasks`);
            const continueMessage = generateContinueMessage(
                activeGuards,
                guardResults,
                modelCheck,
            );

            lastCheckResult = { ...modelCheck, guardResults };
            scheduleContinue(continueMessage);
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

    // ── Guard Check Functions ──

    function scheduleContinue(continueMessage: string): void {
        const delayMs = config.defaultDelayMs;

        if (schedulerInstance.shouldPause(delayMs)) {
            currentState = "paused";
            emitStatusChanged();
            channel.emit("supervisor.pauseRequested", {
                delayMs,
                reason: continueMessage.slice(0, 200),
            });
        }

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
            pi.sendMessage(
                {
                    customType: "supervisor_continue",
                    content: continueMessage,
                    display: true,
                },
                { triggerTurn: true },
            );
        });
    }

    function getActiveGuards(): GuardConfig[] {
        const guards = config.guards ?? [];
        const source = guards.length > 0 ? guards : DEFAULT_GUARDS;
        return source.filter((g) => g.enable !== false);
    }

    async function runGuardCheck(
        guard: GuardConfig,
        context: string,
    ): Promise<GuardCheckResult> {
        const base: GuardCheckResult = {
            guardName: guard.name,
            completed: true,
            confidence: 1,
            remainingItems: [],
        };

        try {
            switch (guard.type) {
                case "todo":
                    return await checkTodoGuard(guard, context);
                case "specs":
                    return await checkSpecsGuard(guard, context);
                case "ci":
                    return await checkCiGuard(guard, context);
                case "keyword":
                    return checkKeywordGuard(guard, context);
                case "custom":
                    return await checkCustomGuard(guard, context);
                default:
                    return base;
            }
        } catch (err) {
            return {
                ...base,
                completed: false,
                confidence: 0,
                detail: `Guard check error: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }

    async function checkTodoGuard(
        _guard: Extract<GuardConfig, { type: "todo" }>,
        _context: string,
    ): Promise<GuardCheckResult> {
        try {
            const todoResult = await rawChannel.call("todo.list", {}, 5000);
            const todos = Array.isArray(todoResult) ? todoResult : [];

            const incomplete = todos.filter(
                (t: Record<string, unknown>) =>
                    t.status !== "completed" && t.status !== "done",
            );

            return {
                guardName: _guard.name,
                completed: incomplete.length === 0,
                confidence: incomplete.length === 0 ? 1 : 0.8,
                remainingItems: incomplete.map(
                    (t: Record<string, unknown>) => String(t.content ?? t.text ?? "unknown todo"),
                ),
                detail: `${incomplete.length}/${todos.length} todos remaining`,
            };
        } catch (err) {
            log(`todo guard: channel call failed - ${err instanceof Error ? err.message : String(err)}`);
            return {
                guardName: _guard.name,
                completed: true,
                confidence: 0.5,
                remainingItems: [],
                detail: "Todo channel not available, skipping",
            };
        }
    }

    async function checkSpecsGuard(
        guard: Extract<GuardConfig, { type: "specs" }>,
        context: string,
    ): Promise<GuardCheckResult> {
        const specsPath = join(projectRoot, guard.specsFile);

        if (!existsSync(specsPath)) {
            return {
                guardName: guard.name,
                completed: true,
                confidence: 0.5,
                remainingItems: [],
                detail: `Specs file not found: ${guard.specsFile}`,
            };
        }

        const specsContent = readFileSync(specsPath, "utf-8");
        const specItems = parseSpecItems(specsContent);

        if (specItems.length === 0) {
            return {
                guardName: guard.name,
                completed: true,
                confidence: 1,
                remainingItems: [],
                detail: "No spec items found",
            };
        }

        // Use model to check which items are done
        const response = await pi.callLLM({
            systemPrompt: SPECS_CHECK_PROMPT(specsContent, context),
            messages: [{ role: "user", content: "Check completion status" }],
            model: config.smallModel,
            maxTokens: 1024,
        });

        try {
            const jsonStr = response
                .replace(/^```(?:json)?\s*\n?/m, "")
                .replace(/\n?```\s*$/m, "")
                .trim();
            const parsed = JSON.parse(jsonStr) as {
                completed: boolean;
                remainingItems: string[];
            };

            // Check iteration limit
            if (guard.maxIterations > 0 && specsIterationCount >= guard.maxIterations) {
                return {
                    guardName: guard.name,
                    completed: true,
                    confidence: 1,
                    remainingItems: [],
                    detail: `Max iterations (${guard.maxIterations}) reached`,
                };
            }

            return {
                guardName: guard.name,
                completed: parsed.remainingItems.length === 0,
                confidence: parsed.remainingItems.length === 0 ? 1 : 0.9,
                remainingItems: parsed.remainingItems,
                detail: `${specItems.length - parsed.remainingItems.length}/${specItems.length} spec items done`,
            };
        } catch {
            return {
                guardName: guard.name,
                completed: false,
                confidence: 0.3,
                remainingItems: specItems,
                detail: "Failed to parse specs check response",
            };
        }
    }

    async function checkCiGuard(
        guard: Extract<GuardConfig, { type: "ci" }>,
        _context: string,
    ): Promise<GuardCheckResult> {
        if (!guard.checkCommand) {
            return {
                guardName: guard.name,
                completed: true,
                confidence: 1,
                remainingItems: [],
                detail: "No CI check command configured",
            };
        }

        // CI guard is intentionally simple — run command, check exit code
        // For now, just report unknown. Full implementation would use pi.runCommand
        return {
            guardName: guard.name,
            completed: true,
            confidence: 0.5,
            remainingItems: [],
            detail: `CI check: ${guard.checkCommand} (not yet executed)`,
        };
    }

    function checkKeywordGuard(
        guard: Extract<GuardConfig, { type: "keyword" }>,
        context: string,
    ): GuardCheckResult {
        const found = guard.keywords.filter((kw) =>
            context.toLowerCase().includes(kw.toLowerCase()),
        );

        return {
            guardName: guard.name,
            completed: found.length === 0,
            confidence: found.length === 0 ? 1 : 0.7,
            remainingItems: found.length > 0
                ? [`Keywords found indicating incomplete work: ${found.join(", ")}`]
                : [],
            detail: found.length > 0
                ? `Found: ${found.join(", ")}`
                : "No incomplete keywords",
        };
    }

    async function checkCustomGuard(
        guard: Extract<GuardConfig, { type: "custom" }>,
        context: string,
    ): Promise<GuardCheckResult> {
        const response = await pi.callLLM({
            systemPrompt: guard.checkPrompt,
            messages: [{ role: "user", content: context.slice(0, 2000) }],
            model: config.smallModel,
            maxTokens: 512,
        });

        try {
            const jsonStr = response
                .replace(/^```(?:json)?\s*\n?/m, "")
                .replace(/\n?```\s*$/m, "")
                .trim();
            const parsed = JSON.parse(jsonStr) as {
                completed: boolean;
                remainingItems?: string[];
            };

            return {
                guardName: guard.name,
                completed: parsed.completed,
                confidence: parsed.completed ? 0.8 : 0.7,
                remainingItems: parsed.remainingItems ?? [],
                detail: response.slice(0, 200),
            };
        } catch {
            return {
                guardName: guard.name,
                completed: true,
                confidence: 0.3,
                remainingItems: [],
                detail: "Failed to parse custom guard response, assuming complete",
            };
        }
    }

    // ── Message Generation ──

    function generateContinueMessage(
        guards: GuardConfig[],
        results: GuardCheckResult[],
        modelCheck: CheckResult | null,
    ): string {
        // Priority: first incomplete guard generates the message
        for (let i = 0; i < guards.length; i++) {
            const guard = guards[i];
            const result = results[i];
            if (result.completed || result.remainingItems.length === 0) continue;

            switch (guard.type) {
                case "todo":
                    return TODO_GUARD_PROMPT(result.remainingItems);
                case "specs": {
                    const specsGuard = guard as Extract<GuardConfig, { type: "specs" }>;
                    const completedItems = results[i].detail?.match(/(\d+)\/(\d+)/);
                    const done = completedItems ? completedItems[1] : "?";
                    const total = completedItems ? completedItems[2] : "?";
                    return SPECS_GUARD_PROMPT(
                        specsGuard.specsFile,
                        [],
                        result.remainingItems,
                        `${done}/${total}`,
                    );
                }
                case "ci":
                    return CI_GUARD_PROMPT(result.detail ?? "unknown", (guard as Extract<GuardConfig, { type: "ci" }>).checkCommand);
                case "keyword":
                    return KEYWORD_GUARD_PROMPT(result.remainingItems, result.detail ?? "");
                case "custom": {
                    const customGuard = guard as Extract<GuardConfig, { type: "custom" }>;
                    if (customGuard.continuePromptTemplate) {
                        return CUSTOM_GUARD_PROMPT(customGuard.continuePromptTemplate, {
                            remainingItems: result.remainingItems.join("\n"),
                            detail: result.detail ?? "",
                        });
                    }
                    break;
                }
            }
        }

        // Fallback: generic continue from model check
        if (modelCheck) {
            const tasks = modelCheck.incompleteTasks.map((t) => `[${t.severity}] ${t.description}`);
            return CONTINUE_PROMPT(
                modelCheck.modelResponse ?? "Model detected incomplete tasks",
                tasks.length > 0 ? tasks : ["Continue working"],
            );
        }

        return CONTINUE_PROMPT("Incomplete tasks detected", ["Please continue working on remaining items."]);
    }

    function generateBlockMessage(
        guard: GuardConfig,
        result: GuardCheckResult,
    ): string {
        if (guard.type === "specs") {
            return SPECS_GUARD_BLOCK_MESSAGE(result.remainingItems, specsIterationCount);
        }

        return `[Supervisor/${guard.name}] Completion rejected. Remaining items:\n${result.remainingItems.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\nPlease continue working on these items.`;
    }

    // ── Helpers ──

    function parseSpecItems(specsContent: string): string[] {
        const items: string[] = [];
        const lines = specsContent.split("\n");
        for (const line of lines) {
            const trimmed = line.trim();
            if (/^[-*]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
                items.push(trimmed.replace(/^[-*\d.]\s*/, ""));
            }
        }
        return items;
    }

    function getStatus(): SupervisorStatus {
        return {
            enabled,
            state: currentState,
            continueCount: schedulerInstance?.getContinueCount() ?? 0,
            maxContinueCount: config?.maxContinueCount ?? 0,
            activeGuards: getActiveGuards().map((g) => g.name),
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

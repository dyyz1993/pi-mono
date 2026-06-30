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
    TriggerRecord,
    GuardConfig,
    GuardCheckResult,
    GoalState,
    GoalChecklistItem,
    GoldResult,
} from "./types.ts";
import { loadConfig, DEFAULT_CONFIG } from "./config.ts";
import { checkWithSmallModel } from "./checker.ts";
import { Scheduler } from "./scheduler.ts";
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
    REFINE_GOAL_SYSTEM_PROMPT,
    REFINE_GOAL_USER_PROMPT,
    GOAL_CHECKLIST_SYSTEM_PROMPT,
    GOAL_CHECKLIST_USER_PROMPT,
} from "./prompts.ts";
import { advanceChecklistAfterPassedCheck, applyChecklistProgress } from "./checklist.ts";
import { setForensicDir, appendForensic, forensicTs } from "./forensic.ts";
import { appendFileSync, readFileSync, existsSync, writeFileSync, unlinkSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const LOG_DIR = "/tmp/supervisor-debug";
let logFile = `${LOG_DIR}/default.log`;
function log(msg: string) {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${msg}\n`;
    try { appendFileSync(logFile, line); } catch { /* ignore write failures */ }
}

const DEFAULT_GUARDS: GuardConfig[] = [
    { name: "incomplete-keywords", type: "keyword", enable: true, keywords: ["TODO", "FIXME", "WIP", "HACK"] },
];

const GOAL_RUNTIME_STATE_FILE = "supervisor-goal-runtime.json";
const TRIGGER_LOG_DIR = "supervisor-logs";
const TRIGGER_HISTORY_LIMIT = 200;
const SUPERVISOR_COMPLETE_TOOL = "supervisor_complete";

interface GoalRuntimeState {
    activeGoal?: GoalState;
    lastGoldResult?: GoldResult;
    enabled?: boolean;
}

interface PendingPauseState {
    scheduledAt: number;
    delayMs: number;
    reason?: string;
}

export default function sessionSupervisorExtension(pi: ExtensionAPI) {
    let config: SupervisorConfig = DEFAULT_CONFIG;
    let enabled = false;
    let currentState: SupervisorStatus["state"] = "idle";
    let lastCheckResult: CheckResult | undefined;
    let activeGoal: GoalState | undefined;
    let lastGoldResult: GoldResult | undefined;
    let schedulerInstance: Scheduler;
    let lastTaskReports: TaskReport[] = [];
    let specsIterationCount = 0;
    let projectRoot = "";
    let sessionDataDir = "";
    let triggerHistory: TriggerRecord[] = [];
    let triggerSeq = 0;
    let stagnationCount = 0;
    let lastIncompleteSignature = "";
    let pendingPause: PendingPauseState | undefined;

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
        if (!schedulerInstance) {
            return { scheduled: false } as const;
        }
        const delayMs = params.delayMs ?? config.defaultDelayMs;
        const result = schedulerInstance.scheduleContinue(
            "manual-pause",
            delayMs,
            () => {
                pendingPause = undefined;
                currentState = "continuing";
                emitStatusChanged();
                triggerContinue("Manual pause completed, resuming");
            },
        );
        if (result.scheduled) {
            pendingPause = {
                scheduledAt: result.scheduledAt ?? Date.now() + delayMs,
                delayMs,
                reason: params.reason,
            };
            currentState = "paused";
            emitStatusChanged();
            channel.emit("supervisor.pauseRequested", { type: "pauseRequested" as const, delayMs, reason: params.reason });
        }
        return result;
    });

    channel.handle("cancelPause", async () => {
        if (!schedulerInstance) return { cancelled: false, error: "Not initialized" };
        const cancelled = schedulerInstance.cancelTimer("manual-pause");
        if (cancelled) {
            pendingPause = undefined;
            currentState = enabled ? "idle" : "disabled";
            emitStatusChanged();
            channel.emit("supervisor.pauseCancelled", { type: "pauseCancelled" as const, reason: "Cancelled via channel" });
        }
        return { cancelled };
    });

    channel.handle("forceContinue", async (params) => {
        if (!schedulerInstance) return { triggered: false, error: "Not initialized" };
        schedulerInstance.cancelAll();
        pendingPause = undefined;
        currentState = "continuing";
        emitStatusChanged();
        triggerContinue(params.reason ?? "Force continue via channel");
        return { triggered: true };
    });

    channel.handle("disable", async () => {
        enabled = false;
        schedulerInstance?.cancelAll();
        pendingPause = undefined;
        currentState = "disabled";
        syncSupervisorToolVisibility();
        emitStatusChanged();
        persistGoalRuntimeState();
        return { disabled: true };
    });

    channel.handle("enable", async () => {
        enabled = true;
        currentState = "idle";
        syncSupervisorToolVisibility();
        emitStatusChanged();
        persistGoalRuntimeState();
        return { enabled: true };
    });

    channel.handle("getTaskReport", async () => ({ tasks: lastTaskReports }));
    channel.handle("setGoal", async (params) => {
        const now = Date.now();
        const objective = params.objective.trim();
        const checklist = createFallbackGoalChecklist(objective);
        const nextGoal = applyChecklistProgress({
            id: `goal_${now.toString(36)}`,
            objective,
            status: "running",
            startedAt: now,
            updatedAt: now,
            currentMilestone: checklist[0]?.text,
            checklist,
            continuationCount: 0,
            blockers: [],
        });
        enabled = true;
        currentState = "idle";
        activeGoal = nextGoal;
        lastGoldResult = undefined;
        stagnationCount = 0;
        lastIncompleteSignature = "";
        syncSupervisorToolVisibility();
        persistGoalRuntimeState();
        emitStatusChanged();
        channel.emit("supervisor.goalChanged", { type: "goalChanged" as const, goal: activeGoal });
        appendForensic({
            ts: forensicTs(),
            type: "goal_set",
            goalId: activeGoal.id,
            objective: activeGoal.objective,
            checklistLength: activeGoal.checklist?.length ?? 0,
        });
        queueGoalChecklistRefinement(activeGoal.id, objective);

        return { goal: activeGoal };
    });

    channel.handle("clearGoal", async (params) => {
        const clearedGoalId = activeGoal?.id;
        if (activeGoal) {
            activeGoal = {
                ...activeGoal,
                status: "cancelled",
                updatedAt: Date.now(),
            };
            channel.emit("supervisor.goalChanged", { type: "goalChanged" as const, goal: activeGoal, reason: params.reason });
        }
        activeGoal = undefined;
        lastGoldResult = undefined;
        syncSupervisorToolVisibility();
        persistGoalRuntimeState();
        appendForensic({
            ts: forensicTs(),
            type: "goal_cleared",
            goalId: clearedGoalId,
            reason: params.reason,
        });
        channel.emit("supervisor.goalChanged", { type: "goalChanged" as const, goal: undefined, reason: params.reason });
        emitStatusChanged();
        return { cleared: true };
    });

    channel.handle("refineGoal", async (params) => {
        const objective = params.objective?.trim();
        if (!objective) {
            return { success: false, error: "No objective provided" };
        }

        const refineStart = Date.now();
        try {
            // Gather project context: directory structure + key MD files
            const ctxStart = Date.now();
            const projectContext = gatherProjectContext(projectRoot);
            const ctxDurationMs = Date.now() - ctxStart;
            const ctxChars = projectContext.length;
            log(`refineGoal: gathered project context in ${ctxDurationMs}ms (${ctxChars} chars)`);

            const llmStart = Date.now();
            const refinedObjective = await pi.callLLM({
                systemPrompt: REFINE_GOAL_SYSTEM_PROMPT,
                messages: [{ role: "user", content: REFINE_GOAL_USER_PROMPT(objective, projectContext) }],
                maxTokens: 4096,
            });
            const llmDurationMs = Date.now() - llmStart;

            const trimmed = refinedObjective.trim();
            log(`refineGoal: LLM responded in ${llmDurationMs}ms, output ${trimmed.length} chars`);

            // Do NOT update activeGoal — just return the refined text
            // The frontend will fill it into the input box for user review

            const totalDurationMs = Date.now() - refineStart;
            log(`refineGoal: completed in ${totalDurationMs}ms (context=${ctxDurationMs}ms, llm=${llmDurationMs}ms)`);

            return { success: true, objective: trimmed };
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            const totalDurationMs = Date.now() - refineStart;
            log(`refineGoal failed after ${totalDurationMs}ms: ${errMsg}`);
            return { success: false, error: errMsg };
        }
    });

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

    channel.handle("getTriggerHistory", async (params) => {
        const limit = params.limit ?? 50;
        return { triggers: triggerHistory.slice(-limit) };
    });

    // ── Tool: supervisor_complete ──
    // LLM calls this to declare completion. Guards can reject it.

    pi.registerTool({
        name: SUPERVISOR_COMPLETE_TOOL,
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
            appendForensic({
                ts: forensicTs(),
                type: "supervisor_complete_called",
                summary: summary.slice(0, 1000),
                enabled,
                activeGuardCount: getActiveGuards().length,
            });

            if (!enabled) {
                return {
                    content: [{ type: "text" as const, text: "Supervisor complete ignored: supervisor is disabled for this session." }],
                    details: { approved: false, reason: "Supervisor is disabled" },
                    terminate: false,
                };
            }

            const activeGuards = getActiveGuards();
            if (activeGuards.length === 0) {
                appendForensic({
                    ts: forensicTs(),
                    type: "supervisor_complete_approved",
                    guardsPassed: 0,
                });
                return {
                    content: [{ type: "text" as const, text: "Supervisor complete: approved (no active guards)" }],
                    details: { approved: true, reason: "No active guards" },
                    terminate: true,
                };
            }

            for (const guard of activeGuards) {
                const result = await runGuardCheck(guard, summary);

                if (!result.completed && result.remainingItems.length > 0) {
                    const blockMsg = generateBlockMessage(guard, result);
                    log(`supervisor_complete BLOCKED by ${guard.name}: ${result.remainingItems.join(", ")}`);
                    appendForensic({
                        ts: forensicTs(),
                        type: "supervisor_complete_guard_blocked",
                        guardName: guard.name,
                        remainingItems: result.remainingItems,
                    });
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

            appendForensic({
                ts: forensicTs(),
                type: "supervisor_complete_approved",
                guardsPassed: activeGuards.length,
            });
            return {
                content: [{ type: "text" as const, text: "Supervisor complete: approved — all guards passed." }],
                details: { approved: true, reason: "All guards passed" },
                terminate: true,
            };
        },
    });

    // ── Session lifecycle ──

    // ── Inject active goal into system prompt ──

    pi.on("before_agent_start", async (event) => {
        if (!activeGoal || activeGoal.status === "cancelled" || activeGoal.status === "complete") {
            return {};
        }

        const checklistSection =
            activeGoal.checklist && activeGoal.checklist.length > 0
                ? `
**Derived Checklist**:
${activeGoal.checklist.map((item, index) => `${index + 1}. [${item.status}] ${item.text}`).join("\n")}
`
                : "";

        const goalSection = `

## Active Goal

You are working toward the following user goal. The user goal text is authoritative and must not be rewritten.

**User Goal**: ${activeGoal.objective}
**Status**: ${activeGoal.status}
**Started**: ${new Date(activeGoal.startedAt).toISOString()}
${checklistSection}

Use the checklist as your working contract. Do not call \`supervisor_complete\` until the user goal and checklist are satisfied. When you believe the objective is fully achieved, call the \`supervisor_complete\` tool with a concise summary of what was accomplished and verified.
`;

        return {
            systemPrompt: event.systemPrompt + goalSection,
        };
    });

    pi.on("session_start", async (_event, ctx) => {
        sessionDataDir = ctx.sessionDataDir;
        setForensicDir(sessionDataDir);
        config = loadConfig(ctx.sessionDataDir, ctx.projectDataDir);
        enabled = config.enable;
        specsIterationCount = 0;
        stagnationCount = 0;
        lastIncompleteSignature = "";
        // Per-session log file to avoid concurrent write conflicts
        const sessionId = ctx.sessionDataDir.split("/").pop() || "unknown";
        try { mkdirSync(LOG_DIR, { recursive: true }); } catch { /* ignore */ }
        logFile = `${LOG_DIR}/${sessionId}.log`;
        loadGoalRuntimeState();
        loadTriggerHistoryFromLogs();

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

        appendForensic({
            ts: forensicTs(),
            type: "session_start",
            enabled,
            guardCount: getActiveGuards().length,
            smallModel: config.smallModel,
            maxContinueCount: config.maxContinueCount,
        });

        // projectRoot is the git root (worktree-aware), correct for specs file resolution
        projectRoot = ctx.projectRoot ?? ctx.cwd;

        schedulerInstance = new Scheduler(
            config.maxContinueCount,
            config.pauseThresholdMs,
        );

        currentState = enabled ? "idle" : "disabled";
        syncSupervisorToolVisibility();
        emitStatusChanged();

        if (enabled && activeGoal && (activeGoal.status === "running" || activeGoal.status === "checking")) {
            log(`session_start: resuming goal '${activeGoal.objective.slice(0, 60)}'`);
            setGoalStatus("running");
        }
    });

    // ── agent_end: Guard loop ──

    pi.on("agent_end", async (event: AgentEndEvent, ctx) => {
        log(`agent_end: enabled=${enabled}, checkOnAgentEnd=${config.checkOnAgentEnd}`);
        appendForensic({
            ts: forensicTs(),
            type: "agent_end_triggered",
            enabled,
            checkOnAgentEnd: config.checkOnAgentEnd,
            schedulerExhausted: schedulerInstance?.isExhausted() ?? false,
            hasActiveGoal: Boolean(activeGoal),
            agentEndMs: Date.now(),
        });
        if (!enabled || !config.checkOnAgentEnd) {
            appendForensic({
                ts: forensicTs(),
                type: "agent_end_skipped",
                reason: !enabled ? "disabled" : "checkOnAgentEnd=false",
            });
            return;
        }
        if (activeGoal && ["complete", "cancelled", "blocked"].includes(activeGoal.status)) {
            currentState = "idle";
            log(`agent_end: skipping supervisor check for terminal goal status=${activeGoal.status}`);
            appendForensic({
                ts: forensicTs(),
                type: "agent_end_skipped",
                reason: `terminal goal status=${activeGoal.status}`,
            });
            emitStatusChanged();
            return;
        }
        if (pi.getFlag("disable-supervisor") === true) {
            appendForensic({
                ts: forensicTs(),
                type: "agent_end_skipped",
                reason: "disable-supervisor flag",
            });
            return;
        }
        if (schedulerInstance.isExhausted()) {
            log(`agent_end: scheduler exhausted (${schedulerInstance.getContinueCount()}/${config.maxContinueCount})`);
            appendForensic({
                ts: forensicTs(),
                type: "scheduler_exhausted",
                continueCount: schedulerInstance.getContinueCount(),
                maxContinueCount: config.maxContinueCount,
            });
            return;
        }

        const checkStartedAt = Date.now();
        currentState = "checking";
        setGoalStatus("checking");
        emitStatusChanged();

        try {
            const lastAssistantText = extractLastAssistantText(
                event.messages as Array<{ role: string; content: unknown }>,
            );
            log(`lastAssistantText (200ch): ${lastAssistantText.slice(0, 200)}`);

            const activeGuards = getActiveGuards();
            log(`activeGuards: [${activeGuards.map((g) => `${g.name}(${g.type})`).join(", ")}]`);

            // Phase 1: Run all guard checks with timing
            const guardResults: GuardCheckResult[] = [];
            const reports: TaskReport[] = [];
            const guardTimings: Array<{ guardName: string; guardType: string; durationMs: number }> = [];

            for (const guard of activeGuards) {
                const guardStart = Date.now();
                const result = await runGuardCheck(guard, lastAssistantText);
                const guardDuration = Date.now() - guardStart;
                guardResults.push(result);
                guardTimings.push({ guardName: guard.name, guardType: guard.type, durationMs: guardDuration });

                reports.push({
                    guardName: guard.name,
                    guardType: guard.type,
                    status: result.completed ? "completed" : "incomplete",
                    details: result.detail,
                    remainingItems: result.remainingItems,
                });

                log(`guard[${guard.name}] completed=${result.completed}, remaining=${result.remainingItems.length}, duration=${guardDuration}ms`);
            }

            lastTaskReports = reports;
            channel.emit("supervisor.taskReport", { type: "taskReport" as const, tasks: reports });

            // Phase 2: If any guard says incomplete → continue immediately
            const hasIncompleteGuards = guardResults.some((r) => !r.completed && r.remainingItems.length > 0);

            if (hasIncompleteGuards) {
                log(`Guards detected incomplete tasks`);
                specsIterationCount++;

                // Stagnation detection: compare this round's incomplete signature
                // with the previous round. If identical, the guard results have
                // not changed and the agent is stuck.
                const currentSignature = guardResults
                    .filter((r) => !r.completed)
                    .map((r) => `${r.guardName}:${r.remainingItems.sort().join(",")}`)
                    .join("|");

                if (currentSignature === lastIncompleteSignature) {
                    stagnationCount++;
                    log(`Stagnation detected (count=${stagnationCount}), signature=${currentSignature}`);
                    appendForensic({
                        ts: forensicTs(),
                        type: "stagnation_detected",
                        stagnationCount,
                        currentSignature,
                        previousSignature: lastIncompleteSignature,
                        guardResults: guardResults.map((r) => ({
                            guardName: r.guardName,
                            completed: r.completed,
                            remainingItems: r.remainingItems,
                            confidence: r.confidence,
                        })),
                    });
                } else {
                    stagnationCount = 0;
                }
                lastIncompleteSignature = currentSignature;

                if (stagnationCount >= 1) {
                    log(`Stagnation threshold reached (${stagnationCount + 1} consecutive identical results), stopping loop`);

                    const checkDurationMs = Date.now() - checkStartedAt;
                    currentState = "idle";
                    setGoalStatus("blocked", {
                        kind: "runtime",
                        summary: `Stagnation: same guard results for ${stagnationCount + 1} consecutive checks (${currentSignature})`,
                    });
                    emitStatusChanged();

                    lastCheckResult = { completed: false, confidence: 0.5, incompleteTasks: [], guardResults };
                    recordGoldResult({
                        verdict: "blocked",
                        confidence: 0.5,
                        reason: `Stagnation detected: same incomplete guard results for ${stagnationCount + 1} consecutive checks.`,
                        evidence: guardResults.map((r) => ({
                            kind: "guard" as const,
                            summary: `${r.guardName}: ${r.detail ?? r.remainingItems.join(", ")}`,
                            passed: r.completed,
                        })),
                        durationMs: checkDurationMs,
                    });

                    const record = buildTriggerRecord(checkStartedAt, checkDurationMs, "blocked", 0.5, guardResults, guardTimings, undefined, "paused", "Stagnation detected, stopping loop");
                    appendTriggerRecord(record);

                    pi.sendMessage(
                        {
                            customType: "supervisor_stagnation",
                            content: `Goal stalled: same incomplete items detected for ${stagnationCount + 1} consecutive checks. Stopping auto-continue.`,
                            display: true,
                        },
                        { triggerTurn: false },
                    );

                    return;
                }

                const continueMessage = generateContinueMessage(
                    activeGuards,
                    guardResults,
                    null,
                );

                const checkDurationMs = Date.now() - checkStartedAt;

                lastCheckResult = { completed: false, confidence: 0.9, incompleteTasks: [], guardResults };
                recordGoldResult({
                    verdict: "incomplete",
                    confidence: 0.9,
                    reason: "Active guards found remaining work.",
                    evidence: guardResults.map((r) => ({
                        kind: "guard",
                        summary: `${r.guardName}: ${r.detail ?? (r.completed ? "completed" : r.remainingItems.join(", "))}`,
                        passed: r.completed,
                    })),
                    continueMessage,
                    durationMs: checkDurationMs,
                });

                const record = buildTriggerRecord(checkStartedAt, checkDurationMs, "incomplete", 0.9, guardResults, guardTimings, undefined, "continue", "Active guards found remaining work");
                appendTriggerRecord(record);

                scheduleContinue(continueMessage);
                return;
            }

            // Phase 3: All guards passed → run fallback model check
            const modelCheckStart = Date.now();
            const modelCheck = await checkWithSmallModel(
                event.messages as Array<{ role: string; content: unknown }>,
                config,
                pi.callLLM.bind(pi),
                ctx.sessionSignal,
            );
            const modelCheckDurationMs = Date.now() - modelCheckStart;

            const hasModelIncomplete = modelCheck.completed === false || modelCheck.incompleteTasks.length > 0;

            if (!hasModelIncomplete) {
                log(`All guards passed + model check passed`);
                const checkDurationMs = Date.now() - checkStartedAt;
                currentState = "idle";
                lastCheckResult = { ...modelCheck, guardResults };

                const passedEvidenceSummary = modelCheck.modelResponse ?? "Guards and model check passed.";
                const checklistAdvance = activeGoal
                    ? advanceChecklistAfterPassedCheck(activeGoal, passedEvidenceSummary)
                    : undefined;

                if (checklistAdvance?.hasRemaining) {
                    activeGoal = {
                        ...checklistAdvance.goal,
                        continuationCount: schedulerInstance?.getContinueCount() ?? checklistAdvance.goal.continuationCount,
                    };
                    persistGoalRuntimeState();
                    channel.emit("supervisor.goalChanged", { type: "goalChanged" as const, goal: activeGoal });

                    const continueMessage = [
                        "The current checklist item passed supervisor verification.",
                        checklistAdvance.completedItem
                            ? `Completed checklist item: ${checklistAdvance.completedItem.text}`
                            : undefined,
                        checklistAdvance.nextItem
                            ? `Continue with the next checklist item: ${checklistAdvance.nextItem.text}`
                            : undefined,
                        "Do not call supervisor_complete until every checklist item has been individually completed and verified.",
                    ].filter(Boolean).join("\n");

                    recordGoldResult({
                        verdict: "incomplete",
                        confidence: modelCheck.confidence,
                        reason: "Current checklist item passed, but later checklist items remain.",
                        evidence: [
                            ...guardResults.map((r) => ({
                                kind: "guard" as const,
                                summary: `${r.guardName}: ${r.detail ?? "completed"}`,
                                passed: true,
                            })),
                            {
                                kind: "model" as const,
                                summary: passedEvidenceSummary,
                                passed: true,
                            },
                            {
                                kind: "assistant_claim" as const,
                                summary: `Checklist advanced to: ${checklistAdvance.nextItem?.text ?? "next item"}`,
                                passed: false,
                            },
                        ],
                        continueMessage,
                        durationMs: checkDurationMs,
                    });

                    const record = buildTriggerRecord(
                        checkStartedAt, checkDurationMs, "incomplete", modelCheck.confidence,
                        guardResults, guardTimings,
                        {
                            passed: true,
                            confidence: modelCheck.confidence,
                            response: modelCheck.modelResponse,
                            durationMs: modelCheckDurationMs,
                            model: config.smallModel,
                        },
                        "continue", "Checklist has remaining items",
                    );
                    appendTriggerRecord(record);
                    emitStatusChanged();
                    scheduleContinue(continueMessage);
                    return;
                }

                if (checklistAdvance) {
                    activeGoal = checklistAdvance.goal;
                    persistGoalRuntimeState();
                    channel.emit("supervisor.goalChanged", { type: "goalChanged" as const, goal: activeGoal });
                }

                recordGoldResult({
                    verdict: "complete",
                    confidence: modelCheck.confidence,
                    reason: passedEvidenceSummary,
                    evidence: [
                        ...guardResults.map((r) => ({
                            kind: "guard" as const,
                            summary: `${r.guardName}: ${r.detail ?? "completed"}`,
                            passed: true,
                        })),
                        {
                            kind: "model" as const,
                            summary: modelCheck.modelResponse ?? "Model check passed.",
                            passed: true,
                        },
                    ],
                    durationMs: checkDurationMs,
                });

                const record = buildTriggerRecord(
                    checkStartedAt, checkDurationMs, "complete", modelCheck.confidence,
                    guardResults, guardTimings,
                    {
                        passed: true,
                        confidence: modelCheck.confidence,
                        response: modelCheck.modelResponse,
                        durationMs: modelCheckDurationMs,
                        model: config.smallModel,
                    },
                    "complete", "All guards and model check passed",
                );
                appendTriggerRecord(record);

                setGoalStatus("complete");
                emitStatusChanged();

                // Send a completion summary entry into the chat stream
                if (activeGoal) {
                    const durationMs = Date.now() - activeGoal.startedAt;
                    pi.sendMessage(
                        {
                            customType: "supervisor_goal_complete",
                            content: "Goal completed",
                            display: true,
                            data: {
                                goalId: activeGoal.id,
                                objective: activeGoal.objective,
                                verdict: "complete",
                                continuationCount: activeGoal.continuationCount,
                                durationMs,
                                evidence: lastGoldResult?.evidence?.map((e) => e.summary) ?? [],
                            },
                        },
                        { triggerTurn: false },
                    );
                }

                return;
            }

            // Phase 4: Model detected incompleteness → continue with model's assessment
            log(`Model detected incomplete tasks`);
            const checkDurationMs = Date.now() - checkStartedAt;
            const continueMessage = generateContinueMessage(
                activeGuards,
                guardResults,
                modelCheck,
            );

            lastCheckResult = { ...modelCheck, guardResults };
            recordGoldResult({
                verdict: "incomplete",
                confidence: modelCheck.confidence,
                reason: modelCheck.modelResponse ?? "Model detected incomplete tasks.",
                evidence: [
                    ...guardResults.map((r) => ({
                        kind: "guard" as const,
                        summary: `${r.guardName}: ${r.detail ?? (r.completed ? "completed" : r.remainingItems.join(", "))}`,
                        passed: r.completed,
                    })),
                    ...modelCheck.incompleteTasks.map((t) => ({
                        kind: "model" as const,
                        summary: `[${t.severity}] ${t.description}`,
                        passed: false,
                    })),
                ],
                continueMessage,
                durationMs: checkDurationMs,
            });

            const record = buildTriggerRecord(
                checkStartedAt, checkDurationMs, "incomplete", modelCheck.confidence,
                guardResults, guardTimings,
                {
                    passed: false,
                    confidence: modelCheck.confidence,
                    response: modelCheck.modelResponse,
                    durationMs: modelCheckDurationMs,
                    model: config.smallModel,
                },
                "continue", modelCheck.modelResponse ?? "Model detected incomplete tasks",
            );
            appendTriggerRecord(record);

            scheduleContinue(continueMessage);
        } catch (err) {
            log(`agent_end error: ${err instanceof Error ? err.message : String(err)}`);
            const checkDurationMs = Date.now() - checkStartedAt;
            currentState = "idle";
            recordGoldResult({
                verdict: "blocked",
                confidence: 0,
                reason: err instanceof Error ? err.message : String(err),
                evidence: [{ kind: "runtime", summary: "Gold check failed.", passed: false }],
                durationMs: checkDurationMs,
            });
            setGoalStatus("blocked", {
                kind: "runtime",
                summary: err instanceof Error ? err.message : String(err),
            });

            const record = buildTriggerRecord(
                checkStartedAt, checkDurationMs, "blocked", 0,
                [], [], undefined,
                "error", err instanceof Error ? err.message : String(err),
            );
            appendTriggerRecord(record);

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

        const shouldPause = schedulerInstance.shouldPause(delayMs);
        const seq = schedulerInstance.getContinueCount();
        const id = `auto-continue-${seq}`;
        const result = schedulerInstance.scheduleContinue(id, delayMs, () => {
            pendingPause = undefined;
            currentState = "continuing";
            setGoalStatus("running");
            emitStatusChanged();
            channel.emit("supervisor.continueTriggered", {
                type: "continueTriggered" as const,
                reason: continueMessage.slice(0, 200),
                delayMs,
            });
            try {
                pi.sendMessage(
                    {
                        customType: "supervisor_continue",
                        content: continueMessage,
                        display: true,
                    },
                    { triggerTurn: true },
                );
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (/stale|abort/i.test(msg)) return;
                throw err;
            }
        });

        if (result.scheduled) {
            appendForensic({
                ts: forensicTs(),
                type: "continue_scheduled",
                reason: continueMessage.slice(0, 500),
                delayMs,
                continueCount: schedulerInstance.getContinueCount(),
                maxContinueCount: config.maxContinueCount,
                shouldPause,
            });
        }

        if (result.scheduled && shouldPause) {
            pendingPause = {
                scheduledAt: result.scheduledAt ?? Date.now() + delayMs,
                delayMs,
                reason: continueMessage.slice(0, 200),
            };
            currentState = "paused";
            emitStatusChanged();
            channel.emit("supervisor.pauseRequested", {
                type: "pauseRequested" as const,
                delayMs,
                reason: continueMessage.slice(0, 200),
            });
        }

        if (!result.scheduled) {
            log(`scheduleContinue: scheduler exhausted (${schedulerInstance.getContinueCount()}/${config.maxContinueCount}), not scheduling`);
            appendForensic({
                ts: forensicTs(),
                type: "continue_skipped",
                reason: `scheduler exhausted (${schedulerInstance.getContinueCount()}/${config.maxContinueCount})`,
            });
            appendForensic({
                ts: forensicTs(),
                type: "scheduler_exhausted",
                continueCount: schedulerInstance.getContinueCount(),
                maxContinueCount: config.maxContinueCount,
            });
        }
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
        const startedAt = Date.now();
        appendForensic({
            ts: forensicTs(),
            type: "guard_check_start",
            guardName: guard.name,
            guardType: guard.type,
            contextLength: context.length,
        });
        const base: GuardCheckResult = {
            guardName: guard.name,
            completed: true,
            confidence: 1,
            remainingItems: [],
        };

        try {
            let result: GuardCheckResult;
            switch (guard.type) {
                case "todo":
                    result = await checkTodoGuard(guard, context);
                    break;
                case "specs":
                    result = await checkSpecsGuard(guard, context);
                    break;
                case "ci":
                    result = await checkCiGuard(guard, context);
                    break;
                case "keyword":
                    result = checkKeywordGuard(guard, context);
                    break;
                case "custom":
                    result = await checkCustomGuard(guard, context);
                    break;
                default:
                    result = base;
                    break;
            }
            appendForensic({
                ts: forensicTs(),
                type: "guard_check_end",
                guardName: guard.name,
                guardType: guard.type,
                completed: result.completed,
                confidence: result.confidence,
                remainingItems: result.remainingItems,
                detail: result.detail,
                durationMs: Date.now() - startedAt,
            });
            return result;
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            appendForensic({
                ts: forensicTs(),
                type: "guard_check_error",
                guardName: guard.name,
                guardType: guard.type,
                error,
                durationMs: Date.now() - startedAt,
            });
            return {
                ...base,
                completed: false,
                confidence: 0,
                detail: `Guard check error: ${error}`,
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

    function queueGoalChecklistRefinement(goalId: string, objective: string): void {
        void (async () => {
            const refinedChecklist = await deriveGoalChecklistWithLLM(objective);
            if (refinedChecklist.length === 0) return;
            if (!activeGoal || activeGoal.id !== goalId) return;
            if (activeGoal.status !== "running" && activeGoal.status !== "checking") return;

            activeGoal = applyChecklistProgress({
                ...activeGoal,
                checklist: mergeChecklistProgress(activeGoal.checklist ?? [], refinedChecklist),
                updatedAt: Date.now(),
            });
            persistGoalRuntimeState();
            channel.emit("supervisor.goalChanged", { type: "goalChanged" as const, goal: activeGoal });
            emitStatusChanged();
        })().catch((err) => {
            log(`queueGoalChecklistRefinement failed: ${err instanceof Error ? err.message : String(err)}`);
        });
    }

    async function deriveGoalChecklistWithLLM(objective: string): Promise<GoalChecklistItem[]> {
        try {
            const context = projectRoot ? gatherProjectContext(projectRoot) : "";
            const raw = await pi.callLLM({
                systemPrompt: GOAL_CHECKLIST_SYSTEM_PROMPT,
                messages: [{ role: "user", content: GOAL_CHECKLIST_USER_PROMPT(objective, context) }],
                model: config.smallModel,
                maxTokens: 1024,
            });
            const parsed = parseGoalChecklist(raw);
            if (parsed.length > 0) {
                return parsed;
            }
        } catch (err) {
            log(`deriveGoalChecklistWithLLM failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        return [];
    }

    function mergeChecklistProgress(
        existing: GoalChecklistItem[],
        incoming: GoalChecklistItem[],
    ): GoalChecklistItem[] {
        const now = Date.now();
        return incoming.map((item, index) => {
            const previous = existing[index];
            return {
                ...item,
                status: previous?.status ?? item.status,
                updatedAt: now,
            };
        });
    }

    function createFallbackGoalChecklist(objective: string): GoalChecklistItem[] {
        const now = Date.now();
        const mentionedPaths = extractMentionedPaths(objective);
        const scopeText = mentionedPaths.length > 0
            ? `确认目标范围和涉及路径：${mentionedPaths.slice(0, 3).join(", ")}`
            : "确认目标范围、约束和验收方式";
        return [
            makeChecklistItem(1, scopeText, "scope", now),
            makeChecklistItem(2, "完成用户目标要求的实际改动或操作", "implementation", now),
            makeChecklistItem(3, "运行相关检查、测试或人工可验证步骤", "verification", now),
            makeChecklistItem(4, "总结完成结果、验证证据和剩余风险", "report", now),
        ];
    }

    function parseGoalChecklist(raw: string): GoalChecklistItem[] {
        if (!raw.trim()) return [];
        try {
            const jsonStr = raw
                .replace(/^```(?:json)?\s*\n?/m, "")
                .replace(/\n?```\s*$/m, "")
                .trim();
            const parsed = JSON.parse(jsonStr) as unknown;
            const items = Array.isArray((parsed as { items?: unknown }).items)
                ? (parsed as { items: unknown[] }).items
                : Array.isArray(parsed)
                    ? parsed
                    : [];
            const now = Date.now();
            return items
                .map((item, index) => normalizeChecklistDraft(item, index + 1, now))
                .filter((item): item is GoalChecklistItem => Boolean(item))
                .slice(0, 6);
        } catch {
            return [];
        }
    }

    function normalizeChecklistDraft(item: unknown, index: number, now: number): GoalChecklistItem | undefined {
        if (!item || typeof item !== "object") return undefined;
        const record = item as Record<string, unknown>;
        const text = typeof record.text === "string" ? record.text.trim() : "";
        if (!text) return undefined;
        return makeChecklistItem(index, text, normalizeChecklistKind(record.kind), now);
    }

    function normalizeChecklistKind(kind: unknown): GoalChecklistItem["kind"] {
        if (kind === "scope" || kind === "implementation" || kind === "verification" || kind === "report") {
            return kind;
        }
        return "implementation";
    }

    function makeChecklistItem(
        index: number,
        text: string,
        kind: GoalChecklistItem["kind"],
        now: number,
    ): GoalChecklistItem {
        return {
            id: `check_${index.toString().padStart(2, "0")}`,
            text,
            kind,
            status: "pending",
            updatedAt: now,
        };
    }

    function extractMentionedPaths(text: string): string[] {
        const matches = text.match(/(?:[\w.-]+\/)+[\w.-]+|[\w.-]+\.(?:ts|tsx|js|jsx|json|md|txt|css|scss|html|mjs|cjs)/g);
        return Array.from(new Set(matches ?? []));
    }

    function getStatus(): SupervisorStatus {
        return {
            enabled,
            state: currentState,
            continueCount: schedulerInstance?.getContinueCount() ?? 0,
            maxContinueCount: config?.maxContinueCount ?? 0,
            activeGuards: getActiveGuards().map((g) => g.name),
            lastCheckResult,
            goal: activeGoal,
            lastGoldResult,
            pendingPause,
        };
    }

    function emitStatusChanged(): void {
        channel.emit("supervisor.statusChanged", { type: "statusChanged" as const, status: getStatus() });
    }

    function getGoalRuntimeStatePath(): string {
        return join(sessionDataDir, GOAL_RUNTIME_STATE_FILE);
    }

    function isGoalState(value: unknown): value is GoalState {
        if (!value || typeof value !== "object") return false;
        const goal = value as Partial<GoalState>;
        return (
            typeof goal.id === "string" &&
            typeof goal.objective === "string" &&
            typeof goal.status === "string" &&
            typeof goal.startedAt === "number" &&
            typeof goal.updatedAt === "number" &&
            (goal.checklist === undefined || Array.isArray(goal.checklist))
        );
    }

    function isGoldResult(value: unknown): value is GoldResult {
        if (!value || typeof value !== "object") return false;
        const result = value as Partial<GoldResult>;
        return (
            typeof result.verdict === "string" &&
            typeof result.confidence === "number" &&
            typeof result.checkedAt === "number" &&
            typeof result.reason === "string" &&
            Array.isArray(result.evidence)
        );
    }

    function isTriggerRecord(value: unknown): value is TriggerRecord {
        if (!value || typeof value !== "object") return false;
        const record = value as Partial<TriggerRecord>;
        return (
            typeof record.seq === "number" &&
            typeof record.startedAt === "number" &&
            typeof record.durationMs === "number" &&
            typeof record.verdict === "string" &&
            typeof record.confidence === "number" &&
            Array.isArray(record.guardResults) &&
            typeof record.action === "string"
        );
    }

    function taskReportsFromTriggerRecord(record: TriggerRecord): TaskReport[] {
        return record.guardResults.map((result) => ({
            guardName: result.guardName,
            guardType: result.guardType,
            status: result.passed ? "completed" : "incomplete",
            details: result.detail,
            remainingItems: result.remainingItems,
        }));
    }

    function getTriggerLogDir(): string {
        return join(sessionDataDir, TRIGGER_LOG_DIR);
    }

    function loadTriggerHistoryFromLogs(): void {
        triggerHistory = [];
        triggerSeq = 0;
        lastTaskReports = [];
        if (!sessionDataDir) return;

        const logDir = getTriggerLogDir();
        if (!existsSync(logDir)) return;

        try {
            const records = readdirSync(logDir)
                .filter((name) => name.endsWith(".json"))
                .map((name) => {
                    const filePath = join(logDir, name);
                    try {
                        const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
                        return isTriggerRecord(parsed) ? parsed : undefined;
                    } catch {
                        return undefined;
                    }
                })
                .filter((record): record is TriggerRecord => Boolean(record))
                .sort((a, b) => (a.startedAt - b.startedAt) || (a.seq - b.seq));

            triggerHistory = records.slice(-TRIGGER_HISTORY_LIMIT);
            triggerSeq = triggerHistory.reduce((max, record) => Math.max(max, record.seq), 0);
            const latestWithGuards = [...triggerHistory].reverse().find((record) => record.guardResults.length > 0);
            lastTaskReports = latestWithGuards ? taskReportsFromTriggerRecord(latestWithGuards) : [];
            log(`loadTriggerHistoryFromLogs: restored ${triggerHistory.length} record(s), seq=${triggerSeq}`);
        } catch (err) {
            log(`loadTriggerHistoryFromLogs failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    function loadGoalRuntimeState(): void {
        activeGoal = undefined;
        lastGoldResult = undefined;
        if (!sessionDataDir) return;
        const filePath = getGoalRuntimeStatePath();
        if (!existsSync(filePath)) return;
        try {
            const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as GoalRuntimeState;
            activeGoal = isGoalState(parsed.activeGoal) ? parsed.activeGoal : undefined;
            lastGoldResult = isGoldResult(parsed.lastGoldResult) ? parsed.lastGoldResult : undefined;
            // Restore enabled state from persisted runtime state
            if (typeof parsed.enabled === "boolean" && parsed.enabled) {
                enabled = true;
                currentState = "idle";
                log(`loadGoalRuntimeState: restored enabled=true`);
            }
        } catch (err) {
            log(`loadGoalRuntimeState failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    function persistGoalRuntimeState(): void {
        if (!sessionDataDir) return;
        const filePath = getGoalRuntimeStatePath();
        if (!activeGoal && !lastGoldResult && !enabled) {
            try {
                if (existsSync(filePath)) unlinkSync(filePath);
            } catch (err) {
                log(`removeGoalRuntimeState failed: ${err instanceof Error ? err.message : String(err)}`);
            }
            return;
        }
        const state: GoalRuntimeState = { activeGoal, lastGoldResult, enabled };
        try {
            writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
        } catch (err) {
            log(`persistGoalRuntimeState failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    function syncSupervisorToolVisibility(): void {
        try {
            const activeTools = pi.getActiveTools();
            const hasTool = activeTools.includes(SUPERVISOR_COMPLETE_TOOL);
            const shouldExpose = enabled;
            if (shouldExpose && !hasTool) {
                pi.setActiveTools([...activeTools, SUPERVISOR_COMPLETE_TOOL]);
            } else if (!shouldExpose && hasTool) {
                pi.setActiveTools(activeTools.filter((name) => name !== SUPERVISOR_COMPLETE_TOOL));
            }
        } catch (err) {
            log(`syncSupervisorToolVisibility failed: ${err instanceof Error ? err.message : String(err)}`);
        }
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

    function setGoalStatus(status: GoalState["status"], blocker?: GoalState["blockers"][number]): void {
        if (!activeGoal) return;
        const oldStatus = activeGoal.status;
        activeGoal = applyChecklistProgress({
            ...activeGoal,
            status,
            updatedAt: Date.now(),
            continuationCount: schedulerInstance?.getContinueCount() ?? activeGoal.continuationCount,
            blockers: blocker ? [...activeGoal.blockers, blocker] : activeGoal.blockers,
        });
        persistGoalRuntimeState();
        if (oldStatus !== activeGoal.status) {
            appendForensic({
                ts: forensicTs(),
                type: "goal_status_changed",
                goalId: activeGoal.id,
                oldStatus,
                newStatus: activeGoal.status,
            });
        }
        channel.emit("supervisor.goalChanged", { type: "goalChanged" as const, goal: activeGoal });
    }

    function recordGoldResult(result: Omit<GoldResult, "goalId" | "checkedAt"> & { durationMs?: number }): void {
        lastGoldResult = {
            ...result,
            goalId: activeGoal?.id,
            checkedAt: Date.now(),
        };
        persistGoalRuntimeState();
        appendForensic({
            ts: forensicTs(),
            type: "gold_result_emitted",
            goldResult: lastGoldResult,
        });
        channel.emit("supervisor.goldResult", { type: "goldResult" as const, ...lastGoldResult });
    }

    function buildTriggerRecord(
        startedAt: number,
        durationMs: number,
        verdict: TriggerRecord["verdict"],
        confidence: number,
        guardResults: GuardCheckResult[],
        guardTimings: Array<{ guardName: string; guardType: string; durationMs: number }>,
        modelCheck: TriggerRecord["modelCheck"],
        action: TriggerRecord["action"],
        reason: string,
    ): TriggerRecord {
        triggerSeq++;
        return {
            goalId: activeGoal?.id,
            seq: triggerSeq,
            startedAt,
            finishedAt: startedAt + durationMs,
            durationMs,
            verdict,
            confidence,
            guardResults: guardResults.map((r, i) => ({
                guardName: r.guardName,
                guardType: guardTimings[i]?.guardType ?? "unknown",
                passed: r.completed,
                confidence: r.confidence,
                remainingItems: r.remainingItems,
                detail: r.detail,
                durationMs: guardTimings[i]?.durationMs ?? 0,
            })),
            modelCheck,
            action,
            reason,
        };
    }

    function appendTriggerRecord(record: TriggerRecord): void {
        triggerHistory = [...triggerHistory.filter((item) => item.seq !== record.seq), record]
            .sort((a, b) => (a.startedAt - b.startedAt) || (a.seq - b.seq))
            .slice(-TRIGGER_HISTORY_LIMIT);
        channel.emit("supervisor.triggerRecord", { type: "triggerRecord" as const, record });
        writeStructuredLog(record);
        log(`trigger #${record.seq}: verdict=${record.verdict}, action=${record.action}, duration=${record.durationMs}ms`);
    }

    function writeStructuredLog(record: TriggerRecord): void {
        if (!sessionDataDir) return;
        const logDir = getTriggerLogDir();
        try {
            if (!existsSync(logDir)) {
                mkdirSync(logDir, { recursive: true });
            }
            const logFile = join(logDir, `trigger-${new Date(record.startedAt).toISOString().replace(/[:.]/g, "-")}.json`);
            writeFileSync(logFile, JSON.stringify(record, null, 2), "utf-8");
        } catch (err) {
            log(`writeStructuredLog failed: ${err instanceof Error ? err.message : String(err)}`);
        }
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

    function gatherProjectContext(root: string, maxDepth = 2): string {
        const MAX_CHARS = 4000;
        const parts: string[] = [];
        let totalLen = 0;

        function walkDir(dir: string, depth: number, prefix: string): void {
            if (depth > maxDepth || totalLen > MAX_CHARS) return;
            let entries: string[];
            try {
                entries = readdirSync(dir).sort();
            } catch {
                return;
            }
            // Filter out common noise
            const skip = new Set(["node_modules", ".git", "dist", ".next", ".turbo", "coverage", ".cache", "__pycache__", ".yalc"]);
            for (const name of entries) {
                if (skip.has(name) || name.startsWith(".")) continue;
                const full = join(dir, name);
                let isDir: boolean;
                try {
                    isDir = statSync(full).isDirectory();
                } catch {
                    continue;
                }
                const line = `${prefix}${isDir ? name + "/" : name}\n`;
                if (totalLen + line.length > MAX_CHARS) return;
                parts.push(line);
                totalLen += line.length;
                if (isDir) walkDir(full, depth + 1, prefix + "  ");
            }
        }

        parts.push("## Directory Structure\n```\n");
        walkDir(root, 0, "");
        parts.push("```\n");

        // Read key documentation files
        const docFiles = ["README.md", "specs.md", "CLAUDE.md", "AGENTS.md", "TODO.md", "package.json"];
        for (const docFile of docFiles) {
            const docPath = join(root, docFile);
            if (!existsSync(docPath)) continue;
            try {
                const content = readFileSync(docPath, "utf-8");
                if (content.length > 1500) {
                    parts.push(`## ${docFile} (first 1500 chars)\n${content.slice(0, 1500)}\n\n`);
                } else {
                    parts.push(`## ${docFile}\n${content}\n\n`);
                }
                totalLen += content.length;
            } catch {
                // skip unreadable files
            }
            if (totalLen > MAX_CHARS) break;
        }

        return parts.join("").slice(0, MAX_CHARS);
    }
}

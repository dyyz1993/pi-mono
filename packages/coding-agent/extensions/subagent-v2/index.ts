import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { StringEnum } from "@dyyz1993/pi-ai";
import {
  type AgentScope,
  type ExtensionAPI,
  createTypedChannel,
  discoverAgents,
} from "@dyyz1993/pi-coding-agent";
import { Text } from "@dyyz1993/pi-tui";
import { Type } from "typebox";
import { getExtensionRuntimeResourcePolicy } from "../runtime-policy.ts";

import { type SubagentChannelContract } from "./subagent-shared/index.ts";
import type { CoordinatorChannelContract } from "../coordinator/types.ts";

interface SubagentDetails {
  agentScope: AgentScope;
  projectAgentsDir: string | null;
  requestedAgentName?: string;
  resolvedAgentName?: string;
  usedDefaultAgent?: boolean;
  result: {
    sessionId: string;
    status: string;
    exitCode: number;
    finalText: string;
    error?: string;
  } | null;
}

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
  description: 'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
  default: "user",
});

type AgentCandidate = { name: string };

export function resolveSubagentAgentName(
  requested: string | undefined,
  agents: AgentCandidate[],
): { requestedAgentName?: string; resolvedAgentName: string | null; usedDefaultAgent: boolean } {
  const requestedAgentName = requested?.trim() || undefined;
  const normalized = requestedAgentName?.toLowerCase();
  const shouldUseDefault = !requestedAgentName || normalized === "default" || normalized === "auto";
  if (!shouldUseDefault) {
    return { requestedAgentName, resolvedAgentName: requestedAgentName, usedDefaultAgent: false };
  }

  const preferred = agents.find((agent) => agent.name === "worker")
    ?? agents.find((agent) => agent.name === "build")
    ?? agents[0]
    ?? null;

  return {
    requestedAgentName,
    resolvedAgentName: preferred?.name ?? null,
    usedDefaultAgent: true,
  };
}

const SubagentParams = Type.Object({
  agent: Type.Optional(Type.String({
    description: [
      "Name of the agent to invoke.",
      "If omitted, auto, or default, the runtime resolves to worker, then build, then the first available agent.",
      "Use interactive-worker when the subtask may need to ask the user with ask-user-question.",
      'Do not pass the literal string "default" unless you intentionally want automatic resolution.',
    ].join(" "),
  })),
  agentName: Type.Optional(Type.String({
    description: "Alias for agent. Prefer agent; accepted for compatibility with UI/API naming.",
  })),
  task: Type.String({ description: "Task instruction to delegate to the agent" }),
  description: Type.Optional(Type.String({ description: "Short (3-5 word) summary of the task, shown in UI. If omitted, derived from the task parameter." })),
  model: Type.Optional(Type.String({ description: "Model override for the subagent (e.g. 'claude-sonnet-4-20250514'). Takes precedence over the agent definition's model. If omitted, inherits from the agent definition or parent." })),
  background: Type.Optional(Type.Boolean({ description: "Run in background mode. Default: false.", default: false })),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds. Default: 300.", default: 300 })),
  cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
  agentScope: Type.Optional(AgentScopeSchema),
  confirmProjectAgents: Type.Optional(
    Type.Boolean({ description: "Prompt before running project-local agents. Default: true.", default: true }),
  ),
  maxDepth: Type.Optional(Type.Number({ description: "Max recursion depth for subagent chain. Default: 5.", default: 5 })),
  variables: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "Variables to pass to the subagent. Use $variable_name in task to reference them." })),
});

const SubagentResumeParams = Type.Object({
  sessionId: Type.Optional(Type.String({ description: "Session ID from previous run" })),
  sessionPath: Type.Optional(Type.String({ description: "Path to the saved session file" })),
  instruction: Type.Optional(Type.String({ description: "Additional instruction for the resumed agent" })),
  background: Type.Optional(Type.Boolean({ description: "Run in background mode. Default: false.", default: false })),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds. Default: 300.", default: 300 })),
});

export function resolveSessionPath(sessionId: string, sessionsBase?: string): string | null {
  const base = sessionsBase ?? join(homedir(), ".pi", "agent", "sessions");
  if (!existsSync(base)) return null;

  function scanDir(dir: string): string | null {
    try {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          const candidate = join(full, `${sessionId}.jsonl`);
          if (existsSync(candidate)) return candidate;
          const nested = scanDir(full);
          if (nested) return nested;
        } else if (entry === `${sessionId}.jsonl`) {
          return full;
        }
      }
    } catch {
      // ignore permission errors etc
    }
    return null;
  }

  return scanDir(base);
}

export default function(pi: ExtensionAPI) {
  const runtimePolicy = getExtensionRuntimeResourcePolicy();
  const canLoadConfiguredAgents = runtimePolicy.canLoadUserAgents || runtimePolicy.canLoadProjectAgents;
  const rawChannel = pi.registerChannel("subagent");
  const channel = createTypedChannel<SubagentChannelContract>(rawChannel).server;

  const coordinatorRaw = pi.registerChannel("coordinator_client");
  const coordinatorClient = createTypedChannel<CoordinatorChannelContract>(coordinatorRaw).client;

  /** Probe coordinator availability with a short timeout. Returns an error message or null. */
  async function probeCoordinator(): Promise<string | null> {
    console.error(`[DIAG:probeCoordinator] coordinatorRaw.name=${coordinatorRaw.name} resolved=${(coordinatorRaw as unknown as { call?: unknown }).call !== undefined}`);
    try {
      await coordinatorClient.call("session_delegate_list", {}, 5_000);
      console.error(`[DIAG:probeCoordinator] call succeeded`);
      return null;
    } catch (err) {
      console.error(`[DIAG:probeCoordinator] call failed: ${err instanceof Error ? err.message : String(err)}`);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("timed out") || msg.includes("timeout")) {
        return "Coordinator extension is not available. Ensure the coordinator extension is loaded (it provides the Process Manager and session delegation).";
      }
      return `Coordinator channel error: ${msg}`;
    }
  }

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: !canLoadConfiguredAgents
      ? [
        "Delegate a task to a builtin subagent with isolated context.",
        "SSH tool-proxy mode (quick SSH sandbox) does not expose local user or project agent files.",
        "The task is dispatched through the coordinator channel to Process Manager.",
      ].join(" ")
      : [
        "Delegate a task to a specialized subagent with isolated context.",
        "Agents are discovered from ~/.pi/agent/agents/ (user) and .pi/agents/ (project).",
        'Use agentScope to control discovery: "user" (default), "project", or "both".',
        "The task is dispatched through the coordinator channel to Process Manager.",
      ].join(" "),
    parameters: SubagentParams,

    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      const startedAt = Date.now();
      const agentScope: AgentScope = params.agentScope ?? "user";
      const discovery = discoverAgents(ctx.cwd, agentScope);
      const agents = discovery.agents;
      const timeoutMs = (params.timeout ?? 300) * 1000;

      // ── Recursion depth check ──
      const maxDepth = params.maxDepth ?? 5;
      const currentDepth = parseInt(process.env.PI_SUBAGENT_DEPTH ?? "0", 10) || 0;
      if (currentDepth >= maxDepth) {
        return {
          content: [{
            type: "text",
            text: `Max subagent recursion depth (${maxDepth}) reached. Current depth: ${currentDepth}. Refusing to delegate deeper.`,
          }],
          details: { agentScope, projectAgentsDir: discovery.projectAgentsDir, result: null },
          isError: true,
        };
      }

      // ── Variable template injection ──
      let resolvedTask = params.task;
      if (params.variables) {
        // Sort keys longest-first to prevent shorter keys from matching
        // inside longer ones (e.g. $foo inside $foobar).
        const entries = Object.entries(params.variables).sort(([a], [b]) => b.length - a.length);
        for (const [key, value] of entries) {
          resolvedTask = resolvedTask.replaceAll(`$${key}`, value);
        }
      }

      const details: SubagentDetails = {
        agentScope,
        projectAgentsDir: discovery.projectAgentsDir,
        result: null,
      };
      const requestedAgent = params.agent ?? params.agentName;
      const agentResolution = resolveSubagentAgentName(requestedAgent, agents);
      if (agentResolution.requestedAgentName) details.requestedAgentName = agentResolution.requestedAgentName;
      if (agentResolution.resolvedAgentName) details.resolvedAgentName = agentResolution.resolvedAgentName;
      details.usedDefaultAgent = agentResolution.usedDefaultAgent;
      const resolvedAgentName = agentResolution.resolvedAgentName;
      if (!resolvedAgentName) {
        return {
          content: [{ type: "text", text: "No subagent is available. Add an agent under ~/.pi/agent/agents/ or .pi/agents/." }],
          details,
          isError: true,
        };
      }
      const agent = agents.find((a) => a.name === resolvedAgentName);

      if (
        (agentScope === "project" || agentScope === "both") &&
        (params.confirmProjectAgents ?? true) &&
        ctx.hasUI
      ) {
        if (agent?.source === "project") {
          const dir = discovery.projectAgentsDir ?? "(unknown)";
          const ok = await ctx.ui.confirm(
            "Run project-local agent?",
            `Agent: ${agent.name}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
            { timeout: 30_000 },
          );
          if (!ok)
            return {
              content: [{ type: "text", text: "Canceled: project-local agent not approved." }],
              details,
            };
        }
      }

      if (!agent) {
        const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
        const requested = agentResolution.requestedAgentName ?? resolvedAgentName;
        return {
          content: [{ type: "text", text: `Unknown agent: "${requested}". Available agents: ${available}.` }],
          details,
        };
      }

      // ── Coordinator availability check (after agent discovery, before RPC) ──
      const coordError = await probeCoordinator();
      if (coordError) {
        return {
          content: [{ type: "text", text: coordError }],
          details,
          isError: true,
        };
      }

      const title = params.description ?? `${resolvedAgentName}: ${params.task.slice(0, 40)}`;

      // Subscribe to delegate_progress events during the sync call
      const unsubProgress = coordinatorClient.on("delegate_progress", (progressData) => {
        if (progressData.toolCallId !== toolCallId) return;
        pi.appendEntry("subagent_progress", {
          toolCallId,
          sessionId: progressData.sessionId,
          eventType: progressData.eventType,
          data: progressData.data,
        });
      });

      try {
        const result = await coordinatorClient.call(
          "session_delegate_sync",
          {
            task: resolvedTask,
            title,
            agent: resolvedAgentName,
            model: params.model,
            timeoutMs,
            projectPath: params.cwd ?? ctx.cwd,
            depth: currentDepth + 1,
            variables: params.variables,
            toolCallId,
          },
          timeoutMs + 30_000,
        );

        pi.appendEntry("subagent", {
          toolCallId,
          sessionId: result.sessionId,
          sessionPath: "",
          description: params.description ?? resolvedAgentName,
          instruction: params.task,
          startedAt,
          completedAt: Date.now(),
          exitCode: result.exitCode,
          finalText: result.finalText,
        });

        if (result.exitCode !== 0) {
          return {
            content: [
              {
                type: "text",
                text: `Agent ${result.status}: ${result.error || result.finalText}`,
              },
            ],
            details: { ...details, result },
            isError: true,
          };
        }

        return {
          content: [{ type: "text", text: result.finalText }],
          details: { ...details, result },
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Agent failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details,
          isError: true,
        };
      } finally {
        unsubProgress();
      }
    },

    renderCall(args, theme, _context) {
      const scope: AgentScope = args.agentScope ?? "user";
      const agentName = args.agent || args.agentName || "...";
      const desc = args.description || "";
      const preview = args.task ? (args.task.length > 60 ? `${args.task.slice(0, 60)}...` : args.task) : "...";
      const currentDepth = parseInt(process.env.PI_SUBAGENT_DEPTH ?? "0", 10) || 0;
      const maxDepth = args.maxDepth ?? 5;
      const depthTag = currentDepth > 0 ? ` [depth ${currentDepth + 1}/${maxDepth}]` : "";
      let text =
        theme.fg("toolTitle", theme.bold("subagent ")) +
        theme.fg("accent", agentName);
      if (desc) text += theme.fg("muted", ` — ${desc}`);
      text += theme.fg("muted", ` [${scope}]${depthTag}`);
      text += `\n  ${theme.fg("dim", preview)}`;
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme, _context) {
      const details = result.details as SubagentDetails | undefined;
      if (!details?.result) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
      }
      const r = details.result;
      return new Text(
        theme.fg("toolTitle", "subagent result") +
        (r.exitCode !== 0 ? theme.fg("error", ` [exit: ${r.exitCode}]`) : "") +
        `\n  ${r.finalText.slice(0, 300)}`,
        0,
        0,
      );
    },
  });

  pi.registerTool({
    name: "subagent_resume",
    label: "Subagent Resume",
    description: "Resume a previously interrupted subagent session by dispatching a new session with resume context.",
    parameters: SubagentResumeParams,

    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      let sPath = params.sessionPath;
      if (!sPath && params.sessionId) {
        sPath = resolveSessionPath(params.sessionId) ?? undefined;
      }
      if (!sPath) {
        if (params.sessionId) {
          return {
            content: [{ type: "text", text: `Session file not found for sessionId: ${params.sessionId}` }],
            details: { agentScope: "user" as AgentScope, projectAgentsDir: null, result: null },
          };
        }
        return {
          content: [{ type: "text", text: "Either sessionId or sessionPath is required." }],
          details: { agentScope: "user" as AgentScope, projectAgentsDir: null, result: null },
        };
      }

      const timeoutMs = (params.timeout ?? 300) * 1000;
      const details: SubagentDetails = { agentScope: "user", projectAgentsDir: null, result: null };
      const startedAt = Date.now();
      const resumePrompt =
        params.instruction ?? "Continue the previous task from where you left off.";
      const currentDepth = parseInt(process.env.PI_SUBAGENT_DEPTH ?? "0", 10) || 0;

      // ── Coordinator availability check (after session path validation, before RPC) ──
      const coordError = await probeCoordinator();
      if (coordError) {
        return {
          content: [{ type: "text", text: coordError }],
          details,
          isError: true,
        };
      }

      // Subscribe to delegate_progress events during the sync call
      const unsubProgress = coordinatorClient.on("delegate_progress", (progressData) => {
        if (progressData.toolCallId !== toolCallId) return;
        pi.appendEntry("subagent_progress", {
          toolCallId,
          sessionId: progressData.sessionId,
          eventType: progressData.eventType,
          data: progressData.data,
        });
      });

      try {
        const result = await coordinatorClient.call(
          "session_delegate_sync",
          {
            task: `[Resuming from session: ${sPath.split("/").pop()}]\n\n${resumePrompt}`,
            title: `Resume: ${sPath.split("/").pop()}`,
            timeoutMs,
            projectPath: ctx.cwd,
            depth: currentDepth,
            toolCallId,
          },
          timeoutMs + 30_000,
        );

        pi.appendEntry("subagent", {
          toolCallId,
          sessionId: result.sessionId,
          sessionPath: sPath,
          description: "(resumed)",
          instruction: params.instruction ?? "(resume)",
          startedAt,
          completedAt: Date.now(),
          exitCode: result.exitCode,
          finalText: result.finalText,
        });

        if (result.exitCode !== 0) {
          return {
            content: [
              {
                type: "text",
                text: `Agent ${result.status}: ${result.error || result.finalText}`,
              },
            ],
            details: { ...details, result },
            isError: true,
          };
        }

        return {
          content: [{ type: "text", text: result.finalText }],
          details: { ...details, result },
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Resume failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details,
          isError: true,
        };
      } finally {
        unsubProgress();
      }
    },

    renderCall(args, theme, _context) {
      const sPath = args.sessionPath ?? args.sessionId ?? "...";
      return new Text(theme.fg("toolTitle", theme.bold("subagent_resume ")) + theme.fg("accent", sPath), 0, 0);
    },

    renderResult(result, { expanded }, theme, _context) {
      const details = result.details as SubagentDetails | undefined;
      if (!details?.result) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
      }
      const r = details.result;
      return new Text(
        theme.fg("toolTitle", "subagent_resume result") +
        (r.exitCode !== 0 ? theme.fg("error", ` [exit: ${r.exitCode}]`) : "") +
        `\n  ${r.finalText.slice(0, 300)}`,
        0,
        0,
      );
    },
  });
}

export function extractParentTodos(branch: unknown[]): Array<{ id: number; text: string; priority?: string; done: boolean }> {
  let todos: Array<{ id: number; text: string; done: boolean; deleted?: boolean; priority?: string }> = [];
  let nextId = 1;

  for (const entry of branch) {
    const e = entry as Record<string, unknown>;
    if (e.type === "custom" && (e as Record<string, unknown>).customType === "todo") {
      const data = (e as Record<string, unknown>).data as Record<string, unknown> | undefined;
      if (data?.todos) {
        todos = data.todos as typeof todos;
        nextId = (data.nextId as number) ?? nextId;
      }
      continue;
    }
    if (e.type !== "message") continue;
    const msg = (e as Record<string, unknown>).message as Record<string, unknown> | undefined;
    if (!msg || msg.role !== "toolResult" || (msg as Record<string, unknown>).toolName !== "todo") continue;
    const details = (msg as Record<string, unknown>).details as Record<string, unknown> | undefined;
    if (details?.todos) {
      todos = details.todos as typeof todos;
      nextId = (details.nextId as number) ?? nextId;
    }
  }

  return todos
    .filter((t) => !t.deleted && !t.done)
    .map((t) => ({ id: t.id, text: t.text, priority: t.priority, done: t.done }));
}

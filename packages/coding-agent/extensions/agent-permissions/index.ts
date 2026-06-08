/**
 * Agent Permissions Extension
 *
 * Implements Claude Code-style permissionMode for sub-agents.
 * Works with AgentConfig.permissionMode to control tool access.
 *
 * Modes:
 *   normal       — default behavior, all tools allowed, dangerous bash blocked
 *   yolo         — auto-allow everything (no blocking)
 *   auto         — (legacy) same as normal
 *   acceptEdits  — (legacy) same as normal
 *   dontAsk      — (legacy) same as yolo
 *   always-allow — (legacy) same as yolo
 *   always-deny  — block everything
 */

import type { AgentConfig, ExtensionAPI, ExtensionContext } from "@dyyz1993/pi-coding-agent";
import { createPathPermissionHandler, type PathConfig } from "./path-checker.ts";

const READ_TOOLS = new Set(["read", "grep", "find", "ls", "glob"]);
const EDIT_TOOLS = new Set(["edit", "write"]);
const DANGEROUS_BASH_PATTERNS = [
  /\brm\s+-rf\b/,
  /\bgit\s+push\s+.*--force\b/,
  /--no-verify/,
  /\bsudo\b/,
  /\bchmod\s+777\b/,
  /\.env/,
  /credentials/i,
];

interface PermissionRule {
  mode: string;
  allowedTools: Set<string> | null;
  blockedTools: Set<string> | null;
  blockBashPatterns: RegExp[] | null;
}

const RULES: Record<string, PermissionRule> = {
  normal: {
    mode: "normal",
    allowedTools: null,
    blockedTools: null,
    blockBashPatterns: DANGEROUS_BASH_PATTERNS,
  },
  yolo: {
    mode: "yolo",
    allowedTools: null,
    blockedTools: null,
    blockBashPatterns: null,
  },
  auto: {
    mode: "auto",
    allowedTools: null,
    blockedTools: null,
    blockBashPatterns: DANGEROUS_BASH_PATTERNS,
  },
  acceptEdits: {
    mode: "acceptEdits",
    allowedTools: null,
    blockedTools: null,
    blockBashPatterns: DANGEROUS_BASH_PATTERNS,
  },
  dontAsk: {
    mode: "dontAsk",
    allowedTools: null,
    blockedTools: null,
    blockBashPatterns: null,
  },
  "always-allow": {
    mode: "always-allow",
    allowedTools: null,
    blockedTools: null,
    blockBashPatterns: null,
  },
  "always-deny": {
    mode: "always-deny",
    allowedTools: new Set(),
    blockedTools: null,
    blockBashPatterns: null,
  },
};

function matchesToolPattern(toolName: string, input: Record<string, unknown>, pattern: string): boolean {
  const parenIdx = pattern.indexOf("(");
  if (parenIdx === -1) {
    if (pattern === "*") return true;
    if (pattern.startsWith("*") && pattern.endsWith("*")) {
      const middle = pattern.slice(1, -1);
      return toolName.includes(middle);
    }
    if (pattern.startsWith("*")) {
      const suffix = pattern.slice(1);
      return toolName.endsWith(suffix);
    }
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      return toolName.startsWith(prefix);
    }
    return pattern === toolName;
  }

  const baseTool = pattern.substring(0, parenIdx).trim();
  if (baseTool !== toolName) return false;

  const globPattern = pattern.substring(parenIdx + 1, pattern.lastIndexOf(")")).trim();
  if (!globPattern || globPattern === "*") return true;

  const parts = globPattern.split("|");
  const inputStr = JSON.stringify(input);
  const command = typeof input.command === "string" ? input.command : "";
  const filePath = typeof input.filePath === "string" ? input.filePath : "";

  // Try to match against relevant input fields
  const targets = [command, filePath, inputStr].filter(Boolean);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Check if pattern starts/ends with * to determine anchors
    const startsWithWildcard = trimmed.startsWith("*");
    const endsWithWildcard = trimmed.endsWith("*");

    // Escape special regex characters EXCEPT: * and [] brackets
    let regexStr = trimmed.replace(/[.+?^$()|\\]/g, "\\$&");

    // Convert * to .*
    regexStr = regexStr.replace(/\*/g, ".*");

    // Add anchors based on wildcards
    if (!startsWithWildcard) regexStr = "^" + regexStr;
    if (!endsWithWildcard) regexStr = regexStr + "$";

    const regex = new RegExp(regexStr);
    for (const target of targets) {
      if (regex.test(target)) return true;
    }
  }
  return false;
}

function matchesDisallowedTool(
  toolName: string,
  input: Record<string, unknown>,
  patterns: string[],
): boolean {
  for (const pattern of patterns) {
    if (matchesToolPattern(toolName, input, pattern)) {
      return true;
    }
  }
  return false;
}

export function createPermissionHandler(agentConfig: AgentConfig) {
  const rawMode = agentConfig.permissionMode ?? "normal";
  const mode = rawMode === "dontAsk" || rawMode === "always-allow" ? "yolo"
    : rawMode === "auto" || rawMode === "acceptEdits" ? "normal"
    : rawMode;
  const rule = RULES[mode];
  if (!rule) return null;

  const disallowedTools = agentConfig.disallowedTools ?? [];
  const allowedToolList = agentConfig.tools;

  return (event: { toolName: string; input: Record<string, unknown> }): { block: boolean; reason?: string } | null => {
    if (allowedToolList && allowedToolList.length > 0) {
      const isAllowed = allowedToolList.some((pattern) => matchesToolPattern(event.toolName, event.input, pattern));
      if (!isAllowed) {
        return {
          block: true,
          reason: `[agent:${agentConfig.name}] Tool "${event.toolName}" not in agent's tool whitelist. Allowed: ${allowedToolList.join(", ")}`,
        };
      }
    }

    if (rule.allowedTools !== null && !rule.allowedTools.has(event.toolName)) {
      const allowed = Array.from(rule.allowedTools).join(", ");
      return {
        block: true,
        reason: `[${mode} mode] Tool "${event.toolName}" not allowed. Allowed: ${allowed}`,
      };
    }

    if (rule.blockedTools !== null && rule.blockedTools.has(event.toolName)) {
      return {
        block: true,
        reason: `[${mode} mode] Tool "${event.toolName}" is blocked (read-only mode).`,
      };
    }

    if (event.toolName === "bash" && rule.blockBashPatterns) {
      const command = event.input?.command;
      if (typeof command === "string") {
        for (const pat of rule.blockBashPatterns) {
          if (pat.test(command)) {
            return {
              block: true,
              reason: `[${mode} mode] Blocked dangerous bash command: ${command}`,
            };
          }
        }
      }
    }

    if (disallowedTools.length > 0 && matchesDisallowedTool(event.toolName, event.input, disallowedTools)) {
      return {
        block: true,
        reason: `[agent:${agentConfig.name}] Tool "${event.toolName}" is explicitly disallowed.`,
      };
    }

    return null;
  };
}

export default function agentPermissions(pi: ExtensionAPI, ctx: ExtensionContext): void {
  pi.on("tool_call", (event) => {
    const vars = (event as { variables?: Record<string, string> }).variables;
    const mode = vars?.["permissionMode"];
    const agentName = vars?.["agentName"] ?? "unknown";
    const allowedTools = vars?.["allowedTools"]?.split(",").filter(Boolean);
    const disallowedTools = vars?.["allowedTools"] !== undefined
      ? vars?.["disallowedTools"]?.split(",").filter(Boolean) ?? []
      : vars?.["disallowedTools"]?.split(",").filter(Boolean);

    // Path-level permission check (runs before tool-level checks)
    const pathsJson = vars?.["paths"];
    if (pathsJson) {
      try {
        const paths = JSON.parse(pathsJson) as PathConfig;
        const pathHandler = createPathPermissionHandler(paths);
        if (pathHandler) {
          const pathResult = pathHandler({ toolName: event.toolName, input: event.input });
          if (pathResult?.block) {
            return { block: true, reason: pathResult.reason };
          }
        }
      } catch {
        // If path parsing fails, continue with normal permission checks
      }
    }

    // Permission mode-based rules (only for non-auto/yolo modes)
    if (!mode || mode === "auto" || mode === "normal" || mode === "dontAsk" || mode === "always-allow" || mode === "yolo") {
      // Still check allowedTools/disallowedTools even in auto mode
      if (allowedTools && allowedTools.length > 0) {
        const handler = createPermissionHandler({
          name: agentName,
          description: "",
          permissionMode: "normal",
          disallowedTools,
          tools: allowedTools,
        } as AgentConfig);
        if (handler) {
          const result = handler({ toolName: event.toolName, input: event.input });
          if (result?.block) {
            return { block: true, reason: result.reason };
          }
        }
      } else if (disallowedTools && disallowedTools.length > 0) {
        const handler = createPermissionHandler({
          name: agentName,
          description: "",
          permissionMode: "normal",
          disallowedTools,
        } as AgentConfig);
        if (handler) {
          const result = handler({ toolName: event.toolName, input: event.input });
          if (result?.block) {
            return { block: true, reason: result.reason };
          }
        }
      }
      return undefined;
    }

    const handler = createPermissionHandler({
      name: agentName,
      description: "",
      permissionMode: mode as AgentConfig["permissionMode"],
      disallowedTools,
      tools: allowedTools,
    } as AgentConfig);

    if (!handler) return undefined;
    const result = handler({ toolName: event.toolName, input: event.input });
    if (result?.block) {
      return { block: true, reason: result.reason };
    }
    return undefined;
  });
}

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { spawn } from "node:child_process";
import { Text } from "atonal";

/**
 * LSP 环境变量注入扩展
 * 
 * 功能：
 * 1. 在工具调用前注入环境变量（如 API keys）
 * 2. 支持多种环境变量来源：.env 文件、系统环境变量、配置文件
 * 3. 提供 /lsp-env 命令管理环境变量
 */
export default function(pi: ExtensionAPI) {
  // 环境变量存储
  const envStore = new Map<string, string>();
  
  // 支持的环境变量来源
  type EnvSource = "env" | "dotenv" | "config";
  
  // ============================================================
  // 1. 会话初始化：恢复环境变量状态
  // ============================================================
  pi.on("session_start", async (_event, ctx) => {
    // 从会话历史中恢复环境变量
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === "lsp-env-state") {
        const state = entry.data as Record<string, string>;
        Object.entries(state).forEach(([key, value]) => {
          envStore.set(key, value);
        });
        break;
      }
    }
    
    if (envStore.size > 0) {
      ctx.ui.notify(`LSP Env 已加载 ${envStore.size} 个环境变量`, "info");
    }
  });

  // ============================================================
  // 2. 工具调用拦截：注入环境变量
  // ============================================================
  pi.on("tool_call", async (event, ctx) => {
    // 只处理需要环境变量的工具
    const toolsNeedingEnv = ["bash", "mcp_call", "spawn"];
    if (!toolsNeedingEnv.includes(event.toolName)) {
      return { action: "continue" };
    }
    
    if (envStore.size === 0) {
      return { action: "continue" };
    }
    
    // 检查是否是 LSP 相关命令
    const lspCommands = ["npx", "node", "npm", "pnpm", "yarn"];
    const needsEnv = lspCommands.some(cmd => 
      event.input.command?.includes(cmd) || 
      event.input.command?.startsWith(cmd)
    );
    
    if (needsEnv) {
      // 注入环境变量到命令
      const envPrefix = Array.from(envStore.entries())
        .map(([key, value]) => `${key}=${shellEscape(value)}`)
        .join(" ");
      
      return {
        action: "modify",
        input: {
          ...event.input,
          command: `${envPrefix} ${event.input.command}`,
          env: {
            ...event.input.env,
            ...Object.fromEntries(envStore),
          },
        },
      };
    }
    
    return { action: "continue" };
  });

  // ============================================================
  // 3. 自定义工具：设置环境变量
  // ============================================================
  pi.registerTool({
    name: "lsp_set_env",
    label: "设置 LSP 环境变量",
    description: "为 LSP 进程设置环境变量（如 API keys）",
    parameters: Type.Object({
      key: Type.String({ description: "环境变量名" }),
      value: Type.String({ description: "环境变量值" }),
      source: StringEnum(["env", "dotenv", "config"] as const, {
        description: "环境变量来源",
        default: "env",
      }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      envStore.set(params.key, params.value);
      
      ctx.ui.setStatus("lsp-env", `${envStore.size} 个环境变量`);
      
      return {
        content: [{
          type: "text",
          text: `✓ 已设置环境变量: ${params.key} (来源: ${params.source})`,
        }],
        details: {
          key: params.key,
          value: params.value,
          source: params.source,
          totalVars: envStore.size,
        },
      };
    },
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", `设置环境变量: ${args.key}`), 0, 0);
    },
    renderResult(result, { expanded }, theme) {
      const details = result.details;
      if (details) {
        return new Text(
          theme.fg("success", `✓ 已设置 ${details.key} (${details.totalVars} 个环境变量)`),
          0, 0
        );
      }
      return new Text(theme.fg("success", "✓ 环境变量已设置"), 0, 0);
    },
  });

  // ============================================================
  // 4. 自定义工具：从 .env 文件加载
  // ============================================================
  pi.registerTool({
    name: "lsp_load_env",
    label: "加载 .env 文件",
    description: "从 .env 文件加载环境变量",
    parameters: Type.Object({
      path: Type.String({
        description: ".env 文件路径",
        default: ".env",
      }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      
      try {
        const envPath = path.resolve(params.path);
        const content = await fs.readFile(envPath, "utf-8");
        
        const lines = content.split("\n");
        let loaded = 0;
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          
          const [key, ...valueParts] = trimmed.split("=");
          const value = valueParts.join("=").replace(/^["']|["']$/g, "");
          
          if (key && value) {
            envStore.set(key, value);
            loaded++;
          }
        }
        
        ctx.ui.setStatus("lsp-env", `${envStore.size} 个环境变量`);
        
        return {
          content: [{
            type: "text",
            text: `✓ 已从 ${envPath} 加载 ${loaded} 个环境变量\n` +
                  `当前共 ${envStore.size} 个环境变量`,
          }],
          details: {
            path: envPath,
            loaded,
            total: envStore.size,
          },
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `✗ 加载失败: ${error.message}`,
          }],
          isError: true,
        };
      }
    },
  });

  // ============================================================
  // 5. 自定义工具：列出环境变量
  // ============================================================
  pi.registerTool({
    name: "lsp_list_env",
    label: "列出 LSP 环境变量",
    description: "列出所有已设置的环境变量",
    parameters: Type.Object({}),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (envStore.size === 0) {
        return {
          content: [{
            type: "text",
            text: "当前没有设置任何环境变量",
          }],
        };
      }
      
      const list = Array.from(envStore.entries())
        .map(([key, value]) => {
          // 对敏感信息脱敏
          const display = key.includes("KEY") || key.includes("SECRET") || key.includes("TOKEN")
            ? `${value.slice(0, 8)}...${value.slice(-4)}`
            : value;
          return `  ${key}=${display}`;
        })
        .join("\n");
      
      return {
        content: [{
          type: "text",
          text: `已设置 ${envStore.size} 个环境变量:\n${list}`,
        }],
        details: {
          count: envStore.size,
          keys: Array.from(envStore.keys()),
        },
      };
    },
  });

  // ============================================================
  // 6. 自定义工具：清除环境变量
  // ============================================================
  pi.registerTool({
    name: "lsp_clear_env",
    label: "清除 LSP 环境变量",
    description: "清除指定的环境变量或所有环境变量",
    parameters: Type.Object({
      key: Type.Optional(Type.String({
        description: "要清除的环境变量名（不指定则清除所有）",
      })),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (params.key) {
        const existed = envStore.delete(params.key);
        ctx.ui.setStatus("lsp-env", `${envStore.size} 个环境变量`);
        return {
          content: [{
            type: "text",
            text: existed
              ? `✓ 已清除环境变量: ${params.key}`
              : `✗ 环境变量不存在: ${params.key}`,
          }],
        };
      } else {
        const count = envStore.size;
        envStore.clear();
        ctx.ui.setStatus("lsp-env", undefined);
        return {
          content: [{
            type: "text",
            text: `✓ 已清除所有 ${count} 个环境变量`,
          }],
        };
      }
    },
  });

  // ============================================================
  // 7. 自定义命令：/lsp-env
  // ============================================================
  pi.registerCommand("lsp-env", {
    description: "管理 LSP 环境变量 (set/get/list/clear/load)",
    getArgumentCompletions: (prefix) => {
      const subcommands = ["set", "get", "list", "clear", "load"];
      return subcommands
        .filter(cmd => cmd.startsWith(prefix))
        .map(cmd => ({ value: cmd, label: cmd }));
    },
    handler: async (args, ctx) => {
      const parts = args.split(/\s+/);
      const subcommand = parts[0];
      
      switch (subcommand) {
        case "set": {
          const [, key, value] = parts;
          if (!key || !value) {
            ctx.ui.notify("用法: /lsp-env set <KEY> <VALUE>", "error");
            return;
          }
          envStore.set(key, value);
          ctx.ui.setStatus("lsp-env", `${envStore.size} 个环境变量`);
          ctx.ui.notify(`已设置: ${key}`, "success");
          break;
        }
        
        case "get": {
          const [, key] = parts;
          if (!key) {
            ctx.ui.notify("用法: /lsp-env get <KEY>", "error");
            return;
          }
          const value = envStore.get(key);
          if (value) {
            ctx.ui.notify(`${key}=${value}`, "info");
          } else {
            ctx.ui.notify(`环境变量不存在: ${key}`, "error");
          }
          break;
        }
        
        case "list":
        case "":
          if (envStore.size === 0) {
            ctx.ui.notify("没有设置任何环境变量", "info");
          } else {
            const list = Array.from(envStore.keys()).join(", ");
            ctx.ui.notify(`环境变量 (${envStore.size}): ${list}`, "info");
          }
          break;
        
        case "clear": {
          const [, key] = parts;
          if (key) {
            const existed = envStore.delete(key);
            ctx.ui.notify(
              existed ? `已清除: ${key}` : `不存在: ${key}`,
              existed ? "success" : "error"
            );
          } else {
            const count = envStore.size;
            envStore.clear();
            ctx.ui.notify(`已清除 ${count} 个环境变量`, "success");
          }
          ctx.ui.setStatus("lsp-env", envStore.size > 0 ? `${envStore.size} 个环境变量` : undefined);
          break;
        }
        
        case "load": {
          const [, path = ".env"] = parts;
          // 使用工具加载
          await ctx.ui.notify(`正在加载: ${path}`, "info");
          break;
        }
        
        default:
          ctx.ui.notify(
            `未知子命令: ${subcommand}\n可用命令: set, get, list, clear, load`,
            "error"
          );
      }
    },
  });

  // ============================================================
  // 8. 会话结束：保存状态
  // ============================================================
  pi.on("session_shutdown", async (_event, ctx) => {
    if (envStore.size > 0) {
      pi.appendEntry("lsp-env-state", Object.fromEntries(envStore));
    }
    ctx.ui.setStatus("lsp-env", undefined);
  });

  // ============================================================
  // 辅助函数
  // ============================================================
  function shellEscape(str: string): string {
    if (/^[a-zA-Z0-9_\-./]+$/.test(str)) {
      return str;
    }
    return `"${str.replace(/"/g, '\\"')}"`;
  }
}

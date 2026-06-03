import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const OPERATIONS = [
  {
    label: "Update d21f3474mon83e9f (Pi Coding Agent Extension Development Guide)",
    tool: "kb_update",
    args: {
      id: "d21f3474mon83e9f",
      append_content:
        "## Extension Storage Paths (v0.70.1+)\n\nExtensions now have access to standardized storage paths through `ExtensionContext`, automatically namespaced by extension name.\n\n### Available Paths\n\n| Property | Scope | Path Template |\n|---|---|---|\n| `ctx.sessionDataDir` | Session | `~/.pi/agent/sessions/<project>/data/<sessionId>/<ext-name>/` |\n| `ctx.cwdDataDir` | CWD | `~/.pi/agent/cwd-data/<encoded-cwd>/<ext-name>/` |\n| `ctx.projectDataDir` | Project | `~/.pi/agent/project-data/<encoded-project>/<ext-name>/` |\n| `ctx.globalDataDir` | Global | `~/.pi/agent/extensions-data/<ext-name>/` |\n\n### Extension Naming\n\n- `ctx.extensionName` — current extension's name\n- `pi.setName(name)` — override auto-derived name (in ExtensionAPI)\n- `pi.extensionName` — read current name (in ExtensionAPI)\n- Auto-derived from: package.json name (strips @scope/), directory name, or filename\n- Duplicate names cause load-time error\n\n### ctx.projectRoot\n\nCanonical git root (worktree-aware). Falls back to cwd if not a git repo.",
    },
  },
  {
    label: "Update dcdfb484mon857xf (pi 插件开发实战速查手册)",
    tool: "kb_update",
    args: {
      id: "dcdfb484mon857xf",
      append_content:
        '## 新增：扩展存储路径 (v0.70.1+)\n\n```typescript\n// ExtensionContext 新增属性\nctx.projectRoot     // 主仓库路径（worktree 回溯），非 git 返回 cwd\nctx.extensionName   // 当前扩展名\nctx.sessionDataDir  // 会话级存储（自动按扩展名隔离）\nctx.cwdDataDir      // cwd 级存储（worktree 各自独立）\nctx.projectDataDir  // 项目级存储（worktree 共享）\nctx.globalDataDir   // 全局存储（跨项目）\n```\n\n命名推导：package.json name > 目录名 > 文件名，`pi.setName()` 可覆盖\n冲突检测：加载时同名直接报错\n\n使用示例：\n```typescript\nimport { join } from \'node:path\';\nimport { readFileSync, writeFileSync } from \'node:fs\';\n\n// 会话级缓存\nwriteFileSync(join(ctx.sessionDataDir, \'cache.json\'), JSON.stringify(data));\n\n// 项目级配置（跨 worktree 共享）\nconst config = readFileSync(join(ctx.projectDataDir, \'config.json\'), \'utf-8\');\n\n// 全局知识库\nconst kb = join(ctx.globalDataDir, \'knowledge.json\');\n```',
    },
  },
  {
    label: "Update af7ecdffmomuopgd (pi-mono 完整类型体系与开发指南)",
    tool: "kb_update",
    args: {
      id: "af7ecdffmomuopgd",
      append_content:
        "## ExtensionContext 新增字段 (v0.70.1)\n\n```typescript\ninterface ExtensionContext {\n  // 原有字段...\n  cwd: string;\n  // 新增\n  extensionName: string;   // 当前扩展名\n  projectRoot: string;     // 主仓库路径（worktree-aware）\n  sessionDataDir: string;  // 会话级存储（按扩展名隔离）\n  cwdDataDir: string;      // cwd 级存储\n  projectDataDir: string;  // 项目级存储\n  globalDataDir: string;   // 全局存储\n}\n```\n\n```typescript\n// Extension 接口新增\ninterface Extension {\n  name: string;  // 自动推导或 pi.setName() 设置\n  path: string;\n  // ...\n}\n\n// ExtensionAPI 新增\npi.setName(name: string): void;\npi.extensionName: string;\n```\n\n关键实现文件：\n- storage.ts: resolveProjectRoot(), getSessionDataDir(), getProjectDataDir(), getCwdDataDir(), getGlobalDataDir()\n- runner.ts: createContext(ext?) 按 extension 隔离存储路径\n- loader.ts: deriveExtensionName() 自动推导 + 去重校验",
    },
  },
  {
    label: "Write new document (Extension 命名机制与存储最佳实践)",
    tool: "kb_write",
    args: {
      title: "Extension 命名机制与存储最佳实践",
      content:
        '# Extension 命名机制与存储最佳实践\n\n## 命名规则\n\n每个扩展必须有唯一的名字。命名按以下优先级确定：\n\n1. `pi.setName(\'my-name\')` 显式设置（最高优先级）\n2. `package.json` 的 `name` 字段（自动去除 `@scope/` 前缀）\n3. 目录名（目录型扩展）\n4. 文件名去后缀（单文件扩展，如 `hello.ts` → `hello`）\n\n同名冲突在加载时直接报错，开发阶段即可发现问题。\n\n## 存储层级选择\n\n| 层级 | 属性 | 适用场景 | 示例 |\n|---|---|---|---|\n| 会话 | `ctx.sessionDataDir` | 临时对话数据 | 对话缓存、工作状态 |\n| CWD | `ctx.cwdDataDir` | 按工作目录隔离 | 构建产物、本地缓存 |\n| 项目 | `ctx.projectDataDir` | 跨 worktree 共享 | 项目配置、共享记忆 |\n| 全局 | `ctx.globalDataDir` | 跨项目共享 | 知识库、全局设置 |\n\n## Worktree 场景\n\n```\n主仓库: /Users/alice/projects/myapp\nWorktree: /Users/alice/projects/myapp-feature\n\nctx.cwd = "/Users/alice/projects/myapp-feature"\nctx.projectRoot = "/Users/alice/projects/myapp"\n\nctx.cwdDataDir → 每个worktree独立\nctx.projectDataDir → 所有worktree共享\n```\n\n## 最佳实践\n\n1. 优先使用 `ctx.projectDataDir` 存储项目级数据\n2. 只在需要 worktree 隔离时使用 `ctx.cwdDataDir`\n3. 会话临时数据用 `ctx.sessionDataDir`，避免污染持久存储\n4. 全局配置和知识库用 `ctx.globalDataDir`\n5. 使用 `pi.setName()` 时选择有意义且唯一的名称\n6. 不要在存储路径外硬编码 `~/.pi/agent/` 路径',
      tags: [
        "extension",
        "storage",
        "naming",
        "best-practice",
        "worktree",
      ],
      keywords: [
        "extension",
        "storage",
        "naming",
        "setName",
        "projectRoot",
        "worktree",
        "best-practice",
        "sessionDataDir",
        "cwdDataDir",
        "projectDataDir",
        "globalDataDir",
      ],
      intent: "Extension 命名机制与存储路径的最佳实践指南",
      project_description: "pi-momo-fork",
    },
  },
];

function sendJson(proc, msg) {
  const json = JSON.stringify(msg);
  proc.stdin.write(json + "\n");
}

function parseResponse(data) {
  if (data.startsWith("Content-Length:")) {
    const idx = data.indexOf("\r\n\r\n");
    if (idx !== -1) return JSON.parse(data.slice(idx + 4));
  }
  return JSON.parse(data);
}

function extractText(result) {
  if (result?.content && Array.isArray(result.content)) {
    return result.content.map((c) => c.text || JSON.stringify(c)).join("\n");
  }
  return JSON.stringify(result);
}

async function main() {
  const proc = spawn("npx", ["-y", "@dyyz1993/kb-mcp@1.2.0", "--stdio"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  const pending = new Map();
  let nextId = 1;
  let buffer = "";

  const waitForResponse = (id) =>
    new Promise((resolve) => {
      pending.set(id, resolve);
    });

  proc.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let boundary;
    while ((boundary = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 1);
      if (!line) continue;
      try {
        const msg = parseResponse(line);
        if (msg.id != null && pending.has(msg.id)) {
          pending.get(msg.id)(msg);
          pending.delete(msg.id);
        }
      } catch {}
    }
  });

  proc.stderr.on("data", (chunk) => {
    const text = chunk.toString().trim();
    if (text) console.error("[stderr]", text);
  });

  // Initialize
  const initId = nextId++;
  console.log("Sending initialize request...");
  sendJson(proc, {
    jsonrpc: "2.0",
    id: initId,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "kb-batch-update", version: "1.0.0" },
    },
  });

  const initResp = await waitForResponse(initId);
  console.log(
    "Initialize:",
    JSON.stringify(initResp.result?.serverInfo || initResp.error || "ok")
  );

  // Initialized notification
  sendJson(proc, { jsonrpc: "2.0", method: "notifications/initialized" });
  console.log("Sent initialized notification\n");

  // Execute operations sequentially
  for (let i = 0; i < OPERATIONS.length; i++) {
    const op = OPERATIONS[i];
    const opId = nextId++;
    console.log(`--- Operation ${i + 1}: ${op.label}`);

    sendJson(proc, {
      jsonrpc: "2.0",
      id: opId,
      method: "tools/call",
      params: {
        name: op.tool,
        arguments: op.args,
      },
    });

    const resp = await waitForResponse(opId);
    if (resp.error) {
      console.error(`FAILED: ${JSON.stringify(resp.error)}\n`);
    } else {
      console.log(`SUCCESS: ${extractText(resp.result)}\n`);
    }
  }

  // Cleanup
  proc.kill("SIGTERM");
  setTimeout(() => {
    proc.kill("SIGKILL");
    process.exit(0);
  }, 3000);
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});

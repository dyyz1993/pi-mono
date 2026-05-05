import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const CONTENT = `# Extension Storage & Path API

## Overview

Extensions access standardized storage paths through \`ExtensionContext\`. All paths are automatically created on first access and namespaced by extension name to prevent conflicts.

## Extension Naming

Each extension has a unique name, auto-derived from its location:

| Extension Form | Name Source | Example |
|---|---|---|
| Package (package.json) | \`name\` field (strips @scope/) | @scope/my-ext → my-ext |
| Directory (index.ts/js) | Directory name | my-ext/index.ts → my-ext |
| Single file | Filename without .ts/.js | hello.ts → hello |

Override with \`pi.setName("custom-name")\`. Duplicate names cause load-time errors.

## ExtensionContext Properties

### ctx.projectRoot: string
Canonical git root (worktree-aware). Falls back to cwd if not a git repo.

### ctx.extensionName: string
The current extension's name.

### ctx.sessionDataDir: string
Per-session storage: \`~/.pi/agent/sessions/<project>/data/<sessionId>/<ext-name>/\`

### ctx.cwdDataDir: string
Per-cwd storage (worktree-isolated): \`~/.pi/agent/cwd-data/<encoded-cwd>/<ext-name>/\`

### ctx.projectDataDir: string
Per-project storage (shared across worktrees): \`~/.pi/agent/project-data/<encoded-project>/<ext-name>/\`

### ctx.globalDataDir: string
Cross-project global storage: \`~/.pi/agent/extensions-data/<ext-name>/\`

## Storage Scope Decision Guide

- Session: Temporary per-conversation data (cache, working state)
- CWD: Per working directory, worktree-isolated (build artifacts, local cache)
- Project: Shared across worktrees (project config, shared memory)
- Global: Cross-project (knowledge bases, shared settings, global caches)

## Usage Example

\`\`\`typescript
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

export default function(pi) {
    pi.on("session_start", async (event, ctx) => {
        // Session-scoped cache
        const cacheFile = join(ctx.sessionDataDir, "cache.json");
        
        // Project-scoped config (shared across worktrees)
        const projectConfig = join(ctx.projectDataDir, "config.json");
        
        // Global cross-project settings
        const globalSettings = join(ctx.globalDataDir, "settings.json");
        
        // Identify project root (worktree-aware)
        console.log(\`Project: \${ctx.projectRoot}\`);
        console.log(\`Extension: \${ctx.extensionName}\`);
    });
}
\`\`\`

## Related Files

- Types: src/core/extensions/types.ts (ExtensionContext, ExtensionAPI interfaces)
- Storage: src/core/storage.ts (path computation functions)
- Runner: src/core/extensions/runner.ts (context creation with per-extension namespacing)
- Loader: src/core/extensions/loader.ts (name derivation and validation)`;

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

async function main() {
  const proc = spawn("npx", ["-y", "@dyyz1993/kb-mcp@1.2.0", "--stdio"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  const rl = createInterface({ input: proc.stdout });
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

  // Step 1: Initialize
  const initId = nextId++;
  console.log("Sending initialize request...");
  sendJson(proc, {
    jsonrpc: "2.0",
    id: initId,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "kb-update-script", version: "1.0.0" },
    },
  });

  const initResp = await waitForResponse(initId);
  console.log("Initialize response:", JSON.stringify(initResp.result?.serverInfo || initResp.error || "ok"));

  // Step 2: Send initialized notification
  sendJson(proc, { jsonrpc: "2.0", method: "notifications/initialized" });
  console.log("Sent initialized notification");

  // Step 3: Call kb_write
  const writeId = nextId++;
  console.log("Sending kb_write request...");
  sendJson(proc, {
    jsonrpc: "2.0",
    id: writeId,
    method: "tools/call",
    params: {
      name: "kb_write",
      arguments: {
        title: "Extension Storage & Path API",
        content: CONTENT,
        tags: ["extension", "storage", "api", "extension-context", "path"],
        keywords: [
          "extension",
          "storage",
          "projectRoot",
          "sessionDataDir",
          "cwdDataDir",
          "projectDataDir",
          "globalDataDir",
          "extensionName",
          "setName",
          "worktree",
        ],
        intent: "Extension storage paths and naming mechanism for pi coding agent extensions",
        project_description: "pi-momo-fork",
      },
    },
  });

  const writeResp = await waitForResponse(writeId);
  if (writeResp.error) {
    console.error("kb_write failed:", JSON.stringify(writeResp.error));
  } else {
    const content = writeResp.result?.content;
    if (Array.isArray(content)) {
      for (const c of content) {
        console.log("Result:", c.text || JSON.stringify(c));
      }
    } else {
      console.log("Result:", JSON.stringify(writeResp.result));
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

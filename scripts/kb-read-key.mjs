import { spawn } from "node:child_process";

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

function extractContent(resp) {
  const content = resp.result?.content;
  if (!Array.isArray(content)) return null;
  for (const c of content) {
    if (c.text) {
      try {
        const parsed = JSON.parse(c.text);
        return parsed;
      } catch {
        return c.text;
      }
    }
  }
  return null;
}

async function main() {
  const docs = [
    { id: "d21f3474mon83e9f", title: "Pi Coding Agent Extension Development Guide" },
    { id: "fi7p9fffar", title: "Extension Storage & Path API" },
    { id: "dcdfb484mon857xf", title: "pi 插件开发实战速查手册" },
    { id: "af7ecdffmomuopgd", title: "pi-mono 完整类型体系与开发指南" },
  ];

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
    if (text && !text.includes("npm warn")) console.error("[stderr]", text);
  });

  // Initialize
  const initId = nextId++;
  sendJson(proc, {
    jsonrpc: "2.0",
    id: initId,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "kb-read", version: "1.0.0" },
    },
  });

  const initResp = await waitForResponse(initId);
  console.log("=== INITIALIZED ===");
  console.log(JSON.stringify(initResp.result?.serverInfo || initResp.error || "ok"));

  sendJson(proc, { jsonrpc: "2.0", method: "notifications/initialized" });

  // Read each document
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const readId = nextId++;

    console.log(`\n${"=".repeat(100)}`);
    console.log(`[${i + 1}/${docs.length}] ${doc.title} (id: ${doc.id})`);
    console.log(`${"=".repeat(100)}`);

    sendJson(proc, {
      jsonrpc: "2.0",
      id: readId,
      method: "tools/call",
      params: { name: "kb_read", arguments: { id: doc.id } },
    });

    const resp = await waitForResponse(readId);

    if (resp.error) {
      console.error("ERROR:", JSON.stringify(resp.error, null, 2));
      continue;
    }

    const data = extractContent(resp);
    if (!data) {
      console.log("No content returned.");
      continue;
    }

    // Print full content
    if (typeof data === "string") {
      console.log(data);
    } else if (data.content) {
      // KB document with content field
      console.log(`Title: ${data.title || doc.title}`);
      console.log(`Tags: ${(data.tags || []).join(", ")}`);
      console.log(`Keywords: ${(data.keywords || []).join(", ")}`);
      console.log(`Intent: ${data.intent || "N/A"}`);
      console.log(`Project: ${data.project_description || "N/A"}`);
      console.log(`Source: ${data.source_project || "N/A"}`);
      console.log(`\n--- CONTENT ---\n`);
      console.log(data.content);
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  }

  console.log(`\n=== DONE: Read ${docs.length} documents ===`);

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

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

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

function extractContentData(resp) {
  const content = resp.result?.content;
  if (!Array.isArray(content)) return null;
  for (const c of content) {
    if (c.text) {
      try { return JSON.parse(c.text); } catch { return c.text; }
    }
  }
  return null;
}

function extractDocIds(data) {
  const ids = [];
  if (Array.isArray(data)) {
    for (const doc of data) {
      if (doc.id) ids.push(doc.id);
    }
  } else if (data && typeof data === "object") {
    if (data.documents && Array.isArray(data.documents)) {
      for (const doc of data.documents) {
        if (doc.id) ids.push(doc.id);
      }
    }
  }
  return [...new Set(ids)];
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

  // Step 1: Initialize
  const initId = nextId++;
  sendJson(proc, {
    jsonrpc: "2.0",
    id: initId,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "kb-check", version: "1.0.0" },
    },
  });

  const initResp = await waitForResponse(initId);
  console.log("=== INITIALIZED ===");
  console.log(JSON.stringify(initResp.result?.serverInfo || initResp.error || "ok"));

  sendJson(proc, { jsonrpc: "2.0", method: "notifications/initialized" });

  // Step 2: kb_list
  const listId = nextId++;
  sendJson(proc, {
    jsonrpc: "2.0",
    id: listId,
    method: "tools/call",
    params: { name: "kb_list", arguments: {} },
  });

  const listResp = await waitForResponse(listId);
  const listData = extractContentData(listResp);
  console.log("\n=== KB_LIST ===");
  console.log(`Total documents: ${listData?.total || "unknown"}`);

  // Step 3: kb_search "extension"
  const searchId = nextId++;
  sendJson(proc, {
    jsonrpc: "2.0",
    id: searchId,
    method: "tools/call",
    params: { name: "kb_search", arguments: { query: "extension" } },
  });

  const searchResp = await waitForResponse(searchId);
  const searchData = extractContentData(searchResp);
  console.log("\n=== KB_SEARCH 'extension' ===");
  console.log(`Total matching: ${searchData?.total || "unknown"}`);

  // Step 4: Collect all unique IDs
  const allIds = new Set();
  const listIds = extractDocIds(listData);
  const searchIds = extractDocIds(searchData);
  for (const id of listIds) allIds.add(id);
  for (const id of searchIds) allIds.add(id);

  console.log(`\n=== TOTAL UNIQUE IDS: ${allIds.size} ===`);
  console.log([...allIds].join(", "));

  // Step 5: Print summary table of all docs
  console.log("\n=== DOCUMENT SUMMARY ===");
  const allDocs = [
    ...(listData?.documents || []),
    ...(searchData?.documents || []),
  ];
  const seen = new Set();
  for (const doc of allDocs) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    console.log(`\n[${doc.id}] ${doc.title}`);
    console.log(`  Tags: ${(doc.tags || []).join(", ")}`);
    console.log(`  Keywords: ${(doc.keywords || []).join(", ")}`);
    console.log(`  Source: ${doc.source_project || "unknown"}`);
    console.log(`  Created: ${new Date(doc.created_at).toISOString()}`);
    if (doc.score) console.log(`  Score: ${doc.score}`);
  }

  // Step 6: Read each document
  console.log(`\n=== READING ${allIds.size} DOCUMENTS ===\n`);
  let count = 0;
  for (const docId of allIds) {
    count++;
    console.log(`\n${"=".repeat(80)}`);
    console.log(`[${count}/${allIds.size}] READING: ${docId}`);
    console.log(`${"=".repeat(80)}`);

    const readId = nextId++;
    sendJson(proc, {
      jsonrpc: "2.0",
      id: readId,
      method: "tools/call",
      params: { name: "kb_read", arguments: { id: docId } },
    });

    const readResp = await waitForResponse(readId);
    const readData = extractContentData(readResp);
    if (readResp.error) {
      console.error("ERROR:", JSON.stringify(readResp.error));
    } else if (typeof readData === "string") {
      console.log(readData);
    } else {
      console.log(JSON.stringify(readData, null, 2));
    }
  }

  console.log(`\n=== DONE: Read ${count} documents ===`);

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

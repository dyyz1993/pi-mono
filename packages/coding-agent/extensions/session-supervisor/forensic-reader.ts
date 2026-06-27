#!/usr/bin/env -S npx tsx
/**
 * Forensic Reader for session-supervisor.
 * 
 * Usage: npx tsx forensic-reader.ts <sessionId>
 *   or: npx tsx forensic-reader.ts --sessions                    (list recent sessions)
 *   or: npx tsx forensic-reader.ts --last                        (read most recent forensic)
 *   or: npx tsx forensic-reader.ts --session-data-dir <path>     (direct path)
 * 
 * Given a session ID, reconstructs the full gold check decision chain:
 *   - What guards ran and what they returned
 *   - What the small model received and responded
 *   - What gold results were emitted
 *   - Whether scheduler was exhausted or stagnation was detected
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

type ForensicRecord = {
  ts: string;
  type: string;
  [key: string]: unknown;
};

const PI_AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const SESSIONS_DIR = join(PI_AGENT_DIR, "sessions");

// ── Helpers ──

function listRecentSessions(limit = 20): Array<{ bucket: string; dataDir: string; mtime: Date }> {
  const results: Array<{ bucket: string; dataDir: string; mtime: Date }> = [];
  if (!existsSync(SESSIONS_DIR)) return results;

  const buckets = readdirSync(SESSIONS_DIR);
  for (const bucket of buckets) {
    const dataDir = join(SESSIONS_DIR, bucket, "data");
    if (!existsSync(dataDir)) continue;
    const sessions = readdirSync(dataDir);
    for (const sessionId of sessions) {
      const forensicDir = join(dataDir, sessionId, "forensic");
      const forensicFile = join(forensicDir, "forensic.jsonl");
      if (!existsSync(forensicFile)) continue;
      const mtime = statSync(forensicFile).mtime;
      results.push({ bucket, dataDir: join(dataDir, sessionId), mtime });
    }
  }

  results.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return results.slice(0, limit);
}

function findSessionDataDir(sessionId: string): string | null {
  if (!existsSync(SESSIONS_DIR)) return null;
  const buckets = readdirSync(SESSIONS_DIR);
  for (const bucket of buckets) {
    const dataDir = join(SESSIONS_DIR, bucket, "data");
    if (!existsSync(dataDir)) continue;
    const sessions = readdirSync(dataDir);
    if (sessions.includes(sessionId)) {
      return join(dataDir, sessionId);
    }
  }
  return null;
}

function readForensicRecords(sessionDataDir: string): ForensicRecord[] {
  const fp = join(sessionDataDir, "forensic", "forensic.jsonl");
  if (!existsSync(fp)) return [];
  const text = readFileSync(fp, "utf-8");
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as ForensicRecord);
}

function readSessionInfo(sessionDataDir: string): Record<string, unknown> {
  const runtimeFile = join(sessionDataDir, "supervisor-goal-runtime.json");
  if (!existsSync(runtimeFile)) return {};

  try {
    const triggerDir = join(sessionDataDir, "supervisor-logs");
    const triggers: unknown[] = [];
    if (existsSync(triggerDir)) {
      const files = readdirSync(triggerDir).filter((f) => f.endsWith(".json"));
      for (const file of files.slice(-10)) {
        try {
          triggers.push(JSON.parse(readFileSync(join(triggerDir, file), "utf-8")));
        } catch { /* skip bad files */ }
      }
    }

    return {
      runtime: JSON.parse(readFileSync(runtimeFile, "utf-8")),
      recentTriggers: triggers,
    };
  } catch {
    return {};
  }
}

// ── Report Generator ──

function generateReport(records: ForensicRecord[]): string {
  const lines: string[] = [];
  const errors: string[] = [];

  lines.push("═".repeat(60));
  lines.push("  SUPERVISOR FORENSIC REPORT");
  lines.push("═".repeat(60));
  lines.push("");

  // 1. Session start info
  const sessionStart = records.find((r) => r.type === "session_start") as Record<string, unknown> | undefined;
  if (sessionStart) {
    lines.push(`📅 Session started: ${sessionStart.ts}`);
    lines.push(`   enabled=${sessionStart.enabled}, guards=${sessionStart.guardCount}`);
    lines.push(`   smallModel=${sessionStart.smallModel}, maxContinue=${sessionStart.maxContinueCount}`);
    lines.push("");
  }

  // 2. Goal tracking
  const goalSet = records.find((r) => r.type === "goal_set") as Record<string, unknown> | undefined;
  if (goalSet) {
    lines.push(`🎯 Goal set: ${(goalSet.objective as string)?.slice(0, 80)}`);
    lines.push(`   goalId=${goalSet.goalId}, checklist=${goalSet.checklistLength} items`);
    lines.push("");
  }

  // 3. Agent end triggers
  const agentEnds = records.filter((r) => r.type === "agent_end_triggered") as Record<string, unknown>[];
  lines.push(`🔁 Agent end triggers: ${agentEnds.length} times`);
  const skipped = records.filter((r) => r.type === "agent_end_skipped") as Record<string, unknown>[];
  if (skipped.length > 0) {
    skipped.forEach((s) => lines.push(`   ⏭ Skipped: ${s.reason}`));
  }
  lines.push("");

  // 4. Guard checks
  const guardStarts = records.filter((r) => r.type === "guard_check_start") as Record<string, unknown>[];
  const guardEnds = records.filter((r) => r.type === "guard_check_end") as Record<string, unknown>[];
  if (guardEnds.length > 0) {
    lines.push("🛡  Guard Checks:");
    for (const g of guardEnds) {
      const status = g.completed ? "✅" : "❌";
      lines.push(`   ${status} ${g.guardName}(${g.guardType}) completed=${g.completed} conf=${g.confidence} dur=${g.durationMs}ms`);
      if (!g.completed && Array.isArray(g.remainingItems) && g.remainingItems.length > 0) {
        (g.remainingItems as string[]).slice(0, 3).forEach((item) => {
          lines.push(`       ▪ ${item.slice(0, 80)}`);
        });
        if ((g.remainingItems as string[]).length > 3) {
          lines.push(`       ... and ${(g.remainingItems as string[]).length - 3} more`);
        }
      }
    }
    lines.push("");
  }

  // 5. Model checks
  const modelStarts = records.filter((r) => r.type === "model_check_start") as Record<string, unknown>[];
  const modelParseds = records.filter((r) => r.type === "model_check_parsed") as Record<string, unknown>[];
  const modelErrors = records.filter((r) => r.type === "model_check_error") as Record<string, unknown>[];
  if (modelParseds.length > 0) {
    lines.push(`🧠 Model Checks (${modelParseds.length}):`);
    for (const m of modelParseds) {
      const status = m.completed ? "✅ COMPLETE" : "❌ INCOMPLETE";
      lines.push(`   ${status} conf=${m.confidence}, reasoning=${(m.reasoningLength as number)}ch`);
    }
    lines.push("");
  }
  if (modelErrors.length > 0) {
    lines.push(`⚠️  Model Check Errors:`);
    for (const e of modelErrors) {
      lines.push(`   ❌ ${e.error}`);
      errors.push(`Model check error: ${e.error}`);
    }
    lines.push("");
  }

  // 6. Gold results
  const goldResults = records.filter((r) => r.type === "gold_result_emitted") as Record<string, unknown>[];
  if (goldResults.length > 0) {
    lines.push(`🥇 Gold Results (${goldResults.length}):`);
    for (const g of goldResults) {
      const gr = g.goldResult as Record<string, unknown> | undefined;
      if (!gr) continue;
      const verdict = gr.verdict as string;
      const emoji = verdict === "complete" ? "✅" : verdict === "incomplete" ? "🔄" : verdict === "blocked" ? "🚫" : "❓";
      lines.push(`   ${emoji} ${verdict} conf=${gr.confidence} reason: ${(gr.reason as string)?.slice(0, 100)}`);
      if (Array.isArray(gr.evidence) && (gr.evidence as Array<Record<string, unknown>>).length > 0) {
        for (const ev of gr.evidence as Array<Record<string, unknown>>) {
          lines.push(`       ▪ [${ev.kind}] ${(ev.summary as string)?.slice(0, 80)}`);
        }
      }
    }
    lines.push("");
  }

  // 7. Stagnation
  const stagnations = records.filter((r) => r.type === "stagnation_detected") as Record<string, unknown>[];
  if (stagnations.length > 0) {
    lines.push(`🔄 Stagnation Events:`);
    for (const s of stagnations) {
      lines.push(`   ⚠️  stagnationCount=${s.stagnationCount}`);
      lines.push(`       signature=${s.currentSignature}`);
      errors.push(`Stagnation detected at count ${s.stagnationCount}: ${s.currentSignature}`);
    }
    lines.push("");
  }

  // 8. Continue scheduling
  const continues = records.filter((r) => r.type === "continue_scheduled") as Record<string, unknown>[];
  const exhausted = records.filter((r) => r.type === "scheduler_exhausted") as Record<string, unknown>[];
  if (continues.length > 0) {
    lines.push(`⏩ Continue Schedule (${continues.length}):`);
    for (const c of continues) {
      lines.push(`   🔄 count=${c.continueCount}/${c.maxContinueCount} delay=${c.delayMs}ms shouldPause=${c.shouldPause}`);
      lines.push(`       ${(c.reason as string)?.slice(0, 100)}`);
    }
    if (exhausted.length > 0) {
      for (const e of exhausted) {
        lines.push(`   ⛔ EXHAUSTED: ${e.continueCount}/${e.maxContinueCount} - supervisor stopped`);
        errors.push(`Scheduler exhausted: ${e.continueCount}/${e.maxContinueCount}`);
      }
    }
    lines.push("");
  }

  // 9. Supervisor complete calls
  const completes = records.filter((r) => r.type === "supervisor_complete_called") as Record<string, unknown>[];
  if (completes.length > 0) {
    lines.push(`🏁 Supervisor Complete Calls:`);
    for (const c of completes) {
      lines.push(`   📝 enabled=${c.enabled} guards=${c.activeGuardCount}`);
      lines.push(`       ${(c.summary as string)?.slice(0, 100)}`);
    }
    lines.push("");
  }

  // 10. Error summary
  const errorRecords = records.filter((r) => r.type === "error") as Record<string, unknown>[];
  if (errorRecords.length > 0) {
    for (const e of errorRecords) {
      errors.push(`[${e.context}] ${e.error}`);
    }
  }

  if (errors.length > 0) {
    lines.push("⚠️  ISSUES FOUND");
    lines.push("─".repeat(40));
    errors.forEach((e) => lines.push(`   ❗ ${e}`));
    lines.push("");
  }

  lines.push("═".repeat(60));
  return lines.join("\n");
}

// ── Main ──

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage: npx tsx forensic-reader.ts <sessionId|--last|--sessions>
       npx tsx forensic-reader.ts --session-data-dir <path>

Options:
  --sessions           List recent sessions with forensic data
  --last               Read the most recent forensic log
  --session-data-dir   Direct path to session data directory
  --help               Show this help

Examples:
  npx tsx forensic-reader.ts --last
  npx tsx forensic-reader.ts abc123
  npx tsx forensic-reader.ts --sessions
`);
    return;
  }

  if (args.includes("--sessions")) {
    const sessions = listRecentSessions();
    if (sessions.length === 0) {
      console.log("No sessions with forensic data found.");
      return;
    }
    console.log("Recent sessions with forensic data:");
    console.log("─".repeat(80));
    sessions.forEach((s, i) => {
      const sessionId = basename(s.dataDir);
      console.log(`  ${i + 1}. ${sessionId}`);
      console.log(`      bucket: ${s.bucket}`);
      console.log(`      mtime:  ${s.mtime.toISOString()}`);
      console.log(`      data:   ${s.dataDir}`);
      console.log();
    });
    return;
  }

  let sessionDataDir: string | null = null;

  if (args.includes("--session-data-dir")) {
    const idx = args.indexOf("--session-data-dir");
    sessionDataDir = args[idx + 1] ?? null;
  } else if (args.includes("--last")) {
    const sessions = listRecentSessions(1);
    if (sessions.length === 0) {
      console.log("No forensic data found.");
      process.exit(1);
    }
    sessionDataDir = sessions[0].dataDir;
    console.log(`📁 Most recent session: ${basename(sessionDataDir)}\n`);
  } else {
    const sessionId = args[0];
    if (!sessionId) {
      console.error("Usage: npx tsx forensic-reader.ts <sessionId|--last|--sessions>");
      process.exit(1);
    }
    sessionDataDir = findSessionDataDir(sessionId);
    if (!sessionDataDir) {
      console.error(`Session "${sessionId}" not found in ${SESSIONS_DIR}`);
      process.exit(1);
    }
  }

  const records = readForensicRecords(sessionDataDir);
  const sessionInfo = readSessionInfo(sessionDataDir);

  if (records.length === 0) {
    console.log(`No forensic records found at ${join(sessionDataDir, "forensic", "forensic.jsonl")}`);
    console.log("Either the supervisor never ran in this session, or the extension needs updating.");
    process.exit(0);
  }

  console.log(`📂 Session data dir: ${sessionDataDir}`);
  console.log(`📄 Forensic records: ${records.length}\n`);
  console.log(generateReport(records));

  // Show runtime state info
  if (sessionInfo.runtime && Object.keys(sessionInfo.runtime).length > 0) {
    const rt = sessionInfo.runtime as Record<string, unknown>;
    console.log("\n📌 Persisted runtime state:");
    console.log(JSON.stringify(rt, null, 2));
  }

  // Show recent trigger logs
  if (Array.isArray(sessionInfo.recentTriggers) && sessionInfo.recentTriggers.length > 0) {
    console.log(`\n📜 Recent trigger logs (${sessionInfo.recentTriggers.length}):`);
    for (const tr of sessionInfo.recentTriggers.slice(-3)) {
      const t = tr as Record<string, unknown>;
      console.log(`  #${t.seq} verdict=${t.verdict} action=${t.action} conf=${t.confidence} dur=${t.durationMs}ms`);
    }
  }
}

main().catch(console.error);

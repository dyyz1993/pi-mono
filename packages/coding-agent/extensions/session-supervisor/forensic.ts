/**
 * Forensic logging for session-supervisor.
 * Writes structured JSONL records to <sessionDataDir>/forensic/forensic.jsonl
 * so we can reconstruct "what happened" after a user reports a bad gold result.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GoldResult, GoalState, GuardCheckResult, TriggerRecord } from "./types.ts";

// ── Record Types ──

export type ForensicRecord =
  | { ts: string; type: "agent_end_triggered"; enabled: boolean; checkOnAgentEnd: boolean; schedulerExhausted: boolean; hasActiveGoal: boolean; agentEndMs: number }
  | { ts: string; type: "agent_end_skipped"; reason: string }
  | { ts: string; type: "guard_check_start"; guardName: string; guardType: string; contextLength: number }
  | { ts: string; type: "guard_check_end"; guardName: string; guardType: string; completed: boolean; confidence: number; remainingItems: string[]; detail?: string; durationMs: number }
  | { ts: string; type: "guard_check_error"; guardName: string; guardType: string; error: string; durationMs: number }
  | { ts: string; type: "model_check_start"; messagesCount: number; messagesTruncated: boolean; smallModel: string }
  | { ts: string; type: "model_check_raw_input"; messages: unknown[]; systemPromptLength: number }
  | { ts: string; type: "model_check_raw_response"; raw: string; retryCount: number; durationMs: number }
  | { ts: string; type: "model_check_parsed"; completed: boolean; confidence: number; incompleteTasks: unknown[]; reasoningLength: number }
  | { ts: string; type: "model_check_error"; error: string; durationMs: number }
  | { ts: string; type: "model_check_fallback"; reason: string }
  | { ts: string; type: "stagnation_detected"; stagnationCount: number; currentSignature: string; previousSignature: string; guardResults: GuardResultSnapshot[] }
  | { ts: string; type: "scheduler_exhausted"; continueCount: number; maxContinueCount: number }
  | { ts: string; type: "gold_result_emitted"; goldResult: Omit<GoldResult, "goalId" | "checkedAt"> & { goalId?: string; checkedAt: number } }
  | { ts: string; type: "supervisor_complete_called"; summary: string; enabled: boolean; activeGuardCount: number }
  | { ts: string; type: "supervisor_complete_guard_blocked"; guardName: string; remainingItems: string[] }
  | { ts: string; type: "supervisor_complete_approved"; guardsPassed: number }
  | { ts: string; type: "continue_scheduled"; reason: string; delayMs: number; continueCount: number; maxContinueCount: number; shouldPause: boolean }
  | { ts: string; type: "continue_skipped"; reason: string }
  | { ts: string; type: "goal_set"; goalId: string; objective: string; checklistLength: number }
  | { ts: string; type: "goal_cleared"; goalId?: string; reason?: string }
  | { ts: string; type: "goal_status_changed"; goalId: string; oldStatus: string; newStatus: string }
  | { ts: string; type: "pause_scheduled"; delayMs: number; reason?: string; scheduledAt: number }
  | { ts: string; type: "pause_cancelled"; reason: string }
  | { ts: string; type: "error"; context: string; error: string }
  | { ts: string; type: "session_start"; enabled: boolean; guardCount: number; smallModel: string; maxContinueCount: number }
  | { ts: string; type: "enable_toggled"; enabled: boolean }
  | { ts: string; type: "checklist_refinement_start"; goalId: string; objective: string }
  | { ts: string; type: "checklist_refinement_result"; goalId: string; checklistLength: number; success: boolean };

export interface GuardResultSnapshot {
  guardName: string;
  completed: boolean;
  remainingItems: string[];
  confidence: number;
}

export function forensicTs(): string {
  return new Date().toISOString();
}

// ── State ──

let forensicDir = "";
let forensicFilePath = "";

export function setForensicDir(sessionDataDir: string): void {
  forensicDir = join(sessionDataDir, "forensic");
  forensicFilePath = join(forensicDir, "forensic.jsonl");
  try {
    if (!existsSync(forensicDir)) {
      mkdirSync(forensicDir, { recursive: true });
    }
  } catch {
    // best effort — if we can't create, just don't log
  }
}

export function appendForensic(record: ForensicRecord): void {
  if (!forensicFilePath) return;
  try {
    appendFileSync(forensicFilePath, JSON.stringify(record) + "\n", "utf-8");
  } catch {
    // best effort — don't crash the supervisor over logging
  }
}

/**
 * Read all forensic records for a given sessionDataDir.
 * Used by the diagnostic tool to reconstruct what happened.
 */
export function readForensicRecords(sessionDataDir: string): ForensicRecord[] {
  const fp = join(sessionDataDir, "forensic", "forensic.jsonl");
  try {
    const text = readFileSync(fp, "utf-8");
    return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as ForensicRecord);
  } catch {
    return [];
  }
}

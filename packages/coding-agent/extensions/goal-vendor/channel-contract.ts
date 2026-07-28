/**
 * Channel contract for the goal-vendor extension.
 *
 * This is a slimmed-down adaptation of the legacy session-supervisor
 * "supervisor" channel. Methods whose semantics do not map cleanly onto the
 * vendored misunders2d contract-based model (setGoal, requestPause,
 * cancelPause) were dropped or renamed. Events that would require
 * fabricating data the upstream kernel never emits (pauseRequested,
 * goldResult, triggerRecord) were removed.
 *
 * The contract is intentionally honest: it only exposes what the
 * misunders2d GoalStore can actually answer.
 */

import type { ChannelContract } from "@dyyz1993/pi-coding-agent";

/**
 * Flattened status projected from misunders2d's GoalStatus + GoalPhase.
 *
 * `state` is a best-effort mapping to the legacy supervisor states so
 * existing IDE clients can reuse their rendering:
 *   - setting_up / awaiting_approval -> "setup"
 *   - running + executing/planning    -> "running"
 *   - running + verifying/auditing    -> "checking"
 *   - paused                          -> "paused"
 *   - interrupted                     -> "blocked"
 *   - completed / cancelled           -> "idle"
 */
export interface GoalVendorStatus {
	/** Whether the goal extension is enabled (master switch). */
	enabled: boolean;
	/** Flattened runtime state, supervisor-compatible where possible. */
	state: "idle" | "setup" | "running" | "checking" | "paused" | "blocked" | "disabled";
	/** Raw misunders2d status, for clients that understand the richer model. */
	rawStatus: string;
	/** Raw misunders2d phase. */
	rawPhase: string;
	/** Continuation sequence counter from misunders2d. */
	continuationSequence: number;
	/** Turn count from misunders2d. */
	turnCount: number;
	/** Sanitized objective text, if a goal exists. */
	objective?: string;
	/** Goal id, if a goal exists. */
	goalId?: string;
	/** Generation (contract rewrite counter), if a goal exists. */
	generation?: number;
}

/** Per-criterion task report projected from misunders2d audit/evidence. */
export interface GoalVendorTaskItem {
	/** Criterion id (AC1, AC2, ...) or check id. */
	id: string;
	/** Criterion text or check label. */
	label: string;
	/** met / pending / waived / unknown. */
	status: string;
	/** Whether this criterion has linked evidence. */
	hasEvidence: boolean;
}

export interface GoalVendorTriggerRecord {
	goalId?: string;
	/** Event log line index. */
	seq: number;
	/** Event type from events.jsonl. */
	eventType: string;
	/** Event summary. */
	summary: string;
	/** Revision at the time of the event. */
	revision: number;
	/** ISO timestamp. */
	timestamp: string;
}

export interface GoalChannelContract extends ChannelContract {
	methods: {
		getStatus: {
			params: Record<string, never>;
			return: GoalVendorStatus;
		};
		startSetup: {
			params: { objective: string };
			return: { started: boolean; goalId?: string; error?: string };
		};
		approveContract: {
			params: Record<string, never>;
			return: { approved: boolean; error?: string };
		};
		rejectContract: {
			params: { reason?: string };
			return: { rejected: boolean };
		};
		clearGoal: {
			params: { reason?: string };
			return: { cleared: boolean };
		};
		forceContinue: {
			params: { reason?: string };
			return: { triggered: boolean };
		};
		disable: {
			params: Record<string, never>;
			return: { disabled: boolean };
		};
		enable: {
			params: Record<string, never>;
			return: { enabled: boolean };
		};
		getTaskReport: {
			params: Record<string, never>;
			return: { tasks: GoalVendorTaskItem[] };
		};
		getTriggerHistory: {
			params: { limit?: number };
			return: { triggers: GoalVendorTriggerRecord[] };
		};
		refineGoal: {
			params: { objective: string };
			return: { success: boolean; objective?: string; error?: string };
		};
		checkToolStatus: {
			params: { toolName: string; channelName?: string; method?: string };
			return: { reachable: boolean; status?: string; error?: string };
		};
	};
	events: {
		"goal.statusChanged": GoalVendorStatus;
		"goal.goalChanged": { goalId?: string; status?: string; reason?: string };
		"goal.taskReport": { tasks: GoalVendorTaskItem[] };
		"goal.continueTriggered": { goalId: string; reason: string };
	};
}

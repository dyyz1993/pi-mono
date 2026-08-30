/**
 * Loop Scheduler Channel Contract
 *
 * 前端 (UI) 和 Agent (tool) 共用这套 channel 方法来 CRUD 定时任务。
 */

export const LOOP_SCHEDULER_CHANNEL_NAME = "loop-scheduler";

/** 单个定时任务配置 */
export interface LoopConfig {
	id: string;
	name: string;
	enabled: boolean;
	cron: string; // 标准 5-field cron: "*/5 * * * *"
	prompt: string; // cron 触发时发给 Agent 的 prompt
	deliverAs: "followUp" | "steer";
}

/** 单个定时任务运行状态 */
export interface LoopStatus {
	id: string;
	isRunning: boolean;
	lastRun: number | null; // timestamp ms
	nextRun: number | null; // timestamp ms
	runCount: number;
	lastError: string | null;
}

/** channel emit 的 status 事件 payload */
export interface LoopSchedulerStatusEvent {
	type: "status";
	loops: LoopStatus[];
}

/** Channel 方法契约 */
export interface LoopSchedulerChannelContract {
	list: {
		request: void;
		response: { loops: LoopConfig[] };
	};

	create: {
		request: {
			name: string;
			cron: string;
			prompt: string;
			deliverAs?: "followUp" | "steer";
		};
		response: { ok: boolean; id?: string; error?: string };
	};

	update: {
		request: {
			id: string;
			name?: string;
			cron?: string;
			prompt?: string;
			deliverAs?: "followUp" | "steer";
		};
		response: { ok: boolean; error?: string };
	};

	toggle: {
		request: { id: string; enabled: boolean };
		response: { ok: boolean; error?: string };
	};

	remove: {
		request: { id: string };
		response: { ok: boolean; error?: string };
	};

	getStatus: {
		request: void;
		response: LoopSchedulerStatusEvent;
	};

	/** 用户切回本 session 时强制成为 active scheduler（lease 抢占）。
	 *  synced = 拿锁后从 settings 补齐进 jobs 的 loop 数（诊断用）。 */
	becomeScheduler: {
		request: void;
		response: { ok: boolean; already?: boolean; synced?: number };
	};
}

/**
 * Loop Scheduler Extension — 通用 cron 定时任务调度器。
 *
 * 功能:
 * - 从 settings.json 读取 loopScheduler.loops 配置
 * - 每个 enabled 的 loop 按 cron 表达式定时触发
 * - 触发时通过 pi.sendUserMessage({ deliverAs }) 给 Agent 发 prompt
 * - 支持运行时 CRUD（channel + tool 双入口）
 * - /loops 命令查看所有任务状态
 * - context hook 注入 loop 状态摘要
 *
 * 配置(settings.json):
 *   "loopScheduler": {
 *     "loops": [
 *       {
 *         "id": "loop-xxx",
 *         "name": "每天跑测试",
 *         "enabled": true,
 *         "cron": "0 9 * * *",
 *         "prompt": "运行项目测试",
 *         "deliverAs": "followUp"
 *       }
 *     ]
 *   }
 */

import type { ExtensionAPI, ContextEvent } from "@dyyz1993/pi-coding-agent";
import { getGlobalDataDir } from "@dyyz1993/pi-coding-agent";
import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";
import { createTypedChannel } from "@dyyz1993/pi-coding-agent";
import { Type, type Static } from "typebox";
import {
	LOOP_SCHEDULER_CHANNEL_NAME,
	type LoopConfig,
	type LoopSchedulerChannelContract,
	type LoopStatus,
} from "./contract.ts";

// ── 轻量 cron 解析器（5-field: min hour day month weekday）──────────

function parseCronField(expr: string, min: number, max: number): number[] {
	if (expr === "*") {
		return Array.from({ length: max - min + 1 }, (_, i) => min + i);
	}
	const result = new Set<number>();
	for (const part of expr.split(",")) {
		const stepMatch = part.match(/^(.+?)\/(\d+)$/);
		const step = stepMatch ? parseInt(stepMatch[2]) : 1;
		const range = stepMatch ? stepMatch[1] : part;
		if (range === "*") {
			for (let i = min; i <= max; i += step) result.add(i);
		} else {
			const rangeMatch = range.match(/^(\d+)-(\d+)$/);
			if (rangeMatch) {
				const lo = Math.max(min, parseInt(rangeMatch[1]));
				const hi = Math.min(max, parseInt(rangeMatch[2]));
				for (let i = lo; i <= hi; i += step) result.add(i);
			} else {
				const n = parseInt(range);
				if (!isNaN(n) && n >= min && n <= max) result.add(n);
			}
		}
	}
	return Array.from(result).sort((a, b) => a - b);
}

function getNextCronTime(cron: string, from: Date = new Date()): Date {
	const [minF, hourF, dayF, monthF, dowF] = cron.split(/\s+/);
	const minutes = parseCronField(minF, 0, 59);
	const hours = parseCronField(hourF, 0, 23);
	const days = parseCronField(dayF, 1, 31);
	const months = parseCronField(monthF, 1, 12);
	// dow: 0-7 (0 and 7 are both Sunday)
	const dows = parseCronField(dowF, 0, 7).map((d) => (d === 7 ? 0 : d));

	const next = new Date(from.getTime() + 60000); // start from next minute
	next.setSeconds(0, 0);

	for (let attempts = 0; attempts < 525600; attempts++) {
		// max 1 year
		const m = next.getMonth() + 1;
		if (!months.includes(m)) {
			next.setMonth(next.getMonth() + 1, 1);
			next.setHours(0, 0, 0, 0);
			continue;
		}
		const d = next.getDate();
		const dow = next.getDay();
		const dayMatch = days.includes(d);
		const dowMatch = dows.includes(dow);
		// If day-of-month field is *, use dow. If dow field is *, use dom.
		// If both are *, both match. If both restricted, either matches.
		const dayOk =
			dayF === "*" ? dowMatch : dowF === "*" ? dayMatch : dayMatch || dowMatch;
		if (!dayOk) {
			next.setDate(next.getDate() + 1);
			next.setHours(0, 0, 0, 0);
			continue;
		}
		const h = next.getHours();
		if (!hours.includes(h)) {
			next.setHours(next.getHours() + 1, 0, 0, 0);
			continue;
		}
		const min = next.getMinutes();
		if (!minutes.includes(min)) {
			next.setMinutes(next.getMinutes() + 1, 0, 0);
			continue;
		}
		return next;
	}
	throw new Error(`无法计算 cron 下次时间: ${cron}`);
}

function isValidCron(cron: string): boolean {
	try {
		const parts = cron.trim().split(/\s+/);
		if (parts.length !== 5) return false;
		getNextCronTime(cron);
		return true;
	} catch {
		return false;
	}
}

// ── 可中断 sleep ──────────────────────────────────────────────────

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) return resolve();
		const timer = setTimeout(resolve, ms);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
	});
}

// ── 生成唯一 ID ───────────────────────────────────────────────────

function genId(): string {
	return `loop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ── 运行时状态 ────────────────────────────────────────────────────

interface JobEntry {
	config: LoopConfig;
	task: ReturnType<ExtensionAPI["background"]> | null;
	lastRun: number | null;
	nextRun: number | null;
	runCount: number;
	lastError: string | null;
}

function buildStatus(jobs: Map<string, JobEntry>): LoopStatus[] {
	return Array.from(jobs.values()).map((j) => ({
		id: j.config.id,
		isRunning: j.config.enabled && j.task !== null,
		lastRun: j.lastRun,
		nextRun: j.nextRun,
		runCount: j.runCount,
		lastError: j.lastError,
	}));
}

// ── settings 读写 ─────────────────────────────────────────────────

function readLoopsFromSettings(ctx: { getSettings: () => unknown }): LoopConfig[] {
	const settings = (ctx.getSettings() ?? {}) as Record<string, unknown>;
	const ls = settings.loopScheduler as { loops?: LoopConfig[] } | undefined;
	return ls?.loops ?? [];
}

async function persistLoops(_pi: ExtensionAPI, _loops: LoopConfig[]): Promise<void> {
	// Settings 写入由 app 端通过 agent.setSettings RPC 完成（channel CRUD 后
	// 返回最新的 loops 列表，前端负责 persist）。Extension 内部只管内存状态。
}

// ── 全局单例锁（保证只有一个 session 执行 cron 触发）──────────────

const LOCK_TIMEOUT_MS = 120_000; // 锁 2 分钟过期（CLI 进程心跳更新）

function getLockPath(): string {
	const dir = getGlobalDataDir("loop-scheduler");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return join(dir, "loop-scheduler.lock");
}

function tryAcquireLock(options?: { force?: boolean }): boolean {
	const lockPath = getLockPath();
	const now = Date.now();
	const myPid = process.pid;

	// 检查现有锁（force 模式跳过占用检查：leader-lease 抢占）
	if (!options?.force && existsSync(lockPath)) {
		try {
			const raw = readFileSync(lockPath, "utf-8");
			const lock = JSON.parse(raw) as { pid: number; ts: number };
			if (now - lock.ts < LOCK_TIMEOUT_MS && lock.pid !== myPid) {
				// 锁未过期且不是自己的 → 别人持有
				return false;
			}
		} catch {
			// 锁文件损坏 → 覆盖
		}
	}

	// 获取锁
	writeFileSync(lockPath, JSON.stringify({ pid: myPid, ts: now }));
	return true;
}

/**
 * Lease-mode heartbeat: refresh the lock if we still hold it. If another
 * process force-preempted (a newly adopted session became the active
 * scheduler), stand down — stop cron jobs and stop refreshing.
 * Returns true when still the scheduler.
 */
function heartbeatLock(jobs: Map<string, JobEntry>): boolean {
	const lockPath = getLockPath();
	try {
		const raw = readFileSync(lockPath, "utf-8");
		const lock = JSON.parse(raw) as { pid: number; ts: number };
		if (lock.pid === process.pid) {
			writeFileSync(lockPath, JSON.stringify({ pid: process.pid, ts: Date.now() }));
			return true;
		}
	} catch {
		// 锁文件丢失/损坏 → 重新拿
		writeFileSync(lockPath, JSON.stringify({ pid: process.pid, ts: Date.now() }));
		return true;
	}
	// 锁被别的进程抢占 → 退位
	for (const entry of jobs.values()) {
		if (entry.task) entry.task.cancel();
	}
	jobs.clear();
	isSchedulerGlobal = false;
	emitStatus();
	return false;
}

/** Module-level mirror of isScheduler for use inside standalone helpers. */
let isSchedulerGlobal = false;

function releaseLock(): void {
	const lockPath = getLockPath();
	try {
		const raw = readFileSync(lockPath, "utf-8");
		const lock = JSON.parse(raw) as { pid: number; ts: number };
		if (lock.pid === process.pid) {
			unlinkSync(lockPath);
		}
	} catch {
		// 文件不存在或损坏，忽略
	}
}

// ── 主扩展 ────────────────────────────────────────────────────────

export default function loopSchedulerExtension(pi: ExtensionAPI): void {
	pi.setName("loop-scheduler");

	const jobs = new Map<string, JobEntry>();
	let isScheduler = false; // 当前 session 是否是 active scheduler
	let lockHeartbeat: ReturnType<typeof setInterval> | null = null;

	// 全局单例锁：extension 加载时就获取（不等 session_start，因为 RPC 模式可能不触发）。
	// 例外：预热进程（PI_WARM_STANDBY=1，由 app 预热池 spawn）在初始启动时不参与锁竞争——
	// 它还没绑定任何用户 session。等它被 adopt（switchSession 触发 reason="resume" 的
	// session_start）时才正式拿锁，见下方 session_start 处理。
	const warmStandby = process.env.PI_WARM_STANDBY === "1";
	if (!warmStandby) {
		try {
			isScheduler = tryAcquireLock();
		} catch (err) {
			console.error(`[loop-scheduler] tryAcquireLock error at init:`, err);
			isScheduler = false;
		}
	}
	// 心跳（租约模式：被抢占时自动退位）
	if (isScheduler) {
		isSchedulerGlobal = true;
		lockHeartbeat = setInterval(() => {
			if (!heartbeatLock(jobs)) {
				if (lockHeartbeat) clearInterval(lockHeartbeat);
				lockHeartbeat = null;
			}
		}, 30_000);
	}
	let channel: ReturnType<typeof createTypedChannel<LoopSchedulerChannelContract>>["server"] | null = null;

	// ── Channel 注册 ──
	try {
		const rawChannel = pi.registerChannel(LOOP_SCHEDULER_CHANNEL_NAME);
		channel = createTypedChannel<LoopSchedulerChannelContract>(rawChannel).server;

		const safeEmit = (event: string, data: unknown) => {
			try {
				(rawChannel as { emit?: (e: string, d: unknown) => void }).emit?.(event, data);
			} catch {
				// channel may be stale after session switch
			}
		};

		const emitStatus = () => safeEmit("status", { type: "status", loops: buildStatus(jobs) });

		channel.handle("list", () => ({ loops: Array.from(jobs.values()).map((j) => j.config), isScheduler } as { loops: LoopConfig[]; isScheduler: boolean }));
		// 用户切回本 session：强制成为 active scheduler（lease 抢占，旧持有者心跳退位）
		channel.handle("becomeScheduler", () => {
			if (isScheduler) return { ok: true, already: true };
			isScheduler = tryAcquireLock({ force: true });
			isSchedulerGlobal = isScheduler;
			if (isScheduler) {
				if (!lockHeartbeat) {
					lockHeartbeat = setInterval(() => {
						if (!heartbeatLock(jobs)) {
							if (lockHeartbeat) clearInterval(lockHeartbeat);
							lockHeartbeat = null;
						}
					}, 30_000);
				}
				// 重新启动本 session 的 enabled loops
				for (const [id, entry] of jobs) {
					if (entry.config.enabled && !entry.task) {
						startJob(pi, jobs, id, emitStatus, isScheduler);
					}
				}
			}
			emitStatus();
			return { ok: isScheduler };
		});
		channel.handle("getStatus", () => ({ type: "status" as const, loops: buildStatus(jobs) }));

		channel.handle("create", ({ name, cron, prompt, deliverAs }) => {
			if (!isValidCron(cron)) {
				return { ok: false, error: `无效的 cron 表达式: ${cron}` };
			}
			const loop: LoopConfig = {
				id: genId(),
				name,
				enabled: true,
				cron,
				prompt,
				deliverAs: deliverAs ?? "followUp",
			};
			jobs.set(loop.id, {
				config: loop,
				task: null,
				lastRun: null,
				nextRun: null,
				runCount: 0,
				lastError: null,
			});
			startJob(pi, jobs, loop.id, emitStatus, isScheduler);
			persistLoops(pi, Array.from(jobs.values()).map((j) => j.config)).catch(() => {});
			emitStatus();
			return { ok: true, id: loop.id };
		});

		channel.handle("update", ({ id, ...updates }) => {
			const entry = jobs.get(id);
			if (!entry) return { ok: false, error: `Loop not found: ${id}` };
			const newConfig = { ...entry.config, ...updates };
			if (updates.cron && !isValidCron(updates.cron)) {
				return { ok: false, error: `无效的 cron 表达式: ${updates.cron}` };
			}
			entry.config = newConfig;
			// 重启 job 如果在跑
			if (entry.task) {
				entry.task.cancel();
				entry.task = null;
				startJob(pi, jobs, id, emitStatus, isScheduler);
			}
			persistLoops(pi, Array.from(jobs.values()).map((j) => j.config)).catch(() => {});
			emitStatus();
			return { ok: true };
		});

		channel.handle("toggle", ({ id, enabled }) => {
			const entry = jobs.get(id);
			if (!entry) return { ok: false, error: `Loop not found: ${id}` };
			entry.config.enabled = enabled;
			if (enabled && !entry.task) {
				startJob(pi, jobs, id, emitStatus, isScheduler);
			} else if (!enabled && entry.task) {
				entry.task.cancel();
				entry.task = null;
				entry.nextRun = null;
			}
			persistLoops(pi, Array.from(jobs.values()).map((j) => j.config)).catch(() => {});
			emitStatus();
			return { ok: true };
		});

		channel.handle("remove", ({ id }) => {
			const entry = jobs.get(id);
			if (!entry) return { ok: false, error: `Loop not found: ${id}` };
			if (entry.task) entry.task.cancel();
			jobs.delete(id);
			persistLoops(pi, Array.from(jobs.values()).map((j) => j.config)).catch(() => {});
			emitStatus();
			return { ok: true };
		});

		// ── 注册 Agent tool（让 Agent 自己 CRUD loop）──
		const LoopManageParams = Type.Object({
			action: Type.Union(
				[
					Type.Literal("list"),
					Type.Literal("create"),
					Type.Literal("update"),
					Type.Literal("toggle"),
					Type.Literal("remove"),
				],
				{ description: "要执行的操作" },
			),
			id: Type.Optional(Type.String({ description: "任务 ID（update/toggle/remove 时必填）" })),
			name: Type.Optional(Type.String({ description: "任务名称（create 时必填）" })),
			cron: Type.Optional(
				Type.String({ description: '标准 5-field cron，如 "*/5 * * * *" 或 "0 9 * * *"' }),
			),
			prompt: Type.Optional(Type.String({ description: "cron 触发时发给 Agent 的 prompt（create 时必填）" })),
			enabled: Type.Optional(Type.Boolean({ description: "enable/disable（toggle 时必填）" })),
			deliverAs: Type.Optional(
				Type.Union(
					[Type.Literal("followUp"), Type.Literal("steer")],
					{ description: "followUp = 排队等待，steer = 插话打断" },
				),
			),
		});

		pi.registerTool({
			name: "loop_manage",
			label: "Loop Manage",
			description:
				"管理定时任务（cron loop）。可以创建、查看、修改、开关、删除定时任务。" +
				'定时任务会按 cron 表达式自动给 Agent 发 prompt。例如用户说"每天 9 点跑测试"，' +
				'调用 create: { name: "每天跑测试", cron: "0 9 * * *", prompt: "运行项目测试" }。',
			parameters: LoopManageParams,
			execute: async (
				_toolCallId: string,
				params: Static<typeof LoopManageParams>,
			) => {
				switch (params.action) {
					case "list": {
						const loops = Array.from(jobs.values()).map((j) => ({
							...j.config,
							runCount: j.runCount,
							lastRun: j.lastRun ? new Date(j.lastRun).toISOString() : null,
							nextRun: j.nextRun ? new Date(j.nextRun).toISOString() : null,
							lastError: j.lastError,
						}));
						return {
							content: [{ type: "text" as const, text: JSON.stringify({ loops }, null, 2) }],
							details: { loops },
						};
					}
					case "create": {
						if (!params.name || !params.cron || !params.prompt) {
							return {
								content: [{ type: "text" as const, text: "错误: create 需要 name, cron, prompt" }],
								details: { ok: false },
							};
						}
						if (!isValidCron(params.cron)) {
							return {
								content: [{ type: "text" as const, text: `错误: 无效的 cron 表达式: ${params.cron}` }],
								details: { ok: false, error: "invalid cron" },
							};
						}
						const loop: LoopConfig = {
							id: genId(),
							name: params.name,
							enabled: true,
							cron: params.cron,
							prompt: params.prompt,
							deliverAs: params.deliverAs ?? "followUp",
						};
						jobs.set(loop.id, {
							config: loop,
							task: null,
							lastRun: null,
							nextRun: null,
							runCount: 0,
							lastError: null,
						});
						startJob(pi, jobs, loop.id, emitStatus, isScheduler);
						persistLoops(pi, Array.from(jobs.values()).map((j) => j.config)).catch(() => {});
						emitStatus();
						return {
							content: [{ type: "text" as const, text: `已创建定时任务「${loop.name}」(${loop.cron})，ID: ${loop.id}` }],
							details: { ok: true, id: loop.id },
						};
					}
					case "update": {
						if (!params.id) {
							return { content: [{ type: "text" as const, text: "错误: update 需要 id" }], details: { ok: false } };
						}
						const entry = jobs.get(params.id);
						if (!entry) {
							return { content: [{ type: "text" as const, text: `错误: 任务不存在: ${params.id}` }], details: { ok: false } };
						}
						if (params.name !== undefined) entry.config.name = params.name;
						if (params.cron !== undefined) {
							if (!isValidCron(params.cron)) {
								return { content: [{ type: "text" as const, text: `错误: 无效 cron: ${params.cron}` }], details: { ok: false } };
							}
							entry.config.cron = params.cron;
						}
						if (params.prompt !== undefined) entry.config.prompt = params.prompt;
						if (params.deliverAs !== undefined) entry.config.deliverAs = params.deliverAs;
						if (entry.task) {
							entry.task.cancel();
							entry.task = null;
							startJob(pi, jobs, params.id, emitStatus, isScheduler);
						}
						persistLoops(pi, Array.from(jobs.values()).map((j) => j.config)).catch(() => {});
						emitStatus();
						return {
							content: [{ type: "text" as const, text: `已更新任务「${entry.config.name}」` }],
							details: { ok: true },
						};
					}
					case "toggle": {
						if (!params.id || params.enabled === undefined) {
							return { content: [{ type: "text" as const, text: "错误: toggle 需要 id 和 enabled" }], details: { ok: false } };
						}
						const entry = jobs.get(params.id);
						if (!entry) {
							return { content: [{ type: "text" as const, text: `错误: 任务不存在: ${params.id}` }], details: { ok: false } };
						}
						entry.config.enabled = params.enabled;
						if (params.enabled && !entry.task) {
							startJob(pi, jobs, params.id, emitStatus, isScheduler);
						} else if (!params.enabled && entry.task) {
							entry.task.cancel();
							entry.task = null;
							entry.nextRun = null;
						}
						persistLoops(pi, Array.from(jobs.values()).map((j) => j.config)).catch(() => {});
						emitStatus();
						return {
							content: [{ type: "text" as const, text: `任务「${entry.config.name}」已${params.enabled ? "启用" : "暂停"}` }],
							details: { ok: true },
						};
					}
					case "remove": {
						if (!params.id) {
							return { content: [{ type: "text" as const, text: "错误: remove 需要 id" }], details: { ok: false } };
						}
						const entry = jobs.get(params.id);
						if (!entry) {
							return { content: [{ type: "text" as const, text: `错误: 任务不存在: ${params.id}` }], details: { ok: false } };
						}
						if (entry.task) entry.task.cancel();
						const name = entry.config.name;
						jobs.delete(params.id);
						persistLoops(pi, Array.from(jobs.values()).map((j) => j.config)).catch(() => {});
						emitStatus();
						return {
							content: [{ type: "text" as const, text: `已删除任务「${name}」` }],
							details: { ok: true },
						};
					}
					default:
						return { content: [{ type: "text" as const, text: `未知操作: ${params.action}` }], details: { ok: false } };
				}
			},
		});

		// ── /loops 命令 ──
		pi.registerCommand("loops", {
			description: "查看所有定时任务状态",
			handler: async () => {
				if (jobs.size === 0) {
					return { text: "暂无定时任务。用 loop_manage 工具创建，或在设置面板添加。" };
				}
				const lines = Array.from(jobs.values()).map((j) => {
					const status = j.config.enabled ? (j.task ? "🟢 运行中" : "⚪ 未启动") : "🔴 已暂停";
					const next = j.nextRun ? new Date(j.nextRun).toLocaleString() : "—";
					const last = j.lastRun ? new Date(j.lastRun).toLocaleString() : "—";
					return `${status} ${j.config.name} | cron: ${j.config.cron} | 已运行 ${j.runCount} 次 | 上次: ${last} | 下次: ${next}${j.lastError ? ` | 错误: ${j.lastError}` : ""}`;
				});
				return { text: lines.join("\n") };
			},
		});

		// ── context hook ──
		pi.on("context", (ctx: ContextEvent, contextEntries: { role: string; content: string }[]) => {
			const activeLoops = Array.from(jobs.values()).filter((j) => j.config.enabled && j.task);
			if (activeLoops.length === 0) return;
			const summary = activeLoops
				.map(
					(j) =>
						`- ${j.config.name} (${j.config.cron}): 已运行 ${j.runCount} 次${j.lastRun ? `, 上次: ${new Date(j.lastRun).toLocaleString()}` : ""}`,
				)
				.join("\n");
			contextEntries.push({
				role: "system",
				content: `[Loop Scheduler] 当前有 ${activeLoops.length} 个活跃定时任务:\n${summary}`,
			});
		});

		// ── session 生命周期 ──
		pi.on("session_start", (_event, ctx) => {
			// 预热进程被 adopt（switchSession → reason="resume"）：此刻它成为
			// 真正的用户 session，正式参与单例锁竞争。
			if (warmStandby && _event.reason === "resume" && !isScheduler) {
				// adopt：强制抢占锁（lease 模式——旧持有者会在下个心跳退位）
				isScheduler = tryAcquireLock({ force: true });
				isSchedulerGlobal = isScheduler;
				if (isScheduler && !lockHeartbeat) {
					lockHeartbeat = setInterval(() => {
						if (!heartbeatLock(jobs)) {
							if (lockHeartbeat) clearInterval(lockHeartbeat);
							lockHeartbeat = null;
						}
					}, 30_000);
				}
			}

			// 从 settings 加载 loops（所有 session 都加载配置，方便 channel CRUD）
			const loops = readLoopsFromSettings(ctx);

			for (const loop of loops) {
				jobs.set(loop.id, {
					config: loop,
					task: null,
					lastRun: null,
					nextRun: null,
					runCount: 0,
					lastError: null,
				});
				// 只有 active scheduler 才启动 cron 触发
				if (loop.enabled && isScheduler) {
					startJob(pi, jobs, loop.id, emitStatus, isScheduler);
				}
			}

			emitStatus();
		});

		pi.on("session_shutdown", () => {
			// 停止所有 loop
			for (const entry of jobs.values()) {
				if (entry.task) entry.task.cancel();
			}
			jobs.clear();

			// 释放锁（如果自己是 scheduler）
			if (isScheduler) {
				if (lockHeartbeat) clearInterval(lockHeartbeat);
				releaseLock();
				isScheduler = false;
				isSchedulerGlobal = false;
			}
		});
	} catch (err) {
		console.error(`[loop-scheduler] init error: ${err instanceof Error ? err.message : String(err)}`);
	}
}

// ── 启动单个 cron job ─────────────────────────────────────────────

function startJob(
	pi: ExtensionAPI,
	jobs: Map<string, JobEntry>,
	id: string,
	emitStatus: () => void,
	schedulerActive: boolean,
): void {
	const entry = jobs.get(id);
	if (!entry || !entry.config.enabled) return;

	// 非活跃 scheduler 不启动 cron（但仍记录配置供 channel 查询）
	if (!schedulerActive) {
		emitStatus();
		return;
	}

	const loop = entry.config;

	try {
		const nextDate = getNextCronTime(loop.cron);
		entry.nextRun = nextDate.getTime();
	} catch {
		entry.lastError = `无效 cron: ${loop.cron}`;
		emitStatus();
		return;
	}

	const task = pi.background(async (signal: AbortSignal) => {
		while (!signal.aborted) {
			let nextTime: number;
			try {
				nextTime = getNextCronTime(loop.cron).getTime();
			} catch {
				entry.lastError = `cron 计算失败: ${loop.cron}`;
				emitStatus();
				return;
			}
			entry.nextRun = nextTime;
			emitStatus();

			const delay = nextTime - Date.now();
			if (delay > 0) {
				await abortableSleep(delay, signal);
			}
			if (signal.aborted) break;

			// 触发 prompt
			try {
				pi.sendUserMessage(loop.prompt, { deliverAs: loop.deliverAs });
				entry.lastRun = Date.now();
				entry.runCount++;
				entry.lastError = null;
			} catch (err) {
				entry.lastError = err instanceof Error ? err.message : String(err);
			}
			emitStatus();
		}
	});

	entry.task = task;
	emitStatus();
}

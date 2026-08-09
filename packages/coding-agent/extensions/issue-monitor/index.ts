/**
 * Issue Monitor Extension — 定时扫描 GitHub Issues，自动触发 Agent 修复。
 *
 * 功能:
 * - 定期调 GitHub API 扫描指定仓库的 open issues
 * - 发现新 issue 时，通过 pi.sendUserMessage 触发 Agent 处理
 * - 已处理的 issue ID 持久化在 session JSONL，重启不重复
 * - /issues 命令查看监控状态
 * - context hook 注入 issue backlog
 *
 * 配置(settings.json):
 *   "issueMonitor": {
 *     "repos": ["owner/repo1", "owner/repo2"],
 *     "interval": 300,          // 扫描间隔(秒)，默认 300 = 5 分钟
 *     "labels": [],             // 只处理带这些 label 的 issue，空 = 全部
 *     "autoFix": true,          // true = 自动触发 Agent；false = 只记录
 *     "branchPrefix": "auto-fix/issue-"
 *   }
 */

import type { ExtensionAPI, ExtensionContext, ContextEvent } from "@dyyz1993/pi-coding-agent";
import { createTypedChannel } from "@dyyz1993/pi-coding-agent";
import {
	ISSUE_MONITOR_CHANNEL_NAME,
	type IssueMonitorChannelContract,
	type IssueMonitorStatusEvent,
	type RepoStatus,
} from "./contract.ts";

// ── 类型 ────────────────────────────────────────

interface IssueMonitorConfig {
	repos: string[];
	interval: number; // 秒
	labels: string[];
	autoFix: boolean;
	branchPrefix: string;
	githubToken: string; // GitHub PAT(避免 rate limit)
}

interface GitHubIssue {
	number: number;
	title: string;
	body: string | null;
	html_url: string;
	labels: { name: string }[];
	created_at: string;
	user: { login: string };
}

interface SeenRecord {
	id: number;
	repo: string;
	ts: number;
}

// ── 默认配置 ────────────────────────────────────

const DEFAULT_CONFIG: IssueMonitorConfig = {
	repos: [],
	interval: 300,
	labels: [],
	autoFix: true,
	branchPrefix: "auto-fix/issue-",
	githubToken: "",
};

// ── 辅助函数 ────────────────────────────────────

function loadConfig(ctx: ExtensionContext): IssueMonitorConfig | null {
	const settings = ctx.getSettings() as Record<string, unknown>;
	const raw = settings.issueMonitor as Partial<IssueMonitorConfig> | undefined;
	if (!raw || !raw.repos || raw.repos.length === 0) {
		return null; // 没配置 repos 就不启动
	}
	return {
		...DEFAULT_CONFIG,
		...raw,
		repos: raw.repos,
		interval: raw.interval ?? DEFAULT_CONFIG.interval,
		labels: raw.labels ?? DEFAULT_CONFIG.labels,
		autoFix: raw.autoFix ?? DEFAULT_CONFIG.autoFix,
		branchPrefix: raw.branchPrefix ?? DEFAULT_CONFIG.branchPrefix,
		githubToken: raw.githubToken ?? DEFAULT_CONFIG.githubToken,
	};
}

/** 从 GitHub API 获取 open issues */
async function fetchOpenIssues(
	repo: string,
	labels: string[],
	githubToken: string,
): Promise<GitHubIssue[]> {
	const labelQuery = labels.length > 0 ? `&labels=${encodeURIComponent(labels.join(","))}` : "";
	const url = `https://api.github.com/repos/${repo}/issues?state=open&per_page=20&sort=created&direction=desc${labelQuery}`;
	const headers: Record<string, string> = {
		Accept: "application/vnd.github.v3+json",
		"User-Agent": "pi-issue-monitor",
	};
	if (githubToken) {
		headers.Authorization = `Bearer ${githubToken}`;
	}
	const res = await fetch(url, { headers });
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
	}
	const data = (await res.json()) as GitHubIssue[];
	// GitHub API 会返回 PR(PR 有 pull_request 字段)，过滤掉
	return data.filter((i) => !("pull_request" in i));
}

/** 构建 issue 消息(含 <issue-monitor> 特殊块标签) */
function buildIssueMessage(repo: string, issue: GitHubIssue, branchPrefix: string): string {
	const body = (issue.body || "(无描述)").slice(0, 1500);
	const branch = `${branchPrefix}${issue.number}`;
	const issueBody = [
		`**仓库**: ${repo}`,
		`**Issue #${issue.number}**: ${issue.title}`,
		`**链接**: ${issue.html_url}`,
		`**提交者**: ${issue.user.login}`,
		`**创建时间**: ${issue.created_at}`,
		``,
		`**描述**:`,
		body,
		``,
		`请分析并修复这个 issue。步骤:`,
		`1. 理解 issue 描述的问题`,
		`2. 在当前项目中定位相关代码`,
		`3. 修改代码修复问题`,
		`4. 运行相关测试验证修复`,
		`5. git commit 并 push 到分支 \`${branch}\``,
		`6. 如果有 gh CLI，创建 PR (title: "fix: ${issue.title.slice(0, 60)}")`,
	].join("\n");

	// 用特殊块标签包裹，前端 IssueMonitorBlockCard 会渲染成卡片
	return `<issue-monitor repo="${repo}" number="${issue.number}" title="${issue.title.replace(/"/g, "'")}" url="${issue.html_url}" status="new">\n${issueBody}\n</issue-monitor>`;
}
		``,
		`**描述**:` ,
		body,
		``,
		`请分析并修复这个 issue。步骤:`,
		`1. 理解 issue 描述的问题`,
		`2. 在当前项目中定位相关代码`,
		`3. 修改代码修复问题`,
		`4. 运行相关测试验证修复`,
		`5. git commit 并 push 到分支 \`${branch}\``,
		`6. 如果有 gh CLI，创建 PR (title: "fix: ${issue.title.slice(0, 60)}")`,
	].join("\n");
}

// ── 主扩展 ──────────────────────────────────────

export default function issueMonitorExtension(pi: ExtensionAPI): void {
	pi.setName("issue-monitor");

	let config: IssueMonitorConfig | null = null;
	const seenIssues = new Map<string, Set<number>>(); // repo -> Set<issue_number>
	let monitorTask: ReturnType<ExtensionAPI["background"]> | null = null;
	let lastScanTime = 0;
	let lastScanError: string | null = null;
	let totalOpenCount = 0;

	// ── Channel 注册(前端通过此 channel 接收状态) ──
	let channel: ReturnType<typeof createTypedChannel<IssueMonitorChannelContract>>["server"] | null = null;
	try {
		const rawChannel = pi.registerChannel(ISSUE_MONITOR_CHANNEL_NAME);
		channel = createTypedChannel<IssueMonitorChannelContract>(rawChannel).server;
		// 前端可调用 get_status 获取完整状态
		channel.handle("get_status", () => buildStatusEvent());
		channel.handle("get_config", () => {
			if (!config) return { repos: [], interval: 300, autoFix: false, labels: [], branchPrefix: "auto-fix/issue-" };
			return {
				repos: config.repos,
				interval: config.interval,
				autoFix: config.autoFix,
				labels: config.labels,
				branchPrefix: config.branchPrefix,
			};
		});
	} catch (err) {
		console.warn("[issue-monitor] Channel 注册失败:", err);
	}

	/** 构建状态快照 */
	function buildStatusEvent(): IssueMonitorStatusEvent {
		const repos: RepoStatus[] = (config?.repos ?? []).map((repo) => ({
			repo,
			openCount: totalOpenCount,
			seenCount: seenIssues.get(repo)?.size ?? 0,
			newCount: 0,
			lastError: lastScanError,
		}));
		return {
			type: "status",
			repos,
			lastScanTime: lastScanTime || null,
			lastScanError,
			totalSeen: [...seenIssues.values()].reduce((sum, s) => sum + s.size, 0),
			isRunning: monitorTask !== null,
		};
	}

	/** 向前端 emit 状态更新 */
	function emitStatus(): void {
		if (!channel) return;
		try {
			channel.emit("status", buildStatusEvent());
		} catch {
			// channel 可能在 session 切换后失效，忽略
		}
	}

	// ── 恢复已处理的 issue IDs ──
	function restoreSeen(entries: ReadonlyArray<{ customType?: string; data?: unknown }>): void {
		for (const entry of entries) {
			if (entry.customType === "issue_monitor_seen" && entry.data) {
				const record = entry.data as SeenRecord;
				if (!seenIssues.has(record.repo)) {
					seenIssues.set(record.repo, new Set());
				}
				seenIssues.get(record.repo)!.add(record.id);
			}
		}
	}

	// ── 扫描一次 ──
	async function scanOnce(): Promise<void> {
		if (!config) return;
		lastScanTime = Date.now();
		lastScanError = null;
		let newCount = 0;

		for (const repo of config.repos) {
			try {
				const issues = await fetchOpenIssues(repo, config.labels, config.githubToken);
				totalOpenCount = issues.length;

				if (!seenIssues.has(repo)) {
					seenIssues.set(repo, new Set());
				}
				const seen = seenIssues.get(repo)!;

				// 首次扫描: 只记录，不触发(避免批量轰炸)
				const isFirstScan = seen.size === 0;

				for (const issue of issues) {
					if (seen.has(issue.number)) continue;
					seen.add(issue.number);

					// 持久化
					pi.appendEntry("issue_monitor_seen", {
						id: issue.number,
						repo,
						ts: Date.now(),
					} satisfies SeenRecord);

					if (isFirstScan) {
						// 首次扫描只记录，不触发修复
						continue;
					}

					newCount++;
					console.log(`[issue-monitor] 新 issue: ${repo}#${issue.number} - ${issue.title}`);

					if (config.autoFix) {
						const msg = buildIssueMessage(repo, issue, config.branchPrefix);
						// 用 followUp 避免中断当前对话
						await pi.sendUserMessage(msg, { deliverAs: "followUp" });
					}
				}
			} catch (err) {
				lastScanError = err instanceof Error ? err.message : String(err);
				console.error(`[issue-monitor] 扫描 ${repo} 失败:`, lastScanError);
			}
		}

		if (newCount > 0) {
			console.log(`[issue-monitor] 本次扫描发现 ${newCount} 个新 issue`);
		}

		// 扫描完成后向前端 emit 状态
		emitStatus();
	}

	// ── 启动监控循环 ──
	function startMonitoring(): void {
		if (!config || monitorTask) return;

		const intervalMs = config.interval * 1000;
		console.log(
			`[issue-monitor] 启动监控: repos=[${config.repos.join(", ")}] interval=${config.interval}s autoFix=${config.autoFix}`,
		);

		// 用 pi.background 运行 polling 循环(支持 abort 取消)
		monitorTask = pi.background(async (signal: AbortSignal) => {
			// 首次延迟 10 秒(等 session 完全启动)
			await new Promise((resolve) => {
				const t = setTimeout(resolve, 10_000);
				signal.addEventListener("abort", () => { clearTimeout(t); resolve(null); }, { once: true });
			});
			if (signal.aborted) return;

			// 立即扫描一次
			await scanOnce().catch((e) => console.error("[issue-monitor] 首次扫描失败:", e));

			// 定时循环
			while (!signal.aborted) {
				await new Promise((resolve) => {
					const t = setTimeout(resolve, intervalMs);
					signal.addEventListener("abort", () => { clearTimeout(t); resolve(null); }, { once: true });
				});
				if (signal.aborted) break;
				await scanOnce().catch((e) => console.error("[issue-monitor] 扫描失败:", e));
			}
		});
	}

	// ── session_start: 初始化 ──
	pi.on("session_start", (_event, ctx) => {
		config = loadConfig(ctx);
		if (!config) {
			console.log("[issue-monitor] 未配置 issueMonitor.repos，扩展不启动");
			return;
		}

		// 从历史 entries 恢复已处理 issue
		const entries = ctx.sessionManager?.getCustomEntries?.() ?? [];
		restoreSeen(entries);

		const totalSeen = [...seenIssues.values()].reduce((sum, s) => sum + s.size, 0);
		console.log(`[issue-monitor] 恢复了 ${totalSeen} 个已处理 issue`);

		startMonitoring();
		emitStatus(); // 初始状态推送给前端
	});

	// ── context: 注入 issue backlog ──
	pi.on("context", (event: ContextEvent) => {
		if (!config) return;
		const totalSeen = [...seenIssues.values()].reduce((sum, s) => sum + s.size, 0);
		if (totalSeen === 0) return;

		const summary = config.repos
			.map((repo) => {
				const seen = seenIssues.get(repo)?.size ?? 0;
				return `  ${repo}: ${seen} issues 已处理`;
			})
			.join("\n");

		const lines = [
			`[issue-monitor] 正在监控 ${config.repos.length} 个仓库 (${config.interval}s 间隔):`,
			summary,
			lastScanTime ? `上次扫描: ${new Date(lastScanTime).toISOString()}` : "尚未扫描",
			lastScanError ? `上次错误: ${lastScanError}` : "",
		].filter(Boolean);

		event.messages.push({
			role: "user",
			content: [{ type: "text", text: lines.join("\n") }],
			timestamp: Date.now(),
		});
	});

	// ── /issues 命令: 查看状态 ──
	pi.registerCommand("issues", {
		description: "查看 issue 监控状态",
		handler: async () => {
			if (!config) {
				return { text: "issue-monitor 未配置。在 settings.json 中添加 issueMonitor.repos。" };
			}
			const lines: string[] = [
				"📊 Issue Monitor 状态",
				`监控仓库: ${config.repos.join(", ")}`,
				`扫描间隔: ${config.interval}s`,
				`自动修复: ${config.autoFix ? "✅ 开启" : "❌ 关闭"}`,
				`上次扫描: ${lastScanTime ? new Date(lastScanTime).toLocaleString() : "尚未扫描"}`,
				lastScanError ? `上次错误: ${lastScanError}` : "",
				"",
				"已处理 issues:",
			];
			for (const repo of config.repos) {
				const seen = seenIssues.get(repo);
				if (seen && seen.size > 0) {
					lines.push(`  ${repo}: ${seen.size} 个 (#[${[...seen].join(", #")}]`);
				} else {
					lines.push(`  ${repo}: 0 个`);
				}
			}
			return { text: lines.filter(Boolean).join("\n") };
		},
	});

	// ── session_shutdown: 清理 ──
	pi.on("session_shutdown", () => {
		if (monitorTask) {
			monitorTask.cancel();
			monitorTask = null;
			console.log("[issue-monitor] 监控已停止");
		}
	});
}

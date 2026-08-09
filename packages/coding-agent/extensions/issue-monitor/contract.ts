/**
 * Issue Monitor Channel Contract
 *
 * 定义 issue-monitor 扩展与前端之间的通信类型。
 */

export const ISSUE_MONITOR_CHANNEL_NAME = "issue-monitor" as const;

/** 扩展定期 emit 的状态快照 */
export interface IssueMonitorStatusEvent {
	type: "status";
	repos: RepoStatus[];
	lastScanTime: number | null;
	lastScanError: string | null;
	totalSeen: number;
	isRunning: boolean;
}

/** 单个仓库的监控状态 */
export interface RepoStatus {
	repo: string;
	openCount: number;
	seenCount: number;
	newCount: number;
	lastError: string | null;
}

/** 新 issue 发现事件 */
export interface IssueMonitorNewIssueEvent {
	type: "new_issue";
	repo: string;
	issueNumber: number;
	issueTitle: string;
	issueUrl: string;
}

/** 前端可调用的 channel 方法 */
export interface IssueMonitorChannelContract {
	/** 获取当前完整状态 */
	get_status: {
		request: void;
		response: IssueMonitorStatusEvent;
	};

	/** 获取配置 */
	get_config: {
		request: void;
		response: {
			repos: string[];
			interval: number;
			autoFix: boolean;
			labels: string[];
			branchPrefix: string;
		};
	};
}

export type IssueMonitorChannelData = IssueMonitorStatusEvent | IssueMonitorNewIssueEvent;

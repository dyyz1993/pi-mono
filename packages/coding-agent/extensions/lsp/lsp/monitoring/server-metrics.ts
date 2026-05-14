import { execSync } from "node:child_process";

export interface ServerMetricsSnapshot {
	name: string;
	pid: number | undefined;
	fileTypes: string[];
	state: "started" | "ready" | "stopped" | "error";
	startupDurationMs: number | undefined;
	memoryRssKb: number | undefined;
	requestCount: number;
	notifyCount: number;
	lastActivityAt: number | undefined;
}

interface ServerMetricsState {
	name: string;
	pid: number | undefined;
	fileTypes: string[];
	state: "started" | "ready" | "stopped" | "error";
	startedAt: number | undefined;
	readyAt: number | undefined;
	stoppedAt: number | undefined;
	requestCount: number;
	notifyCount: number;
	lastActivityAt: number | undefined;
}

export interface ServerMetricsCollector {
	onStarting(name: string, fileTypes: string[]): void;
	onReady(name: string, pid: number | undefined): void;
	onStop(name: string): void;
	onError(name: string): void;
	onRequest(name: string): void;
	onNotify(name: string): void;
	snapshot(): ServerMetricsSnapshot[];
	summary(): string;
}

export function createServerMetricsCollector(): ServerMetricsCollector {
	const servers = new Map<string, ServerMetricsState>();

	return {
		onStarting(name: string, fileTypes: string[]): void {
			servers.set(name, {
				name,
				pid: undefined,
				fileTypes,
				state: "started",
				startedAt: Date.now(),
				readyAt: undefined,
				stoppedAt: undefined,
				requestCount: 0,
				notifyCount: 0,
				lastActivityAt: undefined,
			});
		},

		onReady(name: string, pid: number | undefined): void {
			const entry = servers.get(name);
			if (!entry) {
				return;
			}
			entry.state = "ready";
			entry.pid = pid;
			entry.readyAt = Date.now();
		},

		onStop(name: string): void {
			const entry = servers.get(name);
			if (!entry) {
				return;
			}
			entry.state = "stopped";
			entry.stoppedAt = Date.now();
		},

		onError(name: string): void {
			const entry = servers.get(name);
			if (!entry) {
				return;
			}
			entry.state = "error";
		},

		onRequest(name: string): void {
			const entry = servers.get(name);
			if (!entry) {
				return;
			}
			entry.requestCount += 1;
			entry.lastActivityAt = Date.now();
		},

		onNotify(name: string): void {
			const entry = servers.get(name);
			if (!entry) {
				return;
			}
			entry.notifyCount += 1;
			entry.lastActivityAt = Date.now();
		},

		snapshot(): ServerMetricsSnapshot[] {
			const now = Date.now();
			return [...servers.values()].map((entry) => ({
				name: entry.name,
				pid: entry.pid,
				fileTypes: entry.fileTypes,
				state: entry.state,
				startupDurationMs:
					entry.readyAt && entry.startedAt ? entry.readyAt - entry.startedAt : undefined,
				memoryRssKb: entry.pid ? getProcessMemoryKb(entry.pid) : undefined,
				requestCount: entry.requestCount,
				notifyCount: entry.notifyCount,
				lastActivityAt: entry.lastActivityAt,
			}));
		},

		summary(): string {
			const snapshots = this.snapshot();
			if (snapshots.length === 0) {
				return "[lsp-metrics] No servers configured.";
			}

			const lines: string[] = ["[lsp-metrics] Session summary:", ""];

			for (const snap of snapshots) {
				const types = snap.fileTypes.length > 0 ? snap.fileTypes.join(", ") : "*";
				const startup = snap.startupDurationMs !== undefined ? `${snap.startupDurationMs}ms` : "n/a";
				const mem = snap.memoryRssKb !== undefined ? `${Math.round(snap.memoryRssKb / 1024)}MB` : "n/a";
				const totalOps = snap.requestCount + snap.notifyCount;
				const idleTime = snap.lastActivityAt ? `${Math.round((Date.now() - snap.lastActivityAt) / 1000)}s ago` : "never used";
				const pid = snap.pid ?? "n/a";

				lines.push(`  ${snap.name} [${types}]`);
				lines.push(`    state: ${snap.state}  pid: ${pid}  startup: ${startup}  memory: ${mem}`);
				lines.push(`    requests: ${snap.requestCount}  notifications: ${snap.notifyCount}  total: ${totalOps}  last: ${idleTime}`);
				lines.push("");
			}

			const totalMemory = snapshots.reduce((sum, s) => sum + (s.memoryRssKb ?? 0), 0);
			const totalOps = snapshots.reduce((sum, s) => sum + s.requestCount + s.notifyCount, 0);
			const unusedServers = snapshots.filter((s) => s.requestCount + s.notifyCount === 0);

			lines.push(`  Total: ${snapshots.length} servers, ${Math.round(totalMemory / 1024)}MB RSS, ${totalOps} ops`);
			if (unusedServers.length > 0) {
				lines.push(
					`  Unused: ${unusedServers.map((s) => s.name).join(", ")} (${unusedServers.length}/${snapshots.length} servers received zero requests)`,
				);
			}

			return lines.join("\n");
		},
	};
}

function getProcessMemoryKb(pid: number): number | undefined {
	try {
		if (process.platform === "darwin") {
			const output = execSync(`ps -p ${pid} -o rss=`, { timeout: 2000, encoding: "utf8" }).trim();
			const kb = Number.parseInt(output, 10);
			return Number.isFinite(kb) ? kb : undefined;
		}
		if (process.platform === "linux") {
			const stat = execSync(`cat /proc/${pid}/status 2>/dev/null | grep VmRSS`, {
				timeout: 2000,
				encoding: "utf8",
			}).trim();
			const match = /(\d+)\s*kB/i.exec(stat);
			return match ? Number.parseInt(match[1], 10) : undefined;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

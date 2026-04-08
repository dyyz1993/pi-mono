/**
 * CLI command to view compression logs
 *
 * Usage:
 *   pi compression-logs [options]
 *
 * Options:
 *   --today         Show today's logs (default)
 *   --latest        Show the latest session summary
 *   --session <id>  Show specific session details
 *   --tail <n>      Show last N log entries (default: 20)
 *   --stats         Show statistics summary
 *   --json          Output in JSON format
 */

import * as fs from "fs";
import { homedir } from "os";
import * as path from "path";

interface CompressionSessionLog {
	sessionId: string;
	startTime: string;
	intent?: string;
	intentConfidence?: number;
	tokensBefore: number;
	tokensAfter: number;
	savedTokens: number;
	savedPercent: string;
	durationMs: number;
	totalMessages: number;
	toolResultsProcessed: number;
	strategies: {
		protected: number;
		persist: number;
		summary: number;
		persist_short: number;
		drop: number;
	};
	toolResults: ToolResultLogEntry[];
	errors: string[];
}

interface ToolResultLogEntry {
	messageIndex: number;
	toolName: string;
	strategy: string;
	score: number;
	breakdown: {
		base: number;
		size: number;
		age: number;
		repeat: number;
		content: number;
	};
	reason: string;
	contentPreview: string;
	originalSize: number;
	compressedSize: number;
	savedBytes: number;
}

export class CompressionLogsCLI {
	private logDir: string;

	constructor() {
		this.logDir = path.join(homedir(), ".pi", "compression-logs");
	}

	async run(args: string[]): Promise<void> {
		const options = this.parseArgs(args);

		if (!fs.existsSync(this.logDir)) {
			console.log("No compression logs found. Logs will be created when compression runs.");
			console.log(`Log directory: ${this.logDir}`);
			return;
		}

		if (options.session) {
			await this.showSession(options.session);
		} else if (options.latest) {
			await this.showLatestSession();
		} else if (options.stats) {
			await this.showStats();
		} else {
			await this.showLogs(options);
		}
	}

	private parseArgs(args: string[]): {
		today: boolean;
		latest: boolean;
		session?: string;
		tail: number;
		stats: boolean;
		json: boolean;
	} {
		const result = {
			today: true,
			latest: false,
			session: undefined as string | undefined,
			tail: 20,
			stats: false,
			json: false,
		};

		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (arg === "--today") {
				result.today = true;
			} else if (arg === "--latest") {
				result.latest = true;
				result.today = false;
			} else if (arg === "--session" && i + 1 < args.length) {
				result.session = args[i + 1];
				result.today = false;
				i++;
			} else if (arg === "--tail" && i + 1 < args.length) {
				result.tail = parseInt(args[i + 1], 10) || 20;
				i++;
			} else if (arg === "--stats") {
				result.stats = true;
				result.today = false;
			} else if (arg === "--json") {
				result.json = true;
			}
		}

		return result;
	}

	private async showLogs(options: { tail: number; json: boolean }): Promise<void> {
		const today = new Date().toISOString().split("T")[0];
		const logFile = path.join(this.logDir, `compression-${today}.log`);

		if (!fs.existsSync(logFile)) {
			console.log(`No logs found for today (${today})`);
			console.log("\nAvailable log dates:");
			this.listAvailableDates();
			return;
		}

		const content = fs.readFileSync(logFile, "utf-8");
		const lines = content.trim().split("\n");

		if (options.json) {
			const lastLines = lines.slice(-options.tail);
			console.log(JSON.stringify(lastLines, null, 2));
		} else {
			console.log(`\n📋 Last ${options.tail} log entries:\n`);
			console.log("═".repeat(80));
			const lastLines = lines.slice(-options.tail);
			for (const line of lastLines) {
				console.log(line);
			}
			console.log("═".repeat(80));
			console.log(`\nLog file: ${logFile}`);
		}
	}

	private async showLatestSession(): Promise<void> {
		const files = this.getAllSummaryFiles();
		if (files.length === 0) {
			console.log("No session summaries found.");
			return;
		}

		// Sort by modification time, get the latest
		const latest = files.sort((a, b) => {
			const statA = fs.statSync(a);
			const statB = fs.statSync(b);
			return statB.mtimeMs - statA.mtimeMs;
		})[0];

		await this.showSession(path.basename(latest, ".txt").replace("summary-", ""));
	}

	private async showSession(sessionId: string): Promise<void> {
		const summaryFile = path.join(this.logDir, `summary-${sessionId}.txt`);
		const jsonFile = path.join(this.logDir, `summary-${sessionId}.json`);

		if (!fs.existsSync(summaryFile) && !fs.existsSync(jsonFile)) {
			console.log(`Session not found: ${sessionId}`);
			console.log("\nAvailable sessions:");
			this.listAvailableSessions();
			return;
		}

		if (fs.existsSync(summaryFile)) {
			console.log("\n" + fs.readFileSync(summaryFile, "utf-8"));
		}

		if (fs.existsSync(jsonFile)) {
			console.log(`\nJSON details: ${jsonFile}`);
		}
	}

	private async showStats(): Promise<void> {
		const files = this.getAllSummaryFiles();
		if (files.length === 0) {
			console.log("No session summaries found.");
			return;
		}

		const sessions: CompressionSessionLog[] = [];
		for (const file of files) {
			const jsonFile = file.replace(".txt", ".json");
			if (fs.existsSync(jsonFile)) {
				try {
					const content = fs.readFileSync(jsonFile, "utf-8");
					sessions.push(JSON.parse(content));
				} catch (error) {
					console.error(`Failed to read ${jsonFile}: ${error}`);
				}
			}
		}

		if (sessions.length === 0) {
			console.log("No valid session data found.");
			return;
		}

		// Aggregate statistics
		const stats = {
			totalSessions: sessions.length,
			totalMessages: 0,
			totalTokensBefore: 0,
			totalTokensAfter: 0,
			totalTokensSaved: 0,
			totalDuration: 0,
			totalToolResults: 0,
			strategies: {
				protected: 0,
				persist: 0,
				summary: 0,
				persist_short: 0,
				drop: 0,
			},
			toolBreakdown: {} as Record<string, { count: number; saved: number }>,
		};

		for (const session of sessions) {
			stats.totalMessages += session.totalMessages;
			stats.totalTokensBefore += session.tokensBefore;
			stats.totalTokensAfter += session.tokensAfter;
			stats.totalTokensSaved += session.savedTokens;
			stats.totalDuration += session.durationMs;
			stats.totalToolResults += session.toolResultsProcessed;

			stats.strategies.protected += session.strategies.protected;
			stats.strategies.persist += session.strategies.persist;
			stats.strategies.summary += session.strategies.summary;
			stats.strategies.persist_short += session.strategies.persist_short;
			stats.strategies.drop += session.strategies.drop;

			for (const tr of session.toolResults) {
				if (!stats.toolBreakdown[tr.toolName]) {
					stats.toolBreakdown[tr.toolName] = { count: 0, saved: 0 };
				}
				stats.toolBreakdown[tr.toolName].count++;
				stats.toolBreakdown[tr.toolName].saved += tr.savedBytes;
			}
		}

		console.log("\n" + "═".repeat(80));
		console.log("📊 COMPRESSION STATISTICS SUMMARY");
		console.log("═".repeat(80));
		console.log(`\n📈 Overall:`);
		console.log(`  Total Sessions:        ${stats.totalSessions}`);
		console.log(`  Total Messages:        ${stats.totalMessages}`);
		console.log(`  Total Tool Results:    ${stats.totalToolResults}`);
		console.log(`  Total Duration:        ${(stats.totalDuration / 1000).toFixed(2)}s`);
		console.log(`\n💾 Tokens:`);
		console.log(`  Before Compression:    ${stats.totalTokensBefore.toLocaleString()}`);
		console.log(`  After Compression:     ${stats.totalTokensAfter.toLocaleString()}`);
		console.log(`  Total Saved:           ${stats.totalTokensSaved.toLocaleString()}`);
		console.log(`  Compression Ratio:     ${((stats.totalTokensSaved / stats.totalTokensBefore) * 100).toFixed(1)}%`);
		console.log(`\n🎯 Strategies:`);
		console.log(`  Protected:             ${stats.strategies.protected}`);
		console.log(`  Persisted:             ${stats.strategies.persist}`);
		console.log(`  Summarized:            ${stats.strategies.summary}`);
		console.log(`  Persist Short:         ${stats.strategies.persist_short}`);
		console.log(`  Dropped:               ${stats.strategies.drop}`);
		console.log(`\n🔧 Top Tools by Usage:`);
		const sortedTools = Object.entries(stats.toolBreakdown)
			.sort((a, b) => b[1].count - a[1].count)
			.slice(0, 10);
		for (const [tool, data] of sortedTools) {
			console.log(
				`  ${tool.padEnd(20)} ${data.count.toString().padStart(5)} calls, ${(data.saved / 1024).toFixed(2)}KB saved`,
			);
		}
		console.log("\n" + "═".repeat(80));
	}

	private getAllSummaryFiles(): string[] {
		if (!fs.existsSync(this.logDir)) return [];

		return fs
			.readdirSync(this.logDir)
			.filter((f) => f.startsWith("summary-") && f.endsWith(".txt"))
			.map((f) => path.join(this.logDir, f));
	}

	private listAvailableDates(): void {
		if (!fs.existsSync(this.logDir)) return;

		const dates = fs
			.readdirSync(this.logDir)
			.filter((f) => f.startsWith("compression-") && f.endsWith(".log"))
			.map((f) => f.replace("compression-", "").replace(".log", ""))
			.sort()
			.reverse();

		for (const date of dates.slice(0, 10)) {
			console.log(`  - ${date}`);
		}
	}

	private listAvailableSessions(): void {
		if (!fs.existsSync(this.logDir)) return;

		const sessions = fs
			.readdirSync(this.logDir)
			.filter((f) => f.startsWith("summary-") && f.endsWith(".txt"))
			.map((f) => f.replace("summary-", "").replace(".txt", ""))
			.sort()
			.reverse()
			.slice(0, 10);

		for (const session of sessions) {
			console.log(`  - ${session}`);
		}
	}
}

/**
 * Handle compression-logs command from main CLI
 */
export async function handleCompressionLogsCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "compression-logs") {
		return false;
	}

	const cli = new CompressionLogsCLI();
	await cli.run(args.slice(1));
	return true;
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
	const cli = new CompressionLogsCLI();
	cli.run(process.argv.slice(2)).catch(console.error);
}

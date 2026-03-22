/**
 * Safe Kill Extension
 * 
 * Blocks dangerous process killing commands that use process names.
 * Requires users to find PID first, then kill specific process.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const DANGEROUS_PATTERNS = [
	{
		pattern: /pkill\s+-f\s+["']([^"']+)["']/,
		command: "pkill -f <pattern>",
		description: "通过进程名称匹配杀死进程",
	},
	{
		pattern: /pkill\s+-f\s+([^\s"']+)/,
		command: "pkill -f <pattern>",
		description: "通过进程名称匹配杀死进程（无引号）",
	},
	{
		pattern: /killall\s+(\w+)/,
		command: "killall <name>",
		description: "通过进程名杀死所有匹配进程",
	},
];

export default function (pi: ExtensionAPI) {
	// Intercept bash tool calls to block dangerous process killing commands
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) {
			return;
		}

		const command = event.input.command;

		for (const { pattern, command: cmdPattern, description } of DANGEROUS_PATTERNS) {
			const match = command.match(pattern);
			if (match) {
				const target = match[1];
				const blockedCmd = command.trim();

				// Block the dangerous command
				return {
					block: true,
					reason: `🚫 禁止使用 ${cmdPattern} 杀死进程`,
					content: [
						{
							type: "text",
							text: `检测到危险命令：\`${blockedCmd}\`

**为什么危险：**
- ${description}
- 可能误杀其他包含相同关键词的进程
- 不会显示将要杀死的进程列表
- 无法确认进程是否重要

**✅ 正确的做法：先查找 PID，再杀死进程**

\`\`\`bash
# 步骤 1: 查找进程 ID
ps aux | grep ${target}
# 或查看端口占用（更精确）
lsof -i :<端口>
# 或使用 pgrep
pgrep -f ${target}

# 步骤 2: 确认进程信息
ps -p <PID> -o pid,ppid,user,%cpu,%mem,command

# 步骤 3: 杀死特定进程
kill <PID>
# 强制杀死（谨慎使用）
kill -9 <PID>

# 步骤 4: 验证进程已停止
ps -p <PID>
\`\`\`

**常用开发服务器端口：**
- Vite: 5173
- Next.js: 3000
- Create React App: 3000
- Nuxt: 3000
- Angular: 4200
- SvelteKit: 5173`,
						},
					],
				};
			}
		}
	});

	// Register a safe kill tool that requires user confirmation
	pi.registerTool({
		name: "safe_kill",
		label: "Safe Kill",
		description: "安全地查找并杀死进程 - 先列出 PID 列表，用户确认后杀死指定进程",
		parameters: Type.Object({
			pattern: Type.String({ description: "进程名称、关键词或端口号" }),
			signal: Type.Optional(
				Type.String({
					description: "kill 信号：TERM (默认), INT, KILL 等",
					enum: ["TERM", "INT", "KILL", "HUP", "QUIT"],
				}),
			),
			byPort: Type.Optional(
				Type.Boolean({
					description: "如果为 true，将 pattern 视为端口号，使用 lsof 查找",
					default: false,
				}),
			),
		}),
		async execute(toolCallId, params, _signal, _onUpdate, ctx) {
			const { pattern, signal = "TERM", byPort = false } = params;
			const cwd = ctx.cwd;

			// Import executeBash from bash-executor
			const { executeBash } = await import("../../../packages/coding-agent/src/core/bash-executor.js");

			try {
				// Step 1: Find processes
				let findCmd: string;
				if (byPort) {
					findCmd = `lsof -i :${pattern} 2>/dev/null || netstat -tlnp 2>/dev/null | grep :${pattern}`;
				} else {
					findCmd = `ps aux | grep -f "${pattern}" | grep -v grep`;
				}

				const findResult = await executeBash(findCmd, { cwd });

				if (findResult.exitCode !== 0 || !findResult.output.trim()) {
					return {
						content: [
							{
								type: "text",
								text: `未找到匹配 "${pattern}" 的进程。

请检查：
- 进程名称是否正确
- 进程是否正在运行
- 如果是端口号，请使用 byPort: true`,
							},
						],
						details: { found: false },
					};
				}

				// Parse PID list
				const pids = findResult.output
					.split("\n")
					.filter((line) => line.trim())
					.slice(1) // Skip header
					.map((line) => {
						const parts = line.trim().split(/\s+/);
						return { pid: parts[1], command: parts.slice(10).join(" ") };
					})
					.filter((p) => p.pid && !isNaN(parseInt(p.pid)));

				if (pids.length === 0) {
					return {
						content: [
							{
								type: "text",
								text: `未找到匹配 "${pattern}" 的进程。`,
							},
						],
						details: { found: false },
					};
				}

				// Format process list for display
				const processList = pids
					.map((p, i) => `${i + 1}. PID ${p.pid} - ${p.command}`)
					.join("\n");

				return {
					content: [
						{
							type: "text",
							text: `找到以下匹配 "${pattern}" 的进程：

${processList}

**下一步：**
请告诉我要杀死哪个 PID，例如："kill 12345"

或者使用 kill 命令直接杀死：
\`\`\`bash
kill -${signal} <PID>
\`\`\``,
						},
					],
					details: { found: true, pids, findOutput: findResult.output },
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `查找进程失败：${error instanceof Error ? error.message : String(error)}`,
						},
					],
					details: { error: true },
				};
			}
		},
	});
}

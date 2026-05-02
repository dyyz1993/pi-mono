export interface RuleTemplate {
	id: string;
	name: string;
	description: string;
	category: "file-protection" | "command-filter" | "role-restriction" | "keyword-route" | "sensitive" | "redirect";
	rules: RuleConfig[];
	defaultAction: "block" | "ask" | "prompt";
	acceptsFiles: boolean;
}

export interface RuleConfig {
	event: "PreToolUse" | "PostToolUse" | "Stop" | "SubagentStart" | "SubagentStop";
	matcher?: string;
	ifClause?: string;
	type: "command" | "http" | "prompt";
	command?: string;
	url?: string;
	prompt?: string;
	blockOnMatch: boolean;
	reason: string;
	piVariables?: Record<string, string>;
}

export const TEMPLATES: RuleTemplate[] = [
	{
		id: "no-verify",
		name: "禁止 --no-verify",
		description: "阻止绕过 Git hooks（Husky/lint-staged）的 --no-verify 参数",
		category: "command-filter",
		defaultAction: "block",
		acceptsFiles: false,
		rules: [
			{
				event: "PreToolUse",
				matcher: "Bash",
				ifClause: "Bash(*--no-verify*)",
				type: "command",
				command: "echo 'Blocked: --no-verify is not allowed' >&2 && exit 2",
				blockOnMatch: true,
				reason: "--no-verify 绕过了 Git hooks，禁止使用",
			},
		],
	},
	{
		id: "no-force-push",
		name: "禁止 force push",
		description: "阻止 git push --force / -f 操作",
		category: "command-filter",
		defaultAction: "block",
		acceptsFiles: false,
		rules: [
			{
				event: "PreToolUse",
				matcher: "Bash",
				ifClause: "Bash(git push*--force*)",
				type: "command",
				command: "echo 'Blocked: force push is not allowed' >&2 && exit 2",
				blockOnMatch: true,
				reason: "Force push 会覆盖远程历史，禁止使用",
			},
		],
	},
	{
		id: "no-rm-rf",
		name: "禁止 rm -rf",
		description: "阻止危险删除命令 rm -rf",
		category: "command-filter",
		defaultAction: "block",
		acceptsFiles: false,
		rules: [
			{
				event: "PreToolUse",
				matcher: "Bash",
				ifClause: "Bash(rm *-rf*)",
				type: "command",
				command: "echo 'Blocked: rm -rf is not allowed' >&2 && exit 2",
				blockOnMatch: true,
				reason: "rm -rf 是高危操作，禁止使用",
			},
		],
	},
	{
		id: "no-sudo",
		name: "禁止 sudo",
		description: "阻止 sudo 提权操作",
		category: "command-filter",
		defaultAction: "block",
		acceptsFiles: false,
		rules: [
			{
				event: "PreToolUse",
				matcher: "Bash",
				ifClause: "Bash(sudo*)",
				type: "command",
				command: "echo 'Blocked: sudo is not allowed' >&2 && exit 2",
				blockOnMatch: true,
				reason: "sudo 提权操作需要管理员审批",
			},
		],
	},
	{
		id: "protect-architecture",
		name: "保护架构文件",
		description: "修改架构配置文件时需要用户确认（不直接拦截，弹确认框）",
		category: "file-protection",
		defaultAction: "ask",
		acceptsFiles: true,
		rules: [
			{
				event: "PreToolUse",
				matcher: "Edit|Write",
				ifClause: "Edit(*tsconfig.json)",
				type: "command",
				command: `echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"架构文件 tsconfig.json 修改需要确认"}}'`,
				blockOnMatch: false,
				reason: "架构文件修改需要确认",
			},
			{
				event: "PreToolUse",
				matcher: "Edit|Write",
				ifClause: "Edit(*eslint.config*)",
				type: "command",
				command: `echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"ESLint 配置修改需要确认"}}'`,
				blockOnMatch: false,
				reason: "ESLint 配置修改需要确认",
			},
			{
				event: "PreToolUse",
				matcher: "Edit|Write",
				ifClause: "Edit(*package.json)",
				type: "command",
				command: `echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"package.json 修改需要确认，这会影响项目依赖"}}'`,
				blockOnMatch: false,
				reason: "package.json 修改需要确认",
			},
			{
				event: "PreToolUse",
				matcher: "Edit|Write",
				ifClause: "Edit(*vite.config*)",
				type: "command",
				command: `echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"构建配置修改需要确认"}}'`,
				blockOnMatch: false,
				reason: "构建配置修改需要确认",
			},
		],
	},
	{
		id: "protect-env-secrets",
		name: "保护敏感信息",
		description: "阻止读取/修改 .env、密钥文件、credentials 等",
		category: "sensitive",
		defaultAction: "block",
		acceptsFiles: true,
		rules: [
			{
				event: "PreToolUse",
				matcher: "Edit|Write",
				ifClause: "Edit(*.env*)",
				type: "command",
				command: "echo 'Blocked: .env files contain secrets' >&2 && exit 2",
				blockOnMatch: true,
				reason: "环境变量文件可能包含密钥，禁止直接修改",
			},
			{
				event: "PreToolUse",
				matcher: "Edit|Write",
				ifClause: "Edit(*credentials*)",
				type: "command",
				command: "echo 'Blocked: credentials files are protected' >&2 && exit 2",
				blockOnMatch: true,
				reason: "凭证文件受保护，禁止修改",
			},
			{
				event: "PreToolUse",
				matcher: "Edit|Write",
				ifClause: "Edit(*secret*)",
				type: "command",
				command: "echo 'Blocked: secret files are protected' >&2 && exit 2",
				blockOnMatch: true,
				reason: "密钥文件受保护，禁止修改",
			},
			{
				event: "PreToolUse",
				matcher: "Edit|Write",
				ifClause: "Edit(*.pem*)",
				type: "command",
				command: "echo 'Blocked: PEM key files are protected' >&2 && exit 2",
				blockOnMatch: true,
				reason: "PEM 密钥文件受保护，禁止修改",
			},
		],
	},
	{
		id: "protect-package-json",
		name: "保护 package.json",
		description: "修改 package.json 时需要确认（防止误改依赖）",
		category: "file-protection",
		defaultAction: "ask",
		acceptsFiles: true,
		rules: [
			{
				event: "PreToolUse",
				matcher: "Edit|Write",
				ifClause: "Edit(*package.json)",
				type: "command",
				command: `#!/bin/bash
echo '{"hookSpecificOutput":{"permissionDecision":"ask","permissionDecisionReason":"package.json 修改需要确认，这会影响项目依赖"}}'`,
				blockOnMatch: false,
				reason: "package.json 修改需要确认",
			},
		],
	},
	{
		id: "subagent-no-bash",
		name: "子 Agent 禁止 Bash",
		description: "子 Agent（Explore/Plan）不能直接执行 Bash 命令",
		category: "role-restriction",
		defaultAction: "block",
		acceptsFiles: false,
		rules: [
			{
				event: "PreToolUse",
				matcher: "Bash",
				type: "command",
				command: "echo 'Blocked: subagent cannot use Bash' >&2 && exit 2",
				blockOnMatch: true,
				reason: "子 Agent 不能直接执行 Bash，请引导主 Agent 操作",
				piVariables: { role: "explore|plan" },
			},
		],
	},
	{
		id: "subagent-no-write",
		name: "子 Agent 禁止写入",
		description: "Explore Agent 不能修改文件",
		category: "role-restriction",
		defaultAction: "block",
		acceptsFiles: false,
		rules: [
			{
				event: "PreToolUse",
				matcher: "Edit|Write",
				type: "command",
				command: "echo 'Blocked: explore agent cannot write files' >&2 && exit 2",
				blockOnMatch: true,
				reason: "Explore Agent 只能读取，不能修改文件。请将修改操作交给主 Agent。",
				piVariables: { role: "explore" },
			},
		],
	},
	{
		id: "keyword-task-route",
		name: "关键词任务路由",
		description: "检测到复杂任务关键词时，引导使用子任务",
		category: "keyword-route",
		defaultAction: "prompt",
		acceptsFiles: false,
		rules: [
			{
				event: "PostToolUse",
				matcher: "",
				type: "prompt",
				prompt: `Check if the following tool result suggests a complex task that should be delegated to a subtask. Look for keywords like: refactor, migrate, implement from scratch, rewrite, multi-step.

Tool result: $ARGUMENTS

If the result suggests a complex multi-step task, respond with:
{"decision":"allow","hookSpecificOutput":{"additionalContext":"This looks like a complex task. Consider using the Task tool to delegate to a specialized sub-agent."}}

Otherwise respond with: {"decision":"allow"}`,
				blockOnMatch: false,
				reason: "复杂任务建议使用子任务",
			},
		],
	},
	{
		id: "security-hardened",
		name: "安全加固套件",
		description: "组合所有安全相关规则：禁止危险命令 + 保护敏感文件",
		category: "command-filter",
		defaultAction: "block",
		acceptsFiles: false,
		rules: [
			{
				event: "PreToolUse",
				matcher: "Bash",
				ifClause: "Bash(*--no-verify*)",
				type: "command",
				command: "echo 'Blocked: --no-verify' >&2 && exit 2",
				blockOnMatch: true,
				reason: "安全加固：禁止绕过 hooks",
			},
			{
				event: "PreToolUse",
				matcher: "Bash",
				ifClause: "Bash(git push*--force*)",
				type: "command",
				command: "echo 'Blocked: force push' >&2 && exit 2",
				blockOnMatch: true,
				reason: "安全加固：禁止 force push",
			},
			{
				event: "PreToolUse",
				matcher: "Bash",
				ifClause: "Bash(rm *-rf*)",
				type: "command",
				command: "echo 'Blocked: rm -rf' >&2 && exit 2",
				blockOnMatch: true,
				reason: "安全加固：禁止 rm -rf",
			},
			{
				event: "PreToolUse",
				matcher: "Bash",
				ifClause: "Bash(sudo*)",
				type: "command",
				command: "echo 'Blocked: sudo' >&2 && exit 2",
				blockOnMatch: true,
				reason: "安全加固：禁止 sudo",
			},
			{
				event: "PreToolUse",
				matcher: "Edit|Write",
				ifClause: "Edit(*.env*)",
				type: "command",
				command: "echo 'Blocked: .env files' >&2 && exit 2",
				blockOnMatch: true,
				reason: "安全加固：保护环境变量",
			},
			{
				event: "PreToolUse",
				matcher: "Edit|Write",
				ifClause: "Edit(*credentials*)",
				type: "command",
				command: "echo 'Blocked: credentials' >&2 && exit 2",
				blockOnMatch: true,
				reason: "安全加固：保护凭证文件",
			},
		],
	},
	{
		id: "redirect-arch-to-build",
		name: "架构修改引导子任务",
		description: "修改架构文件时，引导创建子任务交给 build agent 处理",
		category: "redirect",
		defaultAction: "ask",
		acceptsFiles: true,
		rules: [
			{
				event: "PreToolUse",
				matcher: "Edit|Write",
				ifClause: "Edit(*tsconfig.json)",
				type: "command",
				command: `echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"架构文件 tsconfig.json 的修改建议通过子任务完成：请使用 Task 工具创建一个 build agent 子任务来修改此文件。"}}'`,
				blockOnMatch: false,
				reason: "引导通过子任务修改架构文件",
			},
			{
				event: "PreToolUse",
				matcher: "Edit|Write",
				ifClause: "Edit(*eslint.config*)",
				type: "command",
				command: `echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"ESLint 配置建议通过子任务完成：请使用 Task 工具创建子任务来修改。"}}'`,
				blockOnMatch: false,
				reason: "引导通过子任务修改 ESLint 配置",
			},
			{
				event: "PreToolUse",
				matcher: "Edit|Write",
				ifClause: "Edit(*vite.config*)",
				type: "command",
				command: `echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"构建配置建议通过子任务完成：请使用 Task 工具创建子任务来修改。"}}'`,
				blockOnMatch: false,
				reason: "引导通过子任务修改构建配置",
			},
		],
	},
	{
		id: "redirect-subagent-delegation",
		name: "复杂任务自动引导",
		description: "检测到复杂任务关键词时，自动引导使用 Task 子任务",
		category: "redirect",
		defaultAction: "prompt",
		acceptsFiles: false,
		rules: [
			{
				event: "PostToolUse",
				matcher: "",
				type: "prompt",
				prompt: `Analyze this tool result. If it contains keywords like "refactor", "migrate", "rewrite", "implement from scratch", "multi-step", respond with guidance.

Result: $ARGUMENTS

Respond with JSON only:
- If complex task detected: {"decision":"allow","hookSpecificOutput":{"additionalContext":"This appears to be a complex task. Consider using the Task tool to delegate to a specialized sub-agent for better results."}}
- Otherwise: {"decision":"allow"}`,
				blockOnMatch: false,
				reason: "引导复杂任务使用子任务",
			},
		],
	},
];

export function generateSettingsJson(
	entries: Array<{ templateId: string; files: string[]; action: string }>,
): Record<string, unknown> {
	const hooks: Record<string, Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>> = {};

	for (const entry of entries) {
		const tpl = TEMPLATES.find((t) => t.id === entry.templateId);
		if (!tpl) continue;

		for (const rule of tpl.rules) {
			const handler = buildHandler(rule, entry.templateId);
			mergeOneRule(hooks, rule, handler);
		}

		for (const file of entry.files) {
			const isDir = file.endsWith("/");
			const pattern = isDir ? `Edit(*${file}**)` : `Edit(*${file}*)`;
			const action = entry.action || tpl.defaultAction;
			let command: string;
			if (action === "ask") {
				command = `echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"${file} 修改需要确认"}}'`;
			} else {
				command = `echo 'Blocked: ${file} is protected' >&2 && exit 2`;
			}
			const handler: Record<string, unknown> = {
				type: "command",
				if: pattern,
				command,
				"x-pi-id": entry.templateId,
				"x-pi-file": file,
			};
			mergeOneRule(hooks, { event: "PreToolUse", matcher: "Edit|Write", type: "command" }, handler);
		}
	}

	return { hooks };
}

function buildHandler(rule: RuleConfig, tplId: string): Record<string, unknown> {
	const handler: Record<string, unknown> = { type: rule.type, "x-pi-id": tplId };
	if (rule.ifClause) handler.if = rule.ifClause;
	if (rule.command) handler.command = rule.command;
	if (rule.url) handler.url = rule.url;
	if (rule.prompt) handler.prompt = rule.prompt;
	if (rule.piVariables) handler["x-pi-variables"] = rule.piVariables;
	return handler;
}

function mergeOneRule(
	hooks: Record<string, Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>>,
	rule: { event: string; matcher?: string },
	handler: Record<string, unknown>,
): void {
	const event = rule.event;
	if (!hooks[event]) hooks[event] = [];

	let group = hooks[event].find((g) => g.matcher === (rule.matcher || undefined));
	if (!group) {
		group = { hooks: [] };
		if (rule.matcher) group.matcher = rule.matcher;
		hooks[event].push(group);
	}

	group.hooks.push(handler);
}

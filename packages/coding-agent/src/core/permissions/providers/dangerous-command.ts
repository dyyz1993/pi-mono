import { randomUUID } from "node:crypto";
import { createDangerousCommandPatternSuggestions } from "../command-patterns.ts";
import type { PermissionProvider } from "../provider.ts";
import type { PermissionDecision, PermissionRememberOption, PermissionRequest } from "../types.ts";

export interface DangerousCommandPattern {
	id: string;
	pattern: RegExp;
	description: string;
}

export type DangerousCommandAction = "deny" | "ask";

export interface DangerousCommandProviderOptions {
	name?: string;
	priority?: number;
	action?: DangerousCommandAction;
	profiles?: readonly string[];
	patterns?: readonly DangerousCommandPattern[];
	createRequestId?: () => string;
	now?: () => Date;
}

export const DEFAULT_DANGEROUS_COMMAND_PATTERNS: readonly DangerousCommandPattern[] = [
	{
		id: "recursive-rm",
		pattern: /\brm\b(?=[^;&|]*\s(?:-[A-Za-z]*[rR][A-Za-z]*|--recursive)\b)/,
		description: "recursive rm",
	},
	{
		id: "git-push-force",
		pattern: /\bgit\s+push\s+.*--force\b/,
		description: "force push",
	},
	{
		id: "skip-verification",
		pattern: /--no-verify/,
		description: "skipping verification",
	},
	{
		id: "sudo",
		pattern: /\bsudo\b/,
		description: "sudo",
	},
	{
		id: "chmod-777",
		pattern: /\bchmod\s+777\b/,
		description: "chmod 777",
	},
	{
		id: "env-file",
		pattern: /\.env/,
		description: "environment file access",
	},
	{
		id: "credentials",
		pattern: /credentials/i,
		description: "credentials access",
	},
];

export function createDangerousCommandProvider(options: DangerousCommandProviderOptions = {}): PermissionProvider {
	const profiles = new Set(options.profiles ?? ["normal", "autopilot"]);
	const patterns = options.patterns ?? DEFAULT_DANGEROUS_COMMAND_PATTERNS;
	const action = options.action ?? "deny";
	const createRequestId = options.createRequestId ?? (() => `perm_${randomUUID()}`);
	const now = options.now ?? (() => new Date());

	return {
		name: options.name ?? "dangerous-command",
		priority: options.priority,
		check(ctx): PermissionDecision {
			if (ctx.toolName.toLowerCase() !== "bash") return { type: "pass" };
			if (!profiles.has(ctx.permissionProfile)) return { type: "pass" };

			const command = typeof ctx.input.command === "string" ? ctx.input.command : undefined;
			if (!command) return { type: "pass" };

			const matched = findDangerousCommandMatch(command, patterns);
			if (!matched) return { type: "pass" };

			const reason = `Blocked dangerous bash command: ${formatDangerousCommandReason(matched.description)}.`;
			if (action === "deny") {
				return { type: "deny", reason };
			}

			return {
				type: "ask",
				request: buildDangerousCommandRequest({
					command,
					description: matched.description,
					patternId: matched.id,
					sessionId: ctx.sessionId,
					toolCallId: ctx.toolCallId,
					requestId: createRequestId(),
					createdAt: now().toISOString(),
				}),
			};
		},
	};
}

function formatDangerousCommandReason(description: string): string {
	if (description === "sudo") return "sudo requires administrator privileges";
	if (description === "chmod 777") return "chmod 777 grants broad write or execute access";
	if (description === "force push") return "force push can overwrite remote history";
	if (description === "recursive rm") return "recursive removal can delete many files";
	if (description === "environment file access") return "environment files may contain secrets";
	if (description === "credentials access") return "credential files may contain secrets";
	return description;
}

export function findDangerousCommandMatch(
	command: string,
	patterns: readonly DangerousCommandPattern[] = DEFAULT_DANGEROUS_COMMAND_PATTERNS,
): DangerousCommandPattern | undefined {
	return patterns.find((entry) => entry.pattern.test(command));
}

function buildDangerousCommandRequest(input: {
	command: string;
	description: string;
	patternId: string;
	sessionId: string;
	toolCallId?: string;
	requestId: string;
	createdAt: string;
}): PermissionRequest {
	return {
		requestId: input.requestId,
		sessionId: input.sessionId,
		toolCallId: input.toolCallId,
		provider: "dangerous-command",
		subject: "command.run",
		title: "Confirm command",
		message: `Run command flagged for ${input.description}?`,
		actions: ["allow_once", "always_allow_project", "deny_once", "always_deny_project"],
		rememberOptions: buildDangerousCommandRememberOptions(input.command, input.patternId),
		metadata: {
			toolName: "bash",
			command: input.command,
			patternId: input.patternId,
			description: input.description,
		},
		createdAt: input.createdAt,
	};
}

function buildDangerousCommandRememberOptions(command: string, patternId: string): PermissionRememberOption[] {
	const suggestions = createDangerousCommandPatternSuggestions({ command, patternId });
	return [
		...suggestions.map((suggestion) => ({
			id: `allow-${suggestion.id}`,
			label: suggestion.label,
			subject: "command.run",
			pattern: suggestion.pattern,
			scope: "project" as const,
			action: "allow" as const,
			metadata: {
				provider: "dangerous-command",
				patternId,
				...suggestion.metadata,
			},
		})),
		...suggestions.map((suggestion) => ({
			id: `deny-${suggestion.id}`,
			label: suggestion.label,
			subject: "command.run",
			pattern: suggestion.pattern,
			scope: "project" as const,
			action: "deny" as const,
			metadata: {
				provider: "dangerous-command",
				patternId,
				...suggestion.metadata,
			},
		})),
	];
}

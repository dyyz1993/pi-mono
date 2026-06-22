import { getPathArg as getPathArgFromHelpers } from "../../../utils/type-helpers.ts";
import { normalizeCommandForPermission } from "../command-patterns.ts";
import type { PermissionProvider } from "../provider.ts";
import type { PermissionRuleDecision, PermissionRuleMatchInput } from "../store.ts";
import type { PermissionContext } from "../types.ts";

const WRITE_TOOLS = new Set(["edit", "write", "multiedit", "patch"]);
const READ_TOOLS = new Set(["read"]);

export interface StoredDecisionLookup {
	findDecision(input: PermissionRuleMatchInput): PermissionRuleDecision | undefined;
}

export interface StoredDecisionProviderOptions {
	store: StoredDecisionLookup;
	name?: string;
	priority?: number;
	resolveCandidates?: (ctx: PermissionContext) => PermissionRuleMatchInput[];
}

export function createStoredDecisionProvider(options: StoredDecisionProviderOptions): PermissionProvider {
	return {
		name: options.name ?? "stored-decision",
		priority: options.priority,
		check(ctx) {
			const candidates = options.resolveCandidates?.(ctx) ?? defaultStoredDecisionCandidates(ctx);
			for (const candidate of candidates) {
				const decision = options.store.findDecision(candidate);
				if (!decision) continue;
				if (decision.action === "allow") {
					return {
						type: "allow",
						reason: `Allowed by stored permission rule ${decision.rule.id}`,
					};
				}
				return {
					type: "deny",
					reason: `Denied by stored permission rule ${decision.rule.id}`,
				};
			}
			return { type: "pass" };
		},
	};
}

export function defaultStoredDecisionCandidates(ctx: PermissionContext): PermissionRuleMatchInput[] {
	const candidates: PermissionRuleMatchInput[] = [];
	const toolName = ctx.toolName.toLowerCase();
	if (toolName === "bash") {
		const command = typeof ctx.input.command === "string" ? ctx.input.command : undefined;
		if (command) {
			candidates.push({
				provider: "dangerous-command",
				subject: "command.run",
				value: command,
				scope: "project",
			});
			const normalized = normalizeCommandForPermission(command);
			if (normalized !== command) {
				candidates.push({
					provider: "dangerous-command",
					subject: "command.run",
					value: normalized,
					scope: "project",
				});
			}
		}
	}

	const path = getPathArgFromHelpers(ctx.input);
	if (path) {
		if (WRITE_TOOLS.has(toolName)) {
			candidates.push({
				provider: "path-access",
				subject: "file.write",
				value: path,
				scope: "project",
			});
		} else if (READ_TOOLS.has(toolName)) {
			candidates.push({
				provider: "path-access",
				subject: "file.read",
				value: path,
				scope: "project",
			});
		}
	}

	return candidates;
}

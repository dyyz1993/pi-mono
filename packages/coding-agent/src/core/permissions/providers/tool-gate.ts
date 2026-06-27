import { inputToPermissionRecord, matchesToolPattern } from "../patterns.ts";
import type { PermissionProvider } from "../provider.ts";

export interface ToolGateProviderOptions {
	name?: string;
	priority?: number;
}

export function createToolGateProvider(options: ToolGateProviderOptions = {}): PermissionProvider {
	return {
		name: options.name ?? "tool-gate",
		priority: options.priority,
		check(ctx) {
			const inputRecord = inputToPermissionRecord(ctx.input);
			const allowedTools = ctx.agent?.tools;
			const disallowedTools = ctx.agent?.disallowedTools;

			if (allowedTools && allowedTools.length > 0) {
				const matched = allowedTools.some((pattern) => matchesToolPattern(ctx.toolName, inputRecord, pattern));
				if (!matched) {
					return {
						type: "deny",
						reason: `Tool "${ctx.toolName}" not in allowed tools. Allowed: ${allowedTools.join(", ")}`,
					};
				}
			}

			if (disallowedTools && disallowedTools.length > 0) {
				const matched = disallowedTools.some((pattern) => matchesToolPattern(ctx.toolName, inputRecord, pattern));
				if (matched) {
					return { type: "deny", reason: `Tool "${ctx.toolName}" is explicitly disallowed.` };
				}
			}

			return { type: "pass" };
		},
	};
}

import type { PermissionProvider } from "../provider.ts";

export interface ReadonlyProviderOptions {
	name?: string;
	priority?: number;
	profiles?: readonly string[];
}

const MUTATING_TOOLS = new Set(["write", "edit", "multiedit", "patch"]);

export function createReadonlyProvider(options: ReadonlyProviderOptions = {}): PermissionProvider {
	const profiles = new Set(options.profiles ?? ["readonly"]);
	return {
		name: options.name ?? "readonly",
		priority: options.priority,
		check(ctx) {
			if (!profiles.has(ctx.permissionProfile)) return { type: "pass" };
			const toolName = ctx.toolName.toLowerCase();
			if (MUTATING_TOOLS.has(toolName)) {
				return {
					type: "deny",
					reason: `Readonly permission profile blocks mutating tool "${ctx.toolName}".`,
				};
			}
			if (toolName === "bash") {
				return {
					type: "deny",
					reason: "Readonly permission profile blocks bash commands.",
				};
			}
			return { type: "pass" };
		},
	};
}

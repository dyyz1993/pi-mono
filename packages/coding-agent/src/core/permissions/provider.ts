import type { PermissionContext, PermissionDecision } from "./types.ts";

export interface PermissionProvider {
	name: string;
	priority?: number;
	applies?(ctx: PermissionContext): boolean | Promise<boolean>;
	check(ctx: PermissionContext): PermissionDecision | Promise<PermissionDecision>;
}

export interface PermissionProviderFailure {
	providerName: string;
	error: unknown;
	context: PermissionContext;
}

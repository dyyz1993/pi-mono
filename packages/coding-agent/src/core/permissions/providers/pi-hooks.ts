import type { ToolCallEvent, ToolCallEventResult } from "../../extensions/types.ts";
import type { PermissionProvider } from "../provider.ts";
import type { PermissionContext, PermissionDecision } from "../types.ts";

export interface PiHooksProviderOptions {
	name?: string;
	priority?: number;
	emitToolCall: (event: ToolCallEvent) => Promise<ToolCallEventResult | undefined> | ToolCallEventResult | undefined;
}

export function createPiHooksProvider(options: PiHooksProviderOptions): PermissionProvider {
	return {
		name: options.name ?? "pi-hooks",
		priority: options.priority,
		async check(ctx): Promise<PermissionDecision> {
			const originalInput = cloneRecord(ctx.input);
			const eventInput = cloneRecord(ctx.input);
			const result = await options.emitToolCall({
				type: "tool_call",
				toolName: ctx.toolName,
				toolCallId: ctx.toolCallId ?? "",
				input: eventInput,
			} as ToolCallEvent);

			if (result?.block) {
				return {
					type: "deny",
					reason: result.reason ?? "Blocked by hook",
				};
			}

			if (result && "updatedInput" in result && isRecord(result.updatedInput)) {
				Object.assign(eventInput, result.updatedInput);
			}

			if (!recordsEqual(originalInput, eventInput)) {
				return {
					type: "mutate",
					input: eventInput,
					reason: "Tool input updated by hook",
				};
			}

			return { type: "pass" };
		},
	};
}

function cloneRecord(input: Record<string, unknown>): Record<string, unknown> {
	try {
		return structuredClone(input) as Record<string, unknown>;
	} catch {
		return { ...input };
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordsEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
	const leftJson = safeStringify(left);
	const rightJson = safeStringify(right);
	if (leftJson === undefined || rightJson === undefined) {
		return left === right;
	}
	return leftJson === rightJson;
}

function safeStringify(value: Record<string, unknown>): string | undefined {
	try {
		return JSON.stringify(value);
	} catch {
		return undefined;
	}
}

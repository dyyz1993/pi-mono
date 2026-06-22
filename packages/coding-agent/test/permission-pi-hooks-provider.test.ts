import { describe, expect, it } from "vitest";
import { createPiHooksProvider, type PermissionContext, PermissionRuntime } from "../src/core/permissions/index.ts";

function makeContext(overrides: Partial<PermissionContext> = {}): PermissionContext {
	return {
		sessionId: "session-1",
		cwd: "/project",
		permissionProfile: "normal",
		toolName: "bash",
		toolCallId: "toolu-1",
		input: { command: "git status" },
		...overrides,
	};
}

describe("pi-hooks provider", () => {
	it("passes when hooks return no decision and do not mutate input", async () => {
		const seen: unknown[] = [];
		const provider = createPiHooksProvider({
			emitToolCall: (event) => {
				seen.push(event);
				return undefined;
			},
		});

		expect(await provider.check(makeContext())).toEqual({ type: "pass" });
		expect(seen).toEqual([
			{
				type: "tool_call",
				toolName: "bash",
				toolCallId: "toolu-1",
				input: { command: "git status" },
			},
		]);
	});

	it("maps hook blocks to deny decisions", async () => {
		const provider = createPiHooksProvider({
			emitToolCall: () => ({ block: true, reason: "Denied by policy" }),
		});

		expect(await provider.check(makeContext())).toEqual({
			type: "deny",
			reason: "Denied by policy",
		});
	});

	it("uses a default deny reason when hook blocks without a reason", async () => {
		const provider = createPiHooksProvider({
			emitToolCall: () => ({ block: true }),
		});

		expect(await provider.check(makeContext())).toEqual({
			type: "deny",
			reason: "Blocked by hook",
		});
	});

	it("maps hook input mutation to mutate decisions", async () => {
		const provider = createPiHooksProvider({
			emitToolCall: (event) => {
				(event.input as { command: string }).command = "echo safe-replaced";
				return undefined;
			},
		});
		const ctx = makeContext({ input: { command: "rm -rf /tmp/data" } });

		expect(await provider.check(ctx)).toEqual({
			type: "mutate",
			input: { command: "echo safe-replaced" },
			reason: "Tool input updated by hook",
		});
		expect(ctx.input).toEqual({ command: "rm -rf /tmp/data" });
	});

	it("lets hook deny win over input mutation", async () => {
		const provider = createPiHooksProvider({
			emitToolCall: (event) => {
				(event.input as { command: string }).command = "echo safe-replaced";
				return { block: true, reason: "Still denied" };
			},
		});

		expect(await provider.check(makeContext({ input: { command: "rm -rf /tmp/data" } }))).toEqual({
			type: "deny",
			reason: "Still denied",
		});
	});

	it("surfaces hook failures through PermissionRuntime provider failure handling", async () => {
		const runtime = new PermissionRuntime({
			providers: [
				createPiHooksProvider({
					emitToolCall: () => {
						throw new Error("hook runner exploded");
					},
				}),
			],
		});

		await expect(runtime.evaluate(makeContext())).resolves.toEqual({
			type: "deny",
			reason: 'Permission provider "pi-hooks" failed: hook runner exploded',
		});
	});
});

import { describe, expect, it } from "vitest";
import { createToolGateProvider, type PermissionContext, PermissionRuntime } from "../src/core/permissions/index.ts";

function makeContext(overrides: Partial<PermissionContext> = {}): PermissionContext {
	return {
		sessionId: "session-1",
		cwd: "/project",
		permissionProfile: "normal",
		toolName: "read",
		toolCallId: "toolu-1",
		input: { path: "src/app.ts" },
		...overrides,
	};
}

describe("tool-gate provider", () => {
	it("passes when no tool allowlist or blocklist is configured", async () => {
		const provider = createToolGateProvider();

		expect(await provider.check(makeContext())).toEqual({ type: "pass" });
	});

	it("passes listed tools", async () => {
		const provider = createToolGateProvider();

		expect(
			await provider.check(makeContext({ toolName: "read", agent: { tools: ["read", "grep", "find", "ls"] } })),
		).toEqual({
			type: "pass",
		});
	});

	it("denies tools outside the allowlist", async () => {
		const provider = createToolGateProvider();

		expect(await provider.check(makeContext({ toolName: "write", agent: { tools: ["read", "grep"] } }))).toEqual({
			type: "deny",
			reason: 'Tool "write" not in allowed tools. Allowed: read, grep',
		});
	});

	it("always permits coordinator delegate reply tools even when an agent allowlist omits them", async () => {
		const provider = createToolGateProvider();

		expect(
			await provider.check(
				makeContext({
					toolName: "session_delegate_send",
					agent: { tools: ["read", "write", "edit", "bash"] },
				}),
			),
		).toEqual({ type: "pass" });
	});

	it("always permits coordinator delegate reply tools even when an agent blocklist includes them", async () => {
		const provider = createToolGateProvider();

		expect(
			await provider.check(
				makeContext({
					toolName: "session_delegate_send",
					agent: { disallowedTools: ["session_delegate_send"] },
				}),
			),
		).toEqual({ type: "pass" });
	});

	it("supports wildcard tool allowlist entries", async () => {
		const provider = createToolGateProvider();

		expect(await provider.check(makeContext({ toolName: "write", agent: { tools: ["*"] } }))).toEqual({
			type: "pass",
		});
	});

	it("supports tool(input) allowlist patterns for command input", async () => {
		const provider = createToolGateProvider();

		expect(
			await provider.check(
				makeContext({
					toolName: "bash",
					input: { command: "git status --short" },
					agent: { tools: ["bash(git *)"] },
				}),
			),
		).toEqual({ type: "pass" });
	});

	it("denies when a tool(input) allowlist pattern does not match", async () => {
		const provider = createToolGateProvider();

		const result = await provider.check(
			makeContext({
				toolName: "bash",
				input: { command: "rm -rf /tmp/foo" },
				agent: { tools: ["bash(git *)"] },
			}),
		);

		expect(result.type).toBe("deny");
	});

	it("denies tools in the blocklist", async () => {
		const provider = createToolGateProvider();

		expect(
			await provider.check(makeContext({ toolName: "edit", agent: { disallowedTools: ["edit", "write"] } })),
		).toEqual({
			type: "deny",
			reason: 'Tool "edit" is explicitly disallowed.',
		});
	});

	it("supports tool(input) blocklist patterns", async () => {
		const provider = createToolGateProvider();

		expect(
			await provider.check(
				makeContext({
					toolName: "bash",
					input: { command: "rm -rf /tmp/foo" },
					agent: { disallowedTools: ["bash(rm *)"] },
				}),
			),
		).toEqual({
			type: "deny",
			reason: 'Tool "bash" is explicitly disallowed.',
		});
	});

	it("treats empty arrays as no tool-gate restriction", async () => {
		const provider = createToolGateProvider();

		expect(
			await provider.check(makeContext({ toolName: "write", agent: { tools: [], disallowedTools: [] } })),
		).toEqual({
			type: "pass",
		});
	});

	it("still runs in yolo profiles so agent-level tool constraints remain enforceable", async () => {
		const runtime = new PermissionRuntime({ providers: [createToolGateProvider()] });

		await expect(
			runtime.evaluate(
				makeContext({
					permissionProfile: "yolo",
					toolName: "edit",
					agent: { disallowedTools: ["edit"] },
				}),
			),
		).resolves.toEqual({
			type: "deny",
			reason: 'Tool "edit" is explicitly disallowed.',
		});
	});
});

import { describe, expect, it } from "vitest";
import type {
	PermissionContext,
	PermissionDecision,
	PermissionRememberOption,
	PermissionRequest,
} from "../src/core/permissions/index.ts";

describe("permission runtime protocol types", () => {
	it("constructs the core permission request shape", () => {
		const rememberOption: PermissionRememberOption = {
			id: "remember-npm-install",
			label: "All npm install commands",
			subject: "command.run",
			pattern: "npm install *",
			scope: "project",
			action: "allow",
			metadata: { toolName: "bash" },
		};

		const request: PermissionRequest = {
			requestId: "perm-1",
			sessionId: "session-1",
			toolCallId: "toolu-1",
			provider: "dangerous-command",
			subject: "command.run",
			title: "Confirm command",
			message: "Run npm install lodash?",
			actions: ["allow_once", "always_allow_project", "deny_once", "always_deny_project"],
			rememberOptions: [rememberOption],
			metadata: { command: "npm install lodash" },
			createdAt: "2026-06-21T00:00:00.000Z",
		};

		expect(request.requestId).toBe("perm-1");
		expect(request.rememberOptions?.[0]?.pattern).toBe("npm install *");
	});

	it("constructs every permission decision variant", () => {
		const request: PermissionRequest = {
			requestId: "perm-1",
			sessionId: "session-1",
			provider: "path-access",
			subject: "file.write",
			title: "Path outside project",
			message: "Write /tmp/file.ts?",
			actions: ["allow_once", "deny_once"],
			createdAt: "2026-06-21T00:00:00.000Z",
		};

		const decisions: PermissionDecision[] = [
			{ type: "allow" },
			{ type: "deny", reason: "blocked" },
			{ type: "ask", request },
			{ type: "mutate", input: { command: "git status" } },
			{ type: "pass" },
		];

		expect(decisions.map((decision) => decision.type)).toEqual(["allow", "deny", "ask", "mutate", "pass"]);
	});

	it("constructs a permission context with agent policy declarations", () => {
		const ctx: PermissionContext = {
			sessionId: "session-1",
			cwd: "/project",
			permissionProfile: "safe-project",
			toolName: "write",
			toolCallId: "toolu-1",
			input: { path: "src/app.ts" },
			agent: {
				name: "builder",
				tools: ["read", "write"],
				disallowedTools: ["bash(rm *)"],
				paths: { write: ["src/**"] },
			},
		};

		expect(ctx.agent?.paths?.write).toEqual(["src/**"]);
	});
});

import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { createAutoApproverProvider } from "../src/core/permissions/providers/auto-approver.ts";
import type { PermissionContext } from "../src/core/permissions/types.ts";
import type { PermissionProvider } from "../src/index.ts";

function makeContext(overrides: Partial<PermissionContext> = {}): PermissionContext {
	return {
		sessionId: "session-1",
		cwd: "/project",
		permissionProfile: "autopilot",
		toolName: "read",
		input: {},
		...overrides,
	};
}

function loadProvider(): PermissionProvider {
	return createAutoApproverProvider();
}

describe("auto-approver permission provider", () => {
	it("creates a permission provider", () => {
		expect(loadProvider().name).toBe("auto-approver");
	});

	it("auto-approves read-like tools without agent path restrictions", () => {
		const provider = loadProvider();
		expect(provider.check(makeContext({ toolName: "read" }))).toEqual({
			type: "allow",
			reason: 'Auto-approved low-risk read tool "read".',
		});
	});

	it("does not bypass agent read path restrictions", () => {
		const provider = loadProvider();
		expect(provider.check(makeContext({ toolName: "read", agent: { paths: { read: ["docs/**"] } } }))).toEqual({
			type: "pass",
		});
	});

	it("blocks sensitive and protected read paths instead of falling through to path-boundary prompts", () => {
		const provider = loadProvider();
		expect(provider.check(makeContext({ toolName: "read", input: { file_path: "/etc/passwd" } }))).toEqual({
			type: "deny",
			reason: "Autopilot blocked protected or sensitive path.",
		});

		const sshConfig = `${homedir()}/.ssh/config`;
		expect(provider.check(makeContext({ toolName: "read", input: { file_path: sshConfig } }))).toEqual({
			type: "deny",
			reason: "Autopilot blocked protected or sensitive path.",
		});
	});

	it("auto-approves user-writable read paths outside the workspace", () => {
		const provider = loadProvider();
		const filePath = `${homedir()}/Desktop/autopilot-readme.txt`;
		expect(provider.check(makeContext({ toolName: "read", input: { file_path: filePath } }))).toEqual({
			type: "allow",
			reason: `Auto-approved user-writable path "${filePath}".`,
		});
	});

	it("auto-approves workspace writes without agent path restrictions", () => {
		const provider = loadProvider();
		expect(provider.check(makeContext({ toolName: "write", input: { file_path: "/project/src/app.ts" } }))).toEqual({
			type: "allow",
			reason: 'Auto-approved workspace write tool "write".',
		});
	});

	it("auto-decides user-writable writes outside the workspace", () => {
		const provider = loadProvider();
		const filePath = `${homedir()}/Desktop/autopilot.txt`;
		expect(provider.check(makeContext({ toolName: "write", input: { file_path: filePath } }))).toEqual({
			type: "allow",
			reason: `Auto-approved user-writable path "${filePath}".`,
		});
	});

	it("blocks protected writes outside the workspace", () => {
		const provider = loadProvider();
		expect(provider.check(makeContext({ toolName: "write", input: { file_path: "/var/autopilot.txt" } }))).toEqual({
			type: "deny",
			reason: "Autopilot blocked protected or sensitive path.",
		});
	});

	it("blocks unclassified absolute writes outside the workspace", () => {
		const provider = loadProvider();
		expect(
			provider.check(makeContext({ toolName: "write", input: { file_path: "/mnt/shared/autopilot.txt" } })),
		).toEqual({
			type: "deny",
			reason: "Autopilot blocked path outside workspace or known user-writable locations.",
		});
	});

	it("blocks sensitive user path writes outside the workspace", () => {
		const provider = loadProvider();
		const filePath = `${homedir()}/.ssh/config`;
		expect(provider.check(makeContext({ toolName: "write", input: { file_path: filePath } }))).toEqual({
			type: "deny",
			reason: "Autopilot blocked protected or sensitive path.",
		});
	});

	it("auto-approves bash commands without dangerous patterns", () => {
		const provider = loadProvider();
		expect(provider.check(makeContext({ toolName: "bash", input: { command: "echo hello" } }))).toEqual({
			type: "allow",
			reason: "Auto-approved bash command without dangerous patterns.",
		});
	});

	it("auto-approves bounded dangerous bash commands", () => {
		const provider = loadProvider();
		expect(provider.check(makeContext({ toolName: "bash", input: { command: "rm -rf /tmp/data" } }))).toEqual({
			type: "allow",
			reason: "Auto-approved bounded dangerous command.",
		});
	});

	it("blocks dangerous bash commands that are not bounded", () => {
		const provider = loadProvider();
		expect(provider.check(makeContext({ toolName: "bash", input: { command: "sudo rm -rf /tmp/data" } }))).toEqual({
			type: "deny",
			reason: "Autopilot blocked dangerous bash command: recursive removal can delete many files.",
		});
		expect(provider.check(makeContext({ toolName: "bash", input: { command: "rm -rf /Users/me/project" } }))).toEqual(
			{
				type: "deny",
				reason: "Autopilot blocked dangerous bash command: recursive removal can delete many files.",
			},
		);
	});

	it("keeps autopilot denied bash reasons concise", () => {
		const provider = loadProvider();
		expect(
			provider.check(makeContext({ toolName: "bash", input: { command: "echo hello | sudo tee /tmp/file.txt" } })),
		).toEqual({
			type: "deny",
			reason: "Autopilot blocked dangerous bash command: sudo requires administrator privileges.",
		});
	});
});

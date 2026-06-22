import { describe, expect, it } from "vitest";
import autoApproverExtension from "../extensions/auto-approver/index.ts";
import type { PermissionContext } from "../src/core/permissions/types.ts";
import type { ExtensionAPI, PermissionProvider } from "../src/index.ts";

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
	let registered: PermissionProvider | undefined;
	autoApproverExtension({
		setName: () => {},
		permissions: {
			registerProvider: (provider: PermissionProvider) => {
				registered = provider;
			},
			unregisterProvider: () => {},
		},
	} as unknown as ExtensionAPI);
	if (!registered) throw new Error("auto-approver extension did not register a permission provider");
	return registered;
}

describe("auto-approver permission extension", () => {
	it("registers a permission provider through the extension API", () => {
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

	it("auto-approves workspace writes without agent path restrictions", () => {
		const provider = loadProvider();
		expect(provider.check(makeContext({ toolName: "write", input: { file_path: "/project/src/app.ts" } }))).toEqual({
			type: "allow",
			reason: 'Auto-approved workspace write tool "write".',
		});
	});

	it("does not auto-approve writes outside the workspace", () => {
		const provider = loadProvider();
		expect(provider.check(makeContext({ toolName: "write", input: { file_path: "/tmp/app.ts" } }))).toEqual({
			type: "pass",
		});
	});

	it("auto-approves bash commands without dangerous patterns", () => {
		const provider = loadProvider();
		expect(provider.check(makeContext({ toolName: "bash", input: { command: "echo hello" } }))).toEqual({
			type: "allow",
			reason: "Auto-approved bash command without dangerous patterns.",
		});
	});

	it("does not auto-approve dangerous bash commands", () => {
		const provider = loadProvider();
		expect(provider.check(makeContext({ toolName: "bash", input: { command: "rm -rf /tmp/data" } }))).toEqual({
			type: "pass",
		});
	});
});

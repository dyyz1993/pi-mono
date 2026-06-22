import { describe, expect, it } from "vitest";
import { createReadonlyProvider } from "../src/core/permissions/index.ts";
import type { PermissionContext } from "../src/core/permissions/types.ts";

function makeContext(overrides: Partial<PermissionContext> = {}): PermissionContext {
	return {
		sessionId: "session-1",
		cwd: "/project",
		permissionProfile: "readonly",
		toolName: "read",
		input: {},
		...overrides,
	};
}

describe("readonly permission provider", () => {
	it("allows non-mutating tools to continue", () => {
		const provider = createReadonlyProvider();
		expect(provider.check(makeContext({ toolName: "read" }))).toEqual({ type: "pass" });
	});

	it("denies mutating file tools", () => {
		const provider = createReadonlyProvider();
		expect(provider.check(makeContext({ toolName: "write" }))).toEqual({
			type: "deny",
			reason: 'Readonly permission profile blocks mutating tool "write".',
		});
	});

	it("denies bash commands conservatively", () => {
		const provider = createReadonlyProvider();
		expect(provider.check(makeContext({ toolName: "bash" }))).toEqual({
			type: "deny",
			reason: "Readonly permission profile blocks bash commands.",
		});
	});

	it("does not apply outside readonly profiles", () => {
		const provider = createReadonlyProvider();
		expect(provider.check(makeContext({ permissionProfile: "normal", toolName: "write" }))).toEqual({
			type: "pass",
		});
	});
});

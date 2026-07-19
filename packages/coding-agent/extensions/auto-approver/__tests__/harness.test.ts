import { describe, expect, it } from "vitest";
import autoApproverExtension from "../index.ts";
import { createTestRuntime, type ExtensionTestRuntime } from "../../__shared__/testkit.ts";

function setup(): ExtensionTestRuntime {
	const runtime = createTestRuntime();
	autoApproverExtension(runtime.pi);
	return runtime;
}

describe("auto-approver extension", () => {
	it("sets extension name to 'auto-approver'", () => {
		const runtime = setup();
		expect(runtime.extensionName).toBe("auto-approver");
	});

	it("registers exactly one permission provider", () => {
		const runtime = setup();
		expect(runtime.permissionProviders).toHaveLength(1);
	});

	it("registers a provider object (not undefined/null)", () => {
		const runtime = setup();
		expect(runtime.permissionProviders[0]).toBeDefined();
		expect(runtime.permissionProviders[0]).not.toBeNull();
	});
});

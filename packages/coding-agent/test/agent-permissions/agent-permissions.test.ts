import { describe, expect, it } from "vitest";
import { createPermissionHandler } from "../../extensions/agent-permissions/index.js";
import type { AgentConfig } from "../../extensions/subagent/agents.js";

describe("PermissionMode middleware", () => {
	function makeConfig(mode: AgentConfig["permissionMode"], disallowed?: string[]): AgentConfig {
		return {
			name: "test",
			description: "",
			permissionMode: mode,
			disallowedTools: disallowed,
		} as AgentConfig;
	}

	describe("auto mode", () => {
		it("allows read and write tools", () => {
			const handler = createPermissionHandler(makeConfig("auto"));
			expect(handler?.({ toolName: "read", input: {} })).toBeNull();
			expect(handler?.({ toolName: "edit", input: {} })).toBeNull();
			expect(handler?.({ toolName: "write", input: {} })).toBeNull();
		});

		it("allows safe bash commands", () => {
			const handler = createPermissionHandler(makeConfig("auto"));
			expect(handler?.({ toolName: "bash", input: { command: "ls -la" } })).toBeNull();
			expect(handler?.({ toolName: "bash", input: { command: "git status" } })).toBeNull();
		});

		it("blocks dangerous bash commands", () => {
			const handler = createPermissionHandler(makeConfig("auto"));
			const result = handler?.({ toolName: "bash", input: { command: "rm -rf /" } });
			expect(result?.block).toBe(true);

			const result2 = handler?.({ toolName: "bash", input: { command: "git push --force" } });
			expect(result2?.block).toBe(true);

			const result3 = handler?.({ toolName: "bash", input: { command: "sudo apt install" } });
			expect(result3?.block).toBe(true);
		});
	});

	describe("plan mode", () => {
		it("allows read tools", () => {
			const handler = createPermissionHandler(makeConfig("plan"));
			expect(handler?.({ toolName: "read", input: {} })).toBeNull();
			expect(handler?.({ toolName: "grep", input: {} })).toBeNull();
			expect(handler?.({ toolName: "find", input: {} })).toBeNull();
			expect(handler?.({ toolName: "ls", input: {} })).toBeNull();
		});

		it("blocks edit and write tools", () => {
			const handler = createPermissionHandler(makeConfig("plan"));
			const editResult = handler?.({ toolName: "edit", input: {} });
			expect(editResult?.block).toBe(true);

			const writeResult = handler?.({ toolName: "write", input: {} });
			expect(writeResult?.block).toBe(true);
		});

		it("blocks bash entirely", () => {
			const handler = createPermissionHandler(makeConfig("plan"));
			const result = handler?.({ toolName: "bash", input: { command: "ls" } });
			expect(result?.block).toBe(true);
		});
	});

	describe("acceptEdits mode", () => {
		it("allows edit and write tools", () => {
			const handler = createPermissionHandler(makeConfig("acceptEdits"));
			expect(handler?.({ toolName: "edit", input: {} })).toBeNull();
			expect(handler?.({ toolName: "write", input: {} })).toBeNull();
		});

		it("allows safe bash but blocks dangerous commands", () => {
			const handler = createPermissionHandler(makeConfig("acceptEdits"));
			expect(handler?.({ toolName: "bash", input: { command: "npm test" } })).toBeNull();

			const result = handler?.({ toolName: "bash", input: { command: "rm -rf node_modules" } });
			expect(result?.block).toBe(true);
		});
	});

	describe("dontAsk mode", () => {
		it("allows everything", () => {
			const handler = createPermissionHandler(makeConfig("dontAsk"));
			expect(handler?.({ toolName: "bash", input: { command: "rm -rf /" } })).toBeNull();
			expect(handler?.({ toolName: "edit", input: {} })).toBeNull();
		});
	});

	describe("always-allow mode", () => {
		it("allows everything", () => {
			const handler = createPermissionHandler(makeConfig("always-allow"));
			expect(handler?.({ toolName: "bash", input: { command: "anything" } })).toBeNull();
		});
	});

	describe("always-deny mode", () => {
		it("blocks everything", () => {
			const handler = createPermissionHandler(makeConfig("always-deny"));
			const result = handler?.({ toolName: "read", input: {} });
			expect(result?.block).toBe(true);
		});
	});

	describe("disallowedTools", () => {
		it("blocks tools matching disallowedTools patterns", () => {
			const handler = createPermissionHandler(makeConfig("auto", ["edit", "write"]));
			const editResult = handler?.({ toolName: "edit", input: {} });
			expect(editResult?.block).toBe(true);

			const writeResult = handler?.({ toolName: "write", input: {} });
			expect(writeResult?.block).toBe(true);

			expect(handler?.({ toolName: "read", input: {} })).toBeNull();
		});
	});

	describe("returns null for unknown mode", () => {
		it("returns null handler for unrecognized mode", () => {
			const handler = createPermissionHandler(makeConfig("unknown-mode" as any));
			expect(handler).toBeNull();
		});
	});
});

import { describe, expect, it } from "vitest";
import { type PermissionContext, type PermissionProvider, PermissionRuntime } from "../src/core/permissions/index.ts";

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

describe("PermissionRuntime", () => {
	it("runs providers by ascending priority", async () => {
		const seen: string[] = [];
		const providers: PermissionProvider[] = [
			{
				name: "late",
				priority: 20,
				check: () => {
					seen.push("late");
					return { type: "pass" };
				},
			},
			{
				name: "early",
				priority: 10,
				check: () => {
					seen.push("early");
					return { type: "pass" };
				},
			},
		];

		const runtime = new PermissionRuntime({ providers });
		const result = await runtime.evaluate(makeContext());

		expect(result).toEqual({ type: "allow" });
		expect(seen).toEqual(["early", "late"]);
	});

	it("skips providers whose applies predicate returns false", async () => {
		const seen: string[] = [];
		const runtime = new PermissionRuntime({
			providers: [
				{
					name: "skipped",
					applies: () => false,
					check: () => {
						seen.push("skipped");
						return { type: "deny", reason: "should not run" };
					},
				},
				{
					name: "active",
					check: () => {
						seen.push("active");
						return { type: "pass" };
					},
				},
			],
		});

		const result = await runtime.evaluate(makeContext());

		expect(result).toEqual({ type: "allow" });
		expect(seen).toEqual(["active"]);
	});

	it("falls through pass decisions", async () => {
		const runtime = new PermissionRuntime({
			providers: [
				{ name: "first", check: () => ({ type: "pass" }) },
				{ name: "second", check: () => ({ type: "deny", reason: "blocked by second" }) },
			],
		});

		await expect(runtime.evaluate(makeContext())).resolves.toEqual({
			type: "deny",
			reason: "blocked by second",
		});
	});

	it("stops on deny decisions", async () => {
		const seen: string[] = [];
		const runtime = new PermissionRuntime({
			providers: [
				{
					name: "deny",
					check: () => {
						seen.push("deny");
						return { type: "deny", reason: "blocked" };
					},
				},
				{
					name: "after",
					check: () => {
						seen.push("after");
						return { type: "allow" };
					},
				},
			],
		});

		const result = await runtime.evaluate(makeContext());

		expect(result).toEqual({ type: "deny", reason: "blocked" });
		expect(seen).toEqual(["deny"]);
	});

	it("stops on ask decisions", async () => {
		const runtime = new PermissionRuntime({
			providers: [
				{
					name: "asker",
					check: () => ({
						type: "ask",
						request: {
							requestId: "perm-1",
							sessionId: "session-1",
							provider: "asker",
							subject: "command.run",
							title: "Confirm command",
							message: "Run command?",
							actions: ["allow_once", "deny_once"],
							createdAt: "2026-06-21T00:00:00.000Z",
						},
					}),
				},
				{ name: "after", check: () => ({ type: "deny", reason: "should not run" }) },
			],
		});

		const result = await runtime.evaluate(makeContext());

		expect(result.type).toBe("ask");
		if (result.type === "ask") {
			expect(result.request.requestId).toBe("perm-1");
		}
	});

	it("stops on mutate decisions", async () => {
		const runtime = new PermissionRuntime({
			providers: [
				{ name: "mutator", check: () => ({ type: "mutate", input: { command: "git status --short" } }) },
				{ name: "after", check: () => ({ type: "deny", reason: "should not run" }) },
			],
		});

		const result = await runtime.evaluate(makeContext());

		expect(result).toEqual({ type: "mutate", input: { command: "git status --short" } });
	});

	it("converts provider exceptions into deny decisions", async () => {
		const failures: string[] = [];
		const runtime = new PermissionRuntime({
			providers: [
				{
					name: "exploding-provider",
					check: () => {
						throw new Error("boom");
					},
				},
			],
			onProviderFailure: (failure) => failures.push(failure.providerName),
		});

		const result = await runtime.evaluate(makeContext());

		expect(result).toEqual({
			type: "deny",
			reason: 'Permission provider "exploding-provider" failed: boom',
		});
		expect(failures).toEqual(["exploding-provider"]);
	});

	it("allows by default when no provider returns a terminal decision", async () => {
		const runtime = new PermissionRuntime({
			providers: [{ name: "observer", check: () => ({ type: "pass" }) }],
		});

		await expect(runtime.evaluate(makeContext())).resolves.toEqual({ type: "allow" });
	});

	it("can use a custom default decision when every provider passes", async () => {
		const runtime = new PermissionRuntime({
			providers: [{ name: "observer", check: () => ({ type: "pass" }) }],
			defaultDecision: { type: "pass" },
		});

		await expect(runtime.evaluate(makeContext())).resolves.toEqual({ type: "pass" });
	});

	it("can register providers after construction", async () => {
		const runtime = new PermissionRuntime();
		runtime.registerProvider({ name: "registered", check: () => ({ type: "deny", reason: "registered block" }) });

		await expect(runtime.evaluate(makeContext())).resolves.toEqual({
			type: "deny",
			reason: "registered block",
		});
	});
});

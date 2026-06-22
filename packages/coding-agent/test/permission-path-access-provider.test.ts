import { describe, expect, it } from "vitest";
import { createPathAccessProvider, type PermissionContext, PermissionRuntime } from "../src/core/permissions/index.ts";

function makeContext(overrides: Partial<PermissionContext> = {}): PermissionContext {
	return {
		sessionId: "session-1",
		cwd: "/project",
		permissionProfile: "normal",
		toolName: "write",
		toolCallId: "toolu-1",
		input: { file_path: "/project/docs/readme.md" },
		...overrides,
	};
}

describe("path-access provider", () => {
	it("passes when no path restrictions are configured", async () => {
		const provider = createPathAccessProvider();

		expect(await provider.check(makeContext())).toEqual({ type: "pass" });
		expect(await provider.check(makeContext({ agent: { paths: {} } }))).toEqual({ type: "pass" });
		expect(await provider.check(makeContext({ agent: { paths: { write: [] } } }))).toEqual({ type: "pass" });
	});

	it("passes write tools inside allowed write paths", async () => {
		const provider = createPathAccessProvider();

		expect(await provider.check(makeContext({ agent: { paths: { write: ["docs/**"] } } }))).toEqual({
			type: "pass",
		});
	});

	it("supports file_path, filePath, and path input aliases", async () => {
		const provider = createPathAccessProvider();
		const agent = { paths: { write: ["docs/**"] } };

		expect(await provider.check(makeContext({ input: { file_path: "/project/docs/a.md" }, agent }))).toEqual({
			type: "pass",
		});
		expect(await provider.check(makeContext({ input: { filePath: "/project/docs/a.md" }, agent }))).toEqual({
			type: "pass",
		});
		expect(await provider.check(makeContext({ input: { path: "/project/docs/a.md" }, agent }))).toEqual({
			type: "pass",
		});
	});

	it("denies write tools outside allowed write paths", async () => {
		const provider = createPathAccessProvider();

		expect(
			await provider.check(
				makeContext({
					toolName: "edit",
					input: { file_path: "/project/src/index.ts" },
					agent: { paths: { write: ["docs/**"] } },
				}),
			),
		).toEqual({
			type: "deny",
			reason: "Path /project/src/index.ts is not in the allowed write paths: docs/**",
		});
	});

	it("normalizes file URLs and traversal before matching write paths", async () => {
		const provider = createPathAccessProvider();

		expect(
			await provider.check(
				makeContext({
					input: { file_path: "file:///project/docs/readme.md" },
					agent: { paths: { write: ["docs/**"] } },
				}),
			),
		).toEqual({ type: "pass" });

		expect(
			await provider.check(
				makeContext({
					input: { file_path: "/project/docs/../../etc/passwd" },
					agent: { paths: { write: ["docs/**"] } },
				}),
			),
		).toEqual({
			type: "deny",
			reason: "Path /etc/passwd is not in the allowed write paths: docs/**",
		});
	});

	it("denies when configured write glob is invalid and cannot match", async () => {
		const provider = createPathAccessProvider();

		expect(
			await provider.check(
				makeContext({
					input: { file_path: "/project/docs/readme.md" },
					agent: { paths: { write: ["[invalid"] } },
				}),
			),
		).toEqual({
			type: "deny",
			reason: "Path /project/docs/readme.md is not in the allowed write paths: [invalid",
		});
	});

	it("passes and denies read tools based on allowed read paths", async () => {
		const provider = createPathAccessProvider();

		expect(
			await provider.check(
				makeContext({
					toolName: "read",
					input: { file_path: "/project/src/app.ts" },
					agent: { paths: { read: ["src/**"] } },
				}),
			),
		).toEqual({ type: "pass" });

		expect(
			await provider.check(
				makeContext({
					toolName: "read",
					input: { file_path: "/project/secrets.env" },
					agent: { paths: { read: ["src/**"] } },
				}),
			),
		).toEqual({
			type: "deny",
			reason: "Path /project/secrets.env is not in the allowed read paths: src/**",
		});
	});

	it("skips grep, glob, find, ls, and bash for compatibility with current path semantics", async () => {
		const provider = createPathAccessProvider();
		const agent = { paths: { read: ["docs/**"], bash: ["scripts/**"] } };

		for (const toolName of ["grep", "glob", "find", "ls"] as const) {
			expect(await provider.check(makeContext({ toolName, input: { path: "/project/src/app.ts" }, agent }))).toEqual(
				{
					type: "pass",
				},
			);
		}
		expect(
			await provider.check(makeContext({ toolName: "bash", input: { command: "cat /etc/passwd" }, agent })),
		).toEqual({ type: "pass" });
	});

	it("still enforces agent path restrictions in yolo profiles", async () => {
		const runtime = new PermissionRuntime({ providers: [createPathAccessProvider()] });

		await expect(
			runtime.evaluate(
				makeContext({
					permissionProfile: "yolo",
					input: { file_path: "/project/src/index.ts" },
					agent: { paths: { write: ["docs/**"] } },
				}),
			),
		).resolves.toEqual({
			type: "deny",
			reason: "Path /project/src/index.ts is not in the allowed write paths: docs/**",
		});
	});
});

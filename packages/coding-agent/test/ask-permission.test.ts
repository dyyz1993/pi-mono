import { describe, expect, it, vi } from "vitest";
import { askPermission } from "../src/core/ask-permission.ts";
import type { ExtensionUIContext } from "../src/core/extensions/index.ts";
import type { PermissionRequest } from "../src/core/permissions/index.ts";

function makeRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
	return {
		requestId: "perm-1",
		sessionId: "session-1",
		toolCallId: "toolu-1",
		provider: "dangerous-command",
		subject: "command.run",
		title: "Confirm command",
		message: "Run flagged command?",
		actions: ["allow_once", "always_allow_project", "deny_once", "always_deny_project"],
		rememberOptions: [
			{
				id: "command-exact",
				label: "This exact command",
				subject: "command.run",
				pattern: "sudo true",
				scope: "project",
				action: "allow",
			},
			{
				id: "command-deny-exact",
				label: "Always deny this command",
				subject: "command.run",
				pattern: "sudo true",
				scope: "project",
				action: "deny",
			},
		],
		metadata: { toolName: "bash", command: "sudo true" },
		createdAt: "2026-06-21T00:00:00.000Z",
		...overrides,
	};
}

function makeUi(choice: string | undefined): ExtensionUIContext {
	return {
		select: vi.fn(async () => choice),
		confirm: vi.fn(),
		input: vi.fn(),
		askUserQuestion: vi.fn(async (questions: Array<{ id: string }>) =>
			choice === undefined
				? undefined
				: { action: "responded" as const, answers: { [questions[0]!.id]: { selected: [choice] } } },
		),
		notify: vi.fn(),
		onTerminalInput: vi.fn(() => () => undefined),
		setStatus: vi.fn(),
		setWorkingMessage: vi.fn(),
		setWorkingVisible: vi.fn(),
		setWorkingIndicator: vi.fn(),
		setHiddenThinkingLabel: vi.fn(),
		setWidget: vi.fn(),
		setFooter: vi.fn(),
	} as unknown as ExtensionUIContext;
}

describe("askPermission", () => {
	it("allows when a permission_request hook allows", async () => {
		const emit = vi.fn(async () => ({ decision: "allow" as const, message: "ok" }));

		await expect(askPermission({ request: makeRequest(), emitPermissionRequest: emit })).resolves.toEqual({
			type: "allow",
			reason: "ok",
		});
		expect(emit).toHaveBeenCalledWith(expect.objectContaining({ subject: "command.run", title: "Confirm command" }));
	});

	it("maps hook updatedInput to a mutate decision", async () => {
		const emit = vi.fn(async () => ({
			decision: "allow" as const,
			updatedInput: { command: "echo safe" },
		}));

		await expect(askPermission({ request: makeRequest(), emitPermissionRequest: emit })).resolves.toEqual({
			type: "mutate",
			input: { command: "echo safe" },
			reason: undefined,
		});
	});

	it("denies when a permission_request hook denies", async () => {
		const emit = vi.fn(async () => ({ decision: "deny" as const, message: "nope" }));

		await expect(askPermission({ request: makeRequest(), emitPermissionRequest: emit })).resolves.toEqual({
			type: "deny",
			reason: "nope",
		});
	});

	it("uses UI choices when no hook decides", async () => {
		const ui = makeUi("1. Allow once");

		await expect(askPermission({ request: makeRequest(), uiContext: ui })).resolves.toEqual({
			type: "allow",
			reason: 'User selected "Allow once".',
		});
		expect(ui.askUserQuestion).toHaveBeenCalledWith(
			expect.any(Array),
			expect.objectContaining({
				title: "Confirm command",
				message: "Run flagged command?",
				permissionMeta: expect.objectContaining({
					type: "permission_runtime",
					actions: ["allow_once", "always_allow_project", "deny_once", "always_deny_project"],
					rememberOptions: expect.arrayContaining([
						expect.objectContaining({ id: "command-exact", action: "allow" }),
						expect.objectContaining({ id: "command-deny-exact", action: "deny" }),
					]),
				}),
			}),
		);
	});

	it("uses stored project decisions before hooks or UI", async () => {
		const emit = vi.fn(async () => ({ decision: "deny" as const, message: "should not run" }));
		const ui = makeUi("3. Deny once");

		await expect(
			askPermission({
				request: makeRequest(),
				uiContext: ui,
				emitPermissionRequest: emit,
				store: {
					addRule: vi.fn(),
					findDecision: () => ({
						action: "allow",
						rule: {
							id: "perm-stored",
							provider: "dangerous-command",
							subject: "command.run",
							pattern: "sudo true",
							action: "allow",
							scope: "project",
							createdAt: "2026-06-21T00:00:00.000Z",
						},
					}),
				},
			}),
		).resolves.toEqual({
			type: "allow",
			reason: "Allowed by stored permission rule perm-stored",
		});
		expect(emit).not.toHaveBeenCalled();
		expect(ui.askUserQuestion).not.toHaveBeenCalled();
	});

	it("persists project remember choices", async () => {
		const addRule = vi.fn(async () => undefined);
		const ui = makeUi("2. Always allow: This exact command");

		await expect(askPermission({ request: makeRequest(), uiContext: ui, store: { addRule } })).resolves.toEqual({
			type: "allow",
			reason: 'User selected "Always allow".',
		});
		expect(addRule).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "dangerous-command",
				subject: "command.run",
				pattern: "sudo true",
				action: "allow",
				scope: "project",
			}),
		);
	});

	it("falls back to a session remember choice when project settings are not trusted", async () => {
		const addRule = vi
			.fn()
			.mockRejectedValueOnce(new Error("Project is not trusted; refusing to write project settings"))
			.mockResolvedValueOnce(undefined);
		const ui = makeUi("2. Always allow: This exact command");

		await expect(askPermission({ request: makeRequest(), uiContext: ui, store: { addRule } })).resolves.toEqual({
			type: "allow",
			reason: 'User selected "Always allow".',
		});
		expect(addRule).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				pattern: "sudo true",
				action: "allow",
				scope: "project",
			}),
		);
		expect(addRule).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				pattern: "sudo true",
				action: "allow",
				scope: "session",
			}),
		);
	});

	it("persists the selected remember option when multiple patterns are offered", async () => {
		const addRule = vi.fn(async () => undefined);
		const ui = makeUi("3. Always allow: Similar commands");

		await askPermission({
			request: makeRequest({
				rememberOptions: [
					{
						id: "command-exact",
						label: "This exact command",
						subject: "command.run",
						pattern: "git commit --no-verify -m x",
						scope: "project",
						action: "allow",
					},
					{
						id: "command-family",
						label: "Similar commands",
						subject: "command.run",
						pattern: "git commit *--no-verify*",
						scope: "project",
						action: "allow",
					},
				],
			}),
			uiContext: ui,
			store: { addRule },
		});

		expect(addRule).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "dangerous-command",
				subject: "command.run",
				pattern: "git commit *--no-verify*",
				action: "allow",
				scope: "project",
			}),
		);
	});

	it("fails closed when no UI or hook is available", async () => {
		await expect(askPermission({ request: makeRequest() })).resolves.toEqual({
			type: "deny",
			reason: 'Permission request "Confirm command" cannot be shown without UI.',
		});
	});
});

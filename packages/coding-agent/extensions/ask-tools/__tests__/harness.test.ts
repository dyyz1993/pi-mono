import { describe, expect, it, vi } from "vitest";
import askToolsExtension from "../index.ts";
import {
	createTestRuntime,
	callTool,
	createFakeContext,
	type ExtensionTestRuntime,
} from "../../__shared__/testkit.ts";

function setup(): ExtensionTestRuntime {
	const runtime = createTestRuntime();
	askToolsExtension(runtime.pi);
	return runtime;
}

describe("ask-tools extension", () => {
	it("registers exactly 2 tools", () => {
		const runtime = setup();
		expect(Array.from(runtime.tools.keys())).toEqual(["ask-user-question", "ask-notify"]);
	});

	describe("ask-user-question tool", () => {
		it("delegates to ctx.ui.askUserQuestion and returns answers", async () => {
			const runtime = setup();
			const ctx = createFakeContext();
			const fakeAnswers = {
				action: "responded" as const,
				answers: { scope: { selected: ["backend"], text: undefined } },
			};
			ctx.ui.askUserQuestion = vi.fn(async () => fakeAnswers);

			const result = await callTool(runtime, "ask-user-question", {
				questions: [
					{
						id: "scope",
						header: "Scope",
						question: "Which scope?",
						options: [
							{ label: "frontend" },
							{ label: "backend" },
						],
					},
				],
			}, ctx);

			expect(ctx.ui.askUserQuestion).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({ id: "scope", header: "Scope" }),
				]),
				expect.objectContaining({ toolCallId: "test-call-id" }),
			);
			expect(result).toEqual({
				content: [{ type: "text", text: `User answered: ${JSON.stringify(fakeAnswers.answers)}` }],
				details: fakeAnswers,
			});
		});

		it("returns 'User did not answer' when ui returns undefined", async () => {
			const runtime = setup();
			const ctx = createFakeContext();
			ctx.ui.askUserQuestion = vi.fn(async () => undefined);

			const result = await callTool(runtime, "ask-user-question", {
				questions: [{
					id: "q",
					header: "Q",
					question: "?",
					options: [{ label: "a" }, { label: "b" }],
				}],
			}, ctx) as { content: Array<{ type: string; text: string }> };

			expect(result.content[0].text).toBe("User did not answer.");
		});

		it("passes title and timeout through to askUserQuestion", async () => {
			const runtime = setup();
			const ctx = createFakeContext();
			ctx.ui.askUserQuestion = vi.fn(async () => undefined);

			await callTool(runtime, "ask-user-question", {
				title: "Choose strategy",
				questions: [{
					id: "s",
					header: "Strategy",
					question: "Which?",
					options: [{ label: "x" }, { label: "y" }],
				}],
				timeout: 5000,
			}, ctx);

			expect(ctx.ui.askUserQuestion).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ title: "Choose strategy", timeout: 5000 }),
			);
		});
	});

	describe("ask-notify tool", () => {
		it("delegates to ctx.ui.notify with message and type", async () => {
			const runtime = setup();
			const ctx = createFakeContext();

			await callTool(runtime, "ask-notify", {
				message: "Build complete",
				type: "info",
			}, ctx);

			expect(ctx.ui.notify).toHaveBeenCalledWith("Build complete", "info");
		});

		it("returns 'Notified user' content", async () => {
			const runtime = setup();
			const ctx = createFakeContext();

			const result = await callTool(runtime, "ask-notify", {
				message: "Done",
			}, ctx) as { content: Array<{ type: string; text: string }> };

			expect(result.content[0].text).toBe("Notified user");
		});

		it("defaults type to undefined when not provided", async () => {
			const runtime = setup();
			const ctx = createFakeContext();

			await callTool(runtime, "ask-notify", { message: "hi" }, ctx);

			expect(ctx.ui.notify).toHaveBeenCalledWith("hi", undefined);
		});
	});
});

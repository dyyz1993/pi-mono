import { fauxAssistantMessage } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.js";

type SessionEntries = ReturnType<Harness["sessionManager"]["getEntries"]>;

function extractFirstUserText(entries: SessionEntries): string {
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (msg.role !== "user") continue;
		const content = msg.content;
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			const texts = content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n");
			if (texts) return texts;
		}
	}
	return "";
}

function cleanTitle(raw: string): string {
	const withoutThink = raw.replace(/<think[\s\S]*?<\/think\s*>?/g, "");
	return (
		withoutThink
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean)[0]
			?.slice(0, 100)
			.trim() ?? ""
	);
}

describe("auto-session-title extension", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("sets session name from LLM after first turn", async () => {
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("turn_end", async (event, ctx) => {
						if (event.turnIndex !== 0) return;
						if (pi.getSessionName()) return;

						const userText = extractFirstUserText(ctx.sessionManager.getEntries());
						if (!userText) return;

						let title = "";
						try {
							title = await pi.callLLM({
								systemPrompt: "Generate a very short title (max 50 chars). Output ONLY the title.",
								messages: [{ role: "user", content: userText }],
								maxTokens: 30,
							});
						} catch {
							return;
						}

						const cleaned = cleanTitle(title);
						if (cleaned) {
							pi.setSessionName(cleaned);
						}
					});
				},
			],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage("Sure, I can help with that."),
			fauxAssistantMessage("Fix login bug"),
		]);

		await harness.session.prompt("Help me fix the login bug in auth.ts");

		expect(harness.sessionManager.getSessionName()).toBe("Fix login bug");
	});

	it("does not rename if session already has a name", async () => {
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("turn_end", async (event, ctx) => {
						if (event.turnIndex !== 0) return;
						if (pi.getSessionName()) return;

						const userText = extractFirstUserText(ctx.sessionManager.getEntries());
						if (!userText) return;

						let title = "";
						try {
							title = await pi.callLLM({
								systemPrompt: "Generate a short title.",
								messages: [{ role: "user", content: userText }],
								maxTokens: 30,
							});
						} catch {
							return;
						}

						if (title.trim()) {
							pi.setSessionName(title.trim());
						}
					});
				},
			],
		});
		harnesses.push(harness);

		harness.sessionManager.appendSessionInfo("pre-existing name");

		harness.setResponses([fauxAssistantMessage("Ok."), fauxAssistantMessage("should not be used")]);

		await harness.session.prompt("Do something");

		expect(harness.sessionManager.getSessionName()).toBe("pre-existing name");
		expect(harness.faux.state.callCount).toBe(1);
	});

	it("only generates title on first turn", async () => {
		let callLLMCount = 0;

		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("turn_end", async (event, ctx) => {
						if (event.turnIndex !== 0) return;
						if (pi.getSessionName()) return;

						const userText = extractFirstUserText(ctx.sessionManager.getEntries());
						if (!userText) return;

						callLLMCount++;
						let title = "";
						try {
							title = await pi.callLLM({
								systemPrompt: "Generate a short title.",
								messages: [{ role: "user", content: userText }],
								maxTokens: 30,
							});
						} catch {
							return;
						}

						if (title.trim()) {
							pi.setSessionName(title.trim());
						}
					});
				},
			],
		});
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("First response"), fauxAssistantMessage("My Title")]);
		await harness.session.prompt("First prompt");
		expect(callLLMCount).toBe(1);
		expect(harness.sessionManager.getSessionName()).toBe("My Title");

		harness.setResponses([fauxAssistantMessage("Second response")]);
		await harness.session.prompt("Second prompt");
		expect(callLLMCount).toBe(1);
		expect(harness.sessionManager.getSessionName()).toBe("My Title");
	});

	it("gracefully handles callLLM failure without blocking", async () => {
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("turn_end", async (event, ctx) => {
						if (event.turnIndex !== 0) return;
						if (pi.getSessionName()) return;

						const userText = extractFirstUserText(ctx.sessionManager.getEntries());
						if (!userText) return;

						try {
							await pi.callLLM({
								systemPrompt: "Generate a short title.",
								messages: [{ role: "user", content: userText }],
								maxTokens: 30,
							});
						} catch {
							// silently ignore
						}
					});
				},
			],
		});
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("response")]);

		await harness.session.prompt("Hello");

		expect(harness.sessionManager.getSessionName()).toBeUndefined();
	});

	it("strips think tags from LLM title output", async () => {
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("turn_end", async (event, ctx) => {
						if (event.turnIndex !== 0) return;
						if (pi.getSessionName()) return;

						const userText = extractFirstUserText(ctx.sessionManager.getEntries());
						if (!userText) return;

						let title = "";
						try {
							title = await pi.callLLM({
								systemPrompt: "Generate a short title.",
								messages: [{ role: "user", content: userText }],
								maxTokens: 30,
							});
						} catch {
							return;
						}

						const cleaned = cleanTitle(title);
						if (cleaned) {
							pi.setSessionName(cleaned);
						}
					});
				},
			],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage("response"),
			fauxAssistantMessage("<think hmm </think API Debug Helper"),
		]);

		await harness.session.prompt("Help me debug the API");

		expect(harness.sessionManager.getSessionName()).toBe("API Debug Helper");
	});

	describe("session_rename event", () => {
		it("emits session_rename when setSessionName is called via turn_end", async () => {
			const renameEvents: Array<{ oldName: string | undefined; newName: string }> = [];

			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
						pi.on("session_rename", async (event) => {
							renameEvents.push({ oldName: event.oldName, newName: event.newName });
						});

						pi.on("turn_end", async (event, ctx) => {
							if (event.turnIndex !== 0) return;
							if (pi.getSessionName()) return;

							const userText = extractFirstUserText(ctx.sessionManager.getEntries());
							if (!userText) return;

							let title = "";
							try {
								title = await pi.callLLM({
									systemPrompt: "Generate a short title.",
									messages: [{ role: "user", content: userText }],
									maxTokens: 30,
								});
							} catch {
								return;
							}

							const cleaned = cleanTitle(title);
							if (cleaned) {
								pi.setSessionName(cleaned);
							}
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([fauxAssistantMessage("response"), fauxAssistantMessage("Login Bug Fix")]);

			await harness.session.prompt("Fix the login");

			expect(renameEvents).toHaveLength(1);
			expect(renameEvents[0]).toEqual({
				oldName: undefined,
				newName: "Login Bug Fix",
			});
		});

		it("emits session_rename with oldName when renaming existing session", async () => {
			const renameEvents: Array<{ oldName: string | undefined; newName: string }> = [];

			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
						pi.on("session_rename", async (event) => {
							renameEvents.push({ oldName: event.oldName, newName: event.newName });
						});

						pi.on("turn_end", async () => {
							pi.setSessionName("first name");
						});
					},
				],
			});
			harnesses.push(harness);

			harness.sessionManager.appendSessionInfo("original name");

			harness.setResponses([fauxAssistantMessage("ok")]);
			await harness.session.prompt("hello");

			expect(renameEvents).toHaveLength(1);
			expect(renameEvents[0]).toEqual({
				oldName: "original name",
				newName: "first name",
			});
		});

		it("does not emit session_rename if name unchanged", async () => {
			const renameEvents: Array<{ oldName: string | undefined; newName: string }> = [];

			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
						pi.on("session_rename", async (event) => {
							renameEvents.push({ oldName: event.oldName, newName: event.newName });
						});

						pi.on("turn_end", async () => {
							pi.setSessionName("same name");
						});
					},
				],
			});
			harnesses.push(harness);

			harness.sessionManager.appendSessionInfo("same name");

			harness.setResponses([fauxAssistantMessage("ok")]);
			await harness.session.prompt("hello");

			expect(renameEvents).toHaveLength(0);
		});

		it("multiple extensions can listen to session_rename", async () => {
			const ext1Events: Array<{ oldName: string | undefined; newName: string }> = [];
			const ext2Events: Array<{ oldName: string | undefined; newName: string }> = [];

			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
						pi.on("session_rename", async (event) => {
							ext1Events.push({ oldName: event.oldName, newName: event.newName });
						});

						pi.on("turn_end", async () => {
							pi.setSessionName("first title");
						});
					},
					(pi) => {
						pi.on("session_rename", async (event) => {
							ext2Events.push({ oldName: event.oldName, newName: event.newName });
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([fauxAssistantMessage("ok")]);
			await harness.session.prompt("hello");

			expect(ext1Events).toHaveLength(1);
			expect(ext2Events).toHaveLength(1);
			expect(ext1Events[0].newName).toBe("first title");
			expect(ext2Events[0].newName).toBe("first title");
		});

		it("emits session_rename when clearing name with empty string", async () => {
			const renameEvents: Array<{ oldName: string | undefined; newName: string }> = [];

			const harness = await createHarness({
				extensionFactories: [
					(pi) => {
						pi.on("session_rename", async (event) => {
							renameEvents.push({ oldName: event.oldName, newName: event.newName });
						});

						pi.on("turn_end", async () => {
							pi.setSessionName("");
						});
					},
				],
			});
			harnesses.push(harness);

			harness.sessionManager.appendSessionInfo("old name");

			harness.setResponses([fauxAssistantMessage("ok")]);
			await harness.session.prompt("hello");

			expect(renameEvents).toHaveLength(1);
			expect(renameEvents[0]).toEqual({
				oldName: "old name",
				newName: "",
			});
		});
	});
});

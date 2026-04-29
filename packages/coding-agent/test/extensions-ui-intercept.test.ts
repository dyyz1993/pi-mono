import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.js";
import { discoverAndLoadExtensions } from "../src/core/extensions/loader.js";
import { ExtensionRunner } from "../src/core/extensions/runner.js";
import type { ExtensionActions, ExtensionContextActions, ExtensionUIContext } from "../src/core/extensions/types.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { SessionManager } from "../src/core/session-manager.js";

function createMockUI(overrides: Partial<ExtensionUIContext> = {}): ExtensionUIContext {
	return {
		confirm: async () => false,
		select: async () => undefined,
		input: async () => undefined,
		notify: () => {},
		onTerminalInput: () => () => {},
		setStatus: () => {},
		setWorkingMessage: () => {},
		setWorkingIndicator: () => {},
		setHiddenThinkingLabel: () => {},
		setWidget: () => {},
		setFooter: () => {},
		setHeader: () => {},
		setTitle: () => {},
		custom: async () => undefined as never,
		pasteToEditor: () => {},
		setEditorText: () => {},
		getEditorText: () => "",
		editor: async () => undefined,
		addAutocompleteProvider: () => {},
		setEditorComponent: () => {},
		get theme() {
			return {} as any;
		},
		getAllThemes: () => [],
		getTheme: () => undefined,
		setTheme: () => ({ success: false }),
		getToolsExpanded: () => false,
		setToolsExpanded: () => {},
		...overrides,
	};
}

describe("UI Interception", () => {
	let tempDir: string;
	let extensionsDir: string;
	let sessionManager: SessionManager;
	let modelRegistry: ModelRegistry;

	const extensionActions: ExtensionActions = {
		sendMessage: () => {},
		sendUserMessage: () => {},
		appendEntry: () => {},
		setSessionName: () => {},
		getSessionName: () => undefined,
		setLabel: () => {},
		getActiveTools: () => [],
		getAllTools: () => [],
		setActiveTools: () => {},
		refreshTools: () => {},
		getCommands: () => [],
		setModel: async () => false,
		getThinkingLevel: () => "off",
		setThinkingLevel: () => {},
		registerChannel: () => {
			throw new Error("registerChannel is only available in RPC mode");
		},
		callLLM: async () => "",
	};

	const extensionContextActions: ExtensionContextActions = {
		getModel: () => undefined,
		isIdle: () => true,
		getSignal: () => undefined,
		abort: () => {},
		hasPendingMessages: () => false,
		shutdown: () => {},
		getContextUsage: () => undefined,
		compact: () => {},
		getSystemPrompt: () => "",
	};

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ui-intercept-"));
		extensionsDir = path.join(tempDir, "extensions");
		fs.mkdirSync(extensionsDir);
		sessionManager = SessionManager.inMemory();
		const authStorage = AuthStorage.create(path.join(tempDir, "auth.json"));
		modelRegistry = ModelRegistry.create(authStorage);
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	async function createRunnerWithExtension(code: string): Promise<ExtensionRunner> {
		fs.writeFileSync(path.join(extensionsDir, "intercept.ts"), code);
		const result = await discoverAndLoadExtensions([], tempDir, tempDir);
		const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
		runner.bindCore(extensionActions, extensionContextActions);
		return runner;
	}

	describe("ui confirm interception", () => {
		it("handler returning responded with confirmed=true causes confirm() to return true", async () => {
			const runner = await createRunnerWithExtension(`
				export default function(pi) {
					pi.on("ui", async (event, ctx) => {
						if (event.method === "confirm") {
							return { action: "responded", confirmed: true };
						}
						return undefined;
					});
				}
			`);

			let originalCalled = false;
			runner.setUIContext(
				createMockUI({
					confirm: async () => {
						originalCalled = true;
						return false;
					},
				}),
			);

			const result = await runner.getUIContext().confirm("Title", "Message");

			expect(result).toBe(true);
			expect(originalCalled).toBe(false);
		});

		it("handler returning responded with confirmed=false causes confirm() to return false", async () => {
			const runner = await createRunnerWithExtension(`
				export default function(pi) {
					pi.on("ui", async (event, ctx) => {
						if (event.method === "confirm") {
							return { action: "responded", confirmed: false };
						}
						return undefined;
					});
				}
			`);

			runner.setUIContext(createMockUI({ confirm: async () => true }));

			const result = await runner.getUIContext().confirm("Title", "Message");

			expect(result).toBe(false);
		});

		it("falls back to original UI when no handler is registered", async () => {
			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			let originalCalled = false;
			runner.setUIContext(
				createMockUI({
					confirm: async () => {
						originalCalled = true;
						return true;
					},
				}),
			);

			const result2 = await runner.getUIContext().confirm("Title", "Message");

			expect(originalCalled).toBe(true);
			expect(result2).toBe(true);
		});

		it("falls back to original UI when handler returns undefined", async () => {
			const runner = await createRunnerWithExtension(`
				export default function(pi) {
					pi.on("ui", async (event, ctx) => {
						if (event.method === "confirm") {
							return undefined;
						}
						return undefined;
					});
				}
			`);

			let originalCalled = false;
			runner.setUIContext(
				createMockUI({
					confirm: async () => {
						originalCalled = true;
						return true;
					},
				}),
			);

			const result = await runner.getUIContext().confirm("Title", "Message");

			expect(originalCalled).toBe(true);
			expect(result).toBe(true);
		});

		it("first handler with responded short-circuits, second handler not called", async () => {
			fs.writeFileSync(
				path.join(extensionsDir, "a-first.ts"),
				`
				export default function(pi) {
					pi.on("ui", async (event, ctx) => {
						if (event.method === "confirm") {
							return { action: "responded", confirmed: true };
						}
						return undefined;
					});
				}
			`,
			);
			fs.writeFileSync(
				path.join(extensionsDir, "b-second.ts"),
				`
				export default function(pi) {
					pi.on("ui", async (event, ctx) => {
						if (event.method === "confirm") {
							return { action: "responded", confirmed: false };
						}
						return undefined;
					});
				}
			`,
			);

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			runner.bindCore(extensionActions, extensionContextActions);
			runner.setUIContext(createMockUI());

			const confirmed = await runner.getUIContext().confirm("Title", "Message");

			expect(confirmed).toBe(true);
		});

		it("falls back when handler throws", async () => {
			const errors: string[] = [];
			fs.writeFileSync(
				path.join(extensionsDir, "throwing.ts"),
				`
				export default function(pi) {
					pi.on("ui", async (event, ctx) => {
						if (event.method === "confirm") {
							throw new Error("handler exploded");
						}
						return undefined;
					});
				}
			`,
			);

			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			runner.bindCore(extensionActions, extensionContextActions);
			runner.onError((err) => errors.push(err.error));

			let originalCalled = false;
			runner.setUIContext(
				createMockUI({
					confirm: async () => {
						originalCalled = true;
						return true;
					},
				}),
			);

			const confirmed = await runner.getUIContext().confirm("Title", "Message");

			expect(errors.length).toBeGreaterThan(0);
			expect(errors[0]).toContain("handler exploded");
			expect(originalCalled).toBe(true);
			expect(confirmed).toBe(true);
		});
	});

	describe("ui select interception", () => {
		it("handler returning responded causes select() to return value", async () => {
			const runner = await createRunnerWithExtension(`
				export default function(pi) {
					pi.on("ui", async (event, ctx) => {
						if (event.method === "select") {
							return { action: "responded", value: "Option B" };
						}
						return undefined;
					});
				}
			`);

			let originalCalled = false;
			runner.setUIContext(
				createMockUI({
					select: async () => {
						originalCalled = true;
						return undefined;
					},
				}),
			);

			const result = await runner.getUIContext().select("Pick one", ["Option A", "Option B", "Option C"]);

			expect(result).toBe("Option B");
			expect(originalCalled).toBe(false);
		});

		it("handler returning responded with undefined value (dismissed)", async () => {
			const runner = await createRunnerWithExtension(`
				export default function(pi) {
					pi.on("ui", async (event, ctx) => {
						if (event.method === "select") {
							return { action: "responded", value: undefined };
						}
						return undefined;
					});
				}
			`);

			runner.setUIContext(createMockUI({ select: async () => "Option A" }));

			const result = await runner.getUIContext().select("Pick one", ["Option A", "Option B"]);

			expect(result).toBeUndefined();
		});

		it("falls back to original UI when no handler registered", async () => {
			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			runner.setUIContext(createMockUI({ select: async () => "Option A" }));

			const result2 = await runner.getUIContext().select("Pick one", ["Option A", "Option B"]);

			expect(result2).toBe("Option A");
		});
	});

	describe("ui input interception", () => {
		it("handler returning responded causes input() to return value", async () => {
			const runner = await createRunnerWithExtension(`
				export default function(pi) {
					pi.on("ui", async (event, ctx) => {
						if (event.method === "input") {
							return { action: "responded", value: "typed by remote" };
						}
						return undefined;
					});
				}
			`);

			let originalCalled = false;
			runner.setUIContext(
				createMockUI({
					input: async () => {
						originalCalled = true;
						return undefined;
					},
				}),
			);

			const result = await runner.getUIContext().input("Enter value", "placeholder");

			expect(result).toBe("typed by remote");
			expect(originalCalled).toBe(false);
		});

		it("falls back to original UI when handler returns undefined", async () => {
			const runner = await createRunnerWithExtension(`
				export default function(pi) {
					pi.on("ui", async (event, ctx) => {
						if (event.method === "input") {
							return undefined;
						}
						return undefined;
					});
				}
			`);

			runner.setUIContext(createMockUI({ input: async () => "original response" }));

			const result = await runner.getUIContext().input("Enter value");

			expect(result).toBe("original response");
		});
	});

	describe("ui notify interception", () => {
		it("handler receives notify event and original notify still fires", async () => {
			const received: Array<{ message: string; notifyType?: string }> = [];
			const runner = await createRunnerWithExtension(`
				export default function(pi) {
					pi.on("ui", async (event, ctx) => {
						if (event.method === "notify") {
							return { received: true, message: event.message, notifyType: event.notifyType };
						}
						return undefined;
					});
				}
			`);

			let originalCalled = false;
			runner.setUIContext(
				createMockUI({
					notify: (msg, type) => {
						originalCalled = true;
						received.push({ message: msg, notifyType: type });
					},
				}),
			);

			runner.getUIContext().notify("Something happened", "warning");

			await new Promise((r) => setTimeout(r, 50));

			expect(originalCalled).toBe(true);
			expect(received.length).toBe(1);
			expect(received[0].message).toBe("Something happened");
			expect(received[0].notifyType).toBe("warning");
		});

		it("notify fires without handler registered", async () => {
			let originalCalled = false;
			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			runner.setUIContext(
				createMockUI({
					notify: () => {
						originalCalled = true;
					},
				}),
			);

			runner.getUIContext().notify("Hello");

			expect(originalCalled).toBe(true);
		});
	});

	describe("respondUI async injection", () => {
		it("ctx.respondUI resolves confirm before original UI", async () => {
			const runner = await createRunnerWithExtension(`
				export default function(pi) {
					pi.on("ui", async (event, ctx) => {
						if (event.method === "confirm") {
							setTimeout(() => {
								ctx.respondUI(event.id, { action: "responded", confirmed: true });
							}, 10);
							return undefined;
						}
						return undefined;
					});
				}
			`);

			let originalCalled = false;
			runner.setUIContext(
				createMockUI({
					confirm: async () => {
						originalCalled = true;
						await new Promise(() => {});
						return false;
					},
				}),
			);

			const result = await runner.getUIContext().confirm("Title", "Message");

			expect(result).toBe(true);
			expect(originalCalled).toBe(true);
		});

		it("ctx.respondUI resolves select before original UI", async () => {
			const runner = await createRunnerWithExtension(`
				export default function(pi) {
					pi.on("ui", async (event, ctx) => {
						if (event.method === "select") {
							setTimeout(() => {
								ctx.respondUI(event.id, { action: "responded", value: "Green" });
							}, 10);
							return undefined;
						}
						return undefined;
					});
				}
			`);

			let originalCalled = false;
			runner.setUIContext(
				createMockUI({
					select: async () => {
						originalCalled = true;
						await new Promise(() => {});
						return "Red";
					},
				}),
			);

			const result = await runner.getUIContext().select("Pick one", ["Red", "Green", "Blue"]);

			expect(result).toBe("Green");
			expect(originalCalled).toBe(true);
		});

		it("original UI wins when respondUI is not called", async () => {
			const runner = await createRunnerWithExtension(`
				export default function(pi) {
					pi.on("ui", async (event, ctx) => {
						return undefined;
					});
				}
			`);

			runner.setUIContext(
				createMockUI({
					confirm: async () => true,
				}),
			);

			const result = await runner.getUIContext().confirm("Title", "Message");

			expect(result).toBe(true);
		});

		it("respondUI with unknown id is a no-op", async () => {
			const runner = await createRunnerWithExtension(`
				export default function(pi) {
					pi.on("ui", async (event, ctx) => {
						ctx.respondUI("nonexistent-id", { action: "responded", confirmed: true });
						return undefined;
					});
				}
			`);

			runner.setUIContext(
				createMockUI({
					confirm: async () => true,
				}),
			);

			const result = await runner.getUIContext().confirm("Title", "Message");

			expect(result).toBe(true);
		});

		it("first respondUI wins, second is ignored", async () => {
			const runner = await createRunnerWithExtension(`
				export default function(pi) {
					pi.on("ui", async (event, ctx) => {
						setTimeout(() => {
							ctx.respondUI(event.id, { action: "responded", confirmed: true });
						}, 5);
						setTimeout(() => {
							ctx.respondUI(event.id, { action: "responded", confirmed: false });
						}, 15);
						return undefined;
					});
				}
			`);

			runner.setUIContext(
				createMockUI({
					confirm: async () => {
						await new Promise(() => {});
						return false;
					},
				}),
			);

			const result = await runner.getUIContext().confirm("Title", "Message");

			expect(result).toBe(true);
		});
	});

	describe("no UI context set (noOpUIContext fallback)", () => {
		it("confirm returns noOp default (false) when no handler and no UI context", async () => {
			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			const confirmed = await runner.getUIContext().confirm("Title", "Message");

			expect(confirmed).toBe(false);
		});

		it("select returns noOp default (undefined) when no handler and no UI context", async () => {
			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			const selected = await runner.getUIContext().select("Pick", ["A", "B"]);

			expect(selected).toBeUndefined();
		});

		it("hasUI returns false when no UI context is set", async () => {
			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			expect(runner.hasUI()).toBe(false);
		});

		it("hasUI returns false after setUIContext(undefined)", async () => {
			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			runner.setUIContext(undefined);

			expect(runner.hasUI()).toBe(false);
		});

		it("hasUI returns true when a real UI context is set", async () => {
			const result = await discoverAndLoadExtensions([], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			runner.setUIContext(createMockUI());

			expect(runner.hasUI()).toBe(true);
		});
	});
});

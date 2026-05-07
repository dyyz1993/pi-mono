import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockWriteRawStdout, mockAttachJsonlLineReader } = vi.hoisted(() => ({
	mockWriteRawStdout: vi.fn(),
	mockAttachJsonlLineReader: vi.fn(),
}));

vi.mock("../src/core/output-guard.js", () => ({
	takeOverStdout: vi.fn(),
	writeRawStdout: mockWriteRawStdout,
}));

vi.mock("../src/core/extensions/channel-manager.js", () => ({
	ChannelManager: vi.fn().mockImplementation(() => ({
		register: vi.fn(() => ({ send: vi.fn() })),
		handleInbound: vi.fn(),
	})),
}));

vi.mock("../src/modes/rpc/jsonl.js", () => ({
	serializeJsonLine: (v: unknown) => `${JSON.stringify(v)}\n`,
	attachJsonlLineReader: mockAttachJsonlLineReader,
}));

vi.mock("../src/core/model-resolver.js", () => ({
	resolveModelAlias: vi.fn(() => null),
}));

vi.mock("../src/utils/shell.js", () => ({
	killTrackedDetachedChildren: vi.fn(),
}));

vi.mock("../src/modes/interactive/theme/theme.js", () => ({
	theme: {},
}));

import { runRpcMode } from "../src/modes/rpc/rpc-mode.js";

function createMockSession() {
	return {
		model: { provider: "test", id: "test-model", contextWindow: 128000 },
		thinkingLevel: "medium",
		isStreaming: false,
		isCompacting: false,
		steeringMode: "all",
		followUpMode: "all",
		sessionFile: "/tmp/test-session.jsonl",
		sessionId: "test-session-id",
		sessionName: undefined as string | undefined,
		autoCompactionEnabled: true,
		messages: [] as unknown[],
		pendingMessageCount: 0,

		bindExtensions: vi.fn().mockResolvedValue(undefined),
		subscribe: vi.fn().mockReturnValue(vi.fn()),
		getTierModels: vi.fn().mockReturnValue({}),
		setTierModels: vi.fn(),
		modelRegistry: {
			getAvailable: vi.fn().mockResolvedValue([{ provider: "test", id: "test-model", contextWindow: 128000 }]),
		},
		setModel: vi.fn().mockResolvedValue(undefined),
		cycleModel: vi.fn().mockResolvedValue(null),
		setThinkingLevel: vi.fn(),
		cycleThinkingLevel: vi.fn().mockReturnValue("high"),
		setSteeringMode: vi.fn(),
		setFollowUpMode: vi.fn(),
		setAutoCompactionEnabled: vi.fn(),
		setAutoRetryEnabled: vi.fn(),
		abortRetry: vi.fn(),
		abortBash: vi.fn(),
		getSessionStats: vi.fn().mockReturnValue({
			sessionFile: "/tmp/test",
			sessionId: "test-session-id",
			userMessages: 0,
			assistantMessages: 0,
		}),
		setSessionName: vi.fn(),
		getActiveToolNames: vi.fn().mockReturnValue(["tool1", "tool2"]),
		setActiveToolsByName: vi.fn(),
		getSteeringMessages: vi.fn().mockReturnValue([]),
		getFollowUpMessages: vi.fn().mockReturnValue([]),
		clearQueue: vi.fn().mockReturnValue({ steering: [], followUp: [] }),
		extensionRunner: {
			getFlags: vi.fn().mockReturnValue(new Map()),
			getFlagValues: vi.fn().mockReturnValue(new Map()),
			setFlagValue: vi.fn(),
			getAllRegisteredTools: vi.fn().mockReturnValue([]),
			getRegisteredCommands: vi.fn().mockReturnValue([]),
		},
		resourceLoader: {
			getSkills: vi.fn().mockReturnValue({ skills: [] }),
			getExtensions: vi.fn().mockReturnValue({ extensions: [] }),
			getSystemPrompt: vi.fn().mockReturnValue("system prompt"),
			getAppendSystemPrompt: vi.fn().mockReturnValue(["append"]),
			getAgentsFiles: vi.fn().mockReturnValue({ agentsFiles: [] }),
		},
		settingsManager: {
			getGlobalSettings: vi.fn().mockReturnValue({ hideThinkingBlock: false }),
			getProjectSettings: vi.fn().mockReturnValue({}),
			applyOverrides: vi.fn(),
		},
		getContextUsage: vi.fn().mockReturnValue(null),
		sessionManager: {
			getEntries: vi.fn().mockReturnValue([]),
			getLeafId: vi.fn().mockReturnValue(null),
			getSessionName: vi.fn().mockReturnValue(undefined),
			getSessionFile: vi.fn().mockReturnValue("/tmp/test.jsonl"),
			getSessionId: vi.fn().mockReturnValue("test-session-id"),
			appendSessionInfo: vi.fn(),
			flush: vi.fn(),
		},
		promptTemplates: [],
		reload: vi.fn().mockResolvedValue(undefined),
		setCwd: vi.fn().mockResolvedValue(undefined),
		navigateTree: vi.fn().mockResolvedValue({ cancelled: false }),
		getUserMessagesForForking: vi.fn().mockReturnValue([]),
		getLastAssistantText: vi.fn().mockReturnValue(null),
		prompt: vi.fn().mockImplementation(async (_message: string, options: any) => {
			if (options?.preflightResult) {
				options.preflightResult(true);
			}
		}),
		executeBash: vi.fn().mockResolvedValue({ output: "", exitCode: 0, cancelled: false }),
		exportToHtml: vi.fn().mockResolvedValue("/tmp/export.html"),
		compact: vi.fn().mockResolvedValue({ summary: "", tokensBefore: 0 }),
		steer: vi.fn().mockResolvedValue(undefined),
		followUp: vi.fn().mockResolvedValue(undefined),
		abort: vi.fn().mockResolvedValue(undefined),
		agent: {
			waitForIdle: vi.fn().mockResolvedValue(undefined),
		},
		fileSnapshotManager: {
			getModifiedFiles: vi.fn().mockReturnValue([]),
			getFileDiff: vi.fn().mockReturnValue(null),
		},
	};
}

function createMockRuntimeHost(session: ReturnType<typeof createMockSession>) {
	return {
		session,
		setRebindSession: vi.fn(),
		newSession: vi.fn().mockResolvedValue({ cancelled: false }),
		switchSession: vi.fn().mockResolvedValue({ cancelled: false }),
		fork: vi.fn().mockResolvedValue({ cancelled: false, selectedText: "" }),
		dispose: vi.fn().mockResolvedValue(undefined),
	};
}

describe("RPC mode command handling", () => {
	let session: ReturnType<typeof createMockSession>;
	let runtimeHost: ReturnType<typeof createMockRuntimeHost>;
	let lineCallback: (line: string) => void;
	let capturedOutputs: string[];

	beforeEach(async () => {
		vi.spyOn(process, "on").mockReturnValue(process as never);
		session = createMockSession();
		runtimeHost = createMockRuntimeHost(session);
		capturedOutputs = [];

		mockWriteRawStdout.mockImplementation((text: string) => {
			capturedOutputs.push(text);
		});

		mockAttachJsonlLineReader.mockImplementation((_stream: unknown, cb: (line: string) => void) => {
			lineCallback = cb;
			return () => {};
		});

		vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
		vi.spyOn(process.stdin, "on").mockReturnValue(process.stdin as never);
		vi.spyOn(process.stdin, "off").mockReturnValue(process.stdin as never);
		vi.spyOn(process.stdin, "pause").mockReturnValue(process.stdin as never);

		runRpcMode(runtimeHost as never);

		await vi.waitFor(() => {
			expect(capturedOutputs.length).toBeGreaterThan(0);
		});
		const readyMsg = JSON.parse(capturedOutputs[0].trim());
		expect(readyMsg.type).toBe("ready");
		capturedOutputs.length = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	async function sendCommand(command: object): Promise<any> {
		capturedOutputs.length = 0;
		lineCallback(JSON.stringify(command));
		await vi.waitFor(
			() => {
				expect(capturedOutputs.length).toBeGreaterThan(0);
			},
			{ timeout: 3000, interval: 10 },
		);
		return JSON.parse(capturedOutputs[0].trim());
	}

	function parseResponse(index = 0) {
		return JSON.parse(capturedOutputs[index].trim());
	}

	// ========================================================================
	// Startup
	// ========================================================================

	it("emits ready message on startup", () => {
		expect(session.bindExtensions).toHaveBeenCalled();
		expect(session.subscribe).toHaveBeenCalled();
	});

	// ========================================================================
	// State
	// ========================================================================

	describe("get_state", () => {
		it("returns session state", async () => {
			const resp = await sendCommand({ type: "get_state", id: "s1" });

			expect(resp.id).toBe("s1");
			expect(resp.type).toBe("response");
			expect(resp.command).toBe("get_state");
			expect(resp.success).toBe(true);
			expect(resp.data.model.provider).toBe("test");
			expect(resp.data.model.id).toBe("test-model");
			expect(resp.data.thinkingLevel).toBe("medium");
			expect(resp.data.isStreaming).toBe(false);
			expect(resp.data.isCompacting).toBe(false);
			expect(resp.data.steeringMode).toBe("all");
			expect(resp.data.followUpMode).toBe("all");
			expect(resp.data.sessionFile).toBe("/tmp/test-session.jsonl");
			expect(resp.data.sessionId).toBe("test-session-id");
			expect(resp.data.autoCompactionEnabled).toBe(true);
			expect(resp.data.messageCount).toBe(0);
			expect(resp.data.pendingMessageCount).toBe(0);
		});
	});

	// ========================================================================
	// Model
	// ========================================================================

	describe("set_model", () => {
		it("sets model when found in registry", async () => {
			const resp = await sendCommand({ type: "set_model", id: "m1", provider: "test", modelId: "test-model" });

			expect(resp.success).toBe(true);
			expect(resp.command).toBe("set_model");
			expect(session.modelRegistry.getAvailable).toHaveBeenCalled();
			expect(session.setModel).toHaveBeenCalledWith({ provider: "test", id: "test-model", contextWindow: 128000 });
		});

		it("returns error when model not found", async () => {
			session.modelRegistry.getAvailable.mockResolvedValueOnce([]);

			const resp = await sendCommand({ type: "set_model", id: "m2", provider: "nope", modelId: "missing" });

			expect(resp.success).toBe(false);
			expect(resp.error).toContain("Model not found");
		});
	});

	describe("cycle_model", () => {
		it("returns null when no model available", async () => {
			const resp = await sendCommand({ type: "cycle_model", id: "cm1" });

			expect(resp.success).toBe(true);
			expect(resp.data).toBeNull();
			expect(session.cycleModel).toHaveBeenCalled();
		});

		it("returns model info when available", async () => {
			session.cycleModel.mockResolvedValueOnce({
				model: { provider: "test", id: "next-model", contextWindow: 64000 },
				thinkingLevel: "low",
				isScoped: false,
			});

			const resp = await sendCommand({ type: "cycle_model", id: "cm2" });

			expect(resp.success).toBe(true);
			expect(resp.data.model.id).toBe("next-model");
			expect(resp.data.thinkingLevel).toBe("low");
		});
	});

	describe("get_available_models", () => {
		it("returns model list", async () => {
			const resp = await sendCommand({ type: "get_available_models", id: "gam1" });

			expect(resp.success).toBe(true);
			expect(resp.data.models).toHaveLength(1);
			expect(resp.data.models[0].provider).toBe("test");
		});
	});

	describe("get_tier_models", () => {
		it("returns default tier aliases when no session overrides", async () => {
			const resp = await sendCommand({ type: "get_tier_models", id: "gtm1" });

			expect(resp.success).toBe(true);
			expect(resp.command).toBe("get_tier_models");
			expect(resp.data.models).toEqual({
				fast: "anthropic/claude-haiku-4",
				pro: "anthropic/claude-sonnet-4-20250514",
				max: "anthropic/claude-opus-4-6",
			});
		});

		it("returns merged defaults and session overrides", async () => {
			session.getTierModels.mockReturnValueOnce({ fast: "openai/gpt-4o" });

			const resp = await sendCommand({ type: "get_tier_models", id: "gtm2" });

			expect(resp.success).toBe(true);
			expect(resp.data.models.fast).toBe("openai/gpt-4o");
			expect(resp.data.models.pro).toBe("anthropic/claude-sonnet-4-20250514");
			expect(resp.data.models.max).toBe("anthropic/claude-opus-4-6");
		});
	});

	describe("set_tier_models", () => {
		it("sets session tier models", async () => {
			const resp = await sendCommand({
				type: "set_tier_models",
				id: "stm1",
				models: { fast: "openai/gpt-4o", pro: "anthropic/claude-sonnet-4-20250514" },
			});

			expect(resp.success).toBe(true);
			expect(resp.command).toBe("set_tier_models");
			expect(session.setTierModels).toHaveBeenCalledWith({
				fast: "openai/gpt-4o",
				pro: "anthropic/claude-sonnet-4-20250514",
			});
		});

		it("sets all three tiers", async () => {
			const resp = await sendCommand({
				type: "set_tier_models",
				id: "stm2",
				models: { fast: "a/b", pro: "c/d", max: "e/f" },
			});

			expect(resp.success).toBe(true);
			expect(session.setTierModels).toHaveBeenCalledWith({
				fast: "a/b",
				pro: "c/d",
				max: "e/f",
			});
		});

		it("sets partial tiers only", async () => {
			const resp = await sendCommand({
				type: "set_tier_models",
				id: "stm3",
				models: { max: "e/f" },
			});

			expect(resp.success).toBe(true);
			expect(session.setTierModels).toHaveBeenCalledWith({ max: "e/f" });
		});

		it("returns error for invalid tier names", async () => {
			const resp = await sendCommand({
				type: "set_tier_models",
				id: "stm4",
				models: { turbo: "openai/gpt-4o" } as any,
			});

			expect(resp.success).toBe(false);
			expect(resp.error).toContain("Invalid tier name");
			expect(resp.error).toContain("turbo");
		});
	});

	// ========================================================================
	// Thinking
	// ========================================================================

	describe("set_thinking_level", () => {
		it("sets thinking level", async () => {
			const resp = await sendCommand({ type: "set_thinking_level", id: "tl1", level: "high" });

			expect(resp.success).toBe(true);
			expect(session.setThinkingLevel).toHaveBeenCalledWith("high");
		});
	});

	describe("cycle_thinking_level", () => {
		it("returns new level", async () => {
			const resp = await sendCommand({ type: "cycle_thinking_level", id: "ctl1" });

			expect(resp.success).toBe(true);
			expect(resp.data.level).toBe("high");
			expect(session.cycleThinkingLevel).toHaveBeenCalled();
		});
	});

	// ========================================================================
	// Queue Modes
	// ========================================================================

	describe("set_steering_mode", () => {
		it("sets steering mode", async () => {
			const resp = await sendCommand({ type: "set_steering_mode", id: "sm1", mode: "one-at-a-time" });

			expect(resp.success).toBe(true);
			expect(session.setSteeringMode).toHaveBeenCalledWith("one-at-a-time");
		});
	});

	describe("set_follow_up_mode", () => {
		it("sets follow-up mode", async () => {
			const resp = await sendCommand({ type: "set_follow_up_mode", id: "fum1", mode: "one-at-a-time" });

			expect(resp.success).toBe(true);
			expect(session.setFollowUpMode).toHaveBeenCalledWith("one-at-a-time");
		});
	});

	// ========================================================================
	// Settings
	// ========================================================================

	describe("get_settings", () => {
		it("returns global settings by default", async () => {
			const resp = await sendCommand({ type: "get_settings", id: "gs1" });

			expect(resp.success).toBe(true);
			expect(session.settingsManager.getGlobalSettings).toHaveBeenCalled();
		});

		it("returns project settings when scope is project", async () => {
			const resp = await sendCommand({ type: "get_settings", id: "gs2", scope: "project" });

			expect(resp.success).toBe(true);
			expect(session.settingsManager.getProjectSettings).toHaveBeenCalled();
		});

		it("returns global settings when scope is global", async () => {
			const resp = await sendCommand({ type: "get_settings", id: "gs3", scope: "global" });

			expect(resp.success).toBe(true);
			expect(session.settingsManager.getGlobalSettings).toHaveBeenCalled();
		});
	});

	describe("set_settings", () => {
		it("applies settings overrides", async () => {
			const resp = await sendCommand({ type: "set_settings", id: "ss1", settings: { hideThinkingBlock: true } });

			expect(resp.success).toBe(true);
			expect(session.settingsManager.applyOverrides).toHaveBeenCalledWith({ hideThinkingBlock: true });
		});
	});

	// ========================================================================
	// Active Tools
	// ========================================================================

	describe("get_active_tools", () => {
		it("returns active tool names", async () => {
			const resp = await sendCommand({ type: "get_active_tools", id: "gat1" });

			expect(resp.success).toBe(true);
			expect(resp.data.toolNames).toEqual(["tool1", "tool2"]);
		});
	});

	describe("set_active_tools", () => {
		it("sets active tools by name", async () => {
			const resp = await sendCommand({ type: "set_active_tools", id: "sat1", toolNames: ["tool1"] });

			expect(resp.success).toBe(true);
			expect(session.setActiveToolsByName).toHaveBeenCalledWith(["tool1"]);
		});
	});

	// ========================================================================
	// Queue
	// ========================================================================

	describe("get_queue", () => {
		it("returns steering and follow-up queues", async () => {
			const resp = await sendCommand({ type: "get_queue", id: "gq1" });

			expect(resp.success).toBe(true);
			expect(resp.data.steering).toEqual([]);
			expect(resp.data.followUp).toEqual([]);
		});
	});

	describe("clear_queue", () => {
		it("clears the queue and returns cleared items", async () => {
			session.clearQueue.mockReturnValueOnce({ steering: ["msg1"], followUp: [] });

			const resp = await sendCommand({ type: "clear_queue", id: "cq1" });

			expect(resp.success).toBe(true);
			expect(resp.data.steering).toEqual(["msg1"]);
			expect(session.clearQueue).toHaveBeenCalled();
		});
	});

	// ========================================================================
	// Flags
	// ========================================================================

	describe("get_flags", () => {
		it("returns flags from extension runner", async () => {
			const flagsMap = new Map([
				["verbose", { description: "Verbose output", type: "boolean", default: false, extensionPath: "/ext" }],
			]);
			session.extensionRunner.getFlags.mockReturnValueOnce(flagsMap);

			const resp = await sendCommand({ type: "get_flags", id: "gf1" });

			expect(resp.success).toBe(true);
			expect(resp.data.flags).toHaveLength(1);
			expect(resp.data.flags[0].name).toBe("verbose");
			expect(resp.data.flags[0].type).toBe("boolean");
		});
	});

	describe("get_flag_values", () => {
		it("returns flag values as object", async () => {
			const valuesMap = new Map([["verbose", true]]);
			session.extensionRunner.getFlagValues.mockReturnValueOnce(valuesMap);

			const resp = await sendCommand({ type: "get_flag_values", id: "gfv1" });

			expect(resp.success).toBe(true);
			expect(resp.data.values).toEqual({ verbose: true });
		});
	});

	describe("set_flag", () => {
		it("sets a flag value", async () => {
			const resp = await sendCommand({ type: "set_flag", id: "sf1", name: "debug", value: true });

			expect(resp.success).toBe(true);
			expect(session.extensionRunner.setFlagValue).toHaveBeenCalledWith("debug", true);
		});

		it("sets a string flag value", async () => {
			const resp = await sendCommand({ type: "set_flag", id: "sf2", name: "mode", value: "fast" });

			expect(resp.success).toBe(true);
			expect(session.extensionRunner.setFlagValue).toHaveBeenCalledWith("mode", "fast");
		});
	});

	// ========================================================================
	// Context Usage
	// ========================================================================

	describe("get_context_usage", () => {
		it("returns null usage when context usage unavailable", async () => {
			const resp = await sendCommand({ type: "get_context_usage", id: "gcu1" });

			expect(resp.success).toBe(true);
			expect(resp.data.tokens).toBeNull();
			expect(resp.data.contextWindow).toBe(128000);
			expect(resp.data.percent).toBeNull();
		});

		it("returns usage when available", async () => {
			session.getContextUsage.mockReturnValueOnce({ tokens: 5000, contextWindow: 128000, percent: 3.9 });

			const resp = await sendCommand({ type: "get_context_usage", id: "gcu2" });

			expect(resp.success).toBe(true);
			expect(resp.data.tokens).toBe(5000);
			expect(resp.data.percent).toBe(3.9);
		});
	});

	// ========================================================================
	// System Prompt
	// ========================================================================

	describe("get_system_prompt", () => {
		it("returns system prompt and append prompts", async () => {
			const resp = await sendCommand({ type: "get_system_prompt", id: "gsp1" });

			expect(resp.success).toBe(true);
			expect(resp.data.systemPrompt).toBe("system prompt");
			expect(resp.data.appendSystemPrompt).toEqual(["append"]);
		});
	});

	// ========================================================================
	// Messages
	// ========================================================================

	describe("get_messages", () => {
		it("returns messages from session", async () => {
			const msgs = [{ role: "user", content: "hello" }];
			session.messages = msgs;

			const resp = await sendCommand({ type: "get_messages", id: "gm1" });

			expect(resp.success).toBe(true);
			expect(resp.data.messages).toEqual(msgs);
		});
	});

	describe("get_full_messages", () => {
		it("returns all messages with pagination metadata", async () => {
			const resp = await sendCommand({ type: "get_full_messages", id: "gfm1" });

			expect(resp.success).toBe(true);
			expect(resp.data.messages).toEqual([]);
			expect(resp.data.hasMore).toBe(false);
			expect(resp.data.totalCount).toBe(0);
			expect(resp.data.nextCursor).toBeNull();
		});

		it("paginates with limit", async () => {
			session.sessionManager.getEntries.mockReturnValueOnce([
				{ id: "e1", type: "message", message: { role: "user", content: "hi" } },
				{ id: "e2", type: "message", message: { role: "assistant", content: "hello" } },
			]);

			const resp = await sendCommand({ type: "get_full_messages", id: "gfm2", limit: 1 });

			expect(resp.success).toBe(true);
			expect(resp.data.messages.length).toBeLessThanOrEqual(1);
			expect(typeof resp.data.totalCount).toBe("number");
		});
	});

	describe("get_tree", () => {
		it("returns tree entries and leaf id", async () => {
			session.sessionManager.getEntries.mockReturnValueOnce([
				{ id: "e1", parentId: null, type: "message", message: { role: "user" } },
			]);
			session.sessionManager.getLeafId.mockReturnValueOnce("e1");

			const resp = await sendCommand({ type: "get_tree", id: "gt1" });

			expect(resp.success).toBe(true);
			expect(resp.data.entries).toHaveLength(1);
			expect(resp.data.entries[0].id).toBe("e1");
			expect(resp.data.leafId).toBe("e1");
		});
	});

	// ========================================================================
	// Resources (skills, extensions, tools, commands)
	// ========================================================================

	describe("get_skills", () => {
		it("returns mapped skill data", async () => {
			session.resourceLoader.getSkills.mockReturnValueOnce({
				skills: [
					{
						name: "my-skill",
						description: "A test skill",
						filePath: "/skills/my-skill.md",
						baseDir: "/skills",
						sourceInfo: { type: "project" },
						disableModelInvocation: false,
					},
				],
			});

			const resp = await sendCommand({ type: "get_skills", id: "gsk1" });

			expect(resp.success).toBe(true);
			expect(resp.data.skills).toHaveLength(1);
			expect(resp.data.skills[0].name).toBe("my-skill");
			expect(resp.data.skills[0].filePath).toBe("/skills/my-skill.md");
		});
	});

	describe("get_extensions", () => {
		it("returns mapped extension data", async () => {
			const tools = new Map([["tool-a", {}]]);
			const commands = new Map([["cmd-a", {}]]);
			session.resourceLoader.getExtensions.mockReturnValueOnce({
				extensions: [
					{
						path: "ext.js",
						resolvedPath: "/ext/ext.js",
						sourceInfo: { type: "project" },
						tools,
						commands,
					},
				],
			});

			const resp = await sendCommand({ type: "get_extensions", id: "ge1" });

			expect(resp.success).toBe(true);
			expect(resp.data.extensions).toHaveLength(1);
			expect(resp.data.extensions[0].toolNames).toEqual(["tool-a"]);
			expect(resp.data.extensions[0].commandNames).toEqual(["cmd-a"]);
		});
	});

	describe("get_tools", () => {
		it("returns registered tools", async () => {
			session.extensionRunner.getAllRegisteredTools.mockReturnValueOnce([
				{
					definition: { name: "bash", label: "Bash", description: "Run shell commands" },
					sourceInfo: { type: "builtin" },
				},
			]);

			const resp = await sendCommand({ type: "get_tools", id: "gt2" });

			expect(resp.success).toBe(true);
			expect(resp.data.tools).toHaveLength(1);
			expect(resp.data.tools[0].name).toBe("bash");
			expect(resp.data.tools[0].label).toBe("Bash");
		});
	});

	describe("get_commands", () => {
		it("returns commands from extensions, prompt templates, and skills", async () => {
			session.extensionRunner.getRegisteredCommands.mockReturnValueOnce([
				{ invocationName: "my-cmd", description: "test cmd", sourceInfo: { type: "extension" } },
			]);
			session.promptTemplates = [{ name: "review", description: "Code review", sourceInfo: { type: "project" } }];
			session.resourceLoader.getSkills.mockReturnValueOnce({
				skills: [{ name: "fix", description: "Fix bugs", sourceInfo: { type: "skill" } }],
			});

			const resp = await sendCommand({ type: "get_commands", id: "gc1" });

			expect(resp.success).toBe(true);
			expect(resp.data.commands).toHaveLength(3);
			const sources = resp.data.commands.map((c: any) => c.source);
			expect(sources).toContain("extension");
			expect(sources).toContain("prompt");
			expect(sources).toContain("skill");
		});
	});

	// ========================================================================
	// Session Management
	// ========================================================================

	describe("get_session_stats", () => {
		it("returns session statistics", async () => {
			session.getSessionStats.mockReturnValueOnce({
				sessionFile: "/tmp/test.jsonl",
				sessionId: "sid-1",
				userMessages: 5,
				assistantMessages: 5,
			});

			const resp = await sendCommand({ type: "get_session_stats", id: "gss1" });

			expect(resp.success).toBe(true);
			expect(resp.data.sessionFile).toBe("/tmp/test.jsonl");
			expect(resp.data.userMessages).toBe(5);
		});
	});

	describe("set_session_name", () => {
		it("sets session name", async () => {
			const resp = await sendCommand({ type: "set_session_name", id: "ssn1", name: "my session" });

			expect(resp.success).toBe(true);
			expect(session.setSessionName).toHaveBeenCalledWith("my session");
		});

		it("returns error for empty name", async () => {
			const resp = await sendCommand({ type: "set_session_name", id: "ssn2", name: "   " });

			expect(resp.success).toBe(false);
			expect(resp.error).toContain("cannot be empty");
		});

		it("trims the name before checking", async () => {
			const resp = await sendCommand({ type: "set_session_name", id: "ssn3", name: "  valid  " });

			expect(resp.success).toBe(true);
			expect(session.setSessionName).toHaveBeenCalledWith("valid");
		});
	});

	// ========================================================================
	// Compaction / Retry / Bash
	// ========================================================================

	describe("set_auto_compaction", () => {
		it("enables auto compaction", async () => {
			const resp = await sendCommand({ type: "set_auto_compaction", id: "sac1", enabled: false });

			expect(resp.success).toBe(true);
			expect(session.setAutoCompactionEnabled).toHaveBeenCalledWith(false);
		});
	});

	describe("set_auto_retry", () => {
		it("enables auto retry", async () => {
			const resp = await sendCommand({ type: "set_auto_retry", id: "sar1", enabled: true });

			expect(resp.success).toBe(true);
			expect(session.setAutoRetryEnabled).toHaveBeenCalledWith(true);
		});
	});

	describe("abort_retry", () => {
		it("aborts retry", async () => {
			const resp = await sendCommand({ type: "abort_retry", id: "ar1" });

			expect(resp.success).toBe(true);
			expect(session.abortRetry).toHaveBeenCalled();
		});
	});

	describe("abort_bash", () => {
		it("aborts bash", async () => {
			const resp = await sendCommand({ type: "abort_bash", id: "ab1" });

			expect(resp.success).toBe(true);
			expect(session.abortBash).toHaveBeenCalled();
		});
	});

	// ========================================================================
	// Navigation & Reload
	// ========================================================================

	describe("navigate_tree", () => {
		it("navigates tree to target", async () => {
			const resp = await sendCommand({ type: "navigate_tree", id: "nt1", targetId: "entry-5" });

			expect(resp.success).toBe(true);
			expect(resp.data.cancelled).toBe(false);
			expect(session.navigateTree).toHaveBeenCalledWith("entry-5", { summarize: false, skipFiles: undefined });
		});

		it("passes summarize option", async () => {
			await sendCommand({ type: "navigate_tree", id: "nt2", targetId: "entry-5", summarize: true });

			expect(session.navigateTree).toHaveBeenCalledWith("entry-5", { summarize: true, skipFiles: undefined });
		});

		it("passes skipFiles option", async () => {
			await sendCommand({ type: "navigate_tree", id: "nt3", targetId: "entry-5", skipFiles: true });

			expect(session.navigateTree).toHaveBeenCalledWith("entry-5", {
				summarize: false,
				skipFiles: true,
			});
		});
	});

	describe("reload", () => {
		it("reloads the session", async () => {
			const resp = await sendCommand({ type: "reload", id: "rl1" });

			expect(resp.success).toBe(true);
			expect(session.reload).toHaveBeenCalled();
		});
	});

	describe("set_cwd", () => {
		it("changes working directory", async () => {
			const resp = await sendCommand({ type: "set_cwd", id: "sc1", cwd: "/new/path" });

			expect(resp.success).toBe(true);
			expect(session.setCwd).toHaveBeenCalledWith("/new/path");
		});
	});

	// ========================================================================
	// Agents Files
	// ========================================================================

	describe("get_agents_files", () => {
		it("returns agents files", async () => {
			session.resourceLoader.getAgentsFiles.mockReturnValueOnce({
				agentsFiles: [{ path: ".opencode/agent/code.md", content: "# agent" }],
			});

			const resp = await sendCommand({ type: "get_agents_files", id: "gaf1" });

			expect(resp.success).toBe(true);
			expect(resp.data.agentsFiles).toHaveLength(1);
		});
	});

	// ========================================================================
	// Rollback queries
	// ========================================================================

	describe("get_modified_files", () => {
		it("returns files from session", async () => {
			const files = [{ path: "src/foo.ts", status: "modified", turnIndex: 2, entryId: "snap123" }];
			(session as any).fileSnapshotManager.getModifiedFiles.mockReturnValueOnce(files);

			const resp = await sendCommand({ type: "get_modified_files", id: "gmf1" });

			expect(resp.success).toBe(true);
			expect(resp.command).toBe("get_modified_files");
			expect(resp.data.files).toHaveLength(1);
			expect(resp.data.files[0].path).toBe("src/foo.ts");
			expect(resp.data.files[0].status).toBe("modified");
		});

		it("passes fromEntryId and toEntryId", async () => {
			(session as any).fileSnapshotManager.getModifiedFiles.mockReturnValueOnce([]);

			await sendCommand({
				type: "get_modified_files",
				id: "gmf2",
				fromEntryId: "entry-a",
				toEntryId: "entry-b",
			});

			expect((session as any).fileSnapshotManager.getModifiedFiles).toHaveBeenCalledWith({
				fromEntryId: "entry-a",
				toEntryId: "entry-b",
			});
		});

		it("returns empty array when no fileSnapshotManager", async () => {
			delete (session as any).fileSnapshotManager;

			const resp = await sendCommand({ type: "get_modified_files", id: "gmf3" });

			expect(resp.success).toBe(true);
			expect(resp.data.files).toEqual([]);
		});

		it("returns empty files with no changes", async () => {
			(session as any).fileSnapshotManager.getModifiedFiles.mockReturnValueOnce([]);

			const resp = await sendCommand({ type: "get_modified_files", id: "gmf4" });

			expect(resp.success).toBe(true);
			expect(resp.data.files).toEqual([]);
		});
	});

	describe("get_file_diff", () => {
		it("returns diff for file", async () => {
			const diff = {
				path: "src/foo.ts",
				oldContent: "original\n",
				newContent: "modified\n",
				unifiedDiff: "--- src/foo.ts\n+++ src/foo.ts\n@@ -1 +1 @@\n-original\n+modified\n",
			};
			(session as any).fileSnapshotManager.getFileDiff.mockReturnValueOnce(diff);

			const resp = await sendCommand({
				type: "get_file_diff",
				id: "gfd1",
				filePath: "src/foo.ts",
			});

			expect(resp.success).toBe(true);
			expect(resp.command).toBe("get_file_diff");
			expect(resp.data.path).toBe("src/foo.ts");
			expect(resp.data.oldContent).toBe("original\n");
			expect(resp.data.newContent).toBe("modified\n");
			expect(resp.data.unifiedDiff).toContain("-original");
		});

		it("returns null for non-existent file", async () => {
			(session as any).fileSnapshotManager.getFileDiff.mockReturnValueOnce(null);

			const resp = await sendCommand({
				type: "get_file_diff",
				id: "gfd2",
				filePath: "nonexistent.ts",
			});

			expect(resp.success).toBe(true);
			expect(resp.data).toBeNull();
		});

		it("passes entry range options", async () => {
			(session as any).fileSnapshotManager.getFileDiff.mockReturnValueOnce(null);

			await sendCommand({
				type: "get_file_diff",
				id: "gfd3",
				filePath: "src/foo.ts",
				fromEntryId: "a",
				toEntryId: "b",
			});

			expect((session as any).fileSnapshotManager.getFileDiff).toHaveBeenCalledWith({
				filePath: "src/foo.ts",
				fromEntryId: "a",
				toEntryId: "b",
			});
		});

		it("returns null when no fileSnapshotManager", async () => {
			delete (session as any).fileSnapshotManager;

			const resp = await sendCommand({
				type: "get_file_diff",
				id: "gfd4",
				filePath: "src/foo.ts",
			});

			expect(resp.success).toBe(true);
			expect(resp.data).toBeNull();
		});
	});

	// ========================================================================
	// Prompting (async dispatch)
	// ========================================================================

	describe("prompt", () => {
		it("dispatches prompt and emits success via preflight", async () => {
			const resp = await sendCommand({ type: "prompt", id: "p1", message: "hello" });

			expect(resp.success).toBe(true);
			expect(resp.command).toBe("prompt");
			expect(session.prompt).toHaveBeenCalledWith(
				"hello",
				expect.objectContaining({ source: "rpc", images: undefined, streamingBehavior: undefined }),
			);
		});

		it("passes images and streamingBehavior", async () => {
			session.prompt.mockImplementationOnce(async (_msg: string, opts: any) => {
				if (opts?.preflightResult) opts.preflightResult(true);
			});

			await sendCommand({
				type: "prompt",
				id: "p2",
				message: "look at this",
				images: [{ type: "image", data: "base64" }],
				streamingBehavior: "steer",
			});

			expect(session.prompt).toHaveBeenCalledWith(
				"look at this",
				expect.objectContaining({
					images: [{ type: "image", data: "base64" }],
					streamingBehavior: "steer",
				}),
			);
		});
	});

	describe("steer", () => {
		it("dispatches steer command", async () => {
			const resp = await sendCommand({ type: "steer", id: "st1", message: "change direction" });

			expect(resp.success).toBe(true);
			expect(session.steer).toHaveBeenCalledWith("change direction", undefined);
		});
	});

	describe("follow_up", () => {
		it("dispatches follow_up command", async () => {
			const resp = await sendCommand({ type: "follow_up", id: "fu1", message: "next step" });

			expect(resp.success).toBe(true);
			expect(session.followUp).toHaveBeenCalledWith("next step", undefined);
		});
	});

	describe("abort", () => {
		it("dispatches abort command", async () => {
			const resp = await sendCommand({ type: "abort", id: "a1" });

			expect(resp.success).toBe(true);
			expect(session.abort).toHaveBeenCalled();
		});
	});

	// ========================================================================
	// Session Lifecycle
	// ========================================================================

	describe("new_session", () => {
		it("creates new session and rebinds", async () => {
			const resp = await sendCommand({ type: "new_session", id: "ns1" });

			expect(resp.success).toBe(true);
			expect(resp.data.cancelled).toBe(false);
			expect(runtimeHost.newSession).toHaveBeenCalled();
		});
	});

	describe("switch_session", () => {
		it("switches session and rebinds", async () => {
			const resp = await sendCommand({ type: "switch_session", id: "sws1", sessionPath: "/path/to/session" });

			expect(resp.success).toBe(true);
			expect(runtimeHost.switchSession).toHaveBeenCalledWith("/path/to/session");
		});
	});

	describe("fork", () => {
		it("forks session at entry", async () => {
			session.sessionManager.getSessionName.mockReturnValueOnce("original");
			session.sessionManager.getSessionFile.mockReturnValueOnce("/forked.jsonl");
			session.sessionManager.getSessionId.mockReturnValueOnce("forked-id");

			const resp = await sendCommand({ type: "fork", id: "fk1", entryId: "e1" });

			expect(resp.success).toBe(true);
			expect(resp.data.cancelled).toBe(false);
			expect(runtimeHost.fork).toHaveBeenCalledWith("e1", undefined);
		});

		it("forks at position when specified", async () => {
			session.sessionManager.getSessionName.mockReturnValueOnce("orig");
			session.sessionManager.getSessionFile.mockReturnValueOnce("/forked.jsonl");
			session.sessionManager.getSessionId.mockReturnValueOnce("forked-id");

			await sendCommand({ type: "fork", id: "fk2", entryId: "e1", position: "at" });

			expect(runtimeHost.fork).toHaveBeenCalledWith("e1", { position: "at" });
		});
	});

	describe("clone", () => {
		it("clones current session", async () => {
			session.sessionManager.getLeafId.mockReturnValueOnce("leaf-1");

			const resp = await sendCommand({ type: "clone", id: "cl1" });

			expect(resp.success).toBe(true);
			expect(runtimeHost.fork).toHaveBeenCalledWith("leaf-1", { position: "at" });
		});

		it("returns error when no leaf", async () => {
			session.sessionManager.getLeafId.mockReturnValueOnce(null);

			const resp = await sendCommand({ type: "clone", id: "cl2" });

			expect(resp.success).toBe(false);
			expect(resp.error).toContain("no current entry");
		});
	});

	describe("get_fork_messages", () => {
		it("returns fork messages", async () => {
			session.getUserMessagesForForking.mockReturnValueOnce([{ entryId: "e1", text: "hello" }]);

			const resp = await sendCommand({ type: "get_fork_messages", id: "gfm3" });

			expect(resp.success).toBe(true);
			expect(resp.data.messages).toHaveLength(1);
		});
	});

	describe("get_last_assistant_text", () => {
		it("returns last assistant text", async () => {
			session.getLastAssistantText.mockReturnValueOnce("Hello!");

			const resp = await sendCommand({ type: "get_last_assistant_text", id: "glat1" });

			expect(resp.success).toBe(true);
			expect(resp.data.text).toBe("Hello!");
		});

		it("returns null when no assistant text", async () => {
			session.getLastAssistantText.mockReturnValueOnce(null);

			const resp = await sendCommand({ type: "get_last_assistant_text", id: "glat2" });

			expect(resp.success).toBe(true);
			expect(resp.data.text).toBeNull();
		});
	});

	describe("export_html", () => {
		it("exports session to HTML", async () => {
			session.exportToHtml.mockResolvedValueOnce("/tmp/out.html");

			const resp = await sendCommand({ type: "export_html", id: "eh1", outputPath: "/out.html" });

			expect(resp.success).toBe(true);
			expect(resp.data.path).toBe("/tmp/out.html");
			expect(session.exportToHtml).toHaveBeenCalledWith("/out.html");
		});
	});

	// ========================================================================
	// Bash
	// ========================================================================

	describe("bash", () => {
		it("executes bash command", async () => {
			session.executeBash.mockResolvedValueOnce({ output: "hello\n", exitCode: 0, cancelled: false });

			const resp = await sendCommand({ type: "bash", id: "b1", command: "echo hello" });

			expect(resp.success).toBe(true);
			expect(resp.data.output.trim()).toBe("hello");
			expect(resp.data.exitCode).toBe(0);
			expect(session.executeBash).toHaveBeenCalledWith("echo hello");
		});
	});

	// ========================================================================
	// Compact
	// ========================================================================

	describe("compact", () => {
		it("compacts session with optional instructions", async () => {
			session.compact.mockResolvedValueOnce({ summary: "compacted", tokensBefore: 5000 });

			const resp = await sendCommand({ type: "compact", id: "cp1", customInstructions: "keep imports" });

			expect(resp.success).toBe(true);
			expect(resp.data.summary).toBe("compacted");
			expect(session.compact).toHaveBeenCalledWith("keep imports");
		});

		it("compacts without custom instructions", async () => {
			session.compact.mockResolvedValueOnce({ summary: "done", tokensBefore: 1000 });

			const resp = await sendCommand({ type: "compact", id: "cp2" });

			expect(resp.success).toBe(true);
			expect(session.compact).toHaveBeenCalledWith(undefined);
		});
	});

	// ========================================================================
	// Error Handling
	// ========================================================================

	describe("unknown command", () => {
		it("returns error for unrecognized command type", async () => {
			const resp = await sendCommand({ type: "nonexistent_command", id: "uc1" });

			expect(resp.success).toBe(false);
			expect(resp.error).toContain("Unknown command");
		});
	});

	describe("invalid JSON", () => {
		it("returns parse error for malformed input", async () => {
			capturedOutputs.length = 0;
			lineCallback("not valid json {{{");

			await vi.waitFor(
				() => {
					expect(capturedOutputs.length).toBeGreaterThan(0);
				},
				{ timeout: 3000, interval: 10 },
			);

			const resp = parseResponse();
			expect(resp.success).toBe(false);
			expect(resp.error).toContain("Failed to parse");
		});
	});

	describe("command handler throws", () => {
		it("returns error when session method throws", async () => {
			session.navigateTree.mockRejectedValueOnce(new Error("navigation failed"));

			const resp = await sendCommand({ type: "navigate_tree", id: "err1", targetId: "x" });

			expect(resp.success).toBe(false);
			expect(resp.error).toContain("navigation failed");
		});
	});

	// ========================================================================
	// Extension UI Context
	// ========================================================================

	describe("extension UI context", () => {
		let uiContext: any;

		beforeEach(() => {
			const bindCall = session.bindExtensions.mock.calls[0];
			if (bindCall?.[0]) {
				uiContext = bindCall[0].uiContext;
			}
		});

		it("notify outputs extension_ui_request", () => {
			capturedOutputs.length = 0;
			uiContext.notify("test message", "info");

			expect(capturedOutputs.length).toBe(1);
			const msg = JSON.parse(capturedOutputs[0].trim());
			expect(msg.type).toBe("extension_ui_request");
			expect(msg.method).toBe("notify");
			expect(msg.message).toBe("test message");
			expect(msg.notifyType).toBe("info");
		});

		it("setStatus outputs extension_ui_request", () => {
			capturedOutputs.length = 0;
			uiContext.setStatus("build", "compiling...");

			expect(capturedOutputs.length).toBe(1);
			const msg = JSON.parse(capturedOutputs[0].trim());
			expect(msg.method).toBe("setStatus");
			expect(msg.statusKey).toBe("build");
			expect(msg.statusText).toBe("compiling...");
		});

		it("setWidget outputs extension_ui_request for string arrays", () => {
			capturedOutputs.length = 0;
			uiContext.setWidget("panel", ["line 1", "line 2"]);

			expect(capturedOutputs.length).toBe(1);
			const msg = JSON.parse(capturedOutputs[0].trim());
			expect(msg.method).toBe("setWidget");
			expect(msg.widgetKey).toBe("panel");
			expect(msg.widgetLines).toEqual(["line 1", "line 2"]);
		});

		it("setWidget ignores non-array content", () => {
			capturedOutputs.length = 0;
			uiContext.setWidget("panel", () => "render");

			expect(capturedOutputs.length).toBe(0);
		});

		it("setWidget outputs for undefined content", () => {
			capturedOutputs.length = 0;
			uiContext.setWidget("panel", undefined);

			expect(capturedOutputs.length).toBe(1);
			const msg = JSON.parse(capturedOutputs[0].trim());
			expect(msg.widgetLines).toBeUndefined();
		});

		it("setTitle outputs extension_ui_request", () => {
			capturedOutputs.length = 0;
			uiContext.setTitle("new title");

			expect(capturedOutputs.length).toBe(1);
			const msg = JSON.parse(capturedOutputs[0].trim());
			expect(msg.method).toBe("setTitle");
			expect(msg.title).toBe("new title");
		});

		it("setEditorText outputs extension_ui_request", () => {
			capturedOutputs.length = 0;
			uiContext.setEditorText("code here");

			expect(capturedOutputs.length).toBe(1);
			const msg = JSON.parse(capturedOutputs[0].trim());
			expect(msg.method).toBe("set_editor_text");
			expect(msg.text).toBe("code here");
		});

		it("pasteToEditor delegates to setEditorText", () => {
			capturedOutputs.length = 0;
			uiContext.pasteToEditor("pasted text");

			expect(capturedOutputs.length).toBe(1);
			const msg = JSON.parse(capturedOutputs[0].trim());
			expect(msg.method).toBe("set_editor_text");
			expect(msg.text).toBe("pasted text");
		});

		it("getEditorText returns empty string", () => {
			expect(uiContext.getEditorText()).toBe("");
		});

		it("onTerminalInput returns no-op unsubscribe", () => {
			const unsub = uiContext.onTerminalInput();
			expect(typeof unsub).toBe("function");
		});

		it("custom returns undefined", async () => {
			const result = await uiContext.custom();
			expect(result).toBeUndefined();
		});

		it("setWorkingMessage is a no-op", () => {
			expect(() => uiContext.setWorkingMessage("msg")).not.toThrow();
		});

		it("setWorkingIndicator is a no-op", () => {
			expect(() => uiContext.setWorkingIndicator()).not.toThrow();
		});

		it("setHiddenThinkingLabel is a no-op", () => {
			expect(() => uiContext.setHiddenThinkingLabel("label")).not.toThrow();
		});

		it("setFooter is a no-op", () => {
			expect(() => uiContext.setFooter(() => {})).not.toThrow();
		});

		it("setHeader is a no-op", () => {
			expect(() => uiContext.setHeader(() => {})).not.toThrow();
		});

		it("addAutocompleteProvider is a no-op", () => {
			expect(() => uiContext.addAutocompleteProvider()).not.toThrow();
		});

		it("setEditorComponent is a no-op", () => {
			expect(() => uiContext.setEditorComponent()).not.toThrow();
		});

		it("getAllThemes returns empty array", () => {
			expect(uiContext.getAllThemes()).toEqual([]);
		});

		it("getTheme returns undefined", () => {
			expect(uiContext.getTheme("dark")).toBeUndefined();
		});

		it("setTheme returns failure object", () => {
			const result = uiContext.setTheme("dark");
			expect(result.success).toBe(false);
			expect(result.error).toContain("not supported");
		});

		it("getToolsExpanded returns false", () => {
			expect(uiContext.getToolsExpanded()).toBe(false);
		});

		it("setToolsExpanded is a no-op", () => {
			expect(() => uiContext.setToolsExpanded(true)).not.toThrow();
		});

		it("select emits request and resolves on response", async () => {
			capturedOutputs.length = 0;
			const selectPromise = uiContext.select("Pick one", ["a", "b"]);

			await vi.waitFor(() => expect(capturedOutputs.length).toBe(1));
			const req = JSON.parse(capturedOutputs[0].trim());
			expect(req.method).toBe("select");
			expect(req.title).toBe("Pick one");
			expect(req.options).toEqual(["a", "b"]);

			lineCallback(JSON.stringify({ type: "extension_ui_response", id: req.id, value: "a" }));

			const result = await selectPromise;
			expect(result).toBe("a");
		});

		it("select resolves undefined when cancelled", async () => {
			capturedOutputs.length = 0;
			const selectPromise = uiContext.select("Pick one", ["a", "b"]);

			await vi.waitFor(() => expect(capturedOutputs.length).toBe(1));
			const req = JSON.parse(capturedOutputs[0].trim());

			lineCallback(JSON.stringify({ type: "extension_ui_response", id: req.id, cancelled: true }));

			const result = await selectPromise;
			expect(result).toBeUndefined();
		});

		it("confirm emits request and resolves on response", async () => {
			capturedOutputs.length = 0;
			const confirmPromise = uiContext.confirm("Title", "Are you sure?");

			await vi.waitFor(() => expect(capturedOutputs.length).toBe(1));
			const req = JSON.parse(capturedOutputs[0].trim());
			expect(req.method).toBe("confirm");
			expect(req.message).toBe("Are you sure?");

			lineCallback(JSON.stringify({ type: "extension_ui_response", id: req.id, confirmed: true }));

			const result = await confirmPromise;
			expect(result).toBe(true);
		});

		it("confirm resolves false when cancelled", async () => {
			capturedOutputs.length = 0;
			const confirmPromise = uiContext.confirm("Title", "Sure?");

			await vi.waitFor(() => expect(capturedOutputs.length).toBe(1));
			const req = JSON.parse(capturedOutputs[0].trim());

			lineCallback(JSON.stringify({ type: "extension_ui_response", id: req.id, cancelled: true }));

			const result = await confirmPromise;
			expect(result).toBe(false);
		});

		it("input emits request and resolves on response", async () => {
			capturedOutputs.length = 0;
			const inputPromise = uiContext.input("Enter name", "placeholder");

			await vi.waitFor(() => expect(capturedOutputs.length).toBe(1));
			const req = JSON.parse(capturedOutputs[0].trim());
			expect(req.method).toBe("input");
			expect(req.placeholder).toBe("placeholder");

			lineCallback(JSON.stringify({ type: "extension_ui_response", id: req.id, value: "Alice" }));

			const result = await inputPromise;
			expect(result).toBe("Alice");
		});

		it("input resolves undefined when cancelled", async () => {
			capturedOutputs.length = 0;
			const inputPromise = uiContext.input("Enter name");

			await vi.waitFor(() => expect(capturedOutputs.length).toBe(1));
			const req = JSON.parse(capturedOutputs[0].trim());

			lineCallback(JSON.stringify({ type: "extension_ui_response", id: req.id, cancelled: true }));

			const result = await inputPromise;
			expect(result).toBeUndefined();
		});

		it("select resolves undefined on timeout", async () => {
			capturedOutputs.length = 0;
			const selectPromise = uiContext.select("Pick", ["a"], { timeout: 50 });

			await vi.waitFor(() => expect(capturedOutputs.length).toBe(1));

			const result = await selectPromise;
			expect(result).toBeUndefined();
		}, 10000);

		it("confirm resolves false on timeout", async () => {
			capturedOutputs.length = 0;
			const confirmPromise = uiContext.confirm("Sure?", "msg", { timeout: 50 });

			await vi.waitFor(() => expect(capturedOutputs.length).toBe(1));

			const result = await confirmPromise;
			expect(result).toBe(false);
		}, 10000);

		it("select resolves undefined when signal aborted", async () => {
			capturedOutputs.length = 0;
			const ac = new AbortController();
			ac.abort();

			const result = await uiContext.select("Pick", ["a"], { signal: ac.signal });
			expect(result).toBeUndefined();
		});

		it("confirm resolves false when signal aborted", async () => {
			capturedOutputs.length = 0;
			const ac = new AbortController();
			ac.abort();

			const result = await uiContext.confirm("Sure?", "msg", { signal: ac.signal });
			expect(result).toBe(false);
		});

		it("editor emits request and resolves on response", async () => {
			capturedOutputs.length = 0;
			const editorPromise = uiContext.editor("Edit file", "initial content");

			await vi.waitFor(() => expect(capturedOutputs.length).toBe(1));
			const req = JSON.parse(capturedOutputs[0].trim());
			expect(req.method).toBe("editor");
			expect(req.title).toBe("Edit file");
			expect(req.prefill).toBe("initial content");

			lineCallback(JSON.stringify({ type: "extension_ui_response", id: req.id, value: "edited content" }));

			const result = await editorPromise;
			expect(result).toBe("edited content");
		});

		it("editor resolves undefined when cancelled", async () => {
			capturedOutputs.length = 0;
			const editorPromise = uiContext.editor("Edit");

			await vi.waitFor(() => expect(capturedOutputs.length).toBe(1));
			const req = JSON.parse(capturedOutputs[0].trim());

			lineCallback(JSON.stringify({ type: "extension_ui_response", id: req.id, cancelled: true }));

			const result = await editorPromise;
			expect(result).toBeUndefined();
		});
	});
});

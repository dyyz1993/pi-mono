import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { GoalState, GuardConfig, TriggerRecord } from "../../extensions/session-supervisor/types.ts";
import { createHarness, type Harness } from "./harness.ts";

// ── Helpers ──

/**
 * Creates an inline extension factory that mimics the session-supervisor's
 * goal lifecycle: before_agent_start injection, agent_end guard loop with
 * callLLM, and supervisor_complete tool.
 *
 * Goal state is managed via the returned controller instead of channel calls
 * to keep tests simple and synchronous.
 */
function createSupervisorLikeExtension(options?: {
	guards?: Array<Extract<GuardConfig, { type: "keyword" }>>;
	checkOnAgentEnd?: boolean;
}) {
	const checkOnAgentEnd = options?.checkOnAgentEnd ?? true;
	const guards = options?.guards ?? [];

	let activeGoal: GoalState | undefined;
	let goalStatusLog: Array<{ status: GoalState["status"]; at: number }> = [];
	const triggerHistory: TriggerRecord[] = [];
	let triggerSeq = 0;
	let stagnationCount = 0;
	let lastIncompleteSignature = "";

	const controller = {
		setGoal(objective: string) {
			const now = Date.now();
			activeGoal = {
				id: `goal_${now.toString(36)}`,
				objective,
				status: "running",
				startedAt: now,
				updatedAt: now,
				continuationCount: 0,
				blockers: [],
			};
			goalStatusLog = [];
			goalStatusLog.push({ status: "running", at: now });
			stagnationCount = 0;
			lastIncompleteSignature = "";
		},
		/** Simulate session_start restoring a persisted goal */
		restoreGoal(goal: GoalState) {
			activeGoal = goal;
			goalStatusLog = [{ status: goal.status, at: goal.updatedAt }];
		},
		clearGoal() {
			if (activeGoal) {
				activeGoal = { ...activeGoal, status: "cancelled", updatedAt: Date.now() };
			}
			activeGoal = undefined;
		},
		getGoal: () => activeGoal,
		getGoalStatusLog: () => goalStatusLog,
		getTriggerHistory: () => triggerHistory,
	};

	const factory = (pi: any) => {
		pi.registerTool({
			name: "supervisor_complete",
			label: "Supervisor Complete",
			description: "Declare task completion",
			parameters: {
				type: "object",
				properties: {
					summary: { type: "string", description: "Summary of work done" },
				},
				required: ["summary"],
			},
			execute: async (_toolCallId: string, params: Record<string, unknown>) => {
				const summary = String(params.summary ?? "");

				for (const guard of guards) {
					if (guard.type === "keyword") {
						const found = guard.keywords.filter((kw) => summary.toLowerCase().includes(kw.toLowerCase()));
						if (found.length > 0) {
							return {
								content: [
									{
										type: "text" as const,
										text: `Blocked by keyword guard: ${found.join(", ")}`,
									},
								],
								details: { approved: false, blockedBy: "keyword", remainingItems: found },
								terminate: false,
							};
						}
					}
				}

				return {
					content: [{ type: "text" as const, text: "Supervisor complete: approved." }],
					details: { approved: true },
				};
			},
		});

		pi.on("before_agent_start", async (event: { systemPrompt: string }) => {
			if (!activeGoal || activeGoal.status === "cancelled" || activeGoal.status === "complete") {
				return {};
			}

			const goalSection = `

## Active Goal

**Objective**: ${activeGoal.objective}
**Status**: ${activeGoal.status}

When you believe the objective is fully achieved, call the \`supervisor_complete\` tool with a summary.
`;

			return {
				systemPrompt: event.systemPrompt + goalSection,
			};
		});

		if (checkOnAgentEnd) {
			pi.on("agent_end", async (event: { messages: Array<{ role: string; content: unknown }> }) => {
				if (!activeGoal || activeGoal.status === "complete" || activeGoal.status === "cancelled") {
					return;
				}

				const triggerStartedAt = Date.now();
				activeGoal = { ...activeGoal, status: "checking", updatedAt: Date.now() };
				goalStatusLog.push({ status: "checking", at: Date.now() });

				// Extract last assistant text
				let lastAssistantText = "";
				for (let i = event.messages.length - 1; i >= 0; i--) {
					const msg = event.messages[i];
					if (msg.role === "assistant") {
						if (typeof msg.content === "string") {
							lastAssistantText = msg.content;
						} else if (Array.isArray(msg.content)) {
							lastAssistantText = (msg.content as Array<{ type: string; text?: string }>)
								.filter((p) => p.type === "text")
								.map((p) => p.text ?? "")
								.join("\n");
						}
						break;
					}
				}

				// Run keyword guard checks
				const guardResults: TriggerRecord["guardResults"] = [];
				for (const guard of guards) {
					if (guard.type === "keyword") {
						const guardStart = Date.now();
						const found = guard.keywords.filter((kw) =>
							lastAssistantText.toLowerCase().includes(kw.toLowerCase()),
						);
						guardResults.push({
							guardName: guard.name,
							guardType: "keyword",
							passed: found.length === 0,
							confidence: found.length === 0 ? 1 : 0.7,
							remainingItems: found.length > 0 ? [`Keywords found: ${found.join(", ")}`] : [],
							detail: found.length > 0 ? `Found: ${found.join(", ")}` : "No incomplete keywords",
							durationMs: Date.now() - guardStart,
						});
					}
				}

				// Stagnation detection (mirrors production session-supervisor logic)
				const hasIncompleteGuards = guardResults.some((r) => !r.passed && r.remainingItems.length > 0);
				if (hasIncompleteGuards) {
					const currentSignature = guardResults
						.filter((r) => !r.passed)
						.map((r) => `${r.guardName}:${r.remainingItems.sort().join(",")}`)
						.join("|");

					if (currentSignature === lastIncompleteSignature) {
						stagnationCount++;
					} else {
						stagnationCount = 0;
					}
					lastIncompleteSignature = currentSignature;

					if (stagnationCount >= 2) {
						activeGoal = { ...activeGoal!, status: "blocked", updatedAt: Date.now() };
						goalStatusLog.push({ status: "blocked", at: Date.now() });

						triggerSeq++;
						triggerHistory.push({
							seq: triggerSeq,
							startedAt: triggerStartedAt,
							finishedAt: Date.now(),
							durationMs: Date.now() - triggerStartedAt,
							verdict: "blocked",
							confidence: 0.5,
							guardResults,
							action: "idle",
							reason: `Stagnation detected: same incomplete guard results for ${stagnationCount + 1} consecutive checks.`,
						});
						return;
					}
				} else {
					stagnationCount = 0;
					lastIncompleteSignature = "";
				}

				// Use callLLM for model-based completion check (same as real supervisor)
				const modelCheckStart = Date.now();
				const modelResponse = await pi.callLLM({
					systemPrompt:
						'You are a completion checker. Respond with JSON: {"completed": boolean, "confidence": number}',
					messages: [
						{
							role: "user",
							content: `Check if this task is done: ${lastAssistantText.slice(0, 500)}`,
						},
					],
					maxTokens: 256,
				});
				const modelCheckDurationMs = Date.now() - modelCheckStart;

				const triggerFinishedAt = Date.now();
				const triggerDurationMs = triggerFinishedAt - triggerStartedAt;

				try {
					const cleaned = modelResponse
						.replace(/```json?\n?/g, "")
						.replace(/\n?```/g, "")
						.trim();
					const parsed = JSON.parse(cleaned);
					if (parsed.completed) {
						activeGoal = { ...activeGoal, status: "complete", updatedAt: Date.now() };
						goalStatusLog.push({ status: "complete", at: Date.now() });

						triggerSeq++;
						triggerHistory.push({
							seq: triggerSeq,
							startedAt: triggerStartedAt,
							finishedAt: triggerFinishedAt,
							durationMs: triggerDurationMs,
							verdict: "complete",
							confidence: parsed.confidence ?? 0.9,
							guardResults,
							modelCheck: {
								passed: true,
								confidence: parsed.confidence ?? 0.9,
								response: modelResponse,
								durationMs: modelCheckDurationMs,
							},
							action: "idle",
							reason: "Model check passed",
						});
					} else {
						activeGoal = { ...activeGoal, status: "running", updatedAt: Date.now() };
						goalStatusLog.push({ status: "running", at: Date.now() });

						triggerSeq++;
						triggerHistory.push({
							seq: triggerSeq,
							startedAt: triggerStartedAt,
							finishedAt: triggerFinishedAt,
							durationMs: triggerDurationMs,
							verdict: "incomplete",
							confidence: parsed.confidence ?? 0.8,
							guardResults,
							modelCheck: {
								passed: false,
								confidence: parsed.confidence ?? 0.8,
								response: modelResponse,
								durationMs: modelCheckDurationMs,
							},
							action: "continue",
							reason: "Model detected incomplete tasks",
						});
					}
				} catch {
					activeGoal = { ...activeGoal, status: "complete", updatedAt: Date.now() };
					goalStatusLog.push({ status: "complete", at: Date.now() });

					triggerSeq++;
					triggerHistory.push({
						seq: triggerSeq,
						startedAt: triggerStartedAt,
						finishedAt: triggerFinishedAt,
						durationMs: triggerDurationMs,
						verdict: "complete",
						confidence: 0.5,
						guardResults,
						modelCheck: {
							passed: true,
							confidence: 0.5,
							response: modelResponse,
							durationMs: modelCheckDurationMs,
						},
						action: "idle",
						reason: "Parse failed, assuming complete",
					});
				}
			});
		}
	};

	return { controller, factory };
}

describe("goal lifecycle via harness", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	// ── Phase 1: before_agent_start injection ──

	it("injects active goal objective into the system prompt", async () => {
		const { controller, factory } = createSupervisorLikeExtension();
		controller.setGoal("Fix the authentication bug in login.ts");

		const harness = await createHarness({ extensionFactories: [factory] });
		harnesses.push(harness);

		let providerSystemPrompt = "";
		harness.setResponses([
			(context) => {
				providerSystemPrompt = context.systemPrompt ?? "";
				return fauxAssistantMessage("working on it");
			},
			// callLLM from agent_end
			fauxAssistantMessage('{"completed": true, "confidence": 0.9}'),
		]);

		await harness.session.prompt("fix the bug");

		expect(providerSystemPrompt).toContain("Active Goal");
		expect(providerSystemPrompt).toContain("Fix the authentication bug in login.ts");
	});

	it("does not inject goal section when no goal has been set", async () => {
		const { factory } = createSupervisorLikeExtension();

		const harness = await createHarness({ extensionFactories: [factory] });
		harnesses.push(harness);

		let providerSystemPrompt = "";
		harness.setResponses([
			(context) => {
				providerSystemPrompt = context.systemPrompt ?? "";
				return fauxAssistantMessage("done");
			},
		]);

		await harness.session.prompt("hello");

		expect(providerSystemPrompt).not.toContain("Active Goal");
	});

	// ── Phase 2: agent_end lifecycle with callLLM ──

	it("transitions goal through checking to complete when model check says done", async () => {
		const { controller, factory } = createSupervisorLikeExtension();
		controller.setGoal("Write unit tests");

		const harness = await createHarness({ extensionFactories: [factory] });
		harnesses.push(harness);

		harness.setResponses([
			// Main agent response
			fauxAssistantMessage("I wrote all the unit tests."),
			// callLLM response from agent_end
			fauxAssistantMessage('{"completed": true, "confidence": 0.9}'),
		]);

		await harness.session.prompt("write tests");

		expect(controller.getGoalStatusLog()).toContainEqual(expect.objectContaining({ status: "checking" }));
		expect(controller.getGoalStatusLog()).toContainEqual(expect.objectContaining({ status: "complete" }));
		expect(controller.getGoal()?.status).toBe("complete");
	});

	it("keeps goal running when model check says incomplete", async () => {
		const { controller, factory } = createSupervisorLikeExtension();
		controller.setGoal("Fix all lint errors");

		const harness = await createHarness({ extensionFactories: [factory] });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage("I fixed some of the lint errors."),
			fauxAssistantMessage('{"completed": false, "confidence": 0.8}'),
		]);

		await harness.session.prompt("fix lint errors");

		expect(controller.getGoalStatusLog()).toContainEqual(expect.objectContaining({ status: "checking" }));
		expect(controller.getGoal()?.status).toBe("running");
	});

	// ── Phase 3: full lifecycle - running -> checking -> complete -> no injection ──

	it("stops injecting after goal transitions to complete", async () => {
		const { controller, factory } = createSupervisorLikeExtension();
		controller.setGoal("Refactor database layer");

		const harness = await createHarness({ extensionFactories: [factory] });
		harnesses.push(harness);

		// First turn: goal is running, should inject
		let firstPrompt = "";
		harness.setResponses([
			(context) => {
				firstPrompt = context.systemPrompt ?? "";
				return fauxAssistantMessage("done refactoring");
			},
			// callLLM from agent_end: task complete
			fauxAssistantMessage('{"completed": true, "confidence": 0.95}'),
		]);

		await harness.session.prompt("refactor it");

		expect(firstPrompt).toContain("Active Goal");
		expect(firstPrompt).toContain("Refactor database layer");
		expect(controller.getGoal()?.status).toBe("complete");

		// Second turn: goal is complete, should NOT inject
		let secondPrompt = "";
		harness.setResponses([
			(context) => {
				secondPrompt = context.systemPrompt ?? "";
				return fauxAssistantMessage("next task");
			},
		]);

		await harness.session.prompt("next");

		expect(secondPrompt).not.toContain("Active Goal");
	});

	// ── Phase 4: clearGoal ──

	it("clearGoal cancels the active goal and stops injection", async () => {
		const { controller, factory } = createSupervisorLikeExtension();
		controller.setGoal("Build the feature");

		const harness = await createHarness({ extensionFactories: [factory] });
		harnesses.push(harness);

		expect(controller.getGoal()?.status).toBe("running");

		controller.clearGoal();
		expect(controller.getGoal()).toBeUndefined();

		// Verify no injection in next turn
		let providerSystemPrompt = "";
		harness.setResponses([
			(context) => {
				providerSystemPrompt = context.systemPrompt ?? "";
				return fauxAssistantMessage("ok");
			},
		]);

		await harness.session.prompt("hello");

		expect(providerSystemPrompt).not.toContain("Active Goal");
	});

	it("can complete goal one, clear it, then activate and check goal two", async () => {
		const { controller, factory } = createSupervisorLikeExtension();
		controller.setGoal("Create goal-one.txt");

		const harness = await createHarness({ extensionFactories: [factory] });
		harnesses.push(harness);

		let firstPrompt = "";
		harness.setResponses([
			(context) => {
				firstPrompt = context.systemPrompt ?? "";
				return fauxAssistantMessage("Created goal-one.txt");
			},
			fauxAssistantMessage('{"completed": true, "confidence": 0.91}'),
		]);

		await harness.session.prompt("run goal one");

		expect(firstPrompt).toContain("Active Goal");
		expect(firstPrompt).toContain("Create goal-one.txt");
		expect(controller.getGoal()?.status).toBe("complete");
		expect(controller.getTriggerHistory()).toHaveLength(1);
		expect(controller.getTriggerHistory()[0]!.verdict).toBe("complete");

		controller.clearGoal();
		expect(controller.getGoal()).toBeUndefined();

		controller.setGoal("Create goal-two.txt");

		let secondPrompt = "";
		harness.setResponses([
			(context) => {
				secondPrompt = context.systemPrompt ?? "";
				return fauxAssistantMessage("Created goal-two.txt");
			},
			fauxAssistantMessage('{"completed": true, "confidence": 0.93}'),
		]);

		await harness.session.prompt("run goal two");

		expect(secondPrompt).toContain("Active Goal");
		expect(secondPrompt).toContain("Create goal-two.txt");
		expect(secondPrompt).not.toContain("Create goal-one.txt");
		expect(controller.getGoal()?.objective).toBe("Create goal-two.txt");
		expect(controller.getGoal()?.status).toBe("complete");

		const history = controller.getTriggerHistory();
		expect(history).toHaveLength(2);
		expect(history[1]!.seq).toBe(2);
		expect(history[1]!.verdict).toBe("complete");
		expect(history[1]!.confidence).toBe(0.93);
	});

	// ── Phase 5: supervisor_complete tool ──

	it("supervisor_complete tool approves when no guards block", async () => {
		const { controller, factory } = createSupervisorLikeExtension();
		controller.setGoal("Add logging");

		const harness = await createHarness({ extensionFactories: [factory] });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("supervisor_complete", { summary: "Added logging to all modules" }, { id: "call-sc" }),
			),
			fauxAssistantMessage("All done with logging."),
			// callLLM from agent_end
			fauxAssistantMessage('{"completed": true, "confidence": 0.95}'),
		]);

		await harness.session.prompt("add logging");

		const toolResultMessages = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResultMessages).toHaveLength(1);
		const resultText = (toolResultMessages[0]!.content as Array<{ type: string; text?: string }>)
			.filter((c) => c.type === "text")
			.map((c) => c.text ?? "")
			.join("");
		expect(resultText).toContain("approved");
	});

	it("supervisor_complete tool blocks when keyword guard detects incomplete work", async () => {
		const { controller, factory } = createSupervisorLikeExtension({
			guards: [{ name: "test-keyword", type: "keyword", enable: true, keywords: ["TODO"] }],
		});
		controller.setGoal("Remove all TODOs");

		const harness = await createHarness({ extensionFactories: [factory] });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("supervisor_complete", { summary: "I still have TODO items to fix" }, { id: "call-sc" }),
			),
			fauxAssistantMessage("Let me continue fixing TODOs."),
			// callLLM from agent_end
			fauxAssistantMessage('{"completed": false, "confidence": 0.8}'),
		]);

		await harness.session.prompt("remove all todos");

		const toolResultMessages = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResultMessages).toHaveLength(1);
		const resultText = (toolResultMessages[0]!.content as Array<{ type: string; text?: string }>)
			.filter((c) => c.type === "text")
			.map((c) => c.text ?? "")
			.join("");
		expect(resultText).toContain("Blocked");
	});

	// ── Phase 6: keyword guard + agent_end ──

	it("keyword guard in agent_end does not affect goal when keywords absent", async () => {
		const { controller, factory } = createSupervisorLikeExtension({
			guards: [{ name: "test-keyword", type: "keyword", enable: true, keywords: ["TODO", "FIXME"] }],
		});
		controller.setGoal("Remove all TODOs");

		const harness = await createHarness({ extensionFactories: [factory] });
		harnesses.push(harness);

		harness.setResponses([
			// No keywords in this response
			fauxAssistantMessage("I have removed all the pending items from the codebase."),
			// callLLM: complete
			fauxAssistantMessage('{"completed": true, "confidence": 0.9}'),
		]);

		await harness.session.prompt("remove all todos");

		expect(controller.getGoal()?.status).toBe("complete");
	});

	// ── Phase 7: idle-time setGoal triggers turn via sendMessage ──

	it("setGoal during idle triggers a new turn with goal injected", async () => {
		const { controller, factory } = createSupervisorLikeExtension();

		const harness = await createHarness({ extensionFactories: [factory] });
		harnesses.push(harness);

		// First turn: no goal, normal interaction
		let firstPrompt = "";
		harness.setResponses([
			(context) => {
				firstPrompt = context.systemPrompt ?? "";
				return fauxAssistantMessage("idle response");
			},
		]);

		await harness.session.prompt("hello");
		expect(firstPrompt).not.toContain("Active Goal");

		// Now set goal while idle (simulates channel call from frontend)
		controller.setGoal("Fix the CI pipeline");

		// setGoal in production triggers sendMessage({ triggerTurn: true }).
		// In the test we simulate that by sending a follow-up prompt that
		// represents the auto-triggered turn.
		let secondPrompt = "";
		harness.setResponses([
			(context) => {
				secondPrompt = context.systemPrompt ?? "";
				return fauxAssistantMessage("fixing CI now");
			},
			// callLLM from agent_end
			fauxAssistantMessage('{"completed": true, "confidence": 0.9}'),
		]);

		await harness.session.prompt("Goal activated: Fix the CI pipeline");

		expect(secondPrompt).toContain("Active Goal");
		expect(secondPrompt).toContain("Fix the CI pipeline");
		expect(controller.getGoal()?.status).toBe("complete");
	});

	// ── Phase 8: session_start restores running goal and triggers turn ──

	it("session_start resumes a persisted running goal by triggering a turn", async () => {
		const { controller, factory } = createSupervisorLikeExtension();

		// Simulate a goal that was persisted before session restart
		const persistedGoal: GoalState = {
			id: "goal_abc123",
			objective: "Deploy to staging",
			status: "running",
			startedAt: Date.now() - 60000,
			updatedAt: Date.now() - 60000,
			continuationCount: 2,
			blockers: [],
		};
		controller.restoreGoal(persistedGoal);

		// Create harness (triggers session_start) - goal is already restored
		const harness = await createHarness({ extensionFactories: [factory] });
		harnesses.push(harness);

		// In production, session_start would call sendMessage({ triggerTurn: true }).
		// We simulate that triggered turn.
		let resumedPrompt = "";
		harness.setResponses([
			(context) => {
				resumedPrompt = context.systemPrompt ?? "";
				return fauxAssistantMessage("deploying to staging now");
			},
			// callLLM from agent_end: complete
			fauxAssistantMessage('{"completed": true, "confidence": 0.95}'),
		]);

		await harness.session.prompt("Resuming goal: Deploy to staging");

		expect(resumedPrompt).toContain("Active Goal");
		expect(resumedPrompt).toContain("Deploy to staging");
		expect(controller.getGoal()?.status).toBe("complete");
	});

	it("session_start does not trigger turn for completed goal", async () => {
		const { controller, factory } = createSupervisorLikeExtension();

		// Simulate a goal that was already completed before session restart
		const completedGoal: GoalState = {
			id: "goal_xyz789",
			objective: "Write documentation",
			status: "complete",
			startedAt: Date.now() - 120000,
			updatedAt: Date.now() - 60000,
			continuationCount: 1,
			blockers: [],
		};
		controller.restoreGoal(completedGoal);

		const harness = await createHarness({ extensionFactories: [factory] });
		harnesses.push(harness);

		let prompt = "";
		harness.setResponses([
			(context) => {
				prompt = context.systemPrompt ?? "";
				return fauxAssistantMessage("hello");
			},
		]);

		await harness.session.prompt("hello");

		expect(prompt).not.toContain("Active Goal");
	});

	// ── Phase 9: trigger history ──

	it("records trigger history with timing when goal completes", async () => {
		const { controller, factory } = createSupervisorLikeExtension();
		controller.setGoal("Write unit tests");

		const harness = await createHarness({ extensionFactories: [factory] });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage("I wrote all the unit tests."),
			fauxAssistantMessage('{"completed": true, "confidence": 0.9}'),
		]);

		await harness.session.prompt("write tests");

		const history = controller.getTriggerHistory();
		expect(history).toHaveLength(1);

		const record = history[0]!;
		expect(record.seq).toBe(1);
		expect(record.verdict).toBe("complete");
		expect(record.confidence).toBe(0.9);
		expect(record.action).toBe("idle");
		expect(record.durationMs).toBeGreaterThanOrEqual(0);
		expect(record.startedAt).toBeLessThanOrEqual(record.finishedAt);
		expect(record.finishedAt - record.startedAt).toBe(record.durationMs);
		expect(record.modelCheck).toBeDefined();
		expect(record.modelCheck!.passed).toBe(true);
		expect(record.modelCheck!.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("records trigger history with incomplete verdict", async () => {
		const { controller, factory } = createSupervisorLikeExtension();
		controller.setGoal("Fix all lint errors");

		const harness = await createHarness({ extensionFactories: [factory] });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage("I fixed some of the lint errors."),
			fauxAssistantMessage('{"completed": false, "confidence": 0.8}'),
		]);

		await harness.session.prompt("fix lint errors");

		const history = controller.getTriggerHistory();
		expect(history).toHaveLength(1);

		const record = history[0]!;
		expect(record.seq).toBe(1);
		expect(record.verdict).toBe("incomplete");
		expect(record.confidence).toBe(0.8);
		expect(record.action).toBe("continue");
		expect(record.reason).toBe("Model detected incomplete tasks");
		expect(record.modelCheck).toBeDefined();
		expect(record.modelCheck!.passed).toBe(false);
	});

	it("records keyword guard results in trigger history", async () => {
		const { controller, factory } = createSupervisorLikeExtension({
			guards: [{ name: "test-keyword", type: "keyword", enable: true, keywords: ["TODO"] }],
		});
		controller.setGoal("Remove all TODOs");

		const harness = await createHarness({ extensionFactories: [factory] });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage("I still have some TODO items to handle."),
			fauxAssistantMessage('{"completed": false, "confidence": 0.7}'),
		]);

		await harness.session.prompt("remove todos");

		const history = controller.getTriggerHistory();
		expect(history).toHaveLength(1);

		const record = history[0]!;
		expect(record.guardResults).toHaveLength(1);
		expect(record.guardResults[0]!.guardName).toBe("test-keyword");
		expect(record.guardResults[0]!.passed).toBe(false);
		expect(record.guardResults[0]!.remainingItems).toHaveLength(1);
		expect(record.guardResults[0]!.remainingItems[0]).toContain("TODO");
		expect(record.guardResults[0]!.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("records keyword guard passing in trigger history", async () => {
		const { controller, factory } = createSupervisorLikeExtension({
			guards: [{ name: "test-keyword", type: "keyword", enable: true, keywords: ["TODO", "FIXME"] }],
		});
		controller.setGoal("Remove all TODOs");

		const harness = await createHarness({ extensionFactories: [factory] });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage("I have removed all the pending items from the codebase."),
			fauxAssistantMessage('{"completed": true, "confidence": 0.9}'),
		]);

		await harness.session.prompt("remove all todos");

		const history = controller.getTriggerHistory();
		expect(history).toHaveLength(1);

		const record = history[0]!;
		expect(record.guardResults).toHaveLength(1);
		expect(record.guardResults[0]!.passed).toBe(true);
		expect(record.guardResults[0]!.remainingItems).toHaveLength(0);
	});

	it("accumulates multiple trigger records across turns", async () => {
		const { controller, factory } = createSupervisorLikeExtension();
		controller.setGoal("Multi-step task");

		const harness = await createHarness({ extensionFactories: [factory] });
		harnesses.push(harness);

		// First turn: incomplete
		harness.setResponses([
			fauxAssistantMessage("Working on step 1."),
			fauxAssistantMessage('{"completed": false, "confidence": 0.6}'),
		]);

		await harness.session.prompt("do the task");

		// Second turn: complete
		harness.setResponses([
			fauxAssistantMessage("All steps done."),
			fauxAssistantMessage('{"completed": true, "confidence": 0.95}'),
		]);

		await harness.session.prompt("continue");

		const history = controller.getTriggerHistory();
		expect(history).toHaveLength(2);

		expect(history[0]!.seq).toBe(1);
		expect(history[0]!.verdict).toBe("incomplete");
		expect(history[0]!.action).toBe("continue");

		expect(history[1]!.seq).toBe(2);
		expect(history[1]!.verdict).toBe("complete");
		expect(history[1]!.action).toBe("idle");

		// Verify timing is non-negative and sequential
		expect(history[0]!.durationMs).toBeGreaterThanOrEqual(0);
		expect(history[1]!.durationMs).toBeGreaterThanOrEqual(0);
		expect(history[1]!.startedAt).toBeGreaterThanOrEqual(history[0]!.finishedAt);
	});

	// ── Phase 10: Stagnation detection ──

	it("detects stagnation when same guard results repeat and stops loop", async () => {
		const { controller, factory } = createSupervisorLikeExtension({
			guards: [{ name: "test-keyword", type: "keyword", enable: true, keywords: ["TODO"] }],
		});
		controller.setGoal("Remove all TODOs");

		const harness = await createHarness({ extensionFactories: [factory] });
		harnesses.push(harness);

		// Turn 1: keyword guard finds "TODO", stagnationCount = 0 (first occurrence)
		harness.setResponses([
			fauxAssistantMessage("I still have TODO items to fix."),
			fauxAssistantMessage('{"completed": false, "confidence": 0.7}'),
		]);
		await harness.session.prompt("remove todos");

		let history = controller.getTriggerHistory();
		expect(history).toHaveLength(1);
		expect(history[0]!.verdict).toBe("incomplete");
		expect(history[0]!.action).toBe("continue");

		// Turn 2: same keyword guard finds "TODO" again, stagnationCount = 1
		harness.setResponses([
			fauxAssistantMessage("I still have TODO items to fix."),
			fauxAssistantMessage('{"completed": false, "confidence": 0.7}'),
		]);
		await harness.session.prompt("continue");

		history = controller.getTriggerHistory();
		expect(history).toHaveLength(2);
		expect(history[1]!.verdict).toBe("incomplete");
		expect(history[1]!.action).toBe("continue");

		// Turn 3: same keyword guard finds "TODO" again, stagnationCount = 2 → blocked
		harness.setResponses([
			fauxAssistantMessage("I still have TODO items to fix."),
			fauxAssistantMessage('{"completed": false, "confidence": 0.6}'),
		]);
		await harness.session.prompt("continue");

		history = controller.getTriggerHistory();
		expect(history).toHaveLength(3);
		expect(history[2]!.verdict).toBe("blocked");
		expect(history[2]!.action).toBe("idle");
		expect(history[2]!.reason).toContain("Stagnation");
		expect(controller.getGoal()?.status).toBe("blocked");
	});

	it("resets stagnation count when guard results change", async () => {
		const { controller, factory } = createSupervisorLikeExtension({
			guards: [{ name: "test-keyword", type: "keyword", enable: true, keywords: ["TODO", "FIXME"] }],
		});
		controller.setGoal("Remove all TODOs and FIXMEs");

		const harness = await createHarness({ extensionFactories: [factory] });
		harnesses.push(harness);

		// Turn 1: finds TODO + FIXME
		harness.setResponses([
			fauxAssistantMessage("I have TODO and FIXME items to fix."),
			fauxAssistantMessage('{"completed": false, "confidence": 0.7}'),
		]);
		await harness.session.prompt("remove all");

		expect(controller.getTriggerHistory()).toHaveLength(1);
		expect(controller.getTriggerHistory()[0]!.verdict).toBe("incomplete");

		// Turn 2: finds only TODO (progress!), stagnation resets
		harness.setResponses([
			fauxAssistantMessage("I still have TODO items to fix."),
			fauxAssistantMessage('{"completed": false, "confidence": 0.8}'),
		]);
		await harness.session.prompt("continue");

		expect(controller.getTriggerHistory()).toHaveLength(2);
		expect(controller.getTriggerHistory()[1]!.verdict).toBe("incomplete");

		// Turn 3: finds only TODO again, stagnationCount = 1 (not blocked yet)
		harness.setResponses([
			fauxAssistantMessage("I still have TODO items to fix."),
			fauxAssistantMessage('{"completed": false, "confidence": 0.8}'),
		]);
		await harness.session.prompt("continue");

		expect(controller.getTriggerHistory()).toHaveLength(3);
		expect(controller.getTriggerHistory()[2]!.verdict).toBe("incomplete");
		expect(controller.getGoal()?.status).toBe("running"); // not blocked yet

		// Turn 4: same again, stagnationCount = 2 → blocked
		harness.setResponses([
			fauxAssistantMessage("I still have TODO items to fix."),
			fauxAssistantMessage('{"completed": false, "confidence": 0.7}'),
		]);
		await harness.session.prompt("continue");

		expect(controller.getTriggerHistory()).toHaveLength(4);
		expect(controller.getTriggerHistory()[3]!.verdict).toBe("blocked");
		expect(controller.getGoal()?.status).toBe("blocked");
	});
});

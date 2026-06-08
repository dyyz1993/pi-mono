import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { GoalState, GuardConfig } from "../../extensions/session-supervisor/types.ts";
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
		},
		clearGoal() {
			if (activeGoal) {
				activeGoal = { ...activeGoal, status: "cancelled", updatedAt: Date.now() };
			}
			activeGoal = undefined;
		},
		getGoal: () => activeGoal,
		getGoalStatusLog: () => goalStatusLog,
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

				// Use callLLM for model-based completion check (same as real supervisor)
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

				try {
					const cleaned = modelResponse
						.replace(/```json?\n?/g, "")
						.replace(/\n?```/g, "")
						.trim();
					const parsed = JSON.parse(cleaned);
					if (parsed.completed) {
						activeGoal = { ...activeGoal, status: "complete", updatedAt: Date.now() };
						goalStatusLog.push({ status: "complete", at: Date.now() });
					} else {
						activeGoal = { ...activeGoal, status: "running", updatedAt: Date.now() };
						goalStatusLog.push({ status: "running", at: Date.now() });
					}
				} catch {
					activeGoal = { ...activeGoal, status: "complete", updatedAt: Date.now() };
					goalStatusLog.push({ status: "complete", at: Date.now() });
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
});

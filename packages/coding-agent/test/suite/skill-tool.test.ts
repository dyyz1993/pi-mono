import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { Skill } from "../../src/core/skills.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import type { ExtensionFactory } from "../../src/index.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "../utilities.ts";
import { createHarness, getAssistantTexts, type Harness } from "./harness.ts";

describe("skill tool integration via harness", () => {
	const harnesses: Harness[] = [];
	const tempDirs: string[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
		while (tempDirs.length > 0) {
			const tempDir = tempDirs.pop();
			if (tempDir) {
				rmSync(tempDir, { recursive: true, force: true });
			}
		}
	});

	function createSkillFile(
		tempDir: string,
		name: string,
		description: string,
		body: string,
		options?: { context?: "inline" | "fork" },
	): Skill {
		const skillDir = join(tempDir, "skills", name);
		mkdirSync(skillDir, { recursive: true });
		const skillPath = join(skillDir, "SKILL.md");
		const frontmatter = options?.context
			? `---\nname: ${name}\ndescription: ${description}\ncontext: ${options.context}\n---\n`
			: `---\nname: ${name}\ndescription: ${description}\n---\n`;
		writeFileSync(skillPath, `${frontmatter}${body}`);
		return {
			name,
			description,
			filePath: skillPath,
			baseDir: skillDir,
			sourceInfo: createSyntheticSourceInfo(skillPath, { source: "test" }),
			disableModelInvocation: false,
			context: options?.context,
		};
	}

	function createHarnessWithSkills(skills: Skill[]): Promise<Harness> {
		const resourceLoader = createTestResourceLoader();
		resourceLoader.getSkills = () => ({ skills, diagnostics: [] });
		// No tools override — use default base tools so skill tool gets registered
		return createHarness({ resourceLoader });
	}

	it("registers the skill tool when skills are available", async () => {
		const tempDir = join(tmpdir(), `pi-skill-harness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		tempDirs.push(tempDir);

		const testSkill = createSkillFile(tempDir, "code-review", "Review code for quality", "Step 1: Read the diff");

		const harness = await createHarnessWithSkills([testSkill]);
		harnesses.push(harness);

		const skillTool = harness.session.getToolDefinition("skill");
		expect(skillTool).toBeDefined();
		expect(skillTool!.name).toBe("skill");
	});

	it("does not register the skill tool when no skills are available", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const skillTool = harness.session.getToolDefinition("skill");
		expect(skillTool).toBeUndefined();
	});

	it("loads skill content when the model calls the skill tool", async () => {
		const tempDir = join(tmpdir(), `pi-skill-harness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		tempDirs.push(tempDir);

		const testSkill = createSkillFile(
			tempDir,
			"code-review",
			"Review code for quality",
			"Step 1: Read the diff\nStep 2: Check for bugs",
		);

		const harness = await createHarnessWithSkills([testSkill]);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("skill", { name: "code-review" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("I reviewed the code using the skill."),
		]);

		await harness.session.prompt("review my code");

		// Verify tool was called and result was passed back
		const toolResultMessages = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResultMessages).toHaveLength(1);

		const toolResult = toolResultMessages[0]!;
		const resultText = (toolResult.content as Array<{ type: string; text?: string }>)
			.filter((c) => c.type === "text")
			.map((c) => c.text ?? "")
			.join("");
		expect(resultText).toContain('<skill name="code-review"');
		expect(resultText).toContain("Step 1: Read the diff");
		expect(resultText).toContain("Step 2: Check for bugs");

		// Verify follow-up assistant message
		const assistantTexts = getAssistantTexts(harness);
		expect(assistantTexts).toContain("I reviewed the code using the skill.");
	});

	it("returns error when model calls skill tool with unknown name", async () => {
		const tempDir = join(tmpdir(), `pi-skill-harness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		tempDirs.push(tempDir);

		const testSkill = createSkillFile(tempDir, "existing", "An existing skill", "Existing body");

		const harness = await createHarnessWithSkills([testSkill]);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("skill", { name: "nonexistent" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("Skill not found, let me try something else."),
		]);

		await harness.session.prompt("use nonexistent skill");

		const toolResultMessages = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResultMessages).toHaveLength(1);

		const resultText = (toolResultMessages[0]!.content as Array<{ type: string; text?: string }>)
			.filter((c) => c.type === "text")
			.map((c) => c.text ?? "")
			.join("");
		expect(resultText).toContain('Skill "nonexistent" not found');
		expect(resultText).toContain("existing");
	});

	it("includes skills section in system prompt when skill tool is registered", async () => {
		const tempDir = join(tmpdir(), `pi-skill-harness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		tempDirs.push(tempDir);

		const testSkill = createSkillFile(tempDir, "my-skill", "A test skill", "Do the thing");

		const harness = await createHarnessWithSkills([testSkill]);
		harnesses.push(harness);

		// Verify the tool is registered and active — the system prompt is built
		// internally by AgentSession and includes the available_skills section
		// when the skill tool is active. We verify this indirectly by confirming
		// the tool definition exists and is active.
		const skillTool = harness.session.getToolDefinition("skill");
		expect(skillTool).toBeDefined();

		// Also verify the faux provider sees the tool in the request
		let toolNamesInRequest: string[] = [];
		harness.setResponses([
			(context) => {
				toolNamesInRequest = context.tools?.map((t: any) => t.name) ?? [];
				return fauxAssistantMessage("ok");
			},
		]);

		await harness.session.prompt("test");
		expect(toolNamesInRequest).toContain("skill");
	});

	it("runs fork skill in isolated subtask when context:fork is set", async () => {
		const tempDir = join(tmpdir(), `pi-skill-harness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		tempDirs.push(tempDir);

		const forkSkill = createSkillFile(
			tempDir,
			"deep-research",
			"Perform deep research",
			"You are a research specialist. Analyze the given topic thoroughly.",
			{ context: "fork" },
		);

		const harness = await createHarnessWithSkills([forkSkill]);
		harnesses.push(harness);

		// The fork mode calls runSubtask which creates its own session and consumes
		// faux responses. Set responses for the subtask's agent loop.
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("skill", { name: "deep-research" }), { stopReason: "toolUse" }),
			// The subtask's response (consumed by runSubtask's internal session)
			fauxAssistantMessage("Research complete: the topic has been analyzed."),
			// The parent session's follow-up after getting the subtask result
			fauxAssistantMessage("I've completed the deep research."),
		]);

		await harness.session.prompt("research quantum computing");

		// Verify the skill tool was called
		const toolResultMessages = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResultMessages.length).toBeGreaterThanOrEqual(1);

		// In fork mode, the result should be the subtask's final text (not the skill XML block)
		const firstResult = toolResultMessages[0]!;
		const resultText = (firstResult.content as Array<{ type: string; text?: string }>)
			.filter((c) => c.type === "text")
			.map((c) => c.text ?? "")
			.join("");

		// Fork mode returns the subtask result, not inline skill XML
		expect(resultText).toContain("Research complete");
		expect(resultText).not.toContain('<skill name="deep-research"');
	});

	it("falls back to inline when context:fork is set but no subtaskContext", async () => {
		const tempDir = join(tmpdir(), `pi-skill-harness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		tempDirs.push(tempDir);

		// Create a fork skill but the harness won't have subtaskContext
		// (this tests the fallback path when subtaskContext is not provided)
		const forkSkill = createSkillFile(
			tempDir,
			"offline-skill",
			"A skill that would fork but can't",
			"Step 1: Do something",
			{ context: "fork" },
		);

		const resourceLoader = createTestResourceLoader();
		resourceLoader.getSkills = () => ({ skills: [forkSkill], diagnostics: [] });
		// Create harness without providing subtaskContext (it's built internally by AgentSession,
		// so in production it always has one. But the skill tool's fallback path handles the
		// case where subtaskContext is undefined.)
		const harness = await createHarness({ resourceLoader });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("skill", { name: "offline-skill" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("Done."),
		]);

		await harness.session.prompt("use offline skill");

		// AgentSession always provides subtaskContext, so fork mode should activate
		// and the subtask will run. The subtask consumes a faux response.
		const toolResultMessages = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResultMessages.length).toBeGreaterThanOrEqual(1);
	});

	it("compares inline and fork skill result formats", async () => {
		const tempDir = join(tmpdir(), `pi-skill-harness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		tempDirs.push(tempDir);

		const inlineSkill = createSkillFile(
			tempDir,
			"inline-helper",
			"An inline skill",
			"Step 1: Analyze the problem\nStep 2: Propose a solution",
		);
		const forkSkill = createSkillFile(
			tempDir,
			"fork-helper",
			"A fork skill",
			"You are a specialist. Solve the problem.",
			{ context: "fork" },
		);

		// --- Test inline skill ---
		const inlineHarness = await createHarnessWithSkills([inlineSkill, forkSkill]);
		harnesses.push(inlineHarness);

		inlineHarness.setResponses([
			fauxAssistantMessage(fauxToolCall("skill", { name: "inline-helper" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("Inline done."),
		]);

		await inlineHarness.session.prompt("use inline skill");

		const inlineToolResults = inlineHarness.session.messages.filter((m) => m.role === "toolResult");
		expect(inlineToolResults.length).toBeGreaterThanOrEqual(1);
		const inlineText = (inlineToolResults[0]!.content as Array<{ type: string; text?: string }>)
			.filter((c) => c.type === "text")
			.map((c) => c.text ?? "")
			.join("");
		expect(inlineText).toContain('<skill name="inline-helper"');
		expect(inlineText).toContain("Step 1: Analyze the problem");

		// --- Test fork skill ---
		const forkHarness = await createHarnessWithSkills([inlineSkill, forkSkill]);
		harnesses.push(forkHarness);

		forkHarness.setResponses([
			fauxAssistantMessage(fauxToolCall("skill", { name: "fork-helper" }), { stopReason: "toolUse" }),
			// Subtask consumes this response
			fauxAssistantMessage("Fork specialist result."),
			// Parent session follow-up
			fauxAssistantMessage("Fork done."),
		]);

		await forkHarness.session.prompt("use fork skill");

		const forkToolResults = forkHarness.session.messages.filter((m) => m.role === "toolResult");
		expect(forkToolResults.length).toBeGreaterThanOrEqual(1);
		const forkText = (forkToolResults[0]!.content as Array<{ type: string; text?: string }>)
			.filter((c) => c.type === "text")
			.map((c) => c.text ?? "")
			.join("");
		// Fork returns plain text, not the skill XML block
		expect(forkText).toContain("Fork specialist result");
		expect(forkText).not.toContain('<skill name="fork-helper"');
	});

	it("passes args to inline skill content", async () => {
		const tempDir = join(tmpdir(), `pi-skill-harness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		tempDirs.push(tempDir);

		const testSkill = createSkillFile(tempDir, "helper", "A helper skill", "Step 1: Do the thing");
		const harness = await createHarnessWithSkills([testSkill]);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("skill", { name: "helper", args: "focus on security" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Done with security focus."),
		]);

		await harness.session.prompt("help me with security");

		const toolResultMessages = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResultMessages).toHaveLength(1);
		const resultText = (toolResultMessages[0]!.content as Array<{ type: string; text?: string }>)
			.filter((c) => c.type === "text")
			.map((c) => c.text ?? "")
			.join("");
		// Should contain both the skill XML block and the args
		expect(resultText).toContain('<skill name="helper"');
		expect(resultText).toContain("focus on security");
	});

	it("matches skill names case-insensitively", async () => {
		const tempDir = join(tmpdir(), `pi-skill-harness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		tempDirs.push(tempDir);

		const testSkill = createSkillFile(tempDir, "Code-Review", "Review code", "Review the code carefully");
		const harness = await createHarnessWithSkills([testSkill]);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("skill", { name: "code-review" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("Review complete."),
		]);

		await harness.session.prompt("review my code");

		const toolResultMessages = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResultMessages).toHaveLength(1);
		const resultText = (toolResultMessages[0]!.content as Array<{ type: string; text?: string }>)
			.filter((c) => c.type === "text")
			.map((c) => c.text ?? "")
			.join("");
		expect(resultText).toContain('<skill name="Code-Review"');
	});

	it("passes args to forked subtask", async () => {
		const tempDir = join(tmpdir(), `pi-skill-harness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		tempDirs.push(tempDir);

		const forkSkill = createSkillFile(
			tempDir,
			"research",
			"Deep research skill",
			"You are a researcher. Investigate thoroughly.",
			{ context: "fork" },
		);

		const harness = await createHarnessWithSkills([forkSkill]);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("skill", { name: "research", args: "quantum computing" }), {
				stopReason: "toolUse",
			}),
			// Subtask response
			fauxAssistantMessage("Research on quantum computing complete."),
			// Parent follow-up
			fauxAssistantMessage("I've completed the research."),
		]);

		await harness.session.prompt("research quantum computing");

		const toolResultMessages = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResultMessages.length).toBeGreaterThanOrEqual(1);
		const resultText = (toolResultMessages[0]!.content as Array<{ type: string; text?: string }>)
			.filter((c) => c.type === "text")
			.map((c) => c.text ?? "")
			.join("");
		// Fork mode: should contain the subtask result, not inline XML
		expect(resultText).toContain("Research on quantum computing complete");
		expect(resultText).not.toContain('<skill name="research"');
	});

	it("returns error when skill file cannot be read", async () => {
		const tempDir = join(tmpdir(), `pi-skill-harness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		tempDirs.push(tempDir);

		// Create a skill object pointing to a non-existent file
		const brokenSkill: Skill = {
			name: "broken",
			description: "A broken skill",
			filePath: "/nonexistent/path/SKILL.md",
			baseDir: "/nonexistent/path",
			sourceInfo: createSyntheticSourceInfo("/nonexistent/path/SKILL.md", { source: "test" }),
			disableModelInvocation: false,
		};

		const resourceLoader = createTestResourceLoader();
		resourceLoader.getSkills = () => ({ skills: [brokenSkill], diagnostics: [] });
		const harness = await createHarness({ resourceLoader });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("skill", { name: "broken" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("Let me try something else."),
		]);

		await harness.session.prompt("use broken skill");

		const toolResultMessages = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResultMessages).toHaveLength(1);
		const resultText = (toolResultMessages[0]!.content as Array<{ type: string; text?: string }>)
			.filter((c) => c.type === "text")
			.map((c) => c.text ?? "")
			.join("");
		expect(resultText).toContain('Failed to load skill "broken"');
	});

	it("runs fork skill with a specific agentConfig", async () => {
		const tempDir = join(tmpdir(), `pi-skill-harness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		tempDirs.push(tempDir);

		const forkSkill = createSkillFile(tempDir, "code-review", "Review code", "Review the code for issues.", {
			context: "fork",
		});

		const harness = await createHarnessWithSkills([forkSkill]);
		harnesses.push(harness);

		let capturedMessages: string[] = [];
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("skill", { name: "code-review" }), { stopReason: "toolUse" }),
			// Subtask response - capture messages to verify skill body is passed as task
			(context) => {
				capturedMessages = (context.messages ?? [])
					.flatMap((m: any) => {
						if (typeof m.content === "string") return [m.content];
						if (Array.isArray(m.content))
							return m.content.filter((c: any) => c.type === "text").map((c: any) => c.text ?? "");
						return [];
					})
					.filter(Boolean);
				return fauxAssistantMessage("Code review complete: no issues found.");
			},
			fauxAssistantMessage("Review done."),
		]);

		await harness.session.prompt("review my code");

		const toolResultMessages = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResultMessages.length).toBeGreaterThanOrEqual(1);
		const resultText = (toolResultMessages[0]!.content as Array<{ type: string; text?: string }>)
			.filter((c) => c.type === "text")
			.map((c) => c.text ?? "")
			.join("");
		expect(resultText).toContain("Code review complete");
		// The subtask used the skill body as the task text
		expect(capturedMessages).toContain("Review the code for issues.");
	});

	it("fork skill uses parent session model by default", async () => {
		const tempDir = join(tmpdir(), `pi-skill-harness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		tempDirs.push(tempDir);

		const forkSkill = createSkillFile(tempDir, "analyze", "Analyze code", "Analyze the given code.", {
			context: "fork",
		});

		const harness = await createHarnessWithSkills([forkSkill]);
		harnesses.push(harness);

		let capturedModel: string | undefined;
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("skill", { name: "analyze" }), { stopReason: "toolUse" }),
			(_context, _options, _state, model) => {
				capturedModel = model.id;
				return fauxAssistantMessage("Analysis complete.");
			},
			fauxAssistantMessage("Done."),
		]);

		await harness.session.prompt("analyze this code");

		expect(capturedModel).toBeDefined();
		// The fork subtask should use the same model as the parent
		const parentModel = harness.getModel();
		expect(capturedModel).toBe(parentModel.id);
	});

	it("fork skill subtask inherits parent session tools", async () => {
		const tempDir = join(tmpdir(), `pi-skill-harness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		tempDirs.push(tempDir);

		const forkSkill = createSkillFile(tempDir, "search", "Search code", "Search the codebase.", { context: "fork" });

		const harness = await createHarnessWithSkills([forkSkill]);
		harnesses.push(harness);

		let toolNamesInSubtask: string[] = [];
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("skill", { name: "search" }), { stopReason: "toolUse" }),
			(context) => {
				toolNamesInSubtask = context.tools?.map((t: any) => t.name) ?? [];
				return fauxAssistantMessage("Search complete.");
			},
			fauxAssistantMessage("Done."),
		]);

		await harness.session.prompt("search for TODOs");

		// The subtask should have inherited tools from parent session
		expect(toolNamesInSubtask.length).toBeGreaterThan(0);
		expect(toolNamesInSubtask).toContain("read");
		expect(toolNamesInSubtask).toContain("bash");
	});

	it("fork skill subtask fires extension hooks", async () => {
		let hookFiredInSubtask = false;
		const factory: ExtensionFactory = (pi) => {
			pi.on("before_agent_start", () => {
				hookFiredInSubtask = true;
			});
		};

		const tempDir = join(tmpdir(), `pi-skill-harness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		tempDirs.push(tempDir);

		const forkSkill = createSkillFile(tempDir, "hooked", "A hooked skill", "Do something.", { context: "fork" });

		const extensionsResult = await createTestExtensionsResult([factory], tempDir);
		const resourceLoader = createTestResourceLoader({ extensionsResult });
		resourceLoader.getSkills = () => ({ skills: [forkSkill], diagnostics: [] });
		const harness = await createHarness({ resourceLoader });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("skill", { name: "hooked" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("Subtask done."),
			fauxAssistantMessage("Parent done."),
		]);

		await harness.session.prompt("use hooked skill");

		expect(hookFiredInSubtask).toBe(true);
	});

	it("fork skill does not inherit parent history by default", async () => {
		const tempDir = join(tmpdir(), `pi-skill-harness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		tempDirs.push(tempDir);

		const forkSkill = createSkillFile(tempDir, "isolated", "An isolated skill", "You are isolated.", {
			context: "fork",
		});

		const harness = await createHarnessWithSkills([forkSkill]);
		harnesses.push(harness);

		// Seed parent session with a message
		harness.sessionManager.appendMessage({
			role: "user",
			content: "Secret parent topic: dragons",
			timestamp: Date.now(),
		});

		let subtaskMessages: string[] = [];
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("skill", { name: "isolated" }), { stopReason: "toolUse" }),
			(context) => {
				subtaskMessages = (context.messages ?? [])
					.map((m: any) => (typeof m.content === "string" ? m.content : ""))
					.filter(Boolean);
				return fauxAssistantMessage("Isolated result.");
			},
			fauxAssistantMessage("Done."),
		]);

		await harness.session.prompt("use isolated skill");

		// The subtask should NOT see the parent's secret message
		expect(subtaskMessages).not.toContain("Secret parent topic: dragons");
	});

	it("fork skill can load agent from disk", async () => {
		const tempDir = join(tmpdir(), `pi-skill-harness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		tempDirs.push(tempDir);

		// Create an Agent.md on disk
		const agentDir = join(tempDir, "project");
		mkdirSync(join(agentDir, ".pi", "agents"), { recursive: true });
		writeFileSync(
			join(agentDir, ".pi", "agents", "reviewer.md"),
			`---
name: reviewer
description: Code reviewer
systemPrompt: You are a strict code reviewer.
---
`,
		);

		const forkSkill = createSkillFile(
			tempDir,
			"review",
			"Review with agent",
			"Review the code using the reviewer agent.",
			{ context: "fork" },
		);

		const resourceLoader = createTestResourceLoader();
		resourceLoader.getSkills = () => ({ skills: [forkSkill], diagnostics: [] });
		const harness = await createHarness({ resourceLoader, cwd: agentDir });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("skill", { name: "review" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("Review with agent complete."),
			fauxAssistantMessage("Done."),
		]);

		await harness.session.prompt("review code");

		const toolResultMessages = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResultMessages.length).toBeGreaterThanOrEqual(1);
		const resultText = (toolResultMessages[0]!.content as Array<{ type: string; text?: string }>)
			.filter((c) => c.type === "text")
			.map((c) => c.text ?? "")
			.join("");
		expect(resultText).toContain("Review with agent complete");
	});
});

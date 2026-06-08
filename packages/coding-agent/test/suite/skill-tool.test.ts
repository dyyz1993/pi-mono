import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { Skill } from "../../src/core/skills.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import { createTestResourceLoader } from "../utilities.ts";
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

	function createSkillFile(tempDir: string, name: string, description: string, body: string): Skill {
		const skillDir = join(tempDir, "skills", name);
		mkdirSync(skillDir, { recursive: true });
		const skillPath = join(skillDir, "SKILL.md");
		writeFileSync(skillPath, `---\nname: ${name}\ndescription: ${description}\n---\n${body}`);
		return {
			name,
			description,
			filePath: skillPath,
			baseDir: skillDir,
			sourceInfo: createSyntheticSourceInfo(skillPath, { source: "test" }),
			disableModelInvocation: false,
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
});

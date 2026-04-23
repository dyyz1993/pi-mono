import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import { fauxAssistantMessage } from "@dyyz1993/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../suite/harness.js";
import { type CallLLMFn, MemoryExtractor, MemoryPrefetch, serializeMessages } from "./auto-memory.js";
import { getMemoryDir } from "./utils.js";

describe("auto-memory integration", () => {
	let harness: Harness;
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `am-integ-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		harness?.cleanup();
		const memoryDir = getMemoryDir(tempDir);
		if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true, force: true });
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	});

	describe("session_start + before_agent_start", () => {
		it("creates memory dir and injects system prompt", async () => {
			const memoryDir = getMemoryDir(tempDir);
			harness = await createHarness({
				extensionFactories: [
					(pi) => {
						pi.on("session_start", async () => {
							const { mkdir } = await import("node:fs/promises");
							await mkdir(memoryDir, { recursive: true });
						});
						pi.on("before_agent_start", async (event) => {
							const { readFile } = await import("node:fs/promises");
							const { getEntrypointPath, truncateEntrypoint } = await import("./utils.js");
							const { MEMORY_SYSTEM_PROMPT } = await import("./prompts.js");
							let memoryContent = "";
							try {
								memoryContent = await readFile(getEntrypointPath(tempDir), "utf-8");
							} catch {}
							const truncated = truncateEntrypoint(memoryContent);
							const memoryPrompt = MEMORY_SYSTEM_PROMPT(memoryDir, truncated.content);
							return { systemPrompt: `${event.systemPrompt}\n\n${memoryPrompt}` };
						});
					},
				],
			});

			let capturedSystemPrompt = "";
			harness.setResponses([
				(ctx) => {
					capturedSystemPrompt = ctx.systemPrompt ?? "";
					return fauxAssistantMessage("done");
				},
			]);

			await harness.session.prompt("hello");

			expect(capturedSystemPrompt).toContain("auto memory");
			expect(capturedSystemPrompt).toContain("Types of memory");
			expect(capturedSystemPrompt).toContain("Your memory is currently empty");
		});

		it("includes MEMORY.md content when present", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(join(memoryDir, "MEMORY.md"), "- [Test](test.md) — some desc");

			harness = await createHarness({
				extensionFactories: [
					(pi) => {
						pi.on("before_agent_start", async (event) => {
							const { readFile } = await import("node:fs/promises");
							const { getEntrypointPath, truncateEntrypoint } = await import("./utils.js");
							const { MEMORY_SYSTEM_PROMPT } = await import("./prompts.js");
							let memoryContent = "";
							try {
								memoryContent = await readFile(getEntrypointPath(tempDir), "utf-8");
							} catch {}
							const truncated = truncateEntrypoint(memoryContent);
							return {
								systemPrompt: `${event.systemPrompt}\n\n${MEMORY_SYSTEM_PROMPT(memoryDir, truncated.content)}`,
							};
						});
					},
				],
			});

			let capturedSystemPrompt = "";
			harness.setResponses([
				(ctx) => {
					capturedSystemPrompt = ctx.systemPrompt ?? "";
					return fauxAssistantMessage("done");
				},
			]);

			await harness.session.prompt("hello");

			expect(capturedSystemPrompt).toContain("- [Test](test.md) — some desc");
			expect(capturedSystemPrompt).not.toContain("Your memory is currently empty");
		});
	});

	describe("MemoryPrefetch", () => {
		it("selects and reads relevant memory files", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(
				join(memoryDir, "testing.md"),
				"---\nname: Testing\ndescription: Test policy\ntype: feedback\n---\n\nNever mock DB.",
			);
			writeFileSync(
				join(memoryDir, "user_role.md"),
				"---\nname: Role\ndescription: User role\ntype: user\n---\n\nSenior dev.",
			);

			const callLLM: CallLLMFn = async (opts) => {
				expect(opts.systemPrompt).toContain("selecting memories");
				return JSON.stringify({ selected: ["testing.md"] });
			};

			const prefetch = new MemoryPrefetch();
			prefetch.start("tell me about testing", memoryDir, callLLM);

			await new Promise((r) => setTimeout(r, 100));
			const result = prefetch.collect();
			expect(result).toContain("testing.md");
			expect(result).toContain("Never mock DB");
			expect(result).not.toContain("Senior dev");
		});

		it("returns null when not settled", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });

			const callLLM: CallLLMFn = async () => {
				await new Promise((r) => setTimeout(r, 500));
				return JSON.stringify({ selected: [] });
			};

			const prefetch = new MemoryPrefetch();
			prefetch.start("query", memoryDir, callLLM);

			expect(prefetch.collect()).toBeNull();

			await new Promise((r) => setTimeout(r, 600));
			expect(prefetch.collect()).toBe("");
		});
	});

	describe("MemoryExtractor", () => {
		it("tracks when main agent writes to memory dir", () => {
			const memoryDir = getMemoryDir(tempDir);
			const extractor = new MemoryExtractor();

			extractor.onToolCall("write", { path: join(memoryDir, "topic.md") }, memoryDir);
			expect((extractor as unknown as { mainAgentWroteMemory: boolean }).mainAgentWroteMemory).toBe(true);
		});

		it("ignores writes outside memory dir", () => {
			const memoryDir = getMemoryDir(tempDir);
			const extractor = new MemoryExtractor();

			extractor.onToolCall("write", { path: join(tempDir, "output.txt") }, memoryDir);
			expect((extractor as unknown as { mainAgentWroteMemory: boolean }).mainAgentWroteMemory).toBe(false);
		});

		it("extracts memories via callLLM and writes files", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });

			const callLLM: CallLLMFn = async () => {
				return JSON.stringify({
					actions: [
						{
							op: "create",
							filename: "feedback_testing.md",
							name: "Testing Policy",
							description: "Never mock DB",
							type: "feedback",
							content: "Integration tests must use real DB.",
						},
					],
				});
			};

			const extractor = new MemoryExtractor();
			const messages = [
				{
					role: "user" as const,
					content: [{ type: "text" as const, text: "How should I test?" }],
					timestamp: Date.now(),
				},
				{
					role: "assistant" as const,
					content: [{ type: "text" as const, text: "Use real DB" }],
					timestamp: Date.now(),
				},
			] as AgentMessage[];

			await extractor.maybeExtract(messages, memoryDir, callLLM);
			await extractor.maybeExtract(messages, memoryDir, callLLM);

			const created = existsSync(join(memoryDir, "feedback_testing.md"));
			expect(created).toBe(true);

			if (created) {
				const content = readFileSync(join(memoryDir, "feedback_testing.md"), "utf-8");
				expect(content).toContain("Testing Policy");
				expect(content).toContain("Integration tests must use real DB");
			}
		});

		it("skips extraction when main agent wrote memory", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });

			let callCount = 0;
			const callLLM: CallLLMFn = async () => {
				callCount++;
				return JSON.stringify({ actions: [{ op: "skip" }] });
			};

			const extractor = new MemoryExtractor();
			extractor.onToolCall("write", { path: join(memoryDir, "topic.md") }, memoryDir);

			const messages = [
				{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }], timestamp: Date.now() },
			] as AgentMessage[];

			await extractor.maybeExtract(messages, memoryDir, callLLM);
			await extractor.maybeExtract(messages, memoryDir, callLLM);

			expect(callCount).toBe(0);
		});
	});

	describe("serializeMessages", () => {
		it("serializes user and assistant messages", () => {
			const messages = [
				{ role: "user" as const, content: [{ type: "text" as const, text: "hello" }], timestamp: 0 },
				{
					role: "assistant" as const,
					content: [{ type: "text" as const, text: "hi there" }],
					timestamp: 0,
				},
			] as AgentMessage[];

			const result = serializeMessages(messages);
			expect(result).toContain("[user]: hello");
			expect(result).toContain("[assistant]: hi there");
		});

		it("respects lastN option", () => {
			const messages = Array.from({ length: 10 }, (_, i) => ({
				role: "user" as const,
				content: [{ type: "text" as const, text: `msg ${i}` }],
				timestamp: 0,
			})) as AgentMessage[];

			const result = serializeMessages(messages, { lastN: 3 });
			expect(result).toContain("msg 7");
			expect(result).toContain("msg 8");
			expect(result).toContain("msg 9");
			expect(result).not.toContain("msg 6");
		});
	});

	describe("context event injection", () => {
		it("injects prefetched memories into context messages", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(
				join(memoryDir, "test.md"),
				"---\nname: Test\ndescription: test\ntype: feedback\n---\n\nSome content.",
			);

			harness = await createHarness({
				extensionFactories: [
					(pi) => {
						const prefetch = new MemoryPrefetch();
						const callLLMFn = (opts: any) => pi.callLLM(opts);

						pi.on("before_agent_start", async () => {
							prefetch.start("test query", memoryDir, callLLMFn);
						});

						pi.on("context", (event) => {
							const memoryText = prefetch.collect();
							if (!memoryText) return;
							const memoryMessage = {
								role: "user" as const,
								content: [{ type: "text" as const, text: `[Memory context]\n\n${memoryText}` }],
								timestamp: Date.now(),
							};
							return { messages: [...event.messages, memoryMessage] };
						});
					},
				],
			});

			harness.setResponses([() => fauxAssistantMessage("done")]);

			await harness.session.prompt("test query");
		});
	});
});

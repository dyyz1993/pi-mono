import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import { fauxAssistantMessage } from "@dyyz1993/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "../../src/core/extensions/index.js";
import { createHarness, type Harness } from "../suite/harness.js";
import autoMemoryExtensionDefault, {
	type CallLLMFn,
	MemoryDream,
	MemoryExtractor,
	MemoryPrefetch,
	serializeMessages,
	updateMemoryIndex,
} from "./auto-memory.js";
import { DREAM_MIN_HOURS, DREAM_MIN_SESSIONS, getMemoryDir, getProjectRoot } from "./utils.js";

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

	describe("MemoryPrefetch edge cases", () => {
		it("returns empty string when memory dir has no .md files", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });

			const prefetch = new MemoryPrefetch();
			prefetch.start("query", memoryDir, async () => "unused");

			await new Promise((r) => setTimeout(r, 50));
			expect(prefetch.collect()).toBe("");
		});

		it("returns empty string when callLLM returns non-JSON", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(join(memoryDir, "test.md"), "---\nname: T\ntype: project\n---\nContent.");

			const prefetch = new MemoryPrefetch();
			prefetch.start("query", memoryDir, async () => "not json at all");

			await new Promise((r) => setTimeout(r, 50));
			expect(prefetch.collect()).toBe("");
		});

		it("returns empty string when callLLM throws", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(join(memoryDir, "test.md"), "---\nname: T\ntype: project\n---\nContent.");

			const prefetch = new MemoryPrefetch();
			prefetch.start("query", memoryDir, async () => {
				throw new Error("LLM unavailable");
			});

			await new Promise((r) => setTimeout(r, 50));
			expect(prefetch.collect()).toBe("");
		});

		it("ignores selected filenames that do not exist", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(join(memoryDir, "real.md"), "---\nname: Real\ntype: project\n---\nReal content.");

			const callLLM: CallLLMFn = async () => JSON.stringify({ selected: ["nonexistent.md", "real.md"] });

			const prefetch = new MemoryPrefetch();
			prefetch.start("query", memoryDir, callLLM);

			await new Promise((r) => setTimeout(r, 50));
			const result = prefetch.collect();
			expect(result).not.toContain("nonexistent");
			expect(result).toContain("Real content");
		});

		it("returns empty string when callLLM returns empty selected array", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(join(memoryDir, "test.md"), "---\nname: T\ntype: project\n---\nContent.");

			const prefetch = new MemoryPrefetch();
			prefetch.start("query", memoryDir, async () => JSON.stringify({ selected: [] }));

			await new Promise((r) => setTimeout(r, 50));
			expect(prefetch.collect()).toBe("");
		});
	});

	describe("MemoryExtractor throttle and pending", () => {
		it("does not extract on first call (throttle)", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });

			let callCount = 0;
			const callLLM: CallLLMFn = async () => {
				callCount++;
				return JSON.stringify({ actions: [] });
			};

			const extractor = new MemoryExtractor();
			const msgs = [
				{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }], timestamp: Date.now() },
			] as AgentMessage[];

			await extractor.maybeExtract(msgs, memoryDir, callLLM);
			expect(callCount).toBe(0);
		});

		it("extracts on second call", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });

			let callCount = 0;
			const callLLM: CallLLMFn = async () => {
				callCount++;
				return JSON.stringify({ actions: [] });
			};

			const extractor = new MemoryExtractor();
			const msgs = [
				{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }], timestamp: Date.now() },
			] as AgentMessage[];

			await extractor.maybeExtract(msgs, memoryDir, callLLM);
			await extractor.maybeExtract(msgs, memoryDir, callLLM);
			expect(callCount).toBe(1);
		});

		it("resets throttle counter after extraction", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });

			let callCount = 0;
			const callLLM: CallLLMFn = async () => {
				callCount++;
				return JSON.stringify({ actions: [] });
			};

			const extractor = new MemoryExtractor();
			const msgs = [
				{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }], timestamp: Date.now() },
			] as AgentMessage[];

			await extractor.maybeExtract(msgs, memoryDir, callLLM);
			await extractor.maybeExtract(msgs, memoryDir, callLLM);
			await extractor.maybeExtract(msgs, memoryDir, callLLM);
			expect(callCount).toBe(1);

			await extractor.maybeExtract(msgs, memoryDir, callLLM);
			expect(callCount).toBe(2);
		});

		it("queues pending messages when extraction is in progress", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });

			let resolveFirst: () => void;
			const firstCall = new Promise<void>((r) => {
				resolveFirst = r;
			});
			let callCount = 0;

			const callLLM: CallLLMFn = async () => {
				callCount++;
				if (callCount === 1) {
					await firstCall;
				}
				return JSON.stringify({ actions: [] });
			};

			const extractor = new MemoryExtractor();
			const msgs = [
				{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }], timestamp: Date.now() },
			] as AgentMessage[];

			await extractor.maybeExtract(msgs, memoryDir, callLLM);

			const extractPromise = extractor.maybeExtract(msgs, memoryDir, callLLM);
			await new Promise((r) => setTimeout(r, 30));

			const priv = extractor as unknown as { inProgress: boolean; pendingMessages: AgentMessage[] | null };
			expect(priv.inProgress).toBe(true);

			const thirdCall = extractor.maybeExtract(msgs, memoryDir, callLLM);
			expect(priv.pendingMessages).toBe(msgs);

			resolveFirst!();
			await extractPromise;
			await thirdCall;

			expect(callCount).toBeGreaterThanOrEqual(2);
		});

		it("handles update action by appending to existing file", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(join(memoryDir, "existing.md"), "---\nname: Existing\ntype: project\n---\nOld content.");

			const callLLM: CallLLMFn = async () =>
				JSON.stringify({
					actions: [{ op: "update", filename: "existing.md", append: "\n\nNew appended line." }],
				});

			const extractor = new MemoryExtractor();
			const msgs = [
				{ role: "user" as const, content: [{ type: "text" as const, text: "update it" }], timestamp: Date.now() },
			] as AgentMessage[];

			await extractor.maybeExtract(msgs, memoryDir, callLLM);
			await extractor.maybeExtract(msgs, memoryDir, callLLM);

			const content = readFileSync(join(memoryDir, "existing.md"), "utf-8");
			expect(content).toContain("Old content.");
			expect(content).toContain("New appended line.");
		});

		it("handles empty actions array", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });

			const callLLM: CallLLMFn = async () => JSON.stringify({ actions: [] });
			const extractor = new MemoryExtractor();
			const msgs = [
				{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }], timestamp: Date.now() },
			] as AgentMessage[];

			await extractor.maybeExtract(msgs, memoryDir, callLLM);
			await extractor.maybeExtract(msgs, memoryDir, callLLM);

			const files = readdirSync(memoryDir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md");
			expect(files).toHaveLength(0);
		});

		it("handles non-JSON callLLM response", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });

			const callLLM: CallLLMFn = async () => "not json";
			const extractor = new MemoryExtractor();
			const msgs = [
				{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }], timestamp: Date.now() },
			] as AgentMessage[];

			await extractor.maybeExtract(msgs, memoryDir, callLLM);
			await extractor.maybeExtract(msgs, memoryDir, callLLM);

			const files = readdirSync(memoryDir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md");
			expect(files).toHaveLength(0);
		});
	});

	function makeDreamReady(memoryDir: string): void {
		const lockPath = join(memoryDir, ".consolidate-lock");
		writeFileSync(lockPath, "");
		const oldTime = new Date(Date.now() - (DREAM_MIN_HOURS + 1) * 3_600_000);
		utimesSync(lockPath, oldTime, oldTime);

		const sessionsPath = join(memoryDir, ".session-count");
		writeFileSync(sessionsPath, String(DREAM_MIN_SESSIONS + 2));
	}

	describe("MemoryDream", () => {
		it("skips when hours since last dream < DREAM_MIN_HOURS", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(join(memoryDir, "test.md"), "---\nname: T\ntype: project\n---\nContent.");

			const lockPath = join(memoryDir, ".consolidate-lock");
			writeFileSync(lockPath, "");
			utimesSync(lockPath, new Date(), new Date());

			writeFileSync(join(memoryDir, ".session-count"), "100");

			let callCount = 0;
			const callLLM: CallLLMFn = async () => {
				callCount++;
				return "{}";
			};

			const dream = new MemoryDream();
			await dream.maybeRun(memoryDir, callLLM);
			expect(callCount).toBe(0);
		});

		it("skips when session count < DREAM_MIN_SESSIONS", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(join(memoryDir, "test.md"), "---\nname: T\ntype: project\n---\nContent.");

			const lockPath = join(memoryDir, ".consolidate-lock");
			writeFileSync(lockPath, "");
			const oldTime = new Date(Date.now() - (DREAM_MIN_HOURS + 1) * 3_600_000);
			utimesSync(lockPath, oldTime, oldTime);

			writeFileSync(join(memoryDir, ".session-count"), "1");

			let callCount = 0;
			const callLLM: CallLLMFn = async () => {
				callCount++;
				return "{}";
			};

			const dream = new MemoryDream();
			await dream.maybeRun(memoryDir, callLLM);
			expect(callCount).toBe(0);
		});

		it("creates lock file if missing", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });

			const dream = new MemoryDream();
			await dream.maybeRun(memoryDir, async () => "{}");

			expect(existsSync(join(memoryDir, ".consolidate-lock"))).toBe(true);
		});

		it("performs deletions", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(join(memoryDir, "old.md"), "---\nname: Old\ntype: project\n---\nOld.");
			makeDreamReady(memoryDir);

			const callLLM: CallLLMFn = async () => JSON.stringify({ deletions: ["old.md"] });

			const dream = new MemoryDream();
			await dream.maybeRun(memoryDir, callLLM);
			expect(existsSync(join(memoryDir, "old.md"))).toBe(false);
		});

		it("performs merges: writes target, deletes sources", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(join(memoryDir, "a.md"), "---\nname: A\ntype: project\n---\nAAA");
			writeFileSync(join(memoryDir, "b.md"), "---\nname: B\ntype: project\n---\nBBB");
			makeDreamReady(memoryDir);

			const callLLM: CallLLMFn = async () =>
				JSON.stringify({
					merges: [
						{
							sources: ["a.md", "b.md"],
							target: "merged.md",
							content: "---\nname: Merged\ntype: project\n---\nAAA and BBB combined",
						},
					],
				});

			const dream = new MemoryDream();
			await dream.maybeRun(memoryDir, callLLM);

			expect(existsSync(join(memoryDir, "a.md"))).toBe(false);
			expect(existsSync(join(memoryDir, "b.md"))).toBe(false);
			const merged = readFileSync(join(memoryDir, "merged.md"), "utf-8");
			expect(merged).toContain("AAA and BBB combined");
		});

		it("performs updates", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(join(memoryDir, "existing.md"), "---\nname: E\ntype: project\n---\nOld");
			makeDreamReady(memoryDir);

			const callLLM: CallLLMFn = async () =>
				JSON.stringify({
					updates: [{ filename: "existing.md", newContent: "---\nname: E\ntype: project\n---\nNew" }],
				});

			const dream = new MemoryDream();
			await dream.maybeRun(memoryDir, callLLM);

			const content = readFileSync(join(memoryDir, "existing.md"), "utf-8");
			expect(content).toContain("New");
			expect(content).not.toContain("Old");
		});

		it("replaces index with newIndex", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(join(memoryDir, "test.md"), "---\nname: T\ntype: project\n---\nContent.");
			writeFileSync(join(memoryDir, "MEMORY.md"), "Old index");
			makeDreamReady(memoryDir);

			const callLLM: CallLLMFn = async () =>
				JSON.stringify({ newIndex: "- [test](./test.md) — Updated description" });

			const dream = new MemoryDream();
			await dream.maybeRun(memoryDir, callLLM);

			const indexContent = readFileSync(join(memoryDir, "MEMORY.md"), "utf-8");
			expect(indexContent).toContain("Updated description");
			expect(indexContent).not.toContain("Old index");
		});

		it("rolls back lock mtime on callLLM error", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(join(memoryDir, "test.md"), "---\nname: T\ntype: project\n---\nContent.");
			makeDreamReady(memoryDir);

			const lockPath = join(memoryDir, ".consolidate-lock");
			const mtimeBefore = statSync(lockPath).mtimeMs;

			const callLLM: CallLLMFn = async () => {
				throw new Error("LLM down");
			};

			const dream = new MemoryDream();
			await dream.maybeRun(memoryDir, callLLM);

			const mtimeAfter = statSync(lockPath).mtimeMs;
			expect(Math.abs(mtimeAfter - mtimeBefore)).toBeLessThan(1000);
		});

		it("skips dream when memory dir is empty", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });
			makeDreamReady(memoryDir);

			let callCount = 0;
			const callLLM: CallLLMFn = async () => {
				callCount++;
				return "{}";
			};

			const dream = new MemoryDream();
			await dream.maybeRun(memoryDir, callLLM);
			expect(callCount).toBe(0);
		});

		it("updates lock mtime on successful dream", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(join(memoryDir, "test.md"), "---\nname: T\ntype: project\n---\nContent.");
			makeDreamReady(memoryDir);

			const lockPath = join(memoryDir, ".consolidate-lock");
			const mtimeBefore = statSync(lockPath).mtimeMs;

			const callLLM: CallLLMFn = async () => JSON.stringify({});

			const dream = new MemoryDream();
			await dream.maybeRun(memoryDir, callLLM);

			const mtimeAfter = statSync(lockPath).mtimeMs;
			expect(mtimeAfter).toBeGreaterThan(mtimeBefore);
		});
	});

	describe("updateMemoryIndex", () => {
		it("rebuilds index after file deletion", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(join(memoryDir, "alpha.md"), "---\nname: Alpha\ntype: project\n---\nA");
			writeFileSync(join(memoryDir, "beta.md"), "---\nname: Beta\ntype: project\n---\nB");

			await updateMemoryIndex(memoryDir);
			let index = readFileSync(join(memoryDir, "MEMORY.md"), "utf-8");
			expect(index).toContain("alpha");
			expect(index).toContain("beta");

			rmSync(join(memoryDir, "beta.md"));
			await updateMemoryIndex(memoryDir);
			index = readFileSync(join(memoryDir, "MEMORY.md"), "utf-8");
			expect(index).toContain("alpha");
			expect(index).not.toContain("beta");
		});

		it("handles empty directory", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });

			await updateMemoryIndex(memoryDir);
			expect(existsSync(join(memoryDir, "MEMORY.md"))).toBe(true);
			const content = readFileSync(join(memoryDir, "MEMORY.md"), "utf-8");
			expect(content.trim()).toBe("");
		});
	});

	describe("autoMemoryExtension entry function", () => {
		function createMockPi(): {
			pi: ExtensionAPI;
			emit: <E extends string>(event: E, ...args: any[]) => Promise<any>;
			ctx: { ui: { setStatus: ReturnType<typeof vi.fn>; notify: ReturnType<typeof vi.fn> } };
		} {
			const handlers: Record<string, ((...args: any[]) => any)[]> = {};

			const mockUI = {
				setStatus: vi.fn(),
				notify: vi.fn(),
			};
			const mockCtx = { ui: mockUI } as any;

			const pi = {
				on: vi.fn((event: string, handler: (...args: any[]) => any) => {
					if (!handlers[event]) handlers[event] = [];
					handlers[event].push(handler);
				}),
				callLLM: vi.fn(async () => JSON.stringify({ actions: [] })),
				off: vi.fn(),
				once: vi.fn(),
				emit: vi.fn(),
				setStatus: vi.fn(),
				registerProvider: vi.fn(),
				unregisterProvider: vi.fn(),
				events: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), once: vi.fn() },
				registerChannel: vi.fn(),
			} as unknown as ExtensionAPI;

			const emit = async <E extends string>(event: E, ...args: any[]) => {
				const fns = handlers[event] ?? [];
				let result: any;
				for (const fn of fns) {
					const eventArg = args.length > 0 ? args[0] : {};
					result = await fn(eventArg, mockCtx);
				}
				return result;
			};

			return { pi, emit, ctx: mockCtx };
		}

		it("session_shutdown drains active extraction", async () => {
			const { pi, emit } = createMockPi();

			let resolveExtraction: () => void;
			const extractionDone = new Promise<void>((r) => {
				resolveExtraction = r;
			});
			(pi.callLLM as ReturnType<typeof vi.fn>).mockImplementation(async () => {
				await extractionDone;
				return JSON.stringify({ actions: [] });
			});

			autoMemoryExtensionDefault(pi);

			await emit("session_start");

			await emit("agent_end", {
				type: "agent_end",
				messages: [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() }],
			});
			await emit("agent_end", {
				type: "agent_end",
				messages: [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() }],
			});

			const shutdownPromise = emit("session_shutdown", { type: "session_shutdown", reason: "quit" });

			await new Promise((r) => setTimeout(r, 30));
			resolveExtraction!();
			await shutdownPromise;
		});

		it("session_shutdown resolves immediately when no active extraction", async () => {
			const { pi, emit } = createMockPi();

			autoMemoryExtensionDefault(pi);

			await emit("session_start");
			const start = Date.now();
			await emit("session_shutdown", { type: "session_shutdown", reason: "quit" });
			expect(Date.now() - start).toBeLessThan(1000);
		});

		it("agent_end is ignored after draining starts", async () => {
			const { pi, emit } = createMockPi();

			autoMemoryExtensionDefault(pi);

			await emit("session_start");
			await emit("session_shutdown", { type: "session_shutdown", reason: "quit" });

			const callCountBefore = (pi.callLLM as ReturnType<typeof vi.fn>).mock.calls.length;

			await emit("agent_end", {
				type: "agent_end",
				messages: [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() }],
			});
			await emit("agent_end", {
				type: "agent_end",
				messages: [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() }],
			});

			const callCountAfter = (pi.callLLM as ReturnType<typeof vi.fn>).mock.calls.length;
			expect(callCountAfter).toBe(callCountBefore);
		});

		it("before_agent_start reads memory and injects system prompt", async () => {
			const { pi, emit } = createMockPi();
			autoMemoryExtensionDefault(pi);

			await emit("session_start");

			const memoryDir = getMemoryDir(process.cwd());
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(join(memoryDir, "MEMORY.md"), "- [note](note.md) — test note");

			const result = await emit("before_agent_start", {
				type: "before_agent_start",
				systemPrompt: "base prompt",
				prompt: "hello",
			});

			expect(result.systemPrompt).toContain("base prompt");
			expect(result.systemPrompt).toContain("test note");
			expect(result.systemPrompt).toContain("auto memory");

			rmSync(memoryDir, { recursive: true, force: true });
		});

		it("before_agent_start skips prefetch when prompt is empty", async () => {
			const { pi, emit } = createMockPi();
			autoMemoryExtensionDefault(pi);

			await emit("session_start");

			const result = await emit("before_agent_start", {
				type: "before_agent_start",
				systemPrompt: "base",
				prompt: "",
			});

			expect(result.systemPrompt).toContain("base");
			expect((pi.callLLM as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
		});

		it("context handler returns early when prefetch not settled", async () => {
			const { pi, emit } = createMockPi();
			autoMemoryExtensionDefault(pi);

			const result = await emit("context", {
				type: "context",
				messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() }],
			});

			expect(result).toBeUndefined();
		});

		it("context handler injects memory message when prefetch resolved", async () => {
			const { pi, emit } = createMockPi();
			autoMemoryExtensionDefault(pi);

			await emit("session_start");

			const memoryDir = getMemoryDir(process.cwd());
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(join(memoryDir, "test.md"), "---\nname: T\ntype: project\n---\nContent.");

			(pi.callLLM as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({ selected: ["test.md"] }));

			await emit("before_agent_start", {
				type: "before_agent_start",
				systemPrompt: "base",
				prompt: "test query",
			});

			await new Promise((r) => setTimeout(r, 100));

			const result = await emit("context", {
				type: "context",
				messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() }],
			});

			expect(result).toBeDefined();
			expect(result.messages.length).toBe(2);
			expect(result.messages[1].content[0].text).toContain("Content.");

			rmSync(memoryDir, { recursive: true, force: true });
		});

		it("tool_call handler detects memory writes", async () => {
			const { pi, emit } = createMockPi();
			autoMemoryExtensionDefault(pi);

			await emit("session_start");

			const memoryDir = getMemoryDir(process.cwd());
			await emit("tool_call", {
				type: "tool_call",
				toolName: "write",
				input: { path: join(memoryDir, "note.md") },
			});

			await emit("agent_end", {
				type: "agent_end",
				messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() }],
			});
			await emit("agent_end", {
				type: "agent_end",
				messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() }],
			});

			expect((pi.callLLM as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
		});

		it("tool_call handler handles null input", async () => {
			const { pi, emit } = createMockPi();
			autoMemoryExtensionDefault(pi);

			await emit("session_start");

			await emit("tool_call", {
				type: "tool_call",
				toolName: "write",
				input: null,
			});

			await emit("agent_end", {
				type: "agent_end",
				messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() }],
			});
			await emit("agent_end", {
				type: "agent_end",
				messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() }],
			});

			expect((pi.callLLM as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
		});

		it("shows status updates in UI via setStatus", async () => {
			const { pi, emit, ctx } = createMockPi();
			autoMemoryExtensionDefault(pi);

			await emit("session_start");
			expect(ctx.ui.setStatus).toHaveBeenCalledWith("auto-memory", "memory ready");

			await emit("before_agent_start", {
				type: "before_agent_start",
				systemPrompt: "base",
				prompt: "test",
			});
			expect(ctx.ui.setStatus).toHaveBeenCalledWith("auto-memory", "selecting memories...");

			await emit("agent_end", {
				type: "agent_end",
				messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() }],
			});
			await emit("agent_end", {
				type: "agent_end",
				messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() }],
			});
			await new Promise((r) => setTimeout(r, 50));
			expect(ctx.ui.setStatus).toHaveBeenCalledWith("auto-memory", "extracting memories...");

			await emit("session_shutdown", { type: "session_shutdown", reason: "quit" });
			expect(ctx.ui.setStatus).toHaveBeenCalledWith("auto-memory", undefined);
		});
	});

	describe("serializeMessages edge cases", () => {
		it("handles string content (non-array)", () => {
			const messages = [{ role: "user" as const, content: "plain text string", timestamp: 0 }] as AgentMessage[];

			const result = serializeMessages(messages);
			expect(result).toContain("[user]: plain text string");
		});

		it("skips non-user/assistant roles", () => {
			const messages = [
				{ role: "user" as const, content: [{ type: "text" as const, text: "hello" }], timestamp: 0 },
				{ role: "tool" as any, content: "tool result", timestamp: 0 },
				{ role: "assistant" as const, content: [{ type: "text" as const, text: "hi" }], timestamp: 0 },
			] as AgentMessage[];

			const result = serializeMessages(messages);
			expect(result).toContain("[user]: hello");
			expect(result).toContain("[assistant]: hi");
			expect(result).not.toContain("[tool]");
		});
	});

	describe("MemoryExtractor additional branches", () => {
		it("detects edit tool writes to memory dir", () => {
			const memoryDir = getMemoryDir(tempDir);
			const extractor = new MemoryExtractor();

			extractor.onToolCall("edit", { path: join(memoryDir, "topic.md") }, memoryDir);
			expect((extractor as unknown as { mainAgentWroteMemory: boolean }).mainAgentWroteMemory).toBe(true);
		});

		it("normalizes backslashes in paths", () => {
			const memoryDir = "C:\\Users\\test\\.pi\\memory\\project";
			const extractor = new MemoryExtractor();

			extractor.onToolCall("write", { path: "C:\\Users\\test\\.pi\\memory\\project\\note.md" }, memoryDir);
			expect((extractor as unknown as { mainAgentWroteMemory: boolean }).mainAgentWroteMemory).toBe(true);
		});

		it("create action uses filename fallback when name is missing", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });

			const callLLM: CallLLMFn = async () =>
				JSON.stringify({
					actions: [{ op: "create", filename: "minimal.md", content: "Just content" }],
				});

			const extractor = new MemoryExtractor();
			const msgs = [
				{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }], timestamp: Date.now() },
			] as AgentMessage[];

			await extractor.maybeExtract(msgs, memoryDir, callLLM);
			await extractor.maybeExtract(msgs, memoryDir, callLLM);

			const content = readFileSync(join(memoryDir, "minimal.md"), "utf-8");
			expect(content).toContain("name: minimal.md");
			expect(content).toContain("description:");
			expect(content).toContain("type: project");
		});

		it("update action is silent when file does not exist", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });

			const callLLM: CallLLMFn = async () =>
				JSON.stringify({
					actions: [{ op: "update", filename: "nonexistent.md", append: "\nAppended." }],
				});

			const extractor = new MemoryExtractor();
			const msgs = [
				{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }], timestamp: Date.now() },
			] as AgentMessage[];

			await extractor.maybeExtract(msgs, memoryDir, callLLM);
			await extractor.maybeExtract(msgs, memoryDir, callLLM);

			expect(existsSync(join(memoryDir, "nonexistent.md"))).toBe(false);
		});
	});

	describe("MemoryDream additional branches", () => {
		it("handles non-JSON callLLM response in runDream", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(join(memoryDir, "test.md"), "---\nname: T\ntype: project\n---\nContent.");
			makeDreamReady(memoryDir);

			const lockPath = join(memoryDir, ".consolidate-lock");
			const mtimeBefore = statSync(lockPath).mtimeMs;

			const callLLM: CallLLMFn = async () => "not valid json";

			const dream = new MemoryDream();
			await dream.maybeRun(memoryDir, callLLM);

			const mtimeAfter = statSync(lockPath).mtimeMs;
			expect(mtimeAfter).toBeGreaterThan(mtimeBefore);
		});

		it("handles deletion of non-existent file gracefully", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(join(memoryDir, "exists.md"), "---\nname: E\ntype: project\n---\nE");
			makeDreamReady(memoryDir);

			const callLLM: CallLLMFn = async () => JSON.stringify({ deletions: ["nonexistent.md", "exists.md"] });

			const dream = new MemoryDream();
			await dream.maybeRun(memoryDir, callLLM);
			expect(existsSync(join(memoryDir, "exists.md"))).toBe(false);
		});

		it("skips merge when fields are missing", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(join(memoryDir, "a.md"), "---\nname: A\ntype: project\n---\nA");
			makeDreamReady(memoryDir);

			const callLLM: CallLLMFn = async () => JSON.stringify({ merges: [{ sources: ["a.md"], target: "b.md" }] });

			const dream = new MemoryDream();
			await dream.maybeRun(memoryDir, callLLM);
			expect(existsSync(join(memoryDir, "a.md"))).toBe(true);
		});

		it("skips merge source deletion when source equals target", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(join(memoryDir, "self.md"), "---\nname: Self\ntype: project\n---\nOriginal");
			makeDreamReady(memoryDir);

			const callLLM: CallLLMFn = async () =>
				JSON.stringify({
					merges: [{ sources: ["self.md"], target: "self.md", content: "Updated self" }],
				});

			const dream = new MemoryDream();
			await dream.maybeRun(memoryDir, callLLM);

			const content = readFileSync(join(memoryDir, "self.md"), "utf-8");
			expect(content).toBe("Updated self");
		});

		it("skips update when filename or newContent is missing", async () => {
			const memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });
			writeFileSync(join(memoryDir, "orig.md"), "---\nname: O\ntype: project\n---\nOriginal");
			makeDreamReady(memoryDir);

			const callLLM: CallLLMFn = async () => JSON.stringify({ updates: [{ filename: "orig.md" }] });

			const dream = new MemoryDream();
			await dream.maybeRun(memoryDir, callLLM);

			const content = readFileSync(join(memoryDir, "orig.md"), "utf-8");
			expect(content).toContain("Original");
		});
	});

	describe("getProjectRoot", () => {
		it("returns cwd when not a git repo", () => {
			const result = getProjectRoot(tempDir);
			expect(result).toBe(tempDir);
		});

		it("returns resolved path for git repo", () => {
			const result = getProjectRoot(process.cwd());
			expect(result).not.toBe(process.cwd());
			expect(result.endsWith("pi-momo-fork") || result.includes("pi-momo-fork")).toBe(true);
		});

		it("worktrees of same repo share the same project root", async () => {
			const { execSync } = await import("node:child_process");
			const mainDir = join(tmpdir(), `wt-main-${Date.now()}`);
			const wtDir = join(tmpdir(), `wt-worktree-${Date.now()}`);

			try {
				execSync(`git init "${mainDir}"`, { stdio: "pipe" });
				execSync(`git -C "${mainDir}" commit --allow-empty -m "init"`, { stdio: "pipe" });
				execSync(`git -C "${mainDir}" worktree add "${wtDir}"`, { stdio: "pipe" });

				const mainRoot = getProjectRoot(mainDir);
				const wtRoot = getProjectRoot(wtDir);

				expect(mainRoot).toBe(wtRoot);
				expect(getMemoryDir(mainDir)).toBe(getMemoryDir(wtDir));
			} finally {
				try {
					execSync(`git -C "${mainDir}" worktree remove "${wtDir}" --force 2>/dev/null`, { stdio: "pipe" });
				} catch {}
				rmSync(mainDir, { recursive: true, force: true });
				rmSync(wtDir, { recursive: true, force: true });
			}
		});
	});
});

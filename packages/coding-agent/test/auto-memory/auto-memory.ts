import { existsSync } from "node:fs";
import { mkdir, readFile, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import type { CallLLMOptions, ExtensionAPI, ExtensionContext } from "../../src/core/extensions/index.js";
import { DREAM_PROMPT, EXTRACTION_PROMPT, MEMORY_SYSTEM_PROMPT, SELECT_MEMORIES_PROMPT } from "./prompts.js";
import {
	buildFrontmatter,
	DREAM_MIN_HOURS,
	DREAM_MIN_SESSIONS,
	ENTRYPOINT_NAME,
	formatManifest,
	getEntrypointPath,
	getMemoryDir,
	MAX_MEMORY_BYTES_PER_FILE,
	MAX_RELEVANT_MEMORIES,
	type MemoryHeader,
	type MemoryType,
	scanMemoryFiles,
	truncateEntrypoint,
} from "./utils.js";

type CallLLMFn = (options: CallLLMOptions) => Promise<string>;

function serializeMessages(messages: AgentMessage[], options?: { lastN?: number }): string {
	const slice = options?.lastN ? messages.slice(-options.lastN) : messages;
	return slice
		.map((m) => {
			if (m.role === "user" || m.role === "assistant") {
				const text = Array.isArray(m.content)
					? (m.content as Array<{ type: string; text?: string }>)
							.filter(
								(c: { type: string; text?: string }): c is { type: "text"; text: string } => c.type === "text",
							)
							.map((c: { type: "text"; text: string }) => c.text)
							.join("\n")
					: String(m.content);
				return `[${m.role}]: ${text}`;
			}
			return null;
		})
		.filter(Boolean)
		.join("\n");
}

class MemoryPrefetch {
	private promise: Promise<string> | null = null;
	private settled = false;
	private result: string | null = null;

	start(query: string, memoryDir: string, callLLM: CallLLMFn): void {
		this.settled = false;
		this.result = null;
		this.promise = this.run(query, memoryDir, callLLM);
		void this.promise.then((r) => {
			this.result = r;
			this.settled = true;
		});
	}

	collect(): string | null {
		return this.settled ? this.result : null;
	}

	private async run(query: string, memoryDir: string, callLLM: CallLLMFn): Promise<string> {
		try {
			const memories = await scanMemoryFiles(memoryDir);
			if (memories.length === 0) return "";

			const manifest = formatManifest(memories);
			const selected = await callLLM({
				systemPrompt: SELECT_MEMORIES_PROMPT,
				messages: [{ role: "user", content: `Query: ${query}\n\nAvailable:\n${manifest}` }],
			});

			let parsed: { selected: string[] };
			try {
				parsed = JSON.parse(selected);
			} catch {
				return "";
			}

			const filenames = parsed.selected ?? [];
			const resolved = filenames
				.slice(0, MAX_RELEVANT_MEMORIES)
				.map((name: string) => memories.find((m) => m.filename === name))
				.filter((m): m is MemoryHeader => m !== undefined);

			const parts = await Promise.all(
				resolved.map(async (m) => {
					const content = await readFile(m.filePath, "utf-8");
					return `### ${m.filename}\n${content}`;
				}),
			);
			return parts.join("\n\n");
		} catch {
			return "";
		}
	}
}

class MemoryExtractor {
	private inProgress = false;
	private pendingMessages: AgentMessage[] | null = null;
	private turnsSinceLastExtraction = 0;
	private mainAgentWroteMemory = false;

	onToolCall(toolName: string, args: Record<string, unknown>, memoryDir: string): void {
		if ((toolName === "write" || toolName === "edit") && typeof args.path === "string") {
			const normalizedPath = args.path.replace(/\\/g, "/");
			const normalizedDir = memoryDir.replace(/\\/g, "/");
			if (normalizedPath.startsWith(`${normalizedDir}/`)) {
				this.mainAgentWroteMemory = true;
			}
		}
	}

	async maybeExtract(messages: AgentMessage[], memoryDir: string, callLLM: CallLLMFn): Promise<void> {
		if (this.inProgress) {
			this.pendingMessages = messages;
			return;
		}

		if (this.mainAgentWroteMemory) {
			this.mainAgentWroteMemory = false;
			this.turnsSinceLastExtraction = 0;
			return;
		}

		this.turnsSinceLastExtraction++;
		if (this.turnsSinceLastExtraction < 2) return;
		this.turnsSinceLastExtraction = 0;

		await this.runExtraction(messages, memoryDir, callLLM);
	}

	private async runExtraction(messages: AgentMessage[], memoryDir: string, callLLM: CallLLMFn): Promise<void> {
		this.inProgress = true;
		try {
			const recent = serializeMessages(messages, { lastN: 20 });
			const manifest = formatManifest(await scanMemoryFiles(memoryDir));

			const result = await callLLM({
				systemPrompt: EXTRACTION_PROMPT(manifest),
				messages: [{ role: "user", content: `Recent conversation:\n${recent}\n\nExisting memories:\n${manifest}` }],
			});

			let parsed: { actions: ExtractionAction[] };
			try {
				parsed = JSON.parse(result);
			} catch {
				return;
			}

			if (!parsed.actions?.length) return;
			await this.applyActions(parsed.actions, memoryDir);
		} finally {
			this.inProgress = false;
			if (this.pendingMessages) {
				const pending = this.pendingMessages;
				this.pendingMessages = null;
				await this.runExtraction(pending, memoryDir, callLLM);
			}
		}
	}

	private async applyActions(actions: ExtractionAction[], memoryDir: string): Promise<void> {
		for (const action of actions) {
			if (action.op === "create" && action.filename && action.content) {
				const fm = buildFrontmatter({
					name: action.name ?? action.filename,
					description: action.description ?? "",
					type: (action.type as MemoryType) ?? "project",
				});
				const filePath = join(memoryDir, action.filename);
				const body = action.content.slice(0, MAX_MEMORY_BYTES_PER_FILE);
				await writeFile(filePath, `${fm}\n\n${body}`);
			} else if (action.op === "update" && action.filename && action.append) {
				const filePath = join(memoryDir, action.filename);
				if (existsSync(filePath)) {
					const existing = await readFile(filePath, "utf-8");
					await writeFile(filePath, existing + action.append);
				}
			}
		}
		await updateMemoryIndex(memoryDir);
	}
}

type ExtractionAction = {
	op: "create" | "update" | "skip";
	filename?: string;
	name?: string;
	description?: string;
	type?: string;
	content?: string;
	append?: string;
};

class MemoryDream {
	async maybeRun(memoryDir: string, callLLM: CallLLMFn): Promise<void> {
		const lockPath = join(memoryDir, ".consolidate-lock");

		if (!existsSync(lockPath)) {
			await writeFile(lockPath, "");
			await utimes(lockPath, new Date(0), new Date(0));
		}

		const lockStat = await stat(lockPath);
		const hoursSince = (Date.now() - lockStat.mtimeMs) / 3_600_000;
		if (hoursSince < DREAM_MIN_HOURS) return;

		const sessionCount = await countSessionsSince(memoryDir, lockStat.mtimeMs);
		if (sessionCount < DREAM_MIN_SESSIONS) return;

		try {
			await this.runDream(memoryDir, callLLM);
			await utimes(lockPath, new Date(), new Date());
		} catch {
			await utimes(lockPath, new Date(lockStat.mtimeMs), new Date(lockStat.mtimeMs));
		}
	}

	private async runDream(memoryDir: string, callLLM: CallLLMFn): Promise<void> {
		const memories = await scanMemoryFiles(memoryDir);
		if (memories.length === 0) return;

		const allContent = await readAllMemories(memories);
		const entrypointPath = join(memoryDir, ENTRYPOINT_NAME);
		let indexContent = "";
		try {
			indexContent = await readFile(entrypointPath, "utf-8");
		} catch {}

		const result = await callLLM({
			systemPrompt: DREAM_PROMPT(allContent, indexContent, memoryDir),
			messages: [{ role: "user", content: "Perform dream consolidation." }],
		});

		let parsed: DreamResult;
		try {
			parsed = JSON.parse(result);
		} catch {
			return;
		}

		await this.applyDreamActions(parsed, memoryDir);
	}

	private async applyDreamActions(parsed: DreamResult, memoryDir: string): Promise<void> {
		if (parsed.deletions?.length) {
			for (const filename of parsed.deletions) {
				const filePath = join(memoryDir, filename);
				if (existsSync(filePath)) {
					await unlink(filePath);
				}
			}
		}

		if (parsed.merges?.length) {
			for (const merge of parsed.merges) {
				if (merge.sources && merge.target && merge.content) {
					const targetPath = join(memoryDir, merge.target);
					await writeFile(targetPath, merge.content);
					for (const source of merge.sources) {
						const sourcePath = join(memoryDir, source);
						if (existsSync(sourcePath) && source !== merge.target) {
							await unlink(sourcePath);
						}
					}
				}
			}
		}

		if (parsed.updates?.length) {
			for (const update of parsed.updates) {
				if (update.filename && update.newContent) {
					const filePath = join(memoryDir, update.filename);
					await writeFile(filePath, update.newContent);
				}
			}
		}

		if (parsed.newIndex) {
			const { content } = truncateEntrypoint(parsed.newIndex);
			await writeFile(join(memoryDir, ENTRYPOINT_NAME), content);
		}
	}
}

type DreamResult = {
	merges?: { sources: string[]; target: string; content: string }[];
	deletions?: string[];
	updates?: { filename: string; newContent: string }[];
	newIndex?: string;
};

async function readAllMemories(memories: MemoryHeader[]): Promise<string> {
	const parts = await Promise.all(
		memories.map(async (m) => {
			const content = await readFile(m.filePath, "utf-8");
			return `=== ${m.filename} ===\n${content}`;
		}),
	);
	return parts.join("\n\n");
}

async function updateMemoryIndex(memoryDir: string): Promise<void> {
	const memories = await scanMemoryFiles(memoryDir);
	const lines = memories.map((m) => {
		const title = m.filename.replace(/\.md$/, "");
		const desc = m.description ? ` — ${m.description}` : "";
		const line = `- [${title}](./${m.filename})${desc}`;
		return line.slice(0, 150);
	});

	const truncated = truncateEntrypoint(lines.join("\n"));
	await writeFile(join(memoryDir, ENTRYPOINT_NAME), truncated.content);
}

async function countSessionsSince(memoryDir: string, _sinceMs: number): Promise<number> {
	try {
		const sessionsPath = join(memoryDir, ".session-count");
		if (!existsSync(sessionsPath)) {
			await writeFile(sessionsPath, "1");
			return 1;
		}
		const content = await readFile(sessionsPath, "utf-8");
		const count = Number.parseInt(content.trim(), 10) || 0;
		await writeFile(sessionsPath, String(count + 1));
		return count + 1;
	} catch {
		return DREAM_MIN_SESSIONS;
	}
}

export { MemoryPrefetch, MemoryExtractor, MemoryDream, serializeMessages, updateMemoryIndex, type CallLLMFn };

export default function autoMemoryExtension(pi: ExtensionAPI): void {
	const cwd = process.cwd();
	const memoryDir = getMemoryDir(cwd);
	const prefetch = new MemoryPrefetch();
	const extractor = new MemoryExtractor();
	const dream = new MemoryDream();
	let draining = false;
	let activeExtraction: Promise<void> | null = null;
	let ctx: ExtensionContext | null = null;

	function status(text: string | undefined): void {
		ctx?.ui.setStatus("auto-memory", text);
	}

	function notify(message: string, type?: "info" | "warning" | "error"): void {
		ctx?.ui.notify(message, type);
	}

	pi.on("session_start", async (_event, _ctx) => {
		ctx = _ctx;
		await mkdir(memoryDir, { recursive: true });
		status("memory ready");
	});

	pi.on("before_agent_start", async (event, _ctx) => {
		ctx = _ctx;
		let memoryContent = "";
		try {
			memoryContent = await readFile(getEntrypointPath(cwd), "utf-8");
		} catch {}
		const truncated = truncateEntrypoint(memoryContent);
		const memoryPrompt = MEMORY_SYSTEM_PROMPT(memoryDir, truncated.content);

		const lastUserText = event.prompt ?? "";
		if (lastUserText) {
			status("selecting memories...");
			prefetch.start(lastUserText, memoryDir, (opts) => pi.callLLM(opts));
		}

		return { systemPrompt: `${event.systemPrompt}\n\n${memoryPrompt}` };
	});

	pi.on("context", (event, _ctx) => {
		ctx = _ctx;
		const memoryText = prefetch.collect();
		if (!memoryText) return;

		status("memories injected");
		const memoryMessage: AgentMessage = {
			role: "user",
			content: [{ type: "text", text: `[Memory context — relevant memories]\n\n${memoryText}` }],
			timestamp: Date.now(),
		};
		return { messages: [...event.messages, memoryMessage] };
	});

	pi.on("tool_call", (event, _ctx) => {
		ctx = _ctx;
		const args = (event.input ?? {}) as Record<string, unknown>;
		extractor.onToolCall(event.toolName, args, memoryDir);
	});

	pi.on("agent_end", (event, _ctx) => {
		ctx = _ctx;
		if (draining) return;

		activeExtraction = (async () => {
			try {
				status("extracting memories...");
				await extractor.maybeExtract(event.messages, memoryDir, (opts) => pi.callLLM(opts));
				status("consolidating memories...");
				await dream.maybeRun(memoryDir, (opts) => pi.callLLM(opts));
				status("memory idle");
			} catch (e) {
				status("memory error");
				notify(`Auto-memory error: ${e instanceof Error ? e.message : String(e)}`, "warning");
			}
		})();
	});

	pi.on("session_shutdown", async () => {
		draining = true;
		if (activeExtraction) {
			status("draining memory...");
			const timeout = new Promise<void>((resolve) => setTimeout(resolve, 10_000));
			await Promise.race([activeExtraction, timeout]);
		}
		status(undefined);
	});
}

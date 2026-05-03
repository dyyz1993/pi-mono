import { existsSync } from "node:fs";
import { mkdir, readFile, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentMessage, AgentToolResult } from "@dyyz1993/pi-agent-core";
import { Type } from "typebox";
import type { CallLLMOptions, ExtensionAPI, ExtensionContext } from "@dyyz1993/pi-coding-agent";
import { ServerChannel } from "@dyyz1993/pi-coding-agent";

function stripMarkdownCodeBlock(text: string): string {
	let cleaned = text.trim();
	if (cleaned.startsWith("```")) {
		const firstNewline = cleaned.indexOf("\n");
		if (firstNewline !== -1) cleaned = cleaned.slice(firstNewline + 1);
		const lastBacktick = cleaned.lastIndexOf("```");
		if (lastBacktick !== -1) cleaned = cleaned.slice(0, lastBacktick);
		cleaned = cleaned.trim();
	}
	return cleaned;
}

import {
	addHistoryEntry,
	applyPurification,
	evaluateRules,
	getGlobalMemoryDir,
	type HistoryEntry,
	loadSkipWordStore,
	type PurificationResult,
	type SkipRule,
	type SkipWordStore,
	saveSkipWordStore,
} from "./skip-rules.js";
import {
	BOOKMARK_SUMMARY_PROMPT,
	DREAM_PROMPT,
	EXTRACTION_PROMPT,
	MEMORY_SYSTEM_PROMPT,
	SELECT_MEMORIES_PROMPT,
} from "./prompts.js";
import {
	buildBookmarkFrontmatter,
	buildFrontmatter,
	DREAM_MIN_HOURS,
	DREAM_MIN_SESSIONS,
	ENTRYPOINT_NAME,
	formatManifest,
	getEntrypointPath,
	getMemoryDir,
	isBookmarkType,
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

function buildPrefetchUserMessage(query: string, manifest: string, rules: SkipRule[], history: HistoryEntry[]): string {
	const rulesSummary = rules
		.map((r) => {
			const builtin = r.builtin ? " (builtin)" : "";
			return `{ "pattern": "${r.pattern}", "mode": "${r.mode}", "action": "${r.action}" }${builtin}`;
		})
		.join("\n");

	const historySummary = JSON.stringify(
		history.map((h) => ({
			query: h.query,
			selected: h.selected,
			skipped: h.skipped,
			skip_hits: h.skip_hits,
			guard_hits: h.guard_hits,
		})),
	);

	return `## 当前查询\n${query}\n\n## 可用文件\n${manifest}\n\n## 当前规则库\n${rulesSummary}\n\n## 最近 Prefetch 历史\n${historySummary}`;
}

interface PrefetchDebugInfo {
	selectedFiles: string[];
	durationMs: number;
	layer: "skip" | "llm" | "none";
	skipHits: Array<{ pattern: string; mode: string }>;
	guardHits: Array<{ pattern: string; mode: string }>;
	availableFiles: number;
	query: string;
}

class MemoryPrefetch {
	private promise: Promise<string> | null = null;
	private settled = false;
	private result: string | null = null;
	private lastSelected: string[] = [];
	private resultEntryWritten = false;
	private store: SkipWordStore | null = null;
	private _debugInfo: PrefetchDebugInfo | null = null;

	get debugInfo(): PrefetchDebugInfo | null {
		return this._debugInfo;
	}

	start(query: string, memoryDir: string, callLLM: CallLLMFn): void {
		this.settled = false;
		this.result = null;
		this._debugInfo = null;
		this.resultEntryWritten = false;
		this.promise = this.run(query, memoryDir, callLLM);
		void this.promise.then((r) => {
			this.result = r;
			this.settled = true;
		});
	}

	get started(): boolean {
		return this.promise !== null;
	}

	collect(): string | null {
		return this.settled ? this.result : null;
	}

	async awaitResult(timeoutMs = 30_000): Promise<string | null> {
		if (this.promise) {
			await Promise.race([
				this.promise,
				new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
			]);
		}
		return this.collect();
	}

	private ensureStore(): SkipWordStore {
		if (!this.store) {
			this.store = loadSkipWordStore(getGlobalMemoryDir());
		}
		return this.store;
	}

	private async run(query: string, memoryDir: string, callLLM: CallLLMFn): Promise<string> {
		try {
			let store = this.ensureStore();
			const { shouldSkip, skipHits, guardHits } = evaluateRules(query, store.rules);

			const matchedRules = store.rules
				.filter((r) => skipHits.includes(r.pattern) || guardHits.includes(r.pattern))
				.map((r) => ({ pattern: r.pattern, mode: r.mode, action: r.action }));
			const matchedSkip = matchedRules.filter((r) => r.action === "skip").map(({ pattern, mode }) => ({ pattern, mode }));
			const matchedGuard = matchedRules.filter((r) => r.action !== "skip").map(({ pattern, mode }) => ({ pattern, mode }));

		if (shouldSkip) {
			this._debugInfo = {
				selectedFiles: this.lastSelected,
				durationMs: 0,
				layer: "skip",
				skipHits: matchedSkip,
				guardHits: matchedGuard,
				availableFiles: 0,
				query: query.slice(0, 200),
			};
			store = addHistoryEntry(store, {
				query: query.slice(0, 200),
				selected: this.lastSelected,
				skipped: true,
				skip_hits: skipHits,
				guard_hits: guardHits,
				timestamp: Date.now(),
			});
			this.store = store;
			await saveSkipWordStore(getGlobalMemoryDir(), this.store);

			if (this.lastSelected.length === 0) return "";
			return await this.readFiles(this.lastSelected, memoryDir);
		}

		const memories = await scanMemoryFiles(memoryDir);
		if (memories.length === 0) {
			this._debugInfo = {
				selectedFiles: [],
				durationMs: 0,
				layer: "none",
				skipHits: matchedSkip,
				guardHits: matchedGuard,
				availableFiles: 0,
				query: query.slice(0, 200),
			};
			return "";
		}

			const manifest = formatManifest(memories);
			const recentHistory = store.history.slice(-5);
			const startTime = Date.now();

			const llmResult = await callLLM({
				systemPrompt: SELECT_MEMORIES_PROMPT,
				messages: [
					{
						role: "user",
						content: buildPrefetchUserMessage(query, manifest, store.rules, recentHistory),
					},
				],
			});

			let parsed: { selected?: string[]; purification?: PurificationResult };
			try {
				parsed = JSON.parse(stripMarkdownCodeBlock(llmResult));
			} catch {
				this._debugInfo = {
					selectedFiles: [],
					durationMs: Date.now() - startTime,
					layer: "llm",
					skipHits: matchedSkip,
					guardHits: matchedGuard,
					availableFiles: memories.length,
					query: query.slice(0, 200),
				};
				return "";
			}

			const selected = (parsed.selected ?? []).slice(0, MAX_RELEVANT_MEMORIES);
			this.lastSelected = selected;

			if (parsed.purification && typeof parsed.purification === "object") {
				try {
					store = applyPurification(store, parsed.purification);
				} catch {}
			}

			store = addHistoryEntry(store, {
				query: query.slice(0, 200),
				selected,
				skipped: false,
				skip_hits: skipHits,
				guard_hits: guardHits,
				timestamp: Date.now(),
			});
			this.store = store;
			await saveSkipWordStore(getGlobalMemoryDir(), this.store);

			this._debugInfo = {
				selectedFiles: selected,
				durationMs: Date.now() - startTime,
				layer: "llm",
				skipHits: matchedSkip,
				guardHits: matchedGuard,
				availableFiles: memories.length,
				query: query.slice(0, 200),
			};

			if (selected.length === 0) return "";

			return await this.readFiles(selected, memoryDir);
		} catch {
			this._debugInfo = {
				selectedFiles: [],
				durationMs: 0,
				layer: "error",
				skipHits: [],
				guardHits: [],
				availableFiles: 0,
				query: query.slice(0, 200),
			};
			return "";
		}
	}

	private async readFiles(filenames: string[], memoryDir: string): Promise<string> {
		const memories = await scanMemoryFiles(memoryDir);
		const parts: string[] = [];
		for (const name of filenames) {
			const header = memories.find((m) => m.filename === name);
			if (!header) continue;
			try {
				const content = await readFile(header.filePath, "utf-8");
				parts.push(`### ${name}\n${content}`);
			} catch {}
		}
		return parts.join("\n\n");
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

	async maybeExtract(
		messages: AgentMessage[],
		memoryDir: string,
		callLLM: CallLLMFn,
	): Promise<{ created: string[]; updated: string[] } | null> {
		if (this.inProgress) {
			this.pendingMessages = messages;
			return null;
		}

		if (this.mainAgentWroteMemory) {
			this.mainAgentWroteMemory = false;
			this.turnsSinceLastExtraction = 0;
			return null;
		}

		this.turnsSinceLastExtraction++;
		if (this.turnsSinceLastExtraction < 2) return null;
		this.turnsSinceLastExtraction = 0;

		return await this.runExtraction(messages, memoryDir, callLLM);
	}

	private async runExtraction(
		messages: AgentMessage[],
		memoryDir: string,
		callLLM: CallLLMFn,
	): Promise<{ created: string[]; updated: string[] } | null> {
		this.inProgress = true;
		try {
			const recent = serializeMessages(messages, { lastN: 20 });
			const manifest = formatManifest(await scanMemoryFiles(memoryDir));

			const llmResult = await callLLM({
				systemPrompt: EXTRACTION_PROMPT(manifest),
				messages: [
					{
						role: "user",
						content: `Recent conversation:\n${recent}\n\nExisting memories:\n${manifest}`,
					},
				],
			});

			let parsed: { actions?: Array<Record<string, string>> };
			try {
				parsed = JSON.parse(stripMarkdownCodeBlock(llmResult));
			} catch {
				return null;
			}

			const actions = parsed.actions ?? [];
			if (actions.length === 0) return null;

			const result = await this.applyActions(actions, memoryDir);
			return result;
		} finally {
			this.inProgress = false;
			if (this.pendingMessages) {
				const pending = this.pendingMessages;
				this.pendingMessages = null;
				await this.runExtraction(pending, memoryDir, callLLM);
			}
		}
	}

	private async applyActions(
		actions: Array<Record<string, string>>,
		memoryDir: string,
	): Promise<{ created: string[]; updated: string[] }> {
		const created: string[] = [];
		const updated: string[] = [];
		for (const action of actions) {
			const op = action.op;

			if (op === "create") {
				const filename = action.filename;
				const content = action.content ?? "";
				if (!filename || !content) continue;

				const name = action.name ?? filename;
				const description = action.description ?? "";
				const type = (action.type as MemoryType) ?? "project";
				const fm = buildFrontmatter({ name, description, type });
				const body = content.slice(0, MAX_MEMORY_BYTES_PER_FILE);
				await writeFile(join(memoryDir, filename), `${fm}\n\n${body}`);
				created.push(filename);
			} else if (op === "update") {
				const filename = action.filename;
				const append = action.append;
				if (!filename || !append) continue;

				const filePath = join(memoryDir, filename);
				if (!existsSync(filePath)) continue;

				const existing = await readFile(filePath, "utf-8");
				await writeFile(filePath, existing + append);
				updated.push(filename);
			}
		}
		await updateMemoryIndex(memoryDir);
		return { created, updated };
	}
}

class BookmarkCreator {
	registerTool(pi: ExtensionAPI): void {
		pi.registerTool({
			name: "create_bookmark",
			label: "create_bookmark",
			description:
				"Create a bookmark memory file from analyzed content. Use this tool to save a structured bookmark with title, description, summary and tags.",
			parameters: Type.Object({
				title: Type.String({ description: "Bookmark title, concise and descriptive" }),
				description: Type.String({ description: "One-line description of the bookmark" }),
				summary: Type.String({ description: "Detailed summary of the bookmarked content" }),
				tags: Type.Array(Type.String(), { description: "Relevant tags for categorization" }),
			}),
			execute: async (
				_toolCallId: string,
				_params: { title: string; description: string; summary: string; tags: string[] },
				_signal?: AbortSignal,
				_onUpdate?: unknown,
				_ctx?: ExtensionContext,
			): Promise<AgentToolResult<void>> => {
				return { content: [{ type: "text", text: "Not used in JSON mode" }], details: undefined };
			},
		});
	}

	async create(
		messageContent: string,
		sessionId: string,
		messageIds: string[],
		memoryDir: string,
		callLLM: (opts: CallLLMOptions) => Promise<string>,
	): Promise<{ filename: string; filePath: string } | null> {
		try {
			const manifest = formatManifest((await scanMemoryFiles(memoryDir)).filter((m) => isBookmarkType(m)));

			const llmResult = await callLLM({
				systemPrompt: BOOKMARK_SUMMARY_PROMPT(messageContent, manifest),
				messages: [{ role: "user", content: "Create a bookmark summary for this content." }],
			});

			let parsed: { title?: string; description?: string; summary?: string; tags?: string[] };
			try {
				parsed = JSON.parse(stripMarkdownCodeBlock(llmResult));
			} catch {
				return null;
			}

			if (!parsed.title) return null;

			const safeTitle = parsed.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_").slice(0, 50);
			const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
			const filename = `${timestamp}_${safeTitle}.md`;
			const filePath = join(memoryDir, filename);

			const fm = buildBookmarkFrontmatter({
				name: parsed.title,
				description: parsed.description ?? "",
				sourceSession: sessionId,
				sourceMessageIds: messageIds,
				tags: parsed.tags ?? [],
				createdAt: new Date().toISOString(),
			});

			const body = `## ${parsed.title}\n\n${parsed.summary ?? ""}\n\n---\n\n## \u539F\u59CB\u5185\u5BB9\u9884\u89C8\n\n> ${messageContent.slice(0, 500)}${messageContent.length > 500 ? "..." : ""}`;

			await writeFile(filePath, `${fm}\n\n${body}`);
			await updateMemoryIndex(memoryDir);

			return { filename, filePath };
		} catch {
			return null;
		}
	}
}

class MemoryDream {
	async maybeRun(
		memoryDir: string,
		callLLM: CallLLMFn,
	): Promise<{ merges: number; deletions: number; updates: number } | null> {
		const lockPath = join(memoryDir, ".consolidate-lock");

		if (!existsSync(lockPath)) {
			await writeFile(lockPath, "");
			await utimes(lockPath, new Date(0), new Date(0));
		}

		let lockStat: Awaited<typeof stat>;
		try {
			lockStat = await stat(lockPath);
		} catch {
			return null;
		}
		const hoursSince = (Date.now() - lockStat.mtimeMs) / 3_600_000;
		if (hoursSince < DREAM_MIN_HOURS) return null;

		const sessionCount = await countSessionsSince(memoryDir, lockStat.mtimeMs);
		if (sessionCount < DREAM_MIN_SESSIONS) return null;

		try {
			const result = await this.runDream(memoryDir, callLLM);
			await utimes(lockPath, new Date(), new Date());
			return result;
		} catch {
			await utimes(lockPath, new Date(lockStat.mtimeMs), new Date(lockStat.mtimeMs));
			return null;
		}
	}

	private async runDream(
		memoryDir: string,
		callLLM: CallLLMFn,
	): Promise<{ merges: number; deletions: number; updates: number } | null> {
		const memories = await scanMemoryFiles(memoryDir);
		if (memories.length === 0) return null;

		const allContent = await readAllMemories(memories);
		const entrypointPath = join(memoryDir, ENTRYPOINT_NAME);
		let indexContent = "";
		try {
			indexContent = await readFile(entrypointPath, "utf-8");
		} catch {}

		const llmResult = await callLLM({
			systemPrompt: DREAM_PROMPT(allContent, indexContent, memoryDir),
			messages: [
				{
					role: "user",
					content: "Perform dream consolidation. Analyze memories and decide what to merge, delete, or update.",
				},
			],
		});

		let parsed: {
			merges?: Array<{ sources?: string[]; target?: string; content?: string }>;
			deletions?: string[];
			updates?: Array<{ filename?: string; newContent?: string }>;
			newIndex?: string;
		};
		try {
			parsed = JSON.parse(stripMarkdownCodeBlock(llmResult));
		} catch {
			return null;
		}

		return await this.applyDreamActions(parsed, memoryDir);
	}

	private async applyDreamActions(
		parsed: {
			merges?: Array<{ sources?: string[]; target?: string; content?: string }>;
			deletions?: string[];
			updates?: Array<{ filename?: string; newContent?: string }>;
			newIndex?: string;
		},
		memoryDir: string,
	): Promise<{ merges: number; deletions: number; updates: number }> {
		const allHeaders = await scanMemoryFiles(memoryDir);
		const bookmarkSet = new Set(allHeaders.filter(isBookmarkType).map((h) => h.filename));

		if (parsed.merges) {
			for (const merge of parsed.merges) {
				if (!merge.sources || !merge.target || merge.content === undefined) continue;

				const sources = merge.sources;
				const hasBookmark = sources.some((s) => bookmarkSet.has(s));
				const hasNonBookmark = sources.some((s) => !bookmarkSet.has(s));
				if (hasBookmark && hasNonBookmark) continue;

				await writeFile(join(memoryDir, merge.target), merge.content);
				for (const source of sources) {
					if (source === merge.target) continue;
					const sourcePath = join(memoryDir, source);
					if (existsSync(sourcePath)) {
						await unlink(sourcePath);
					}
				}
			}
		}

		if (parsed.deletions) {
			for (const filename of parsed.deletions) {
				if (bookmarkSet.has(filename)) continue;
				const filePath = join(memoryDir, filename);
				if (existsSync(filePath)) {
					await unlink(filePath);
				}
			}
		}

		if (parsed.updates) {
			for (const update of parsed.updates) {
				if (!update.filename || !update.newContent) continue;
				await writeFile(join(memoryDir, update.filename), update.newContent);
			}
		}

		const mergeCount = parsed.merges?.length ?? 0;
		const deletionCount = parsed.deletions?.length ?? 0;
		const updateCount = parsed.updates?.length ?? 0;

		if (parsed.newIndex !== undefined) {
			const { content } = truncateEntrypoint(parsed.newIndex);
			await writeFile(join(memoryDir, ENTRYPOINT_NAME), content);
		}

		return { merges: mergeCount, deletions: deletionCount, updates: updateCount };
	}
}

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

export {
	MemoryPrefetch,
	MemoryExtractor,
	MemoryDream,
	BookmarkCreator,
	serializeMessages,
	updateMemoryIndex,
	type CallLLMFn,
};

export default function autoMemoryExtension(pi: ExtensionAPI): void {
	const cwd = process.cwd();
	const memoryDir = getMemoryDir(cwd);
	const prefetch = new MemoryPrefetch();
	const extractor = new MemoryExtractor();
	const dream = new MemoryDream();
	const bookmarkCreator = new BookmarkCreator();
	let draining = false;
	let activeExtraction: Promise<void> | null = null;
	let ctx: ExtensionContext | null = null;

	const callLLMWithRetry: CallLLMFn = async (opts) => {
		const MAX_RETRIES = 100;
		const RETRY_DELAY_MS = 5_000;
		for (let attempt = 0; ; attempt++) {
			try {
				return await pi.callLLM(opts);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				const isRateLimit = /429|rate.?limit|too.?many.?request|quota/i.test(msg);
				if (!isRateLimit || attempt >= MAX_RETRIES) throw err;
				console.error(`[callLLM] rate limited (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${RETRY_DELAY_MS}ms`);
				await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
			}
		}
	};

	bookmarkCreator.registerTool(pi);

	const rawMemoryChannel = pi.registerChannel("memory");
	const memoryChannel = new ServerChannel(rawMemoryChannel);

	function status(msg?: string): void {
		ctx?.ui.setStatus("auto-memory", msg);
	}

	function notify(message: string, type?: "info" | "warning" | "error"): void {
		ctx?.ui.notify(message, type);
	}

	pi.on("session_start", async (_event, context) => {
		ctx = context as ExtensionContext;
		await mkdir(memoryDir, { recursive: true });
		status("memory ready");
	});

	pi.on("before_agent_start", async (event) => {
		let memoryContent = "";
		try {
			memoryContent = await readFile(getEntrypointPath(cwd), "utf-8");
		} catch {}
		const truncated = truncateEntrypoint(memoryContent);
		const memoryPrompt = MEMORY_SYSTEM_PROMPT(memoryDir, truncated.content);

		const lastUserText = event.prompt ?? "";
		if (lastUserText) {
			status("selecting memories...");
			pi.appendEntry("memory_prefetch", {
				query: lastUserText.slice(0, 200),
				memoryDir,
				availableFiles: (await scanMemoryFiles(memoryDir)).length,
			});
			prefetch.start(lastUserText, memoryDir, callLLMWithRetry);
		}

		return { systemPrompt: `${event.systemPrompt}\n\n${memoryPrompt}` };
	});

	pi.on("context", async (event) => {
		const memoryText = await prefetch.awaitResult();
		const debug = prefetch.debugInfo;

		if (!prefetch.resultEntryWritten && prefetch.started) {
			prefetch.resultEntryWritten = true;
			status(memoryText ? "memories injected" : "no memories found");
			pi.appendEntry("memory_prefetch_result", {
				summary: memoryText ? "Injected relevant memories" : "No relevant memories",
				snippet: memoryText ? memoryText.slice(0, 500) : "",
				injectedBytes: memoryText ? memoryText.length : 0,
				selectedFiles: debug?.selectedFiles ?? [],
				durationMs: debug?.durationMs ?? 0,
				layer: debug?.layer ?? "unknown",
				skipHits: debug?.skipHits ?? [],
				guardHits: debug?.guardHits ?? [],
				availableFiles: debug?.availableFiles ?? 0,
			});
		}

		if (!memoryText) return;

		const memoryMessage = {
			role: "user" as const,
			content: [{ type: "text" as const, text: `[Memory context — relevant memories]\n\n${memoryText}` }],
			timestamp: Date.now(),
		};
		return { messages: [...event.messages, memoryMessage] };
	});

	pi.on("tool_call", (event) => {
		const args = (event.input ?? {}) as Record<string, unknown>;
		extractor.onToolCall(event.toolName, args, memoryDir);
	});

	pi.on("agent_end", (event) => {
		if (draining) return;
		activeExtraction = (async () => {
			try {
				status("extracting memories...");
				const extractResult = await extractor.maybeExtract(event.messages, memoryDir, callLLMWithRetry);
				if (extractResult) {
					pi.appendEntry("memory_extract", {
						status: "completed",
						created: extractResult.created,
						updated: extractResult.updated,
					});
				}

				status("consolidating memories...");
				const dreamResult = await dream.maybeRun(memoryDir, callLLMWithRetry);
				if (dreamResult) {
					pi.appendEntry("memory_dream", {
						status: "completed",
						merges: dreamResult.merges,
						deletions: dreamResult.deletions,
						updates: dreamResult.updates,
					});
				}

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

	memoryChannel.handle("memory.list", async () => {
		try {
			const memories = await scanMemoryFiles(memoryDir);
			const files = memories.map((m) => ({
				filename: m.filename,
				filePath: m.filePath,
				description: m.description ?? null,
				type: m.type ?? null,
				mtimeMs: m.mtimeMs,
			}));
			let entrypointContent: string | null = null;
			try {
				entrypointContent = await readFile(getEntrypointPath(cwd), "utf-8");
			} catch {}
			return { type: "list_result", files, entrypointContent, memoryDir };
		} catch {
			return { type: "list_result", files: [], entrypointContent: null, memoryDir };
		}
	});

	memoryChannel.handle("memory.userRemember", async (params) => {
		const data = params as {
			sourceSessionId?: string;
			sourceMessageIds?: string[];
			content?: string;
		};
		memoryChannel.emit("bookmark_creating", { type: "bookmark_creating" });
		pi.appendEntry("memory_creating", { content: data.content?.slice(0, 200) });
		try {
			const result = await bookmarkCreator.create(
				data.content ?? "",
				data.sourceSessionId ?? "",
				data.sourceMessageIds ?? [],
				memoryDir,
				callLLMWithRetry,
			);
			if (result) {
				pi.appendEntry("memory_created", result);
				const updatedMemories = await scanMemoryFiles(memoryDir);
				memoryChannel.emit("memory_updated", {
					type: "memory_updated",
					files: updatedMemories.map((m) => ({
						filename: m.filename,
						filePath: m.filePath,
						description: m.description ?? null,
						type: m.type ?? null,
						mtimeMs: m.mtimeMs,
					})),
				});
			} else {
				pi.appendEntry("memory_failed", { reason: "LLM failed" });
				memoryChannel.emit("memory_update_failed", { type: "memory_update_failed", reason: "LLM failed" });
			}
		} catch (e) {
			const errMsg = e instanceof Error ? e.message : String(e);
			pi.appendEntry("memory_failed", { reason: errMsg });
			notify(`Bookmark error: ${errMsg}`, "warning");
			memoryChannel.emit("memory_update_failed", { type: "memory_update_failed", reason: "Error" });
		}
		return { ok: true };
	});
}

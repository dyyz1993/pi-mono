/**
 * Message Bridge Extension for pi
 *
 * 1. 拦截 ctx.ui.askUserQuestion 调用，转发到 Message Bridge 服务。
 *    用 ctx.respondUI 异步注入远程回复，与本地 UI 竞争（race 模式）。
 *
 * 2. 监听 agent_end 事件，将 Assistant 回复作为纯文本推送到 Message Bridge。
 *    如果用户在移动端回复，调用 pi.sendUserMessage 将回复注入回 Agent。
 *
 * 类型映射：
 *   askUserQuestion → Ask v2 {method:"askUserQuestion", questions:[...]}
 *   notify  → 纯文本推送（fire-and-forget，不等待回复）
 *
 * answer 解析：
 *   askUserQuestion → {action:"responded", answers:{...}}
 *
 * 用法：
 *   --extension ./extensions/message-bridge/index.ts
 *   或 settings.json: { "extensions": ["./extensions/message-bridge/index.ts"] }
 *
 * 环境变量：
 *   MESSAGE_BRIDGE_URL          - 服务地址（必填，无默认值）
 *   MESSAGE_BRIDGE_SESSION_ID   - 可选 session 过滤
 *   MESSAGE_BRIDGE_TIMEOUT_MS   - 单次 fetch 超时（默认 60000ms）
 *
 * 可靠性保证：
 *   - 所有 fetch 调用都带 AbortController + 超时，避免永久挂起
 *   - askUserQuestion 路径复用 event.timeout（若存在），否则用默认值
 *   - pi.sendUserMessage 的 Promise rejection 被显式捕获
 *   - 错误日志区分 push/pull/respondUI/sendUserMessage 失败，便于排障
 */

import type { ExtensionAPI, ExtensionContext, UIEvent, UIEventResult, AgentEndEvent } from "@dyyz1993/pi-coding-agent";
import type { AgentMessage } from "@dyyz1993/pi-agent-core";

const BRIDGE_URL = process.env.MESSAGE_BRIDGE_URL || "";
const DEFAULT_TIMEOUT_MS = Number(process.env.MESSAGE_BRIDGE_TIMEOUT_MS) || 60_000;

interface PushResponse {
	id: string;
	status: string;
}

interface PullResponse {
	id: string;
	answer: unknown;
}

function ensureBridgeUrl(): string {
	if (!BRIDGE_URL) {
		throw new Error("MESSAGE_BRIDGE_URL is not set; message-bridge extension requires it");
	}
	return BRIDGE_URL;
}

/**
 * Create an AbortController that auto-aborts after `timeoutMs`.
 * Returns `{ signal, cleanup }` — caller should call `cleanup()` to clear
 * the timeout after the fetch resolves (pretempts the timer from keeping
 * the event loop alive).
 */
function createTimeoutSignal(timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	return {
		signal: controller.signal,
		cleanup: () => clearTimeout(timer),
	};
}

async function pushQuestion(
	question: unknown,
	sessionId?: string,
	requestId?: string,
	timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string> {
	const url = ensureBridgeUrl();
	const { signal, cleanup } = createTimeoutSignal(timeoutMs);
	try {
		const resp = await fetch(`${url}/push`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ question, request_id: requestId, session_id: sessionId }),
			signal,
		});
		if (!resp.ok) throw new Error(`Message Bridge push failed: ${resp.status}`);
		const data = (await resp.json()) as PushResponse;
		return data.id;
	} finally {
		cleanup();
	}
}

async function pullAnswer(msgId: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<unknown> {
	const url = ensureBridgeUrl();
	const { signal, cleanup } = createTimeoutSignal(timeoutMs);
	try {
		const resp = await fetch(`${url}/pull/${msgId}`, { signal });
		if (!resp.ok) throw new Error(`Message Bridge pull failed: ${resp.status}`);
		const data = (await resp.json()) as PullResponse;
		return data.answer;
	} finally {
		cleanup();
	}
}

async function pushAndWait(question: unknown, sessionId?: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<string> {
	const id = await pushQuestion(question, sessionId, undefined, timeoutMs);
	const answer = await pullAnswer(id, timeoutMs);
	return typeof answer === "string" ? answer : JSON.stringify(answer);
}

function buildAskUserQuestionRequest(event: UIEvent): Record<string, unknown> {
	return {
		type: "extension_ui_request",
		id: event.id,
		method: "askUserQuestion",
		title: event.title,
		questions: event.questions ?? [],
		timeout: event.timeout,
		toolCallId: event.toolCallId,
	};
}

async function pushAskUserQuestionAndWait(
	question: Record<string, unknown>,
	requestId: string,
	sessionId?: string,
	timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<UIEventResult> {
	const id = await pushQuestion(question, sessionId, requestId, timeoutMs);
	const answer = await pullAnswer(id, timeoutMs);

	if (!answer || typeof answer !== "object") {
		throw new Error("Message Bridge askUserQuestion answer must be structured");
	}
	const result = answer as UIEventResult;
	if (!result || result.action !== "responded" || !("answers" in result)) {
		throw new Error("Message Bridge askUserQuestion answer missing answers");
	}
	return result;
}

async function pushNativeAskAndWait(event: UIEvent, sessionId?: string): Promise<UIEventResult> {
	const question = {
		...buildAskUserQuestionRequest(event),
	};
	// Honor event.timeout if set (UIEvent.timeout is in seconds for askUserQuestion);
	// otherwise fall back to DEFAULT_TIMEOUT_MS.
	const timeoutMs = typeof event.timeout === "number" && event.timeout > 0
		? event.timeout * 1000
		: DEFAULT_TIMEOUT_MS;
	return pushAskUserQuestionAndWait(question, event.id, sessionId, timeoutMs);
}

function extractMessageText(message: unknown): string {
	if (!message || typeof message !== "object" || !("content" in message)) return "";
	const content = (message as { content?: string | Array<{ type: string; text?: string }> }).content;
	if (content === undefined) return "";
	if (typeof content === "string") return content;
	return content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function logError(stage: "push" | "pull" | "respondUI" | "sendUserMessage", err: unknown): void {
	// Distinguish failure stage for easier debugging. Use console.error (not debug)
	// since these indicate real reliability issues. Preserve stack when available.
	const message = err instanceof Error ? err.message : String(err);
	const stack = err instanceof Error ? err.stack : undefined;
	console.error(`[message-bridge] ${stage} failed: ${message}`, stack ?? "");
}

function isStaleError(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	return /stale/i.test(message);
}

export default function messageBridgeExtension(pi: ExtensionAPI) {
	const sessionId = process.env.MESSAGE_BRIDGE_SESSION_ID || undefined;

	pi.on("ui", async (event: UIEvent, ctx: ExtensionContext) => {
		if (event.method === "notify") {
			if (event.message == null) return undefined;
			// notify is fire-and-forget for the caller, but we still await the
			// bridge round-trip internally to preserve ordering and surface
			// errors. Errors are logged, not propagated.
			pushAndWait(event.message, sessionId).catch((err) => logError("push", err));
			return undefined;
		}

		if (event.method === "askUserQuestion") {
			pushNativeAskAndWait(event, sessionId)
				.then((result) => {
					try {
						ctx.respondUI(event.id, result);
					} catch (e) {
						// respondUI may throw if the UI event was already resolved
						// (race with local UI) or if the session went stale.
						// Stale races are expected; re-throw everything else.
						if (!isStaleError(e)) {
							logError("respondUI", e);
						}
					}
				})
				.catch((err) => logError("push", err));
			return undefined;
		}

		return undefined;
	});

	pi.on("agent_end", async (event: AgentEndEvent) => {
		if (!event?.messages) return;

		const assistantTexts = event.messages
			.filter((m: AgentMessage) => m.role === "assistant")
			.map((m: AgentMessage) => extractMessageText(m))
			.filter((t: string) => t.trim());
		if (assistantTexts.length === 0) return;

		const text = assistantTexts.join("\n\n---\n\n");

		pushQuestion(text, sessionId)
			.then((id) => pullAnswer(id))
			.then((answer) => {
				if (typeof answer === "string" && answer.trim()) {
					// pi.sendUserMessage may return either void or Promise<void>
					// depending on the ExtensionAPI variant. We must catch both
					// synchronous throws and async rejections — otherwise they
					// become unhandled Promise rejections that crash the process.
					try {
						const ret = pi.sendUserMessage(answer.trim()) as unknown;
						if (ret && typeof (ret as { then?: unknown }).then === "function") {
							(ret as Promise<void>).catch((err) => {
								if (!isStaleError(err)) logError("sendUserMessage", err);
							});
						}
					} catch (e) {
						if (!isStaleError(e)) logError("sendUserMessage", e);
					}
				}
			})
			.catch((err) => logError("push", err));
	});
}

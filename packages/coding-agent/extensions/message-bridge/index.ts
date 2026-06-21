/**
 * Message Bridge Extension for pi
 *
 * 1. 拦截 ctx.ui.askUserQuestion 调用，转发到 Message Bridge 服务。
 *    用 ctx.respondUI 异步注入远程回复，与本地 UI 竞争（race 模式）。
 *
 * 2. 监听 message_end 事件，将 Assistant 回复作为纯文本推送到 Message Bridge。
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
 *   MESSAGE_BRIDGE_URL          - 服务地址（默认 https://message-bridge.docker.19930810.xyz:8443）
 *   MESSAGE_BRIDGE_SESSION_ID   - 可选 session 过滤
 */

import type { ExtensionAPI, ExtensionContext, UIEvent, UIEventResult, AgentEndEvent } from "@dyyz1993/pi-coding-agent";
import type { AgentMessage } from "@dyyz1993/pi-agent-core";

const BRIDGE_URL = process.env.MESSAGE_BRIDGE_URL || "https://message-bridge.docker.19930810.xyz:8443";

interface PushResponse {
	id: string;
	status: string;
}

interface PullResponse {
	id: string;
	answer: unknown;
}

async function pushQuestion(question: unknown, sessionId?: string, requestId?: string): Promise<string> {
	const resp = await fetch(`${BRIDGE_URL}/push`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ question, request_id: requestId, session_id: sessionId }),
	});
	if (!resp.ok) throw new Error(`Message Bridge push failed: ${resp.status}`);
	const data = (await resp.json()) as PushResponse;
	return data.id;
}

async function pullAnswer(msgId: string): Promise<unknown> {
	const resp = await fetch(`${BRIDGE_URL}/pull/${msgId}`);
	if (!resp.ok) throw new Error(`Message Bridge pull failed: ${resp.status}`);
	const data = (await resp.json()) as PullResponse;
	return data.answer;
}

async function pushAndWait(question: unknown, sessionId?: string): Promise<string> {
	const id = await pushQuestion(question, sessionId);
	const answer = await pullAnswer(id);
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

async function pushAskUserQuestionAndWait(question: Record<string, unknown>, requestId: string, sessionId?: string): Promise<UIEventResult> {
	const id = await pushQuestion(question, sessionId, requestId);
	const answer = await pullAnswer(id);

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
	return pushAskUserQuestionAndWait(question, event.id, sessionId);
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

export default function messageBridgeExtension(pi: ExtensionAPI) {
	const sessionId = process.env.MESSAGE_BRIDGE_SESSION_ID || undefined;

	pi.on("ui", async (event: UIEvent, ctx: ExtensionContext) => {
		if (event.method === "notify") {
			if (event.message == null) return undefined;
			pushAndWait(event.message, sessionId).catch((err) => console.debug("[message-bridge] notify push failed:", err instanceof Error ? err.message : err));
			return undefined;
		}

		if (event.method === "askUserQuestion") {
			pushNativeAskAndWait(event, sessionId)
				.then((result) => {
					try { ctx.respondUI(event.id, result); } catch (e) { if (!/stale/i.test(e instanceof Error ? e.message : "")) throw e; }
				})
				.catch((err) => console.debug("[message-bridge] askUserQuestion push failed:", err instanceof Error ? err.message : err));
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
					try { pi.sendUserMessage(answer.trim()); } catch (e) { if (!/stale/i.test(e instanceof Error ? e.message : "")) throw e; }
				}
			})
			.catch((err) => console.debug("[message-bridge] agent_end push failed:", err instanceof Error ? err.message : err));
	});
}

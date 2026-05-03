/**
 * Message Bridge Extension for pi
 *
 * 1. 拦截 ctx.ui.confirm/select/input 调用，转发到 Message Bridge 服务。
 *    用 ctx.respondUI 异步注入远程回复，与本地 UI 竞争（race 模式）。
 *
 * 2. 监听 message_end 事件，将 Assistant 回复作为纯文本推送到 Message Bridge。
 *    如果用户在移动端回复，调用 pi.sendUserMessage 将回复注入回 Agent。
 *
 * 类型映射：
 *   confirm → {type: "confirm", question: ...}
 *   select  → {type: "radio", question, options}
 *   input   → 纯文本推送
 *   notify  → 纯文本推送（fire-and-forget，不等待回复）
 *
 * answer 解析：
 *   confirm → "【确认】: 确定" / "【确认】: 取消" → confirmed: true/false
 *   radio   → "【问题】: 选项A" → value: "选项A"
 *   纯文本  → 直接返回 answer
 *
 * 用法：
 *   --extension ./extensions/message-bridge/index.ts
 *   或 settings.json: { "extensions": ["./extensions/message-bridge/index.ts"] }
 *
 * 环境变量：
 *   MESSAGE_BRIDGE_URL          - 服务地址（默认 https://message-bridge.docker.19930810.xyz:8443）
 *   MESSAGE_BRIDGE_SESSION_ID   - 可选 session 过滤
 */

const BRIDGE_URL = process.env.MESSAGE_BRIDGE_URL || "https://message-bridge.docker.19930810.xyz:8443";

interface PushResponse {
	id: string;
	status: string;
}

interface PullResponse {
	id: string;
	answer: string;
}

async function pushQuestion(question: unknown, sessionId?: string): Promise<string> {
	const resp = await fetch(`${BRIDGE_URL}/push`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ question, session_id: sessionId }),
	});
	if (!resp.ok) throw new Error(`Message Bridge push failed: ${resp.status}`);
	const data = (await resp.json()) as PushResponse;
	return data.id;
}

async function pullAnswer(msgId: string): Promise<string> {
	const resp = await fetch(`${BRIDGE_URL}/pull/${msgId}`);
	if (!resp.ok) throw new Error(`Message Bridge pull failed: ${resp.status}`);
	const data = (await resp.json()) as PullResponse;
	return data.answer;
}

async function pushAndWait(question: unknown, sessionId?: string): Promise<string> {
	const id = await pushQuestion(question, sessionId);
	return pullAnswer(id);
}

function buildConfirmQuestion(title: string, message?: string): Record<string, unknown> {
	const question = message ? `${title} - ${message}` : title;
	return { type: "confirm", question };
}

function buildSelectQuestion(title: string, options: string[], multiple?: boolean): Record<string, unknown> {
	return {
		type: multiple ? "checkbox" : "radio",
		question: title,
		options: options.map((label) => ({ label, description: "" })),
	};
}

function parseConfirmAnswer(answer: string): boolean {
	const trimmed = answer.trim();
	if (trimmed.includes("取消") || trimmed.includes("拒绝")) return false;
	if (trimmed.includes("确定") || trimmed.includes("确认")) return true;
	const normalized = trimmed.toLowerCase();
	return normalized === "yes" || normalized === "y" || normalized === "true" || normalized === "1";
}

function parseSelectAnswer(answer: string): string {
	const trimmed = answer.trim();
	const colonIdx = trimmed.indexOf("】:");
	if (colonIdx !== -1) {
		const value = trimmed.slice(colonIdx + 2).trim();
		const parts = value.split(",").map((s) => s.trim());
		return parts[0];
	}
	try {
		const parsed = JSON.parse(trimmed);
		if (Array.isArray(parsed)) return String(parsed[0] ?? trimmed);
		if (typeof parsed === "string") return parsed;
		return trimmed;
	} catch {
		return trimmed;
	}
}

function parseMultiSelectAnswer(answer: string, options: string[]): string[] {
	const trimmed = answer.trim();
	try {
		const parsed = JSON.parse(trimmed);
		if (Array.isArray(parsed)) {
			return parsed.map(String).filter((v) => options.includes(v));
		}
	} catch {}
	const colonIdx = trimmed.indexOf("】:");
	if (colonIdx !== -1) {
		const value = trimmed.slice(colonIdx + 2).trim();
		return value
			.split(",")
			.map((s) => s.trim())
			.filter((v) => options.includes(v));
	}
	return options.includes(trimmed) ? [trimmed] : [];
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

export default function messageBridgeExtension(pi: any) {
	const sessionId = process.env.MESSAGE_BRIDGE_SESSION_ID || undefined;

	pi.on("ui", async (event: any, ctx: any) => {
		if (event.method === "notify") {
			pushAndWait(event.message, sessionId).catch(() => {});
			return undefined;
		}

		if (event.method === "confirm") {
			const question = buildConfirmQuestion(event.title, event.message);
			pushAndWait(question, sessionId)
				.then((answer) => {
					const confirmed = parseConfirmAnswer(answer);
					ctx.respondUI(event.id, { action: "responded", confirmed });
				})
				.catch(() => {});
			return undefined;
		}

		if (event.method === "select") {
			const options: string[] = event.options ?? [];
			const multiple: boolean = event.multiple === true;
			const question = buildSelectQuestion(event.title, options, multiple);
			pushAndWait(question, sessionId)
				.then((answer) => {
					if (multiple) {
						const values = parseMultiSelectAnswer(answer, options);
						ctx.respondUI(event.id, { action: "responded", value: values });
					} else {
						const value = parseSelectAnswer(answer);
						ctx.respondUI(event.id, { action: "responded", value });
					}
				})
				.catch(() => {});
			return undefined;
		}

		if (event.method === "input") {
			const question = event.placeholder
				? `${event.title}\n\nPlaceholder: ${event.placeholder}`
				: event.title;
			pushAndWait(question, sessionId)
				.then((answer) => {
					ctx.respondUI(event.id, { action: "responded", value: answer });
				})
				.catch(() => {});
			return undefined;
		}

		if (event.method === "editor") {
			const question = event.prefill
				? `${event.title}\n\nPre-filled content:\n${event.prefill}`
				: event.title;
			pushAndWait(question, sessionId)
				.then((answer) => {
					ctx.respondUI(event.id, { action: "responded", value: answer });
				})
				.catch(() => {});
			return undefined;
		}

		return undefined;
	});

	pi.on("agent_end", async (event: any) => {
		if (!event?.messages) return;

		const assistantTexts = event.messages
			.filter((m: any) => m.role === "assistant")
			.map((m: any) => extractMessageText(m))
			.filter((t: string) => t.trim());
		if (assistantTexts.length === 0) return;

		const text = assistantTexts.join("\n\n---\n\n");

		pushQuestion(text, sessionId)
			.then((id) => pullAnswer(id))
			.then((answer) => {
				if (answer?.trim()) {
					pi.sendUserMessage(answer.trim());
				}
			})
			.catch(() => {});
	});
}

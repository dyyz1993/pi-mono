/**
 * Message Bridge Manual E2E Test
 *
 * 启动后自动触发 confirm → 推送到 Bridge → 卡住等用户手动回复
 * 用户回复后 agent 继续 → agent_end 推送最终文本 → 用户可再回复触发新任务
 *
 * 用法: bash test/suite/run-message-bridge-manual.sh
 */

import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { Type } from "typebox";
import { createHarness, getAssistantTexts, type Harness } from "./harness.js";

const BRIDGE_URL = process.env.MESSAGE_BRIDGE_URL || "https://message-bridge.docker.19930810.xyz:8443";
const SESSION_ID = process.env.MESSAGE_BRIDGE_SESSION_ID || "pi-manual-test";

function log(tag: string, message: string) {
	const ts = new Date().toISOString().slice(11, 23);
	console.log(`[${ts}] [${tag}] ${message}`);
}

function makeUIContext(overrides: Record<string, (...args: any[]) => any> = {}) {
	return {
		confirm: async () => true,
		select: async () => undefined,
		input: async () => undefined,
		notify: (msg: string) => log("NOTIFY", msg),
		onTerminalInput: () => () => {},
		setStatus: () => {},
		setWorkingMessage: () => {},
		setWorkingIndicator: () => {},
		setHiddenThinkingLabel: () => {},
		setWidget: () => {},
		setFooter: () => {},
		setHeader: () => {},
		setTitle: () => {},
		custom: async () => undefined as never,
		pasteToEditor: () => {},
		setEditorText: () => {},
		getEditorText: () => "",
		editor: async () => undefined,
		addAutocompleteProvider: () => {},
		setEditorComponent: () => {},
		get theme() {
			return {} as any;
		},
		getAllThemes: () => [],
		getTheme: () => undefined,
		setTheme: () => ({ success: false }),
		getToolsExpanded: () => false,
		setToolsExpanded: () => {},
		...overrides,
	};
}

type MessageContent = Array<{ type: string; text?: string }>;

function extractToolResultText(context: { messages: Array<{ role: string; content?: MessageContent }> }): string {
	const toolResult = context.messages.find((message) => message.role === "toolResult");
	if (!toolResult || !Array.isArray(toolResult.content)) return "";
	return toolResult.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function loadBridgeFactory(): any {
	const BRIDGE = BRIDGE_URL;
	const sid = SESSION_ID;

	return function messageBridgeExtension(pi: any) {
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

		async function pushQuestion(question: unknown, sessionId?: string): Promise<string> {
			const resp = await fetch(`${BRIDGE}/push`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ question, session_id: sessionId }),
			});
			if (!resp.ok) throw new Error(`push failed: ${resp.status}`);
			return ((await resp.json()) as any).id;
		}

		async function pullAnswer(msgId: string): Promise<string> {
			const resp = await fetch(`${BRIDGE}/pull/${msgId}`);
			if (!resp.ok) throw new Error(`pull failed: ${resp.status}`);
			return ((await resp.json()) as any).answer;
		}

		function parseConfirmAnswer(answer: string): boolean {
			const trimmed = answer.trim();
			if (trimmed.includes("取消") || trimmed.includes("拒绝")) return false;
			if (trimmed.includes("确定") || trimmed.includes("确认")) return true;
			const n = trimmed.toLowerCase();
			return n === "yes" || n === "y" || n === "true" || n === "1";
		}

		function parseSelectAnswer(answer: string): string {
			const trimmed = answer.trim();
			const idx = trimmed.indexOf("】:");
			if (idx !== -1) {
				const value = trimmed.slice(idx + 2).trim();
				return value.split(",").map((s) => s.trim())[0];
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

		pi.on("ui", async (event: any, ctx: any) => {
			if (event.method === "notify") {
				pushQuestion(event.title || event.message, sid)
					.then((id) => pullAnswer(id))
					.catch(() => {});
				return undefined;
			}
			if (event.method === "confirm") {
				const question = {
					type: "confirm",
					question: event.message ? `${event.title} - ${event.message}` : event.title,
				};
				log("BRIDGE", `Pushing confirm: ${JSON.stringify(question)}`);
				pushQuestion(question, sid)
					.then((id) => {
						log("BRIDGE", `Pushed id=${id}, waiting for manual reply...`);
						return pullAnswer(id);
					})
					.then((answer) => {
						const confirmed = parseConfirmAnswer(answer);
						log("BRIDGE", `Got reply: "${answer}" → confirmed=${confirmed}`);
						ctx.respondUI(event.id, { action: "responded", confirmed });
					})
					.catch((err) => log("ERROR", `confirm failed: ${err}`));
				return undefined;
			}
			if (event.method === "select") {
				const options: string[] = event.options ?? [];
				const question = {
					type: "radio",
					question: event.title,
					options: options.map((l) => ({ label: l, description: "" })),
				};
				log("BRIDGE", `Pushing select: ${JSON.stringify(question)}`);
				pushQuestion(question, sid)
					.then((id) => {
						log("BRIDGE", `Pushed id=${id}, waiting for manual reply...`);
						return pullAnswer(id);
					})
					.then((answer) => {
						const value = parseSelectAnswer(answer);
						log("BRIDGE", `Got reply: "${answer}" → value=${value}`);
						ctx.respondUI(event.id, { action: "responded", value });
					})
					.catch((err) => log("ERROR", `select failed: ${err}`));
				return undefined;
			}
			if (event.method === "input") {
				const question = event.placeholder ? `${event.title}\n\nPlaceholder: ${event.placeholder}` : event.title;
				log("BRIDGE", `Pushing input: ${question}`);
				pushQuestion(question, sid)
					.then((id) => {
						log("BRIDGE", `Pushed id=${id}, waiting for manual reply...`);
						return pullAnswer(id);
					})
					.then((answer) => {
						log("BRIDGE", `Got reply: "${answer}"`);
						ctx.respondUI(event.id, { action: "responded", value: answer });
					})
					.catch((err) => log("ERROR", `input failed: ${err}`));
				return undefined;
			}
			return undefined;
		});

		pi.on("agent_end", async (event: any) => {
			if (!event?.messages) return;
			const texts = event.messages
				.filter((m: any) => m.role === "assistant")
				.map((m: any) => extractMessageText(m))
				.filter((t: string) => t.trim());
			if (texts.length === 0) return;
			const text = texts.join("\n\n---\n\n");
			log("BRIDGE", `Agent ended. Pushing final text (${text.length} chars)...`);
			pushQuestion(text, sid)
				.then((id) => {
					log("BRIDGE", `Final text pushed id=${id}. Waiting for your next instruction...`);
					return pullAnswer(id);
				})
				.then((answer) => {
					if (answer?.trim()) {
						log("BRIDGE", `Got new instruction: "${answer}" → sendUserMessage`);
						pi.sendUserMessage(answer.trim());
					}
				})
				.catch((err) => log("ERROR", `agent_end push failed: ${err}`));
		});
	};
}

async function main() {
	log("SETUP", "Creating harness with message-bridge extension...");

	const bridgeFactory = loadBridgeFactory();

	const harness: Harness = await createHarness({
		extensionFactories: [
			(pi: any) => {
				pi.registerTool({
					name: "ask-confirm",
					label: "Ask Confirm",
					description: "Asks a confirmation question",
					parameters: Type.Object({ question: Type.String() }),
					execute: async (_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) => {
						log("TOOL", `ask-confirm called: ${params.question}`);
						const confirmed = await ctx.ui.confirm("Permission", params.question);
						log("TOOL", `ctx.ui.confirm returned: ${confirmed}`);
						return {
							content: [{ type: "text", text: confirmed ? "confirmed" : "denied" }],
						};
					},
				});
			},
			bridgeFactory,
		],
	});

	await harness.session.bindExtensions({
		uiContext: makeUIContext({
			confirm: async () => {
				log("ORIGINAL-UI", "confirm() called → hanging, waiting for Bridge reply...");
				return new Promise(() => {});
			},
		}),
		shutdownHandler: () => {},
	});

	log("SETUP", "Harness ready. Original UI confirm hangs forever.");

	harness.setResponses([
		fauxAssistantMessage([fauxToolCall("ask-confirm", { question: "Should I deploy to production?" })], {
			stopReason: "toolUse",
		}),
		(context: any) => fauxAssistantMessage(extractToolResultText(context)),
	]);

	for (let i = 0; i < 20; i++) {
		harness.appendResponses([fauxAssistantMessage(`收到指令，处理中... (round ${i + 1})`)]);
	}

	harness.session.subscribe((event: any) => {
		if (event.type === "tool_execution_start") {
			log("EVENT", `tool_execution_start: ${event.toolName}(${JSON.stringify(event.args)})`);
		} else if (event.type === "tool_execution_end") {
			const result = event.result?.content?.map((c: any) => c.text)?.join(", ");
			log("EVENT", `tool_execution_end: ${event.toolName} → ${result}`);
		} else if (event.type === "agent_end") {
			log("EVENT", `agent_end: ${event.messages?.length} messages`);
		} else if (event.type === "message_end") {
			log("EVENT", `message_end: role=${event.message?.role}`);
		}
	});

	log("PROMPT", 'Sending prompt: "deploy"');
	log("PROMPT", ">>> Agent will call ask-confirm, which triggers Bridge push");
	log("PROMPT", ">>> GO TO YOUR BRIDGE UI AND REPLY MANUALLY <<<");
	log("PROMPT", "");

	await harness.session.prompt("deploy");

	const texts = getAssistantTexts(harness);
	log("RESULT", `Agent final texts: ${JSON.stringify(texts)}`);
	log("DONE", "Agent completed. The agent_end handler should have pushed final text to Bridge.");
	log("DONE", "Reply from Bridge to trigger sendUserMessage (new turn).");
	log("DONE", "");
	log("DONE", "Script will stay alive to keep the Bridge listeners active...");
	log("DONE", "Press Ctrl+C to stop.");

	await new Promise(() => {});
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});

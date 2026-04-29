/**
 * Message Bridge E2E 验证脚本
 *
 * 用法: npx tsx test/suite/run-message-bridge.ts
 *
 * 流程:
 * 1. 创建 pi harness，加载 message-bridge 插件 + ask-confirm 工具
 * 2. LLM (faux) 调用 ask-confirm 工具 → ctx.ui.confirm() 被拦截
 * 3. 插件 push 到 Message Bridge → 脚本从 /messages 取到消息 ID
 * 4. 脚本调 /answer/{msg_id} 回复 "【确认】: 确定"
 * 5. 插件 pullAnswer 拿到回复 → ctx.respondUI 注入 → 工具拿到 confirmed=true
 * 6. 验证 agent 最终输出
 */

import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { Type } from "typebox";
import { createHarness, getAssistantTexts, type Harness } from "./harness.js";

const BRIDGE_URL = process.env.MESSAGE_BRIDGE_URL || "https://message-bridge.docker.19930810.xyz:8443";
const SESSION_ID = "pi-e2e-test";

type MessageContent = Array<{ type: string; text?: string }>;

function extractToolResultText(context: { messages: Array<{ role: string; content?: MessageContent }> }): string {
	const toolResult = context.messages.find((message) => message.role === "toolResult");
	if (!toolResult || !Array.isArray(toolResult.content)) return "";
	return toolResult.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

let messageBridgeFactory: any;
function loadBridgeFactory(): any {
	if (!messageBridgeFactory) {
		const BRIDGE = BRIDGE_URL;
		const sid = SESSION_ID;

		messageBridgeFactory = function messageBridgeExtension(pi: any) {
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
					pushQuestion(question, sid)
						.then((id) => pullAnswer(id))
						.then((answer) => {
							ctx.respondUI(event.id, { action: "responded", confirmed: parseConfirmAnswer(answer) });
						})
						.catch(() => {});
					return undefined;
				}
				if (event.method === "select") {
					const options: string[] = event.options ?? [];
					const question = {
						type: "radio",
						question: event.title,
						options: options.map((l) => ({ label: l, description: "" })),
					};
					pushQuestion(question, sid)
						.then((id) => pullAnswer(id))
						.then((answer) => {
							ctx.respondUI(event.id, { action: "responded", value: parseSelectAnswer(answer) });
						})
						.catch(() => {});
					return undefined;
				}
				if (event.method === "input") {
					const question = event.placeholder ? `${event.title}\n\nPlaceholder: ${event.placeholder}` : event.title;
					pushQuestion(question, sid)
						.then((id) => pullAnswer(id))
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
				const texts = event.messages
					.filter((m: any) => m.role === "assistant")
					.map((m: any) => extractMessageText(m))
					.filter((t: string) => t.trim());
				if (texts.length === 0) return;
				pushQuestion(texts.join("\n\n---\n\n"), sid)
					.then((id) => pullAnswer(id))
					.then((answer) => {
						if (answer?.trim()) pi.sendUserMessage(answer.trim());
					})
					.catch(() => {});
			});
		};
	}
	return messageBridgeFactory;
}

function log(tag: string, message: string) {
	const ts = new Date().toISOString().slice(11, 23);
	console.log(`[${ts}] [${tag}] ${message}`);
}

function separator(title: string) {
	console.log(`\n${"=".repeat(60)}`);
	console.log(`  ${title}`);
	console.log(`${"=".repeat(60)}`);
}

async function waitForMessageOnBridge(
	sessionId: string,
	since: number,
	questionContains: string,
): Promise<{ id: string; question: any }> {
	const maxAttempts = 30;
	for (let i = 0; i < maxAttempts; i++) {
		try {
			const resp = await fetch(`${BRIDGE_URL}/messages?session_id=${sessionId}`);
			if (!resp.ok) continue;
			const messages = (await resp.json()) as Array<{
				id: string;
				question: any;
				answer?: string;
				created_at: number;
			}>;
			const recent = messages.filter((m) => {
				if (m.created_at <= since) return false;
				if (m.answer) return false;
				const q = typeof m.question === "string" ? m.question : JSON.stringify(m.question);
				return q.includes(questionContains);
			});
			if (recent.length > 0) return recent[0];
		} catch {}
		await new Promise((r) => setTimeout(r, 200));
	}
	throw new Error("Timed out waiting for message on Bridge");
}

async function answerOnBridge(msgId: string, answer: string): Promise<void> {
	const resp = await fetch(`${BRIDGE_URL}/answer/${msgId}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ answer }),
	});
	if (!resp.ok) throw new Error(`Answer failed: ${resp.status}`);
	log("BRIDGE", `Answered ${msgId}: "${answer}"`);
}

function makeUIContext(overrides: Record<string, (...args: any[]) => any> = {}) {
	return {
		confirm: async () => true,
		select: async () => undefined,
		input: async () => undefined,
		notify: () => {},
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

function hangingPromise(): Promise<never> {
	return new Promise(() => {});
}

async function runConfirmScenario(): Promise<boolean> {
	separator("Scenario: confirm via Message Bridge");

	const beforeTime = Date.now() / 1000;

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
			confirm: async (..._args: any[]) => {
				log("ORIGINAL-UI", "confirm() called (will hang, waiting for respondUI to win)");
				return hangingPromise();
			},
		}),
		shutdownHandler: () => {},
	});
	log("SETUP", "UI context bound (original confirm hangs forever)");

	harness.setResponses([
		fauxAssistantMessage([fauxToolCall("ask-confirm", { question: "Should I proceed?" })], {
			stopReason: "toolUse",
		}),
		(context: any) => fauxAssistantMessage(extractToolResultText(context)),
	]);

	const eventLog: Array<{ seq: number; event: string; detail: string }> = [];
	let seq = 0;
	const unsub = harness.session.subscribe((event: any) => {
		seq++;
		let detail = "";
		if (event.type === "tool_execution_start") detail = `tool=${event.toolName} args=${JSON.stringify(event.args)}`;
		else if (event.type === "tool_execution_end")
			detail = `tool=${event.toolName} result=${JSON.stringify(event.result?.content?.map((c: any) => c.text)?.join(", "))}`;
		else if (event.type === "message_end") detail = `role=${event.message?.role}`;
		else if (event.type === "agent_end") detail = `messages=${event.messages?.length}`;
		eventLog.push({ seq, event: event.type, detail });
	});

	log("PROMPT", "Sending prompt to trigger ask-confirm...");
	const promptPromise = harness.session.prompt("ask me");

	log("BRIDGE", "Waiting for message to appear on Bridge...");
	const bridgeMsg = await waitForMessageOnBridge(SESSION_ID, beforeTime, "Permission");
	log("BRIDGE", `Found message: id=${bridgeMsg.id}`);
	log("BRIDGE", `Question payload: ${JSON.stringify(bridgeMsg.question)}`);

	log("BRIDGE", "Answering with confirmed=true...");
	await answerOnBridge(bridgeMsg.id, "【确认】: 确定");

	log("PROMPT", "Waiting for agent to complete...");
	await promptPromise;

	console.log("\n  Event Sequence:");
	console.log("  ─────────────────────────────────────────────────────────────");
	for (const entry of eventLog) {
		console.log(`  #${String(entry.seq).padStart(2)} ${entry.event.padEnd(25)} ${entry.detail}`);
	}
	console.log("  ─────────────────────────────────────────────────────────────\n");

	unsub();

	const texts = getAssistantTexts(harness);
	log("RESULT", `Assistant texts: ${JSON.stringify(texts)}`);

	const pass = texts.includes("confirmed");
	log(pass ? "✅" : "❌", "ASSERT", `Expected 'confirmed' in assistant texts: ${pass ? "PASS" : "FAIL"}`);

	harness.cleanup();
	return pass;
}

async function runSelectScenario(): Promise<boolean> {
	separator("Scenario: select via Message Bridge");

	const beforeTime = Date.now() / 1000;

	log("SETUP", "Creating harness with message-bridge extension...");

	const bridgeFactory = loadBridgeFactory();

	const harness: Harness = await createHarness({
		extensionFactories: [
			(pi: any) => {
				pi.registerTool({
					name: "ask-select",
					label: "Ask Select",
					description: "Asks to pick an option",
					parameters: Type.Object({ prompt: Type.String() }),
					execute: async (_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) => {
						log("TOOL", `ask-select called: ${params.prompt}`);
						const choice = await ctx.ui.select(params.prompt, ["Red", "Green", "Blue"]);
						log("TOOL", `ctx.ui.select returned: ${choice}`);
						return {
							content: [{ type: "text", text: choice ?? "cancelled" }],
						};
					},
				});
			},
			bridgeFactory,
		],
	});

	await harness.session.bindExtensions({
		uiContext: makeUIContext({
			select: async (..._args: any[]) => {
				log("ORIGINAL-UI", "select() called (will hang, waiting for respondUI to win)");
				return hangingPromise();
			},
		}),
		shutdownHandler: () => {},
	});

	harness.setResponses([
		fauxAssistantMessage([fauxToolCall("ask-select", { prompt: "Pick a color" })], {
			stopReason: "toolUse",
		}),
		(context: any) => fauxAssistantMessage(extractToolResultText(context)),
	]);

	const unsub = harness.session.subscribe(() => {});

	log("PROMPT", "Sending prompt to trigger ask-select...");
	const promptPromise = harness.session.prompt("pick one");

	log("BRIDGE", "Waiting for message to appear on Bridge...");
	const bridgeMsg = await waitForMessageOnBridge(SESSION_ID, beforeTime, "Pick a color");
	log("BRIDGE", `Found message: id=${bridgeMsg.id}`);
	log("BRIDGE", `Question payload: ${JSON.stringify(bridgeMsg.question)}`);

	log("BRIDGE", "Answering with Green...");
	await answerOnBridge(bridgeMsg.id, "【问题】: Green");

	log("PROMPT", "Waiting for agent to complete...");
	await promptPromise;

	unsub();

	const texts = getAssistantTexts(harness);
	log("RESULT", `Assistant texts: ${JSON.stringify(texts)}`);

	const pass = texts.includes("Green");
	log(pass ? "✅" : "❌", "ASSERT", `Expected 'Green' in assistant texts: ${pass ? "PASS" : "FAIL"}`);

	harness.cleanup();
	return pass;
}

async function runInputScenario(): Promise<boolean> {
	separator("Scenario: input via Message Bridge");

	const beforeTime = Date.now() / 1000;

	log("SETUP", "Creating harness with message-bridge extension...");

	const bridgeFactory = loadBridgeFactory();

	const harness: Harness = await createHarness({
		extensionFactories: [
			(pi: any) => {
				pi.registerTool({
					name: "ask-input",
					label: "Ask Input",
					description: "Asks for text input",
					parameters: Type.Object({ prompt: Type.String() }),
					execute: async (_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) => {
						log("TOOL", `ask-input called: ${params.prompt}`);
						const text = await ctx.ui.input(params.prompt, "Type here...");
						log("TOOL", `ctx.ui.input returned: ${text}`);
						return {
							content: [{ type: "text", text: text ?? "empty" }],
						};
					},
				});
			},
			bridgeFactory,
		],
	});

	await harness.session.bindExtensions({
		uiContext: makeUIContext({
			input: async (..._args: any[]) => {
				log("ORIGINAL-UI", "input() called (will hang, waiting for respondUI to win)");
				return hangingPromise();
			},
		}),
		shutdownHandler: () => {},
	});

	harness.setResponses([
		fauxAssistantMessage([fauxToolCall("ask-input", { prompt: "Your email?" })], {
			stopReason: "toolUse",
		}),
		(context: any) => fauxAssistantMessage(extractToolResultText(context)),
	]);

	const unsub = harness.session.subscribe(() => {});

	log("PROMPT", "Sending prompt to trigger ask-input...");
	const promptPromise = harness.session.prompt("email");

	log("BRIDGE", "Waiting for message to appear on Bridge...");
	const bridgeMsg = await waitForMessageOnBridge(SESSION_ID, beforeTime, "Your email?");
	log("BRIDGE", `Found message: id=${bridgeMsg.id}`);
	log("BRIDGE", `Question payload: ${JSON.stringify(bridgeMsg.question)}`);

	log("BRIDGE", "Answering with email...");
	await answerOnBridge(bridgeMsg.id, "test@example.com");

	log("PROMPT", "Waiting for agent to complete...");
	await promptPromise;

	unsub();

	const texts = getAssistantTexts(harness);
	log("RESULT", `Assistant texts: ${JSON.stringify(texts)}`);

	const pass = texts.includes("test@example.com");
	log(pass ? "✅" : "❌", "ASSERT", `Expected 'test@example.com' in assistant texts: ${pass ? "PASS" : "FAIL"}`);

	harness.cleanup();
	return pass;
}

async function runNotifyScenario(): Promise<boolean> {
	separator("Scenario: notify via Message Bridge (fire-and-forget)");

	const beforeTime = Date.now() / 1000;

	log("SETUP", "Creating harness with message-bridge extension...");

	const bridgeFactory = loadBridgeFactory();

	const harness: Harness = await createHarness({
		extensionFactories: [
			(pi: any) => {
				pi.registerTool({
					name: "send-notify",
					label: "Send Notification",
					description: "Sends a notification",
					parameters: Type.Object({ message: Type.String() }),
					execute: async (_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) => {
						log("TOOL", `send-notify called: ${params.message}`);
						ctx.ui.notify(params.message);
						return {
							content: [{ type: "text", text: "notified" }],
						};
					},
				});
			},
			bridgeFactory,
		],
	});

	await harness.session.bindExtensions({
		uiContext: makeUIContext(),
		shutdownHandler: () => {},
	});

	harness.setResponses([
		fauxAssistantMessage([fauxToolCall("send-notify", { message: "Deploy completed!" })], {
			stopReason: "toolUse",
		}),
		(context: any) => fauxAssistantMessage(extractToolResultText(context)),
	]);

	const unsub = harness.session.subscribe(() => {});

	log("PROMPT", "Sending prompt to trigger notify...");
	const promptPromise = harness.session.prompt("notify me");

	log("PROMPT", "Waiting for agent to complete (notify is fire-and-forget)...");
	await promptPromise;

	log("BRIDGE", "Checking if notify message appeared on Bridge...");
	await new Promise((r) => setTimeout(r, 500));

	const resp = await fetch(`${BRIDGE_URL}/messages?session_id=${SESSION_ID}`);
	const messages = (await resp.json()) as Array<{
		id: string;
		question: any;
		answer?: string;
		created_at: number;
	}>;
	const notifyMsg = messages.find(
		(m) =>
			m.created_at > beforeTime &&
			!m.answer &&
			typeof m.question === "string" &&
			m.question.includes("Deploy completed!"),
	);

	log("RESULT", notifyMsg ? `Found notify message: id=${notifyMsg.id}` : "Notify message not found");

	unsub();
	harness.cleanup();

	const pass = !!notifyMsg;
	log(pass ? "✅" : "❌", "ASSERT", `Notify message on bridge: ${pass ? "PASS" : "FAIL"}`);
	return pass;
}

async function runConfirmDenyScenario(): Promise<boolean> {
	separator("Scenario: confirm denied via Message Bridge");

	const beforeTime = Date.now() / 1000;

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
				log("ORIGINAL-UI", "confirm() called (will hang)");
				return hangingPromise();
			},
		}),
		shutdownHandler: () => {},
	});

	harness.setResponses([
		fauxAssistantMessage([fauxToolCall("ask-confirm", { question: "Delete file?" })], {
			stopReason: "toolUse",
		}),
		(context: any) => fauxAssistantMessage(extractToolResultText(context)),
	]);

	const unsub = harness.session.subscribe(() => {});

	log("PROMPT", "Sending prompt...");
	const promptPromise = harness.session.prompt("delete");

	log("BRIDGE", "Waiting for message...");
	const bridgeMsg = await waitForMessageOnBridge(SESSION_ID, beforeTime, "Delete file?");
	log("BRIDGE", `Found: id=${bridgeMsg.id}`);
	log("BRIDGE", `Question: ${JSON.stringify(bridgeMsg.question)}`);

	log("BRIDGE", "Answering with denied...");
	await answerOnBridge(bridgeMsg.id, "【确认】: 取消");

	await promptPromise;
	unsub();

	const texts = getAssistantTexts(harness);
	log("RESULT", `Assistant texts: ${JSON.stringify(texts)}`);

	const pass = texts.includes("denied");
	log(pass ? "✅" : "❌", "ASSERT", `Expected 'denied': ${pass ? "PASS" : "FAIL"}`);

	harness.cleanup();
	return pass;
}

async function main() {
	console.log("\n" + "=".repeat(60));
	console.log("  Message Bridge E2E Verification");
	console.log(`  Bridge: ${BRIDGE_URL}`);
	console.log(`  Session: ${SESSION_ID}`);
	console.log("=".repeat(60));

	const results: Array<{ name: string; pass: boolean }> = [];

	results.push({
		name: "1. confirm → confirmed",
		pass: await runConfirmScenario(),
	});

	results.push({
		name: "2. confirm → denied",
		pass: await runConfirmDenyScenario(),
	});

	results.push({
		name: "3. select → Green",
		pass: await runSelectScenario(),
	});

	results.push({
		name: "4. input → text reply",
		pass: await runInputScenario(),
	});

	results.push({
		name: "5. notify (fire-and-forget)",
		pass: await runNotifyScenario(),
	});

	separator("Summary");
	let allPass = true;
	for (const r of results) {
		const icon = r.pass ? "✅" : "❌";
		console.log(`  ${icon} ${r.name}: ${r.pass ? "PASS" : "FAIL"}`);
		if (!r.pass) allPass = false;
	}

	console.log(`\n${"=".repeat(60)}`);
	console.log(`  ${allPass ? "ALL SCENARIOS PASSED" : "SOME SCENARIOS FAILED"}`);
	console.log(`${"=".repeat(60)}\n`);

	process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});

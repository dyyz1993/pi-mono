/**
 * UI Interception E2E 验证脚本 (含 respondUI 异步注入场景)
 *
 * 用法: npx tsx test/suite/run-ui-intercept.ts
 *
 * 验证流程:
 * 1. 加载插件 (ask-plugin + intercept-plugin)
 * 2. faux provider 模拟 LLM 调用工具
 * 3. 验证 6 种拦截场景
 * 4. 输出每个场景的事件时序
 * 5. 生成 Mermaid 时序图
 */

import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { Type } from "typebox";
import { createHarness, getAssistantTexts, type Harness } from "./harness.js";

type MessageContent = Array<{ type: string; text?: string }>;

function extractToolResultText(context: { messages: Array<{ role: string; content?: MessageContent }> }): string {
	const toolResult = context.messages.find((message) => message.role === "toolResult");
	if (!toolResult || !Array.isArray(toolResult.content)) return "";
	return toolResult.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

let globalSeq = 0;
const allScenarioLogs: Array<{
	scenario: string;
	events: Array<{ seq: number; time: string; event: string; detail: string }>;
	uiEvents: Array<{ seq: number; time: string; from: string; to: string; label: string }>;
	pass: boolean;
}> = [];

function log(emoji: string, tag: string, message: string) {
	const timestamp = new Date().toISOString().slice(11, 19);
	console.log(`[${timestamp}] ${emoji} [${tag}] ${message}`);
}

function printSeparator(title: string) {
	console.log(`\n${"=".repeat(60)}`);
	console.log(`  ${title}`);
	console.log(`${"=".repeat(60)}`);
}

function makeAskConfirmPlugin() {
	return (pi: any) => {
		pi.registerTool({
			name: "ask-confirm",
			label: "Ask Confirm",
			description: "Asks a confirmation question",
			parameters: Type.Object({ question: Type.String() }),
			execute: async (_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) => {
				const confirmed = await ctx.ui.confirm("Permission", params.question);
				return {
					content: [{ type: "text", text: confirmed ? "confirmed" : "denied" }],
				};
			},
		});
	};
}

function makeAskSelectPlugin() {
	return (pi: any) => {
		pi.registerTool({
			name: "ask-select",
			label: "Ask Select",
			description: "Asks to pick an option",
			parameters: Type.Object({ prompt: Type.String() }),
			execute: async (_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) => {
				const choice = await ctx.ui.select(params.prompt, ["Red", "Green", "Blue"]);
				return {
					content: [{ type: "text", text: choice ?? "cancelled" }],
				};
			},
		});
	};
}

interface ScenarioResult {
	name: string;
	pass: boolean;
}

async function runScenario(
	name: string,
	options: {
		extensionFactories: Array<(pi: any) => void>;
		bindUIContext?: boolean;
		uiOverrides?: Record<string, (...args: any[]) => any>;
		responses: Array<any>;
		expectedText: string;
		expectedOriginalUICalled?: boolean;
	},
): Promise<boolean> {
	printSeparator(name);
	log("⏳", "SETUP", "Creating harness with extensions...");

	let originalConfirmCalled = false;
	let originalSelectCalled = false;

	const harness: Harness = await createHarness({
		extensionFactories: options.extensionFactories,
	});
	log("✅", "SETUP", "Harness created");

	if (options.bindUIContext) {
		log("⏳", "SETUP", "Binding UI context...");
		await harness.session.bindExtensions({
			uiContext: {
				confirm: async (..._args: any[]) => {
					originalConfirmCalled = true;
					log("🔀", "ORIGINAL-UI", "confirm() called");
					return options.uiOverrides?.confirm?.(..._args) ?? true;
				},
				select: async (..._args: any[]) => {
					originalSelectCalled = true;
					log("🔀", "ORIGINAL-UI", "select() called");
					return options.uiOverrides?.select?.(..._args) ?? undefined;
				},
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
			},
			shutdownHandler: () => {},
		});
		log("✅", "SETUP", "UI context bound");
	}

	harness.setResponses(options.responses);

	const eventLog: Array<{ seq: number; time: string; event: string; detail: string }> = [];
	const uiEventLog: Array<{ seq: number; time: string; from: string; to: string; label: string }> = [];
	let seq = 0;
	const unsub = harness.session.subscribe((event: any) => {
		seq++;
		globalSeq++;
		const time = new Date().toISOString().slice(11, 23);
		let detail = "";
		if (event.type === "tool_execution_start") {
			detail = `tool=${event.toolName} args=${JSON.stringify(event.args)}`;
			uiEventLog.push({
				seq: globalSeq,
				time,
				from: "LLM",
				to: "Tool",
				label: `${event.toolName}(${JSON.stringify(event.args)})`,
			});
		} else if (event.type === "tool_execution_end") {
			detail = `tool=${event.toolName} isError=${event.isError} result=${JSON.stringify(event.result?.content?.map((c: any) => c.text)?.join(", "))}`;
			uiEventLog.push({
				seq: globalSeq,
				time,
				from: "Tool",
				to: "LLM",
				label: `result: ${event.result?.content?.map((c: any) => c.text)?.join(", ")}`,
			});
		} else if (event.type === "message_end") {
			detail = `role=${event.message?.role}`;
		} else if (event.type === "turn_end") {
			detail = `toolResults=${event.toolResults?.length}`;
		} else if (event.type === "agent_end") {
			detail = `messages=${event.messages?.length}`;
		}
		eventLog.push({ seq, time, event: event.type, detail });
	});

	log("⏳", "PROMPT", "Sending prompt: 'ask me'");
	await harness.session.prompt("ask me");
	log("✅", "PROMPT", "Prompt completed");

	console.log("\n  Event Sequence:");
	console.log("  ─────────────────────────────────────────────────────────────");
	for (const entry of eventLog) {
		console.log(`  #${String(entry.seq).padStart(2)} ${entry.time} ${entry.event.padEnd(25)} ${entry.detail}`);
	}
	console.log("  ─────────────────────────────────────────────────────────────\n");

	unsub();

	const texts = getAssistantTexts(harness);
	log("📋", "RESULT", `Assistant texts: ${JSON.stringify(texts)}`);

	const found = texts.includes(options.expectedText);
	const passIcon = found ? "✅" : "❌";
	log(passIcon, "ASSERT", `Expected '${options.expectedText}' in assistant texts: ${found ? "PASS" : "FAIL"}`);

	if (options.expectedOriginalUICalled !== undefined) {
		const uiCalled = originalConfirmCalled || originalSelectCalled;
		const uiPass = uiCalled === options.expectedOriginalUICalled;
		const uiIcon = uiPass ? "✅" : "❌";
		log(
			uiIcon,
			"ASSERT",
			`Original UI called: ${uiCalled}, expected: ${options.expectedOriginalUICalled}: ${uiPass ? "PASS" : "FAIL"}`,
		);
	}

	harness.cleanup();

	const pass =
		found &&
		(options.expectedOriginalUICalled === undefined ||
			originalConfirmCalled === options.expectedOriginalUICalled ||
			originalSelectCalled === options.expectedOriginalUICalled);
	allScenarioLogs.push({ scenario: name, events: eventLog, uiEvents: uiEventLog, pass });

	return pass;
}

function generateMermaidDiagrams() {
	printSeparator("Mermaid Sequence Diagrams");

	const diagrams: Record<string, string[]> = {
		"Scenario 1: Handler short-circuits confirm=true": [
			"sequenceDiagram",
			"    participant LLM as LLM (faux)",
			"    participant Tool as ask-confirm tool",
			"    participant Runner as ExtensionRunner",
			"    participant Handler as ui handler",
			"",
			"    LLM->>Tool: call ask-confirm({question})",
			"    Tool->>Runner: ctx.ui.confirm(Permission, question)",
			"    Note over Runner: generate event.id = uuid",
			"    Note over Runner: create asyncUIPromise (stored in pendingUIResponses)",
			"    Runner->>Handler: emitUIEvent({id, method:confirm, title, message})",
			"    Handler->>Runner: return {action:responded, confirmed:true}",
			"    Note over Runner: action=responded → delete pendingUIResponses[id]",
			"    Runner->>Tool: return true (short-circuit, OrigUI never called)",
			"    Tool->>LLM: tool result: confirmed",
		],
		"Scenario 2: Handler short-circuits confirm=false": [
			"sequenceDiagram",
			"    participant LLM as LLM (faux)",
			"    participant Tool as ask-confirm tool",
			"    participant Runner as ExtensionRunner",
			"    participant Handler as ui handler",
			"",
			"    LLM->>Tool: call ask-confirm({question})",
			"    Tool->>Runner: ctx.ui.confirm(Permission, question)",
			"    Note over Runner: generate event.id = uuid",
			"    Note over Runner: create asyncUIPromise (stored in pendingUIResponses)",
			"    Runner->>Handler: emitUIEvent({id, method:confirm, title, message})",
			"    Handler->>Runner: return {action:responded, confirmed:false}",
			"    Note over Runner: action=responded → delete pendingUIResponses[id]",
			"    Runner->>Tool: return false (short-circuit, OrigUI never called)",
			"    Tool->>LLM: tool result: denied",
		],
		"Scenario 3: Handler short-circuits select=Green": [
			"sequenceDiagram",
			"    participant LLM as LLM (faux)",
			"    participant Tool as ask-select tool",
			"    participant Runner as ExtensionRunner",
			"    participant Handler as ui handler",
			"",
			"    LLM->>Tool: call ask-select({prompt})",
			"    Tool->>Runner: ctx.ui.select(Pick one, [Red,Green,Blue])",
			"    Note over Runner: generate event.id = uuid",
			"    Note over Runner: create asyncUIPromise (stored in pendingUIResponses)",
			"    Runner->>Handler: emitUIEvent({id, method:select, title, options})",
			"    Handler->>Runner: return {action:responded, value:Green}",
			"    Note over Runner: action=responded → delete pendingUIResponses[id]",
			"    Runner->>Tool: return Green (short-circuit, OrigUI never called)",
			"    Tool->>LLM: tool result: Green",
		],
		"Scenario 4: Handler returns undefined, OrigUI responds": [
			"sequenceDiagram",
			"    participant LLM as LLM (faux)",
			"    participant Tool as ask-confirm tool",
			"    participant Runner as ExtensionRunner",
			"    participant Handler as ui handler",
			"    participant OrigUI as Original UI (TUI/RPC)",
			"",
			"    LLM->>Tool: call ask-confirm({question})",
			"    Tool->>Runner: ctx.ui.confirm(Permission, question)",
			"    Note over Runner: generate event.id = uuid",
			"    Note over Runner: create asyncUIPromise (stored in pendingUIResponses)",
			"    Runner->>Handler: emitUIEvent({id, method:confirm, ...})",
			"    Handler->>Runner: return undefined (pass-through)",
			"    Note over Runner: no handler responded → enter race",
			"    par Race: first-responder wins",
			"        Runner->>OrigUI: Promise.race([original.confirm, asyncPromise])",
			"        OrigUI-->>Runner: resolve(true) ← wins",
			"    and",
			"        Note over Runner: asyncPromise pending (no respondUI call)",
			"    end",
			"    Note over Runner: cleanup pendingUIResponses[id]",
			"    Runner->>Tool: return true (from OrigUI)",
			"    Tool->>LLM: tool result: confirmed",
		],
		"Scenario 5: No handler, OrigUI handles directly": [
			"sequenceDiagram",
			"    participant LLM as LLM (faux)",
			"    participant Tool as ask-confirm tool",
			"    participant Runner as ExtensionRunner",
			"    participant OrigUI as Original UI (TUI/RPC)",
			"",
			"    LLM->>Tool: call ask-confirm({question})",
			"    Tool->>Runner: ctx.ui.confirm(Permission, question)",
			"    Note over Runner: hasHandlers(ui) === false",
			"    Note over Runner: skip interception entirely",
			"    Runner->>OrigUI: original.confirm(Permission, question)",
			"    OrigUI-->>Runner: true",
			"    Runner->>Tool: return true",
			"    Tool->>LLM: tool result: confirmed",
		],
		"Scenario 6: respondUI wins race against OrigUI": [
			"sequenceDiagram",
			"    participant LLM as LLM (faux)",
			"    participant Tool as ask-confirm tool",
			"    participant Runner as ExtensionRunner",
			"    participant Handler as ui handler",
			"    participant OrigUI as Original UI (hanging)",
			"    participant Remote as Remote Service",
			"",
			"    LLM->>Tool: call ask-confirm({question})",
			"    Tool->>Runner: ctx.ui.confirm(Permission, question)",
			"    Note over Runner: generate event.id = uuid",
			"    Note over Runner: create asyncUIPromise → pendingUIResponses.set(id, resolve)",
			"    Runner->>Handler: emitUIEvent({id, method:confirm, ...})",
			"    Handler->>Runner: return undefined (pass-through)",
			"    Note over Handler: captures event.id for later",
			"    Handler->>Remote: sendToRemote({id, message})",
			"    Note over Runner: no handler responded → enter race",
			"    par Race: Promise.race",
			"        Runner->>OrigUI: original.confirm() → hangs forever",
			"    and",
			"        Remote-->>Handler: response {id, allowed:true}",
			"        Handler->>Runner: ctx.respondUI(id, {action:responded, confirmed:true})",
			"        Note over Runner: pendingUIResponses.get(id) → resolve(true) ← wins!",
			"    end",
			"    Note over OrigUI: race lost, promise ignored",
			"    Note over Runner: cleanup pendingUIResponses[id]",
			"    Runner->>Tool: return true (from respondUI)",
			"    Tool->>LLM: tool result: confirmed",
		],
	};

	for (const [title, lines] of Object.entries(diagrams)) {
		console.log(`\n### ${title}`);
		console.log("```mermaid");
		for (const line of lines) {
			console.log(`    ${line}`);
		}
		console.log("```");
	}
}

async function main() {
	console.log(`\n${"=".repeat(60)}`);
	console.log("  UI Interception E2E Verification (with respondUI)");
	console.log("=".repeat(60));

	const results: Array<ScenarioResult> = [];

	// Scenario 1: Interceptor plugin confirms=true
	results.push({
		name: "1. Interceptor responds confirmed=true",
		pass: await runScenario("Scenario 1: Interceptor responds confirmed=true", {
			extensionFactories: [
				makeAskConfirmPlugin(),
				(pi: any) => {
					pi.on("ui", async (event: any) => {
						log("📥", "HANDLER", `ui event: method=${event.method} id=${event.id}`);
						if (event.method === "confirm") {
							log("📤", "HANDLER", "returning {action:responded, confirmed:true}");
							return { action: "responded", confirmed: true };
						}
						return undefined;
					});
				},
			],
			responses: [
				fauxAssistantMessage([fauxToolCall("ask-confirm", { question: "May I proceed?" })], {
					stopReason: "toolUse",
				}),
				(context: any) => fauxAssistantMessage(extractToolResultText(context)),
			],
			expectedText: "confirmed",
			expectedOriginalUICalled: false,
		}),
	});

	// Scenario 2: Interceptor plugin confirms=false
	results.push({
		name: "2. Interceptor responds confirmed=false",
		pass: await runScenario("Scenario 2: Interceptor responds confirmed=false", {
			extensionFactories: [
				makeAskConfirmPlugin(),
				(pi: any) => {
					pi.on("ui", async (event: any) => {
						log("📥", "HANDLER", `ui event: method=${event.method} id=${event.id}`);
						if (event.method === "confirm") {
							log("📤", "HANDLER", "returning {action:responded, confirmed:false}");
							return { action: "responded", confirmed: false };
						}
						return undefined;
					});
				},
			],
			responses: [
				fauxAssistantMessage([fauxToolCall("ask-confirm", { question: "May I proceed?" })], {
					stopReason: "toolUse",
				}),
				(context: any) => fauxAssistantMessage(extractToolResultText(context)),
			],
			expectedText: "denied",
			expectedOriginalUICalled: false,
		}),
	});

	// Scenario 3: Interceptor plugin selects option
	results.push({
		name: "3. Interceptor responds with selected option",
		pass: await runScenario("Scenario 3: Interceptor selects 'Green'", {
			extensionFactories: [
				makeAskSelectPlugin(),
				(pi: any) => {
					pi.on("ui", async (event: any) => {
						log("📥", "HANDLER", `ui event: method=${event.method} id=${event.id}`);
						if (event.method === "select") {
							log("📤", "HANDLER", "returning {action:responded, value:Green}");
							return { action: "responded", value: "Green" };
						}
						return undefined;
					});
				},
			],
			responses: [
				fauxAssistantMessage([fauxToolCall("ask-select", { prompt: "Pick a color" })], {
					stopReason: "toolUse",
				}),
				(context: any) => fauxAssistantMessage(extractToolResultText(context)),
			],
			expectedText: "Green",
			expectedOriginalUICalled: false,
		}),
	});

	// Scenario 4: Interceptor returns undefined, fallback to original UI
	results.push({
		name: "4. Interceptor passes through to original UI",
		pass: await runScenario("Scenario 4: Interceptor returns undefined, original UI responds", {
			extensionFactories: [
				makeAskConfirmPlugin(),
				(pi: any) => {
					pi.on("ui", async (event: any) => {
						log("📥", "HANDLER", `ui event: method=${event.method} id=${event.id} → returning undefined`);
						return undefined;
					});
				},
			],
			bindUIContext: true,
			uiOverrides: {
				confirm: async () => true,
			},
			responses: [
				fauxAssistantMessage([fauxToolCall("ask-confirm", { question: "May I?" })], {
					stopReason: "toolUse",
				}),
				(context: any) => fauxAssistantMessage(extractToolResultText(context)),
			],
			expectedText: "confirmed",
			expectedOriginalUICalled: true,
		}),
	});

	// Scenario 5: No interceptor at all
	results.push({
		name: "5. No interceptor, original UI handles directly",
		pass: await runScenario("Scenario 5: No interceptor, original UI handles directly", {
			extensionFactories: [makeAskConfirmPlugin()],
			bindUIContext: true,
			uiOverrides: {
				confirm: async () => true,
			},
			responses: [
				fauxAssistantMessage([fauxToolCall("ask-confirm", { question: "May I?" })], {
					stopReason: "toolUse",
				}),
				(context: any) => fauxAssistantMessage(extractToolResultText(context)),
			],
			expectedText: "confirmed",
			expectedOriginalUICalled: true,
		}),
	});

	// Scenario 6: respondUI async injection wins over original UI
	results.push({
		name: "6. ctx.respondUI wins the race against original UI",
		pass: await runScenario("Scenario 6: respondUI resolves confirm before original UI", {
			extensionFactories: [
				makeAskConfirmPlugin(),
				(pi: any) => {
					pi.on("ui", async (event: any, ctx: any) => {
						log("📥", "HANDLER", `ui event: method=${event.method} id=${event.id}`);
						if (event.method === "confirm") {
							log("📤", "HANDLER", `capturing id=${event.id}, calling respondUI in 10ms`);
							setTimeout(() => {
								log("🚀", "RESPOND-UI", `ctx.respondUI(${event.id}, {confirmed:true})`);
								ctx.respondUI(event.id, { action: "responded", confirmed: true });
							}, 10);
							return undefined;
						}
						return undefined;
					});
				},
			],
			bindUIContext: true,
			uiOverrides: {
				confirm: async () => {
					log("⏳", "ORIGINAL-UI", "original confirm() hanging forever...");
					await new Promise(() => {});
					return false;
				},
			},
			responses: [
				fauxAssistantMessage([fauxToolCall("ask-confirm", { question: "May I?" })], {
					stopReason: "toolUse",
				}),
				(context: any) => fauxAssistantMessage(extractToolResultText(context)),
			],
			expectedText: "confirmed",
			expectedOriginalUICalled: true,
		}),
	});

	// Summary
	printSeparator("Summary");
	let allPass = true;
	for (const r of results) {
		const icon = r.pass ? "✅" : "❌";
		console.log(`  ${icon} ${r.name}: ${r.pass ? "PASS" : "FAIL"}`);
		if (!r.pass) allPass = false;
	}

	console.log(`\n${"=".repeat(60)}`);
	if (allPass) {
		console.log("  ALL 6 SCENARIOS PASSED");
	} else {
		console.log("  SOME SCENARIOS FAILED");
	}
	console.log(`${"=".repeat(60)}\n`);

	generateMermaidDiagrams();

	process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});

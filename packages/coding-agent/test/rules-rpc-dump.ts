import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeJsonLine } from "../src/modes/rpc/jsonl.js";
import { RpcClient } from "../src/modes/rpc/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const RULES_EXT = join(__dirname, "../src/rules-engine/index.ts");
const CLI_PATH = join(__dirname, "../dist/cli.js");
const CWD = join(__dirname, "../../..");

const prompt =
	process.argv[2] ??
	"Read the file packages/coding-agent/src/rules-engine/loader.ts and tell me what parseFrontmatter does, in one sentence.";

interface ChannelEvent {
	type: string;
	[name: string]: unknown;
}

function autoRespondExtensionUI(client: RpcClient, data: Record<string, unknown>): boolean {
	if (data.type !== "extension_ui_request") return false;
	const { id, method } = data as { id: string; method: string };

	if (
		method === "notify" ||
		method === "setStatus" ||
		method === "setWidget" ||
		method === "setTitle" ||
		method === "set_editor_text"
	) {
		return true;
	}

	const proc = (client as unknown as { process: { stdin: { write: (s: string) => void } } }).process;
	if (!proc?.stdin) return false;

	let response: Record<string, unknown>;
	if (method === "select") {
		response = { type: "extension_ui_response", id, value: "0" };
	} else if (method === "confirm") {
		response = { type: "extension_ui_response", id, confirmed: true };
	} else if (method === "input") {
		response = { type: "extension_ui_response", id, value: "" };
	} else if (method === "editor") {
		response = { type: "extension_ui_response", id, value: (data as Record<string, unknown>).prefill ?? "" };
	} else {
		response = { type: "extension_ui_response", id, cancelled: true };
	}

	proc.stdin.write(serializeJsonLine(response));
	return true;
}

async function main() {
	console.log("=== Rules Engine RPC Raw Dump ===\n");
	console.log(`Extension: ${RULES_EXT}`);
	console.log(`CWD: ${CWD}`);
	console.log(`Prompt: "${prompt}"\n`);

	const client = new RpcClient({
		cliPath: CLI_PATH,
		cwd: CWD,
		args: ["--no-extensions", "-e", RULES_EXT],
	});

	const channelEvents: ChannelEvent[] = [];
	const agentEvents: string[] = [];
	let matchEventCount = 0;
	let snapshotEventCount = 0;
	let injectedEventCount = 0;

	const rulesChannel = client.channel("rules-engine");
	rulesChannel.onReceive((data: unknown) => {
		const ev = data as ChannelEvent;
		const evType = ev.type;

		if (evType === "snapshot") {
			snapshotEventCount++;
			channelEvents.push(ev);
			console.log(
				`[channel] snapshot #${snapshotEventCount} | total=${ev.totalRules} unconditional=${ev.unconditionalCount} conditional=${ev.conditionalCount} matchHistory=${(ev.matchHistory as unknown[])?.length ?? 0}`,
			);
		} else if (evType === "matched") {
			matchEventCount++;
			channelEvents.push(ev);
			const rules = (ev.matchedRules as { name: string; title: string; severity: string }[]) ?? [];
			console.log(
				`[channel] MATCHED #${matchEventCount} | file=${ev.filePath} tool=${ev.toolName} rules=[${rules.map((r) => `${r.name}(${r.severity})`).join(", ")}]`,
			);
		} else if (evType === "injected") {
			injectedEventCount++;
			channelEvents.push(ev);
			console.log(
				`[channel] injected #${injectedEventCount} | ruleCount=${(ev.ruleNames as string[])?.length ?? 0} promptLen=${ev.systemPromptLength}`,
			);
		} else if (evType === "unloaded") {
			channelEvents.push(ev);
			console.log(`[channel] unloaded | reason=${ev.reason}`);
		} else {
			channelEvents.push(ev);
			console.log(`[channel] ${evType}`);
		}
	});

	const originalHandleLine = (client as unknown as { handleLine: (line: string) => void }).handleLine.bind(
		client as unknown as { handleLine: (line: string) => void },
	);
	(client as unknown as { handleLine: (line: string) => void }).handleLine = (line: string) => {
		try {
			const data = JSON.parse(line);
			if (autoRespondExtensionUI(client, data)) return;
		} catch {}
		originalHandleLine(line);
	};

	client.onEvent((event) => {
		agentEvents.push(event.type);

		if (event.type === "message_update") {
			const ame = (event as unknown as { assistantMessageEvent: { type: string; delta?: string } })
				.assistantMessageEvent;
			if (ame?.type === "text" && ame.delta) {
				process.stdout.write(ame.delta);
			}
		} else if (event.type === "tool_execution_start") {
			const te = event as unknown as { toolName: string; args: Record<string, unknown> };
			console.log(`\n[agent] tool_start: ${te.toolName} ${JSON.stringify(te.args).slice(0, 120)}`);
		} else if (event.type === "tool_execution_end") {
			const te = event as unknown as { toolName: string; isError?: boolean };
			console.log(`[agent] tool_end: ${te.toolName} error=${te.isError ?? false}`);
		} else if (event.type === "agent_end") {
			console.log("\n\n========== RULES ENGINE SUMMARY ==========");
			console.log(`Channel events:     ${channelEvents.length}`);
			console.log(`  snapshots:        ${snapshotEventCount}`);
			console.log(`  matched:          ${matchEventCount}`);
			console.log(`  injected:         ${injectedEventCount}`);
			console.log(`Agent events:       ${agentEvents.length}`);
			console.log(`============================================\n`);

			if (matchEventCount === 0) {
				console.error("FAIL: No 'matched' channel events received!");
				console.error("Expected at least one matched event when agent reads a .ts file.");
				console.error(
					"Channel events received:",
					channelEvents.map((e) => e.type),
				);
				client.stop();
				process.exit(1);
			}

			console.log(`PASS: ${matchEventCount} matched event(s) received`);
			client.stop();
			process.exit(0);
		}
	});

	await client.start();
	console.log("Agent started, sending prompt...\n");
	await client.promptAndWait(prompt, undefined, 120000);
}

main().catch((e) => {
	console.error("Fatal:", e);
	process.exit(1);
});

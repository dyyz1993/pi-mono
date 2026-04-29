import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeJsonLine } from "../src/modes/rpc/jsonl.js";
import { RpcClient } from "../src/modes/rpc/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Debug script: dumps every RPC event with size analysis.
 * Usage: npx tsx test/rpc-event-dump.ts "your prompt here"
 *
 * Shows:
 * 1. Raw event size (bytes)
 * 2. Redundancy analysis (message vs assistantMessageEvent.partial)
 * 3. Cumulative bandwidth
 */

const prompt = process.argv[2] ?? "说一句话介绍一下你自己，用中文，50字以内";

function autoRespondExtensionUI(client: RpcClient, data: any) {
	if (data.type !== "extension_ui_request") return false;
	const { id, method } = data;

	if (
		method === "notify" ||
		method === "setStatus" ||
		method === "setWidget" ||
		method === "setTitle" ||
		method === "set_editor_text"
	) {
		return true;
	}

	const proc = (client as any).process;
	if (!proc?.stdin) return false;

	let response: any;
	if (method === "select") {
		response = { type: "extension_ui_response", id, value: "0" };
	} else if (method === "confirm") {
		response = { type: "extension_ui_response", id, confirmed: true };
	} else if (method === "input") {
		response = { type: "extension_ui_response", id, value: "" };
	} else if (method === "editor") {
		response = { type: "extension_ui_response", id, value: data.prefill ?? "" };
	} else {
		response = { type: "extension_ui_response", id, cancelled: true };
	}

	proc.stdin.write(serializeJsonLine(response));
	return true;
}

async function main() {
	const client = new RpcClient({
		cliPath: join(__dirname, "../dist/cli.js"),
		args: ["--no-session"],
	});

	let totalBytes = 0;
	let redundantBytes = 0;
	let eventCount = 0;

	const originalHandleLine = (client as any).handleLine.bind(client as any);
	(client as any).handleLine = (line: string) => {
		try {
			const data = JSON.parse(line);
			if (autoRespondExtensionUI(client, data)) {
				return;
			}
		} catch {}
		originalHandleLine(line);
	};

	client.onEvent((event) => {
		eventCount++;
		const raw = JSON.stringify(event);
		const size = Buffer.byteLength(raw, "utf-8");
		totalBytes += size;

		if (event.type === "message_update") {
			const { message, assistantMessageEvent } = event;
			const partial = (assistantMessageEvent as any).partial;

			const messageSize = Buffer.byteLength(JSON.stringify(message), "utf-8");
			const partialSize = partial ? Buffer.byteLength(JSON.stringify(partial), "utf-8") : 0;
			const deltaSize = (assistantMessageEvent as any).delta
				? Buffer.byteLength((assistantMessageEvent as any).delta, "utf-8")
				: 0;
			const eventTypeName = assistantMessageEvent.type;

			const isRedundant = partial && JSON.stringify(message) === JSON.stringify(partial);

			if (isRedundant) {
				redundantBytes += partialSize;
			}

			console.log(
				`[${eventCount}] message_update/${eventTypeName} | total=${size}B | message=${messageSize}B | partial=${partialSize}B | delta=${deltaSize}B | redundant=${isRedundant}`,
			);
		} else {
			console.log(`[${eventCount}] ${event.type} | size=${size}B`);
		}

		if (event.type === "agent_end") {
			console.log("\n========== BANDWIDTH SUMMARY ==========");
			console.log(`Total events:      ${eventCount}`);
			console.log(`Total bytes:       ${totalBytes} (${(totalBytes / 1024).toFixed(1)} KB)`);
			console.log(`Redundant bytes:   ${redundantBytes} (${(redundantBytes / 1024).toFixed(1)} KB)`);
			console.log(`Waste ratio:       ${totalBytes > 0 ? ((redundantBytes / totalBytes) * 100).toFixed(1) : 0}%`);
			console.log(
				`Without redundant: ${totalBytes - redundantBytes} (${((totalBytes - redundantBytes) / 1024).toFixed(1)} KB)`,
			);
			console.log("=========================================\n");

			client.stop();
			process.exit(0);
		}
	});

	await client.start();
	console.log(`Sending prompt: "${prompt}"\n`);
	await client.promptAndWait(prompt);
}

main().catch(console.error);

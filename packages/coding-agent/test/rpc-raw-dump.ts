import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { attachJsonlLineReader, serializeJsonLine } from "../src/modes/rpc/jsonl.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const prompt = process.argv[2] ?? "说一句话介绍一下你自己，用中文，50字以内";

async function main() {
	const proc = spawn("node", [join(__dirname, "../dist/cli.js"), "--mode", "rpc", "--no-session", "--no-extensions"], {
		cwd: process.cwd(),
		stdio: ["pipe", "pipe", "pipe"],
	});

	proc.stderr?.on("data", (d: Buffer) => process.stderr.write(d));

	let totalBytes = 0;
	let redundantBytes = 0;
	let eventCount = 0;
	let _gotAgentEnd = false;

	const handleLine = (line: string) => {
		try {
			const data = JSON.parse(line);
			const size = Buffer.byteLength(line, "utf-8");

			if (data.type === "extension_ui_request") {
				const { id, method } = data;
				if (method === "select") {
					proc.stdin!.write(serializeJsonLine({ type: "extension_ui_response", id, value: "0" }));
				} else if (method === "confirm") {
					proc.stdin!.write(serializeJsonLine({ type: "extension_ui_response", id, confirmed: true }));
				} else if (method === "input") {
					proc.stdin!.write(serializeJsonLine({ type: "extension_ui_response", id, value: "" }));
				} else if (method === "editor") {
					proc.stdin!.write(serializeJsonLine({ type: "extension_ui_response", id, value: data.prefill ?? "" }));
				}
				console.log(`[ext-ui] ${method} (auto-responded)`);
				return;
			}

			if (data.type === "response") {
				console.log(`[response] command=${data.command} success=${data.success}`);
				return;
			}

			eventCount++;
			totalBytes += size;

			if (data.type === "message_update") {
				const { message, assistantMessageEvent: ame } = data;
				const partial = ame?.partial;
				const messageSize = Buffer.byteLength(JSON.stringify(message), "utf-8");
				const partialSize = partial ? Buffer.byteLength(JSON.stringify(partial), "utf-8") : 0;
				const deltaSize = ame?.delta ? Buffer.byteLength(ame.delta, "utf-8") : 0;
				const isRedundant = partial && JSON.stringify(message) === JSON.stringify(partial);
				if (isRedundant) redundantBytes += partialSize;

				console.log(
					`[${eventCount}] message_update/${ame?.type} | line=${size}B | message=${messageSize}B | partial=${partialSize}B | delta=${deltaSize}B | redundant=${isRedundant}`,
				);
			} else if (data.type === "tool_execution_update") {
				const prSize = Buffer.byteLength(JSON.stringify(data.partialResult), "utf-8");
				const argsSize = Buffer.byteLength(JSON.stringify(data.args), "utf-8");
				console.log(
					`[${eventCount}] tool_execution_update/${data.toolName} | line=${size}B | partialResult=${prSize}B | args=${argsSize}B`,
				);
			} else if (data.type === "tool_execution_end") {
				const resultSize = Buffer.byteLength(JSON.stringify(data.result), "utf-8");
				console.log(
					`[${eventCount}] tool_execution_end/${data.toolName} | line=${size}B | result=${resultSize}B | isError=${data.isError}`,
				);
			} else if (data.type === "tool_execution_start") {
				const argsSize = Buffer.byteLength(JSON.stringify(data.args), "utf-8");
				console.log(`[${eventCount}] tool_execution_start/${data.toolName} | line=${size}B | args=${argsSize}B`);
			} else if (data.type === "agent_end") {
				_gotAgentEnd = true;
				console.log(`\n========== BANDWIDTH SUMMARY ==========`);
				console.log(`Total events:      ${eventCount}`);
				console.log(`Total bytes:       ${totalBytes} B (${(totalBytes / 1024).toFixed(1)} KB)`);
				console.log(`Redundant bytes:   ${redundantBytes} B (${(redundantBytes / 1024).toFixed(1)} KB)`);
				console.log(`Waste ratio:       ${totalBytes > 0 ? ((redundantBytes / totalBytes) * 100).toFixed(1) : 0}%`);
				console.log(`Without redundant: ${totalBytes - redundantBytes} B`);
				console.log(`=========================================\n`);
				proc.kill();
				process.exit(0);
			} else {
				console.log(`[${eventCount}] ${data.type} | size=${size}B`);
			}
		} catch {}
	};

	attachJsonlLineReader(proc.stdout!, handleLine);

	await new Promise((r) => setTimeout(r, 500));

	console.log(`Sending prompt: "${prompt}"\n`);
	proc.stdin!.write(
		serializeJsonLine({
			type: "prompt",
			message: prompt,
			id: "req_1",
		}),
	);
}

main().catch(console.error);

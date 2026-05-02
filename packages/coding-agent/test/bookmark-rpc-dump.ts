import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { attachJsonlLineReader, serializeJsonLine } from "../src/modes/rpc/jsonl.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const AUTO_MEMORY_PATH = join(__dirname, "..", "extensions", "auto-memory", "index.ts");
const CLI_PATH = join(__dirname, "../dist/cli.js");

let eventCount = 0;
let phase: "init" | "wait_agent" | "wait_bookmark" | "done" = "init";
let gotAgentEnd = false;
let gotBookmarkResult = false;

function waitForPhase(target: string, timeoutMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${target}`)), timeoutMs);
		const check = setInterval(() => {
			if (phase === target) {
				clearTimeout(timer);
				clearInterval(check);
				resolve();
			}
		}, 100);
	});
}

async function main() {
	const testDir = join(tmpdir(), `bookmark-rpc-test-${Date.now()}`);
	mkdirSync(testDir, { recursive: true });

	console.log("=".repeat(60));
	console.log("Bookmark E2E RPC Raw Dump Test");
	console.log("=".repeat(60));
	console.log(`CLI:          ${CLI_PATH}`);
	console.log(`Extension:    ${AUTO_MEMORY_PATH}`);
	console.log(`Exists CLI:   ${existsSync(CLI_PATH)}`);
	console.log(`Exists Ext:   ${existsSync(AUTO_MEMORY_PATH)}`);
	console.log("=".repeat(60));

	const proc = spawn(
		"node",
		[CLI_PATH, "--mode", "rpc", "--no-session", "--no-extensions", "--extension", AUTO_MEMORY_PATH],
		{
			cwd: testDir,
			stdio: ["pipe", "pipe", "pipe"],
		},
	);

	proc.stderr?.on("data", (d: Buffer) => {
		const str = d.toString().trim();
		if (str) console.log(`[STDERR] ${str}`);
	});

	const handleLine = (line: string) => {
		try {
			const data = JSON.parse(line);
			const size = Buffer.byteLength(line, "utf-8");
			eventCount++;

			if (data.type === "extension_ui_request") {
				const { id, method } = data;
				const statusText = (data as Record<string, unknown>).statusText ?? "";
				console.log(
					`[ext-ui] ${method} key=${(data as Record<string, unknown>).statusKey ?? ""} text=${statusText}`,
				);
				if (method === "select") {
					proc.stdin!.write(serializeJsonLine({ type: "extension_ui_response", id, value: "0" }));
				} else if (method === "confirm") {
					proc.stdin!.write(serializeJsonLine({ type: "extension_ui_response", id, confirmed: true }));
				} else if (method === "input") {
					proc.stdin!.write(serializeJsonLine({ type: "extension_ui_response", id, value: "" }));
				} else if (method === "editor") {
					proc.stdin!.write(serializeJsonLine({ type: "extension_ui_response", id, value: data.prefill ?? "" }));
				} else if (method === "setStatus" || method === "notify") {
					proc.stdin!.write(serializeJsonLine({ type: "extension_ui_response", id, confirmed: true }));
				}
				return;
			}

			if (data.type === "response") {
				console.log(`[response] command=${data.command} success=${data.success}`);
				return;
			}

			if (data.type === "channel_data") {
				console.log(`[channel] ${data.type} name=${data.name} size=${size}B`);
				console.log(`          RAW: ${line.slice(0, 500)}`);
				if (data.data) {
					const dd = JSON.stringify(data.data);
					console.log(`          data=${dd.slice(0, 500)}`);
					const dtype = (data.data as Record<string, unknown>).type;
					if (dtype === "memory_updated" || dtype === "memory_update_failed") {
						gotBookmarkResult = dtype === "memory_updated";
						phase = "done";
						console.log(`\n*** BOOKMARK RESULT: ${dtype} ***`);
					}
				}
				return;
			}

			if (data.type === "extension_status") {
				console.log(`[extension] ${data.status} label=${data.label ?? ""}`);
				return;
			}

			if (data.type === "message_update") {
				const ame = data.assistantMessageEvent;
				if (ame?.type === "text") {
					console.log(`[${eventCount}] message_update/text delta="${(ame.delta ?? "").slice(0, 100)}"`);
				} else {
					console.log(`[${eventCount}] message_update/${ame?.type}`);
				}
			} else if (data.type === "tool_execution_start") {
				console.log(`[${eventCount}] tool_start/${data.toolName}`);
			} else if (data.type === "tool_execution_update") {
				console.log(`[${eventCount}] tool_update/${data.toolName}`);
			} else if (data.type === "tool_execution_end") {
				console.log(`[${eventCount}] tool_end/${data.toolName} error=${data.isError}`);
			} else if (data.type === "agent_end") {
				gotAgentEnd = true;
				console.log(`\n[${eventCount}] agent_end`);
				if (phase === "wait_agent") phase = "wait_bookmark";
			} else {
				console.log(`[${eventCount}] ${data.type} | ${size}B`);
			}
		} catch {
			console.log(`[parse-error] ${line.slice(0, 200)}`);
		}
	};

	attachJsonlLineReader(proc.stdout!, handleLine);

	await new Promise((r) => setTimeout(r, 1000));

	// Phase 1: send simple prompt, wait for agent_end
	phase = "wait_agent";
	const prompt = "你好，请回复 'Agent ready'，不要执行任何工具调用。";
	console.log(`\n[Phase 1] Sending prompt: "${prompt}"\n`);
	proc.stdin!.write(serializeJsonLine({ type: "prompt", message: prompt, id: "req_1" }));

	await waitForPhase("wait_bookmark", 30000);
	console.log(`\n[Phase 1 OK] agent_end received, proceeding to bookmark...\n`);

	// Phase 2: send channel_data to trigger user_remember
	await new Promise((r) => setTimeout(r, 500));
	console.log(`[Phase 2] Sending channel_data user_remember to memory channel...\n`);
	proc.stdin!.write(
		serializeJsonLine({
			type: "channel_data",
			name: "memory",
			data: {
				type: "user_remember",
				content:
					"这是一个 E2E 测试收藏：用户收藏了 agent 的回复作为记忆。涉及的技术栈包括 RPC JSONL 通信、auto-memory 插件的 BookmarkCreator、以及 callLLM 摘要生成。",
				sourceSessionId: "test-session-001",
				sourceMessageIds: ["msg_1", "msg_2"],
			},
		}),
	);

	// Wait up to 90s
	const deadline = Date.now() + 90000;
	while (Date.now() < deadline && phase !== "done") {
		await new Promise((r) => setTimeout(r, 1000));
	}
	if (phase !== "done") {
		console.log(`[TIMEOUT] waiting for memory_updated after 90s`);
	}

	await new Promise((r) => setTimeout(r, 2000));

	console.log(`\n${"=".repeat(60)}`);
	console.log(`Total events: ${eventCount}`);
	console.log(`agent_end: ${gotAgentEnd}`);
	console.log(`bookmark_created (memory_updated): ${gotBookmarkResult}`);
	console.log("=".repeat(60));

	proc.kill();
	process.exit(gotAgentEnd && gotBookmarkResult ? 0 : 1);
}

main().catch(console.error);

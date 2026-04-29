import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "../src/modes/rpc/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const bashExtensionPath = resolve(join(__dirname, "auto-memory/bash.ts"));

const hasApiKey =
	!!process.env.ANTHROPIC_API_KEY ||
	!!process.env.ANTHROPIC_OAUTH_TOKEN ||
	!!process.env.OPENAI_API_KEY ||
	existsSync(join(homedir(), ".pi/agent/models.json"));

const PROVIDER = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN ? "anthropic" : "glm";
const MODEL =
	process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN ? "claude-sonnet-4-5" : "DeepSeek-V3.2";

async function main() {
	if (!hasApiKey) {
		console.error("No API key found. Set ANTHROPIC_API_KEY or configure ~/.pi/agent/models.json");
		process.exit(1);
	}

	console.log(`Provider: ${PROVIDER}, Model: ${MODEL}`);

	const client = new RpcClient({
		cliPath: join(__dirname, "../dist/cli.js"),
		provider: PROVIDER,
		model: MODEL,
		args: ["--no-extensions", "-e", bashExtensionPath, "--no-session"],
	});

	let toolCallId: string | null = null;
	let gotChannelData = false;
	let gotBackgroundEvent = false;

	client.onEvent((event: any) => {
		if (event.type === "extension_ui_request") {
			const resp: any = { type: "extension_ui_response", id: event.id };
			if (event.method === "select") resp.value = "0";
			else if (event.method === "confirm") resp.confirmed = true;
			else if (event.method === "input") resp.value = "";
			else if (event.method === "editor") resp.value = event.prefill ?? "";
			(client as any).writeLine(resp);
			return;
		}

		if (event.type === "channel_data") {
			gotChannelData = true;
			console.log(`\n[onEvent] channel_data name=${event.name} data.type=${event.data?.type}`);
		}
		if (event.type === "tool_execution_start" && event.toolName === "bash") {
			toolCallId = event.toolCallId;
			console.log(`\n[onEvent] bash started toolCallId=${toolCallId}`);
		}
		if (event.type === "tool_execution_end") {
			console.log(`\n[onEvent] tool_end ${event.toolName}`);
		}
		if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
			process.stdout.write(event.assistantMessageEvent.delta);
		}
		if (event.type === "agent_end") {
			console.log("\n[onEvent] agent_end");
		}
	});

	const bashChannel = client.channel("bash");
	bashChannel.onReceive((data: any) => {
		gotBackgroundEvent = true;
		console.log(
			`\n[channel.onReceive] type=${data?.type} toolCallId=${data?.toolCallId} processes=${data?.processes?.length}`,
		);
		if (data?.processes) {
			for (const p of data.processes) {
				console.log(`  -> ${p.toolCallId} status=${p.status} command=${p.command?.slice(0, 40)}`);
			}
		}
	});

	await client.start();
	console.log("Agent started\n");

	console.log("=== Sending prompt ===");
	await client.prompt("Run this bash command and wait: for i in $(seq 1 30); do echo count_$i; sleep 1; done");

	console.log("\n=== Waiting for bash to start ===");
	const deadline = Date.now() + 90000;
	while (!toolCallId && Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 500));
	}

	if (!toolCallId) {
		console.log("ERROR: bash toolCallId not found within 90s");
		await client.stop();
		return;
	}

	// Wait 3s for process to produce output
	await new Promise((r) => setTimeout(r, 3000));

	console.log(`\n=== Sending background command (toolCallId=${toolCallId}) ===`);
	bashChannel.send({ action: "background", toolCallId });

	console.log("=== Waiting for channel events (5s) ===\n");
	await new Promise((r) => setTimeout(r, 5000));

	console.log(`\n=== onEvent got channel_data: ${gotChannelData} ===`);
	console.log(`=== channel.onReceive got event: ${gotBackgroundEvent} ===`);

	if (gotBackgroundEvent) {
		console.log("\n=== Sending list command ===");
		bashChannel.send({ action: "list" });
		await new Promise((r) => setTimeout(r, 2000));
	}

	console.log("\n=== Sending kill ===");
	bashChannel.send({ action: "kill", toolCallId });
	await new Promise((r) => setTimeout(r, 2000));

	console.log("\n=== SUMMARY ===");
	console.log(`onEvent received channel_data: ${gotChannelData}`);
	console.log(`channel.onReceive received data: ${gotBackgroundEvent}`);

	await client.stop();
}

main().catch(console.error);

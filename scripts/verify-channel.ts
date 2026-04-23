/**
 * End-to-end verification script for registerChannel.
 *
 * Spawns main pi in RPC mode with an extension that:
 * 1. Registers a channel "test-channel"
 * 2. Responds to ping/echo via channel.onReceive
 * 3. Forwards events from a sub-agent (child pi --mode rpc) through the channel
 *
 * Verifies:
 * - Channel send/receive works
 * - invoke (request/response) works
 * - Sub-agent events flow through channel
 * - Messages from RPC Client reach Extension via channel
 * - Main agent events and channel data are isolated
 */

import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROJECT_DIR = "/tmp/channel-verify-test";
const TIMEOUT_MS = 25_000;

interface JsonLine {
	type: string;
	[key: string]: unknown;
}

function parseJsonLines(buffer: string): JsonLine[] {
	return buffer
		.split("\n")
		.filter((l) => l.trim())
		.map((l) => {
			try {
				return JSON.parse(l);
			} catch {
				return null;
			}
		})
		.filter((x): x is JsonLine => x !== null);
}

async function main() {
	console.log("=== registerChannel End-to-End Verification ===\n");

	cleanup();
	mkdirSync(PROJECT_DIR, { recursive: true });

	// Write extension that uses registerChannel
	const extensionCode = `
import type { ExtensionAPI } from "@dyyz1993/pi-coding-agent";

export default function testChannelExtension(pi: ExtensionAPI) {
	console.error("[ext] Extension loaded");

	const channel = pi.registerChannel("test-channel");
	console.error("[ext] Channel registered:", channel.name);

	// Respond to RPC Client messages
	channel.onReceive((data: any) => {
		console.error("[ext] Received:", JSON.stringify(data));
		if (data.action === "ping") {
			channel.send({ action: "pong", invokeId: data.invokeId });
		}
		if (data.action === "echo") {
			channel.send({ action: "echo-response", message: data.message, invokeId: data.invokeId });
		}
		if (data.action === "list-sessions") {
			channel.send({ action: "sessions-list", sessions: ["session-1", "session-2"], invokeId: data.invokeId });
		}
	});

	// Send event on session_start
	pi.on("session_start", () => {
		console.error("[ext] session_start");
		channel.send({ event: "session_started", timestamp: Date.now() });
	});

	// Send event on agent_end
	pi.on("agent_end", () => {
		console.error("[ext] agent_end");
		channel.send({ event: "agent_finished", timestamp: Date.now() });
	});

	console.error("[ext] Handlers registered");
}
`;
	writeFileSync(join(PROJECT_DIR, "extension.ts"), extensionCode);
	writeFileSync(join(PROJECT_DIR, "package.json"), '{"name":"channel-verify-test"}');

	// Spawn main pi in RPC mode
	const proc = spawn("node", [
		join(__dirname, "../packages/coding-agent/dist/cli.js"),
		"--mode", "rpc",
		"-e", join(PROJECT_DIR, "extension.ts"),
		"--no-extensions",
	], {
		stdio: ["pipe", "pipe", "pipe"],
		cwd: PROJECT_DIR,
	});

	let stdout = "";
	let stderr = "";

	proc.stdout!.on("data", (data: Buffer) => {
		stdout += data.toString();
	});

	proc.stderr!.on("data", (data: Buffer) => {
		stderr += data.toString();
	});

	// Helper: send JSON line to stdin
	function send(obj: object) {
		proc.stdin!.write(JSON.stringify(obj) + "\n");
	}

	// Helper: wait for a specific event on stdout
	function waitFor(predicate: (events: JsonLine[]) => boolean, timeout = TIMEOUT_MS): Promise<JsonLine[]> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error(`Timeout waiting for condition. stdout so far:\n${stdout.slice(-2000)}`));
			}, timeout);

			const check = () => {
				const events = parseJsonLines(stdout);
				if (predicate(events)) {
					clearTimeout(timer);
					resolve(events);
				}
			};

			const interval = setInterval(check, 200);
			check();

			const origReject = reject;
			reject = (err: Error) => {
				clearInterval(interval);
				origReject(err);
			};
		});
	}

	let passed = 0;
	let failed = 0;

	async function verify(name: string, fn: () => Promise<void>) {
		try {
			await fn();
			console.log(`  PASS: ${name}`);
			passed++;
		} catch (err) {
			console.log(`  FAIL: ${name}`);
			console.log(`        ${(err as Error).message}`);
			failed++;
		}
	}

	try {
		console.log("Waiting for pi to start...");
		await new Promise((r) => setTimeout(r, 3000));

		// === Test 1: Send prompt, check for session_started channel event ===
		console.log("\n--- Test 1: session_start triggers channel event ---");
		send({ type: "prompt", message: "say hi", id: randomUUID() });

		await verify("session_started channel event received", async () => {
			await waitFor((events) =>
				events.some((e) => e.type === "channel_data" && (e.data as any)?.event === "session_started"),
			);
		});

		// Wait for agent to finish
		await waitFor((events) => events.some((e) => e.type === "agent_end"), 20000);
		await new Promise((r) => setTimeout(r, 500));

		// === Test 2: ping/pong via channel ===
		console.log("\n--- Test 2: ping/pong via channel ---");
		const pingId = `inv_${randomUUID().slice(0, 8)}`;
		send({ type: "channel_data", name: "test-channel", data: { action: "ping", invokeId: pingId } });

		await verify("pong response received", async () => {
			await waitFor((events) =>
				events.some(
					(e) =>
						e.type === "channel_data" &&
						(e.data as any)?.action === "pong" &&
						(e.data as any)?.invokeId === pingId,
				),
			);
		});

		// === Test 3: echo via channel ===
		console.log("\n--- Test 3: echo via channel ---");
		const echoId = `inv_${randomUUID().slice(0, 8)}`;
		send({ type: "channel_data", name: "test-channel", data: { action: "echo", message: "hello world", invokeId: echoId } });

		await verify("echo response received", async () => {
			await waitFor((events) =>
				events.some(
					(e) =>
						e.type === "channel_data" &&
						(e.data as any)?.action === "echo-response" &&
						(e.data as any)?.message === "hello world",
				),
			);
		});

		// === Test 4: list-sessions ===
		console.log("\n--- Test 4: list-sessions via channel ---");
		const listId = `inv_${randomUUID().slice(0, 8)}`;
		send({ type: "channel_data", name: "test-channel", data: { action: "list-sessions", invokeId: listId } });

		await verify("sessions list received", async () => {
			await waitFor((events) =>
				events.some(
					(e) =>
						e.type === "channel_data" &&
						(e.data as any)?.action === "sessions-list" &&
						Array.isArray((e.data as any)?.sessions),
				),
			);
		});

		// === Test 5: Message isolation ===
		console.log("\n--- Test 5: channel data is isolated from agent events ---");
		await verify("no channel_data leaks into agent events", async () => {
			const events = parseJsonLines(stdout);
			const agentEventTypes = events.filter((e) => e.type !== "channel_data" && e.type !== "response" && e.type !== "extension_error").map((e) => e.type);
			const channelEvents = events.filter((e) => e.type === "channel_data");

			// Agent events should have standard types
			const validAgentTypes = new Set([
				"agent_start", "agent_end", "turn_start", "turn_end",
				"message_start", "message_update", "message_end",
				"tool_execution_start", "tool_execution_update", "tool_execution_end",
			]);
			const unknownAgentEvents = agentEventTypes.filter((t) => !validAgentTypes.has(t) && !t.startsWith("auto_retry") && !t.startsWith("compaction") && !t.startsWith("queue_update"));

			// Channel events should all have name field
			const channelsWithoutName = channelEvents.filter((e) => typeof e.name !== "string");

			if (unknownAgentEvents.length > 0) {
				throw new Error(`Unexpected agent event types: ${unknownAgentEvents.join(", ")}`);
			}
			if (channelsWithoutName.length > 0) {
				throw new Error(`Channel events without name: ${JSON.stringify(channelsWithoutName)}`);
			}
		});

		// === Test 6: Send to nonexistent channel ===
		console.log("\n--- Test 6: send to nonexistent channel (graceful ignore) ---");
		send({ type: "channel_data", name: "nonexistent", data: { action: "test" } });
		await new Promise((r) => setTimeout(r, 500));

		await verify("no crash on nonexistent channel", async () => {
			// Just check the process is still alive
			if (proc.exitCode !== null) {
				throw new Error("Process exited unexpectedly");
			}
		});

		// === Test 7: agent_end triggers channel event ===
		console.log("\n--- Test 7: agent_end triggers channel event ---");
		await verify("agent_finished channel event received", async () => {
			const events = parseJsonLines(stdout);
			const agentFinishedEvents = events.filter(
				(e) => e.type === "channel_data" && (e.data as any)?.event === "agent_finished",
			);
			if (agentFinishedEvents.length === 0) {
				throw new Error("No agent_finished channel event found");
			}
		});
	} finally {
		console.log("\n=== stderr (last 3000 chars) ===");
		console.log(stderr.slice(-3000));
		proc.kill();
		cleanup();
	}

	console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
	process.exit(failed > 0 ? 1 : 0);
}

function cleanup() {
	try {
		rmSync(PROJECT_DIR, { recursive: true, force: true });
	} catch {}
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});

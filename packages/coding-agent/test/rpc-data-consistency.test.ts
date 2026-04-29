import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent, AgentMessage } from "@dyyz1993/pi-agent-core";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { RpcClient } from "../src/modes/rpc/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const hasApiKey =
	!!process.env.ANTHROPIC_API_KEY ||
	!!process.env.ANTHROPIC_OAUTH_TOKEN ||
	!!process.env.OPENAI_API_KEY ||
	existsSync(join(homedir(), ".pi/agent/models.json"));

const PROVIDER = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN ? "anthropic" : "glm";
const MODEL =
	process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN ? "claude-sonnet-4-5" : "DeepSeek-V3.2";

interface SessionEntryBase {
	type: string;
	id: string;
	parentId: string | null;
	timestamp: string;
}

interface SessionMessageEntry extends SessionEntryBase {
	type: "message";
	message: AgentMessage;
}

type FileEntry = SessionEntryBase & { [key: string]: unknown };

describe.skipIf(!hasApiKey)("RPC data consistency", () => {
	let client: RpcClient;
	let sessionDir: string;

	beforeEach(() => {
		sessionDir = join(tmpdir(), `pi-rpc-consistency-${Date.now()}`);
		mkdirSync(sessionDir, { recursive: true });
		client = new RpcClient({
			cliPath: join(__dirname, "..", "dist", "cli.js"),
			cwd: sessionDir,
			provider: PROVIDER,
			model: MODEL,
		});
	});

	afterEach(async () => {
		await client.stop();
		if (sessionDir && existsSync(sessionDir)) {
			rmSync(sessionDir, { recursive: true });
		}
	});

	async function getSessionFilePath(): Promise<string> {
		const state = await client.getState();
		const sessionFile = state.sessionFile;
		expect(sessionFile).toBeDefined();
		expect(existsSync(sessionFile!)).toBe(true);
		return sessionFile!;
	}

	async function readSessionEntries(): Promise<FileEntry[]> {
		const filePath = await getSessionFilePath();
		const content = readFileSync(filePath, "utf8");
		return content
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
	}

	test("session.jsonl entry has envelope wrapping AgentMessage", async () => {
		await client.start();
		await client.promptAndWait("Reply with just 'ok'");
		await new Promise((resolve) => setTimeout(resolve, 300));

		const fileEntries = await readSessionEntries();
		const messageEntries = fileEntries.filter((e) => e.type === "message") as SessionMessageEntry[];

		expect(messageEntries.length).toBeGreaterThanOrEqual(2);

		for (const entry of messageEntries) {
			expect(entry.type).toBe("message");
			expect(typeof entry.id).toBe("string");
			expect(entry.id.length).toBeGreaterThan(0);
			expect(typeof entry.parentId).toBe("string");
			expect(typeof entry.timestamp).toBe("string");

			expect(entry.message).toBeDefined();
			expect(typeof entry.message.role).toBe("string");
			expect(entry.message.content).toBeDefined();

			if (entry.message.id && entry.id) {
				expect(entry.id).not.toBe(entry.message.id);
			}
		}

		const userEntry = messageEntries.find((e) => e.message.role === "user");
		expect(userEntry).toBeDefined();
	}, 60000);

	test("session.jsonl entry.timestamp is string, message.timestamp is number", async () => {
		await client.start();
		await client.promptAndWait("Reply with just 'ts-test'");
		await new Promise((resolve) => setTimeout(resolve, 300));

		const fileEntries = await readSessionEntries();
		const messageEntries = fileEntries.filter((e) => e.type === "message") as SessionMessageEntry[];

		const userEntry = messageEntries.find((e) => e.message.role === "user");
		expect(userEntry).toBeDefined();
		expect(typeof userEntry!.timestamp).toBe("string");
		expect(typeof userEntry!.message.timestamp).toBe("number");
	}, 60000);

	test("getMessages() returns flat array without type/parentId envelope", async () => {
		await client.start();
		await client.promptAndWait("Reply with just 'flat-test'");
		await new Promise((resolve) => setTimeout(resolve, 300));

		const rpcMessages = await client.getMessages();

		expect(rpcMessages.length).toBeGreaterThanOrEqual(2);

		for (const msg of rpcMessages) {
			expect(typeof msg.role).toBe("string");
			expect(msg.content).toBeDefined();
			expect(typeof msg.timestamp).toBe("number");

			expect((msg as Record<string, unknown>).type).toBeUndefined();
			expect((msg as Record<string, unknown>).parentId).toBeUndefined();
		}
	}, 60000);

	test("getMessages() roles match session.jsonl message roles", async () => {
		await client.start();
		await client.promptAndWait("Reply with just the word 'hello'");
		await new Promise((resolve) => setTimeout(resolve, 300));

		const rpcMessages = await client.getMessages();
		const fileEntries = await readSessionEntries();

		const messageEntries = fileEntries.filter((e) => e.type === "message") as SessionMessageEntry[];

		const rpcRoles = rpcMessages.filter((m) => m.role === "user" || m.role === "assistant").map((m) => m.role);
		const fileRoles = messageEntries
			.filter((e) => e.message.role === "user" || e.message.role === "assistant")
			.map((e) => e.message.role);

		expect(rpcRoles).toEqual(fileRoles);
	}, 60000);

	test("streaming event.message is same AgentMessage type as getMessages()", async () => {
		await client.start();

		const eventMessages: { event: string; message: AgentMessage }[] = [];
		client.onEvent((event) => {
			if (event.type === "message_start" || event.type === "message_end" || event.type === "message_update") {
				eventMessages.push({ event: event.type, message: event.message });
			}
		});

		await client.promptAndWait("Reply with just 'stream-test'");

		const rpcMessages = await client.getMessages();

		expect(eventMessages.length).toBeGreaterThan(0);

		for (const em of eventMessages) {
			expect(typeof em.message.role).toBe("string");
			expect(typeof em.message.timestamp).toBe("number");

			expect((em.message as Record<string, unknown>).type).toBeUndefined();
			expect((em.message as Record<string, unknown>).parentId).toBeUndefined();
		}

		const endEvents = eventMessages.filter((e) => e.event === "message_end");
		for (const endEvent of endEvents) {
			const match = rpcMessages.find((m) => m.role === endEvent.message.role);
			expect(match).toBeDefined();
		}
	}, 60000);

	test("mid-stream getMessages() >= session.jsonl message count", async () => {
		await client.start();

		await client.prompt("Explain what recursion is in 3 paragraphs");
		await new Promise((resolve) => setTimeout(resolve, 2000));

		const midStreamMessages = await client.getMessages();
		const midStreamCount = midStreamMessages.length;

		await client.waitForIdle(60000);
		await new Promise((resolve) => setTimeout(resolve, 300));

		const fileEntries = await readSessionEntries();
		const fileMessageCount = fileEntries.filter((e) => e.type === "message").length;

		expect(midStreamCount).toBeGreaterThanOrEqual(fileMessageCount);
	}, 90000);

	test("reconnect simulation: final snapshot matches session.jsonl", async () => {
		await client.start();

		await client.promptAndWait("Reply with just 'first'");

		const snapshot1 = await client.getMessages();
		expect(snapshot1.length).toBeGreaterThanOrEqual(2);

		const snapshot1Roles = snapshot1.map((m) => m.role);

		await client.promptAndWait("Reply with just 'second'");

		const snapshot2 = await client.getMessages();
		expect(snapshot2.length).toBeGreaterThan(snapshot1.length);

		const snapshot2Roles = snapshot2.map((m) => m.role);
		expect(snapshot2Roles.length).toBeGreaterThan(snapshot1Roles.length);

		await new Promise((resolve) => setTimeout(resolve, 300));

		const fileEntries = await readSessionEntries();
		const fileMessageEntries = fileEntries.filter((e) => e.type === "message") as SessionMessageEntry[];

		expect(snapshot2.length).toBeGreaterThanOrEqual(fileMessageEntries.length);

		const snapshotUA = snapshot2.filter((m) => m.role === "user" || m.role === "assistant");
		const fileUA = fileMessageEntries.filter((e) => e.message.role === "user" || e.message.role === "assistant");
		expect(snapshotUA.length).toBe(fileUA.length);

		const snapshotUARoles = snapshotUA.map((m) => m.role);
		const fileUARoles = fileUA.map((e) => e.message.role);
		expect(snapshotUARoles).toEqual(fileUARoles);
	}, 90000);
});

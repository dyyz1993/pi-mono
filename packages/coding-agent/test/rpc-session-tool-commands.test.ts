import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { RpcClient } from "../src/modes/rpc/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_OAUTH_TOKEN)(
	"RPC session and tool commands",
	() => {
		let client: RpcClient;
		let sessionDir: string;

		beforeEach(() => {
			sessionDir = join(tmpdir(), `pi-rpc-session-tool-test-${Date.now()}`);
			client = new RpcClient({
				cliPath: join(__dirname, "..", "dist", "cli.js"),
				cwd: join(__dirname, ".."),
				env: { PI_CODING_AGENT_DIR: sessionDir },
				provider: "anthropic",
				model: "claude-sonnet-4-5",
			});
		});

		afterEach(async () => {
			await client.stop();
			if (sessionDir && existsSync(sessionDir)) {
				rmSync(sessionDir, { recursive: true });
			}
		});

		test("fork creates a new session from current", async () => {
			await client.start();

			await client.promptAndWait("Reply with just 'hello'");

			const tree = await client.getTreeWithLeaf();
			expect(tree.entries.length).toBeGreaterThan(0);

			const userEntry = tree.entries.find((e) => e.label === "user");
			expect(userEntry).toBeDefined();

			const result = await client.fork(userEntry!.id);

			expect(result.cancelled).toBe(false);
			expect(result.newSessionFile).toBeDefined();
			expect(result.newSessionId).toBeDefined();

			await new Promise((resolve) => setTimeout(resolve, 200));

			const state = await client.getState();
			expect(state.messageCount).toBeGreaterThan(0);
		}, 120000);

		test("fork with position 'at' clones at entry", async () => {
			await client.start();

			await client.promptAndWait("Reply with just 'ok'");

			const tree = await client.getTreeWithLeaf();
			const leafId = tree.leafId;
			expect(leafId).toBeDefined();

			const result = await client.fork(leafId!, { position: "at" });

			expect(result.cancelled).toBe(false);
		}, 90000);

		test("switch_session changes active session", async () => {
			await client.start();

			await client.promptAndWait("Reply with just 'first'");

			const stateBefore = await client.getState();
			expect(stateBefore.messageCount).toBeGreaterThan(0);
			const originalSessionFile = stateBefore.sessionFile;
			expect(originalSessionFile).toBeDefined();

			await client.newSession();

			const stateAfterNew = await client.getState();
			expect(stateAfterNew.messageCount).toBe(0);
			expect(stateAfterNew.sessionFile).not.toBe(originalSessionFile);

			const result = await client.switchSession(originalSessionFile!);
			expect(result.cancelled).toBe(false);

			const stateAfterSwitch = await client.getState();
			expect(stateAfterSwitch.sessionFile).toBe(originalSessionFile);
			expect(stateAfterSwitch.messageCount).toBeGreaterThan(0);
		}, 120000);

		test("register_remote_tool adds a tool to the session", async () => {
			await client.start();

			await client.registerRemoteTool({
				name: "test_remote_tool",
				description: "A test remote tool",
				parameters: {
					type: "object",
					properties: {
						query: { type: "string", description: "Search query" },
					},
					required: ["query"],
				},
			});

			const tools = await client.getTools();
			const registered = tools.find((t) => t.name === "test_remote_tool");
			expect(registered).toBeDefined();
			expect(registered!.description).toBe("A test remote tool");
		}, 30000);

		test("unregister_remote_tool removes a registered tool", async () => {
			await client.start();

			await client.registerRemoteTool({
				name: "temp_tool_to_remove",
				description: "Temporary tool",
				parameters: { type: "object", properties: {} },
			});

			let tools = await client.getTools();
			expect(tools.some((t) => t.name === "temp_tool_to_remove")).toBe(true);

			await client.unregisterRemoteTool("temp_tool_to_remove");

			tools = await client.getTools();
			expect(tools.some((t) => t.name === "temp_tool_to_remove")).toBe(false);
		}, 30000);

		test("remote_tool_result provides result for pending tool call", async () => {
			await client.start();

			await client.registerRemoteTool({
				name: "echo_tool",
				description: "Echoes back the input",
				parameters: {
					type: "object",
					properties: {
						message: { type: "string" },
					},
					required: ["message"],
				},
			});

			let resolveToolCall:
				| ((call: { toolCallId: string; toolName: string; args: Record<string, unknown> }) => void)
				| null = null;
			const toolCallPromise = new Promise<{
				toolCallId: string;
				toolName: string;
				args: Record<string, unknown>;
			}>((resolve) => {
				resolveToolCall = resolve;
			});

			const unsubscribe = client.onRemoteToolCall((call) => {
				if (call.toolName === "echo_tool" && resolveToolCall) {
					resolveToolCall(call);
					resolveToolCall = null;
				}
			});

			const promptDone = client.promptAndWait(
				"Use the echo_tool with message 'hello world'. Reply with just the tool result.",
			);

			const call = await toolCallPromise;
			expect(call.toolName).toBe("echo_tool");
			expect(call.args.message).toBe("hello world");

			client.sendRemoteToolResult(call.toolCallId, {
				content: [{ type: "text", text: "hello world" }],
				isError: false,
			});

			const events = await promptDone;

			const messageEndEvents = events.filter((e) => e.type === "message_end");
			const assistantMessage = messageEndEvents.find((e) => (e as any).message?.role === "assistant") as any;
			expect(assistantMessage).toBeDefined();

			const textContent = assistantMessage.message.content.find((c: any) => c.type === "text");
			expect(textContent?.text.toLowerCase()).toContain("hello world");

			unsubscribe();
		}, 120000);
	},
);

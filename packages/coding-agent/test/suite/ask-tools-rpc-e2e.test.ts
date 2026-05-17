import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import { RpcClient } from "../../src/modes/rpc/rpc-client.js";

const TEMP_DIR = "/tmp/ask-tools-test";
const CLI_PATH = join(__dirname, "..", "..", "dist", "cli.js");
const EXTENSION_PATH = join(__dirname, "..", "..", "extensions", "ask-tools", "index.ts");

const PROVIDER = "opencode-go";
const MODEL = "deepseek-v4-flash";

function createClient(): RpcClient {
	return new RpcClient({
		cliPath: CLI_PATH,
		cwd: TEMP_DIR,
		provider: PROVIDER,
		model: MODEL,
		args: ["--no-extensions", "-e", EXTENSION_PATH, "--no-session"],
	});
}

interface CollectedEvent {
	type: string;
	[key: string]: unknown;
}

/**
 * Run a single ask-tool test:
 * 1. Start RPC client
 * 2. Register event listener that auto-responds to extension_ui_request
 * 3. Send prompt
 * 4. Wait for agent_end (or timeout)
 * 5. Return collected events for assertion
 */
async function runAskToolTest(opts: {
	prompt: string;
	timeout?: number;
	respondToUI: (event: CollectedEvent, client: RpcClient) => void;
}): Promise<CollectedEvent[]> {
	const client = createClient();
	const events: CollectedEvent[] = [];
	let uiRequestHandled = false;

	const timeout = opts.timeout ?? 90_000;

	await client.start();

	const done = new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`Timeout after ${timeout}ms. Events: ${events.map((e) => e.type).join(", ")}`));
		}, timeout);

		client.onEvent((event: any) => {
			events.push(event);

			// Auto-respond to extension_ui_request
			if (event.type === "extension_ui_request" && !uiRequestHandled) {
				uiRequestHandled = true;
				opts.respondToUI(event, client);
			}

			if (event.type === "agent_end") {
				clearTimeout(timer);
				resolve();
			}
		});
	});

	try {
		await client.prompt(opts.prompt);
		await done;
	} finally {
		await client.stop();
	}

	return events;
}

/** Extract all text_delta content from events */
function extractText(events: CollectedEvent[]): string {
	return events
		.filter((e) => e.type === "text_delta" && "text" in e)
		.map((e) => (e as any).text as string)
		.join("");
}

/** Find first tool_result in events */
function findToolResult(events: CollectedEvent[]): CollectedEvent | undefined {
	return events.find((e) => e.type === "tool_result");
}

describe("Ask Tools RPC E2E", () => {
	beforeAll(() => {
		mkdirSync(TEMP_DIR, { recursive: true });
	});

	afterEach(() => {
		// Small delay between tests to let processes clean up
	});

	afterAll(() => {
		rmSync(TEMP_DIR, { recursive: true, force: true });
	});

	it(
		"ask-confirm: responds confirmed=true",
		async () => {
			const events = await runAskToolTest({
				prompt: "Call the ask-confirm tool with title 'Proceed?' and question 'Do you want to continue?'. Only call the tool, nothing else.",
				respondToUI: (event, client) => {
					expect(event.method).toBe("confirm");
					client.respondUI(event.id, { confirmed: true });
				},
			});

			const toolResult = findToolResult(events);
			expect(toolResult).toBeDefined();
			const text = extractText(events);
			expect(text).toContain("yes");
		},
		90_000,
	);

	it(
		"ask-select: responds with single value",
		async () => {
			const events = await runAskToolTest({
				prompt: "Call the ask-select tool with title 'Pick a color' and options ['red', 'green', 'blue']. Only call the tool, nothing else.",
				respondToUI: (event, client) => {
					expect(event.method).toBe("select");
					client.respondUI(event.id, { value: "green" });
				},
			});

			const toolResult = findToolResult(events);
			expect(toolResult).toBeDefined();
			const text = extractText(events);
			expect(text).toContain("green");
		},
		90_000,
	);

	it(
		"ask-input: responds with text value",
		async () => {
			const events = await runAskToolTest({
				prompt: "Call the ask-input tool with title 'Your name'. Only call the tool, nothing else.",
				respondToUI: (event, client) => {
					expect(event.method).toBe("input");
					client.respondUI(event.id, { value: "Alice" });
				},
			});

			const toolResult = findToolResult(events);
			expect(toolResult).toBeDefined();
			const text = extractText(events);
			expect(text).toContain("Alice");
		},
		90_000,
	);

	it(
		"ask-notify: fire-and-forget notification",
		async () => {
			const events = await runAskToolTest({
				prompt: "Call the ask-notify tool with message 'Hello World' and type 'info'. Only call the tool, nothing else.",
				respondToUI: (event, client) => {
					expect(event.method).toBe("notify");
					// notify is fire-and-forget but still needs response in RPC mode
					client.respondUI(event.id, { value: "" });
				},
			});

			const toolResult = findToolResult(events);
			expect(toolResult).toBeDefined();
		},
		90_000,
	);
});

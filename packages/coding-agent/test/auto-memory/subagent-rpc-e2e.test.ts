import { existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RpcClient } from "../../src/modes/rpc/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const subagentExtPath = resolve(__dirname, "subagent.ts");
const bashExtPath = resolve(__dirname, "bash.ts");
const todoExtPath = resolve(__dirname, "todo.ts");

const hasModelConfig = existsSync(join(homedir(), ".pi/agent/models.json"));
const PROVIDER = "zhipuai";
const MODEL = "glm-4.7";

function makeClient(projectDir: string): RpcClient {
	return new RpcClient({
		cliPath: join(__dirname, "..", "..", "dist", "cli.js"),
		cwd: projectDir,
		provider: PROVIDER,
		model: MODEL,
		args: ["--no-extensions", "-e", subagentExtPath, "-e", bashExtPath, "-e", todoExtPath, "--no-session"],
	});
}

describe.skipIf(!hasModelConfig)("SubAgent RPC E2E", () => {
	let client: RpcClient;
	let projectDir: string;

	beforeEach(() => {
		const rawDir = join(tmpdir(), `subagent-rpc-e2e-${Date.now()}`);
		mkdirSync(rawDir, { recursive: true });
		projectDir = realpathSync(rawDir);
		client = makeClient(projectDir);
	});

	afterEach(async () => {
		await client.stop();
		if (projectDir && existsSync(projectDir)) {
			rmSync(projectDir, { recursive: true, force: true });
		}
	});

	it("triggers subagent via RPC and receives channel events", async () => {
		await client.start();

		const subagentChannelEvents: unknown[] = [];
		const unsubChannel = client.channel("subagent").onReceive((data) => {
			subagentChannelEvents.push(data);
			console.log("[subagent channel]", JSON.stringify(data).slice(0, 200));
		});

		const allEvents: unknown[] = [];
		const unsubEvent = client.onEvent((event) => {
			const e = event as any;
			if (e.type === "toolCall" || e.type === "toolResult" || e.type === "agent_end") {
				console.log(`[event] ${e.type}`, e.name ?? e.stopReason ?? "");
			}
			allEvents.push(event);
		});

		try {
			const events = await client.promptAndWait(
				"你【必须且只能】使用 subagent 工具来完成此任务，禁止直接调用 bash。\n\n" +
					"调用方式：subagent(description='count numbers', instruction='请使用 bash 工具执行命令：for i in $(seq 1 100); do echo $i; sleep 0.2; done')\n\n" +
					"请立即执行，不要解释。",
				undefined,
				120_000,
			);

			console.log(`\n=== Summary ===`);
			console.log(`Total events: ${events.length}`);
			console.log(`Subagent channel events: ${subagentChannelEvents.length}`);

			expect(events.length).toBeGreaterThan(0);

			const subagentStartEvents = subagentChannelEvents.filter((d: any) => d?.event?.type === "subagent_start");
			console.log(`✅ subagent_start events: ${subagentStartEvents.length}`);
			expect(subagentStartEvents.length).toBe(1);
			console.log(`   description: ${(subagentStartEvents[0] as any).event.description}`);
			console.log(`   instruction: ${(subagentStartEvents[0] as any).event.instruction?.slice(0, 100)}`);

			expect(subagentChannelEvents.length).toBeGreaterThan(0);
			console.log(`✅ Subagent channel events: ${subagentChannelEvents.length}`);

			const bashExecInSubagent = subagentChannelEvents.filter(
				(d: any) => d?.event?.type === "tool_execution_start" && d?.event?.toolName === "bash",
			);
			expect(bashExecInSubagent.length).toBeGreaterThan(0);
			console.log(`✅ Bash tool execution in sub-agent: ${bashExecInSubagent.length}`);
			console.log(`   command: ${(bashExecInSubagent[0] as any).event.args.command}`);

			const bashEndInSubagent = subagentChannelEvents.filter(
				(d: any) => d?.event?.type === "tool_execution_end" && d?.event?.toolName === "bash",
			);
			expect(bashEndInSubagent.length).toBeGreaterThan(0);
			const bashResult = (bashEndInSubagent[0] as any).event.result.content[0].text;
			console.log(`✅ Bash result length: ${bashResult.length} chars`);
			const numbersInResult = bashResult.match(/\b\d+\b/g);
			console.log(`✅ Numbers in bash output: ${numbersInResult?.length ?? 0} (expected ~100)`);

			const agentEndEvents = subagentChannelEvents.filter((d: any) => d?.event?.type === "agent_end");
			expect(agentEndEvents.length).toBeGreaterThan(0);
			console.log(`✅ agent_end event received in sub-agent`);
		} finally {
			unsubChannel();
			unsubEvent();
		}
	}, 180_000);
});

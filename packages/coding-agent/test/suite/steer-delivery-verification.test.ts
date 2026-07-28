/**
 * A 组 — Steer/FollowUp 运行时边界验证
 *
 * 补充 agent-session-queue.test.ts 未覆盖的边界：
 * 1. steer 在非 streaming 状态回退到 prompt
 * 2. followUp 在非 streaming 状态回退到 prompt
 * 3. 委派回传式 steer（模拟 session_delegate_send 调用 steer 的效果）
 */

import type { AgentTool } from "@dyyz1993/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, getAssistantTexts, getMessageText, getUserTexts, type Harness } from "./harness.ts";

describe("Steer/followUp 运行时验证", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("steer while NOT streaming falls through to prompt and immediately produces a response", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("immediate response")]);

		// Agent is idle (not streaming) — steer should call prompt()
		await harness.session.steer("hello when idle");

		expect(getUserTexts(harness)).toEqual(["hello when idle"]);
		expect(getAssistantTexts(harness)).toEqual(["immediate response"]);
	});

	it("followUp while NOT streaming falls through to prompt and immediately produces a response", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("immediate follow-up response")]);

		// Agent is idle (not streaming) — followUp should call prompt()
		await harness.session.followUp("follow-up when idle");

		expect(getUserTexts(harness)).toEqual(["follow-up when idle"]);
		expect(getAssistantTexts(harness)).toEqual(["immediate follow-up response"]);
	});

	it("steer then followUp correctly ordered when both called while idle", async () => {
		const h1 = await createHarness();
		harnesses.push(h1);
		const h2 = await createHarness();
		harnesses.push(h2);

		const processed: string[] = [];

		h1.setResponses([
			() => {
				processed.push("steer");
				return fauxAssistantMessage("steer done");
			},
		]);
		await h1.session.steer("interrupt");
		expect(processed).toContain("steer");

		h2.setResponses([
			() => {
				processed.push("followUp");
				return fauxAssistantMessage("followUp done");
			},
		]);
		await h2.session.followUp("follow-up");
		expect(processed).toContain("followUp");
		// steer was issued before followUp
		expect(processed.indexOf("steer")).toBeLessThan(processed.indexOf("followUp"));
	});

	it("delegate-style send: steering into a streaming target is queued and delivered", async () => {
		let releaseToolExecution: (() => void) | undefined;
		const toolRelease = new Promise<void>((resolve) => {
			releaseToolExecution = resolve;
		});

		const waitTool: AgentTool = {
			name: "wait",
			label: "Wait",
			description: "Wait for release",
			parameters: Type.Object({}),
			execute: async () => {
				await toolRelease;
				return { content: [{ type: "text", text: "released" }], details: {} };
			},
		};

		const harness = await createHarness({ tools: [waitTool] });
		harnesses.push(harness);

		const waitForToolStart = new Promise<void>((resolve) => {
			const unsub = harness.session.subscribe((event) => {
				if (event.type === "tool_execution_start" && event.toolName === "wait") {
					unsub();
					resolve();
				}
			});
		});

		let steerContextInjected = false;
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			(context) => {
				steerContextInjected = context.messages.some(
					(m) => m.role === "user" && getMessageText(m) === "steer from delegate",
				);
				return fauxAssistantMessage(steerContextInjected ? "delegate steer received" : "delegate steer MISSING");
			},
		]);

		// Start agent — it will hit the wait tool
		const promptPromise = harness.session.prompt("start");
		await waitForToolStart;

		// Send steer as a delegate would
		await harness.session.steer("steer from delegate");
		expect(harness.session.getSteeringMessages()).toEqual(["steer from delegate"]);

		// Release the tool, agent picks up the steer
		releaseToolExecution?.();
		await promptPromise;

		expect(steerContextInjected).toBe(true);
		expect(getUserTexts(harness)).toEqual(["start", "steer from delegate"]);
	});
});

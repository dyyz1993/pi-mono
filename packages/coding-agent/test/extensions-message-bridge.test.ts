import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEndEvent, ExtensionAPI, UIEvent } from "../src/core/extensions/types.ts";

const assistantDefaults = {
	api: "responses" as const,
	provider: "test-provider",
	model: "test-model",
	usage: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
		},
	},
	stopReason: "stop" as const,
	timestamp: 1,
};

function userMessage(content: string) {
	return { role: "user" as const, content, timestamp: 1 };
}

function assistantMessage(text: string) {
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text }],
		...assistantDefaults,
	};
}

const mockPushResponse = { id: "test-msg-id", status: "pushed" };
const pushMock = vi.fn().mockResolvedValue({
	ok: true,
	status: 200,
	json: () => Promise.resolve(mockPushResponse),
});
const pullMock = vi.fn().mockResolvedValue({
	ok: true,
	status: 200,
	json: () =>
		Promise.resolve({
			id: "test-msg-id",
			answer: {
				action: "responded",
				answers: { scope: { selected: ["Local"], text: "ship local first" } },
			},
		}),
});

vi.stubGlobal(
	"fetch",
	vi.fn((url: string, init?: RequestInit) => {
		if (url.endsWith("/push")) return pushMock(url, init);
		if (url.includes("/pull/")) return pullMock(url, init);
		return Promise.resolve({ ok: false, status: 404 });
	}),
);

const handlers: Array<{ event: string; handler: (...args: unknown[]) => unknown }> = [];
const sendUserMessageMock = vi.fn();
const mockPi = {
	on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
		handlers.push({ event, handler });
	}),
	sendUserMessage: sendUserMessageMock,
};

const respondUIMock = vi.fn();

function getHandler(event: string) {
	return handlers.find((h) => h.event === event)?.handler;
}

function createAskEvent(overrides: Partial<UIEvent> = {}): UIEvent {
	return {
		type: "ui",
		id: "ask-request-1",
		method: "askUserQuestion",
		title: "Test Ask",
		message: "审批前请确认范围",
		questions: [
			{
				id: "scope",
				header: "Scope",
				question: "先处理哪边？",
				options: [
					{ label: "Local", description: "先做好本地" },
					{ label: "Remote", description: "先对接远程" },
				],
			},
			{
				id: "checks",
				header: "Checks",
				question: "需要哪些验证？",
				multiSelect: true,
				options: [
					{ label: "Refresh", description: "刷新恢复" },
					{ label: "Bridge", description: "message bridge" },
				],
			},
		],
		timeout: 60000,
		toolCallId: "tool-ask",
		permissionMeta: {
			type: "goal_approval",
			kind: "contract",
			goalId: "goal-1",
			generation: 2,
			objective: "验证 Message Bridge 审批",
		},
		...overrides,
	};
}

function createContext() {
	return { respondUI: respondUIMock };
}

describe("message-bridge extension", () => {
	beforeEach(async () => {
		handlers.length = 0;
		pushMock.mockClear();
		pullMock.mockClear();
		respondUIMock.mockClear();
		sendUserMessageMock.mockClear();
		mockPi.on.mockClear();
		// Extension now requires MESSAGE_BRIDGE_URL (no default URL baked in)
		process.env.MESSAGE_BRIDGE_URL = "http://test-bridge:8080";

		const { default: factory } = await import("../extensions/message-bridge/index.ts");
		factory(mockPi as unknown as ExtensionAPI);
	});

	afterEach(() => {
		delete process.env.MESSAGE_BRIDGE_URL;
	});

	it("registers ui and agent_end handlers", () => {
		expect(mockPi.on).toHaveBeenCalledWith("ui", expect.any(Function));
		expect(mockPi.on).toHaveBeenCalledWith("agent_end", expect.any(Function));
	});

	it("askUserQuestion: forwards the full Ask v2 request and resolves with structured answers", async () => {
		const askAnswer = {
			action: "responded",
			answers: {
				scope: { selected: ["Local"], text: "ship local first" },
				checks: { selected: ["Refresh", "Bridge"] },
			},
			annotations: { checks: { notes: "smoke note" } },
		};
		pullMock.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ id: "ask-request-1", answer: askAnswer }),
		});

		const handler = getHandler("ui");
		expect(handler).toBeDefined();
		const event = createAskEvent();
		const ctx = createContext();

		const result = await handler?.(event, ctx);

		expect(result).toBeUndefined();
		expect(pushMock).toHaveBeenCalledTimes(1);
		const pushBody = JSON.parse(pushMock.mock.calls[0][1].body);
		expect(pushBody).toEqual({
			question: {
				type: "extension_ui_request",
				id: event.id,
				method: "askUserQuestion",
				title: event.title,
				message: event.message,
				questions: event.questions,
				timeout: 60000,
				toolCallId: "tool-ask",
				permissionMeta: event.permissionMeta,
			},
			request_id: event.id,
		});

		await new Promise((r) => setTimeout(r, 10));

		expect(respondUIMock).toHaveBeenCalledWith(event.id, askAnswer);
	});

	it("askUserQuestion: rejects malformed bridge answers instead of resolving the request", async () => {
		pullMock.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ id: "ask-request-1", answer: "plain text" }),
		});

		const handler = getHandler("ui");
		const event = createAskEvent();
		const ctx = createContext();

		await handler?.(event, ctx);
		await new Promise((r) => setTimeout(r, 10));

		expect(pushMock).toHaveBeenCalledTimes(1);
		expect(respondUIMock).not.toHaveBeenCalled();
	});

	it("legacy confirm/select/input/editor UI methods are not translated by message-bridge", async () => {
		const handler = getHandler("ui");
		const event = {
			type: "ui",
			id: "legacy-confirm",
			method: "confirm",
			title: "Legacy confirm",
			message: "Old protocol",
		} as UIEvent;
		const ctx = createContext();

		const result = await handler?.(event, ctx);
		await new Promise((r) => setTimeout(r, 10));

		expect(result).toBeUndefined();
		expect(pushMock).not.toHaveBeenCalled();
		expect(respondUIMock).not.toHaveBeenCalled();
	});

	it("notify: pushes plain text and returns undefined without respondUI", async () => {
		const handler = getHandler("ui");
		const event = {
			type: "ui",
			id: "notify-1",
			method: "notify",
			title: "Info",
			message: "Info message",
		} as UIEvent;
		const ctx = createContext();

		const result = await handler?.(event, ctx);

		expect(result).toBeUndefined();
		expect(pushMock).toHaveBeenCalledTimes(1);
		const pushBody = JSON.parse(pushMock.mock.calls[0][1].body);
		expect(pushBody.question).toBe("Info message");

		await new Promise((r) => setTimeout(r, 10));

		expect(respondUIMock).not.toHaveBeenCalled();
	});

	it("agent_end: pushes assistant text and calls sendUserMessage on reply", async () => {
		pullMock.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ id: "test-msg-id", answer: "继续执行下一步" }),
		});

		const handler = getHandler("agent_end");
		await handler?.({
			type: "agent_end",
			messages: [userMessage("do something"), assistantMessage("I did the thing.")],
		} satisfies AgentEndEvent);

		const pushBody = JSON.parse(pushMock.mock.calls[0][1].body);
		expect(pushBody.question).toContain("I did the thing.");

		await new Promise((r) => setTimeout(r, 10));

		expect(sendUserMessageMock).toHaveBeenCalledWith("继续执行下一步");
	});

	it("agent_end: does not call sendUserMessage when answer is empty", async () => {
		pullMock.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ id: "test-msg-id", answer: "   " }),
		});

		const handler = getHandler("agent_end");
		await handler?.({
			type: "agent_end",
			messages: [assistantMessage("done")],
		} satisfies AgentEndEvent);

		await new Promise((r) => setTimeout(r, 10));

		expect(sendUserMessageMock).not.toHaveBeenCalled();
	});

	it("agent_end: skips when no assistant messages", async () => {
		const handler = getHandler("agent_end");
		await handler?.({
			type: "agent_end",
			messages: [userMessage("hello")],
		} satisfies AgentEndEvent);

		expect(pushMock).not.toHaveBeenCalled();
	});

	it("agent_end: joins multiple assistant messages", async () => {
		pullMock.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ id: "test-msg-id", answer: "ok" }),
		});

		const handler = getHandler("agent_end");
		await handler?.({
			type: "agent_end",
			messages: [assistantMessage("Step 1 done."), assistantMessage("Step 2 done.")],
		} satisfies AgentEndEvent);

		const pushBody = JSON.parse(pushMock.mock.calls[0][1].body);
		expect(pushBody.question).toContain("Step 1 done.");
		expect(pushBody.question).toContain("Step 2 done.");
		expect(pushBody.question).toContain("---");
	});
});

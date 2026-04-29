import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPushResponse = { id: "test-msg-id", status: "pushed" };
const pushMock = vi.fn().mockResolvedValue({
	ok: true,
	status: 200,
	json: () => Promise.resolve(mockPushResponse),
});
const pullMock = vi.fn().mockResolvedValue({
	ok: true,
	status: 200,
	json: () => Promise.resolve({ id: "test-msg-id", answer: "yes" }),
});

vi.stubGlobal(
	"fetch",
	vi.fn((url: string, init?: RequestInit) => {
		if (url.endsWith("/push")) return pushMock(url, init);
		if (url.includes("/pull/")) return pullMock(url, init);
		return Promise.resolve({ ok: false, status: 404 });
	}),
);

const handlers: Array<{ event: string; handler: (...args: any[]) => any }> = [];
const sendUserMessageMock = vi.fn();
const mockPi = {
	on: vi.fn((event: string, handler: (...args: any[]) => any) => {
		handlers.push({ event, handler });
	}),
	sendUserMessage: sendUserMessageMock,
};

const respondUIMock = vi.fn();

function getHandler(event: string) {
	return handlers.find((h) => h.event === event)?.handler;
}

function createUIEvent(method: string, overrides: Record<string, any> = {}) {
	return {
		type: "ui" as const,
		id: `test-${method}-${Date.now()}`,
		method: method as "confirm" | "select" | "input" | "notify",
		title: "Test Title",
		message: "Test Message",
		options: ["Option A", "Option B", "Option C"],
		placeholder: "Enter text...",
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

		const { default: factory } = await import("../extensions/message-bridge/index.ts");
		factory(mockPi);
	});

	it("registers ui and agent_end handlers", () => {
		expect(mockPi.on).toHaveBeenCalledWith("ui", expect.any(Function));
		expect(mockPi.on).toHaveBeenCalledWith("agent_end", expect.any(Function));
	});

	it("confirm: pushes {type:confirm} and resolves via respondUI with confirmed=true", async () => {
		pullMock.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ id: "test-msg-id", answer: "【确认】: 确定" }),
		});

		const handler = getHandler("ui")!;
		const event = createUIEvent("confirm");
		const ctx = createContext();

		const result = await handler(event, ctx);

		expect(result).toBeUndefined();
		expect(pushMock).toHaveBeenCalledTimes(1);

		const pushBody = JSON.parse(pushMock.mock.calls[0][1].body);
		expect(pushBody.question).toEqual({ type: "confirm", question: "Test Title - Test Message" });

		await new Promise((r) => setTimeout(r, 10));

		expect(respondUIMock).toHaveBeenCalledWith(event.id, {
			action: "responded",
			confirmed: true,
		});
	});

	it("confirm: parses '取消' as confirmed=false", async () => {
		pullMock.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ id: "test-msg-id", answer: "【确认】: 取消" }),
		});

		const handler = getHandler("ui")!;
		const event = createUIEvent("confirm");
		const ctx = createContext();

		await handler(event, ctx);
		await new Promise((r) => setTimeout(r, 10));

		expect(respondUIMock).toHaveBeenCalledWith(event.id, {
			action: "responded",
			confirmed: false,
		});
	});

	it("select: pushes structured radio question", async () => {
		pullMock.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ id: "test-msg-id", answer: "【问题】: Option B" }),
		});

		const handler = getHandler("ui")!;
		const event = createUIEvent("select");
		const ctx = createContext();

		await handler(event, ctx);

		const pushBody = JSON.parse(pushMock.mock.calls[0][1].body);
		expect(pushBody.question).toEqual({
			type: "radio",
			question: "Test Title",
			options: [
				{ label: "Option A", description: "" },
				{ label: "Option B", description: "" },
				{ label: "Option C", description: "" },
			],
		});

		await new Promise((r) => setTimeout(r, 10));

		expect(respondUIMock).toHaveBeenCalledWith(event.id, {
			action: "responded",
			value: "Option B",
		});
	});

	it("select: parses JSON array answer (multi-select)", async () => {
		pullMock.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ id: "test-msg-id", answer: '["Option A","Option C"]' }),
		});

		const handler = getHandler("ui")!;
		const event = createUIEvent("select");
		const ctx = createContext();

		await handler(event, ctx);
		await new Promise((r) => setTimeout(r, 10));

		expect(respondUIMock).toHaveBeenCalledWith(event.id, {
			action: "responded",
			value: "Option A",
		});
	});

	it("input: pushes plain text question and returns answer", async () => {
		pullMock.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ id: "test-msg-id", answer: "user input text" }),
		});

		const handler = getHandler("ui")!;
		const event = createUIEvent("input");
		const ctx = createContext();

		await handler(event, ctx);

		const pushBody = JSON.parse(pushMock.mock.calls[0][1].body);
		expect(pushBody.question).toContain("Test Title");
		expect(pushBody.question).toContain("Placeholder: Enter text...");

		await new Promise((r) => setTimeout(r, 10));

		expect(respondUIMock).toHaveBeenCalledWith(event.id, {
			action: "responded",
			value: "user input text",
		});
	});

	it("notify: pushes and returns undefined without respondUI", async () => {
		const handler = getHandler("ui")!;
		const event = createUIEvent("notify", { title: "Info message", message: "Info message" });
		const ctx = createContext();

		const result = await handler(event, ctx);

		expect(result).toBeUndefined();
		expect(pushMock).toHaveBeenCalledTimes(1);

		await new Promise((r) => setTimeout(r, 10));

		expect(respondUIMock).not.toHaveBeenCalled();
	});

	it("agent_end: pushes assistant text and calls sendUserMessage on reply", async () => {
		pullMock.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ id: "test-msg-id", answer: "继续执行下一步" }),
		});

		const handler = getHandler("agent_end")!;
		await handler({
			type: "agent_end",
			messages: [
				{ role: "user", content: "do something" },
				{ role: "assistant", content: [{ type: "text", text: "I did the thing." }] },
			],
		});

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

		const handler = getHandler("agent_end")!;
		await handler({
			type: "agent_end",
			messages: [{ role: "assistant", content: [{ type: "text", text: "done" }] }],
		});

		await new Promise((r) => setTimeout(r, 10));

		expect(sendUserMessageMock).not.toHaveBeenCalled();
	});

	it("agent_end: skips when no assistant messages", async () => {
		const handler = getHandler("agent_end")!;
		await handler({
			type: "agent_end",
			messages: [{ role: "user", content: "hello" }],
		});

		expect(pushMock).not.toHaveBeenCalled();
	});

	it("agent_end: joins multiple assistant messages", async () => {
		pullMock.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ id: "test-msg-id", answer: "ok" }),
		});

		const handler = getHandler("agent_end")!;
		await handler({
			type: "agent_end",
			messages: [
				{ role: "assistant", content: [{ type: "text", text: "Step 1 done." }] },
				{ role: "assistant", content: [{ type: "text", text: "Step 2 done." }] },
			],
		});

		const pushBody = JSON.parse(pushMock.mock.calls[0][1].body);
		expect(pushBody.question).toContain("Step 1 done.");
		expect(pushBody.question).toContain("Step 2 done.");
		expect(pushBody.question).toContain("---");
	});
});

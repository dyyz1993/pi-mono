import { describe, expect, it, vi } from "vitest";
import { RpcClient } from "../src/modes/rpc/rpc-client.js";

type RpcClientPrivate = {
	send: (command: { type: string }) => Promise<unknown>;
	getData: <T>(response: unknown) => T;
};

describe("RpcClient clone", () => {
	it("sends the clone RPC command", async () => {
		const client = new RpcClient();
		const privateClient = client as unknown as RpcClientPrivate;
		const send = vi.fn(async () => ({
			type: "response",
			command: "clone",
			success: true,
			data: { cancelled: false },
		}));
		privateClient.send = send;
		privateClient.getData = <T>(response: unknown): T => {
			return (response as { data: T }).data;
		};

		const result = await client.clone();

		expect(send).toHaveBeenCalledWith({ type: "clone" });
		expect(result).toEqual({ cancelled: false });
	});
});

describe("RpcClient getTierModels", () => {
	it("sends get_tier_models command", async () => {
		const client = new RpcClient();
		const privateClient = client as unknown as RpcClientPrivate;
		const send = vi.fn(async () => ({
			type: "response",
			command: "get_tier_models",
			success: true,
			data: {
				models: {
					fast: "anthropic/claude-haiku-4",
					pro: "anthropic/claude-sonnet-4-20250514",
					max: "anthropic/claude-opus-4-6",
				},
			},
		}));
		privateClient.send = send;
		privateClient.getData = <T>(response: unknown): T => {
			return (response as { data: T }).data;
		};

		const result = await client.getTierModels();

		expect(send).toHaveBeenCalledWith({ type: "get_tier_models" });
		expect(result).toEqual({
			fast: "anthropic/claude-haiku-4",
			pro: "anthropic/claude-sonnet-4-20250514",
			max: "anthropic/claude-opus-4-6",
		});
	});
});

describe("RpcClient setTierModels", () => {
	it("sends set_tier_models command with models", async () => {
		const client = new RpcClient();
		const privateClient = client as unknown as RpcClientPrivate;
		const send = vi.fn(async () => ({
			type: "response",
			command: "set_tier_models",
			success: true,
		}));
		privateClient.send = send;

		await client.setTierModels({ fast: "openai/gpt-4o", pro: "anthropic/claude-sonnet-4-20250514" });

		expect(send).toHaveBeenCalledWith({
			type: "set_tier_models",
			models: { fast: "openai/gpt-4o", pro: "anthropic/claude-sonnet-4-20250514" },
		});
	});
});

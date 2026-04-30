import { randomUUID } from "crypto";
import type { Channel, ChannelDataMessage, ChannelEntry, ChannelOutputFn } from "./channel-types.js";

const DEFAULT_INVOKE_TIMEOUT = 30_000;

export class ChannelManager {
	private channels = new Map<string, ChannelEntry>();
	private outputFn: ChannelOutputFn;

	constructor(outputFn: ChannelOutputFn) {
		this.outputFn = outputFn;
	}

	register(name: string): Channel {
		if (this.channels.has(name)) {
			throw new Error(`Channel "${name}" is already registered`);
		}

		const entry: ChannelEntry = {
			name,
			handlers: new Set(),
			pendingInvokes: new Map(),
		};
		this.channels.set(name, entry);

		const invokeImpl = (data: unknown, timeoutMs: number = DEFAULT_INVOKE_TIMEOUT): Promise<unknown> => {
			return new Promise((resolve, reject) => {
				const invokeId = `inv_${randomUUID().slice(0, 8)}`;
				const timer = setTimeout(() => {
					entry.pendingInvokes.delete(invokeId);
					reject(new Error(`Channel invoke "${name}" timed out after ${timeoutMs}ms`));
				}, timeoutMs);

				entry.pendingInvokes.set(invokeId, { resolve, reject, timer });
				this.outputFn({
					type: "channel_data",
					name,
					data: { ...((data as Record<string, unknown>) ?? {}), invokeId },
				});
			});
		};

		return {
			name,
			send: (data: unknown) => {
				this.outputFn({ type: "channel_data", name, data });
			},
			onReceive: (handler: (data: unknown) => void) => {
				entry.handlers.add(handler);
				return () => {
					entry.handlers.delete(handler);
				};
			},
			invoke: invokeImpl,
			call: (method: string, params: Record<string, unknown>, timeoutMs?: number) => {
				const payload = { ...params, __call: method };
				return invokeImpl(payload, timeoutMs ?? DEFAULT_INVOKE_TIMEOUT);
			},
		};
	}

	handleInbound(message: ChannelDataMessage): void {
		const entry = this.channels.get(message.name);
		if (!entry) return;

		const data = message.data as Record<string, unknown>;

		if (data && typeof data === "object" && typeof data.invokeId === "string") {
			const pending = entry.pendingInvokes.get(data.invokeId);
			if (pending) {
				clearTimeout(pending.timer);
				entry.pendingInvokes.delete(data.invokeId);
				pending.resolve(data);
				return;
			}
		}

		for (const handler of entry.handlers) {
			try {
				handler(message.data);
			} catch {
				// swallow handler errors
			}
		}
	}

	has(name: string): boolean {
		return this.channels.has(name);
	}

	unregister(name: string): void {
		const entry = this.channels.get(name);
		if (!entry) return;
		for (const [, pending] of entry.pendingInvokes) {
			clearTimeout(pending.timer);
			pending.reject(new Error(`Channel "${name}" was unregistered`));
		}
		this.channels.delete(name);
	}
}

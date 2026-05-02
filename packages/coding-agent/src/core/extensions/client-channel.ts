import type { Channel } from "./channel-types.js";

export type {
	ChannelContract,
	EventData,
	EventKeys,
	MethodKeys,
	MethodParams,
	MethodReturn,
} from "./server-channel.js";

import type {
	ChannelContract,
	EventData,
	EventKeys,
	MethodKeys,
	MethodParams,
	MethodReturn,
} from "./server-channel.js";

const DEFAULT_CALL_TIMEOUT = 30_000;

export class ClientChannel<T extends ChannelContract = ChannelContract> {
	private raw: Channel;

	constructor(raw: Channel) {
		this.raw = raw;
	}

	/**
	 * Call a method on the server with typed parameters and return value.
	 *
	 * @param method - The method name to call
	 * @param params - The parameters to pass to the method
	 * @param timeoutMs - Optional timeout in milliseconds (default: 30000)
	 * @returns Promise that resolves to the method's return value
	 *
	 * @example
	 * ```typescript
	 * interface MyContract extends ChannelContract {
	 *   methods: {
	 *     getUser: { params: { id: string }; return: { name: string; email: string } };
	 *     updateUser: { params: { id: string; name: string }; return: { success: boolean } };
	 *   };
	 * }
	 *
	 * const client = new ClientChannel<MyContract>(channel);
	 * const user = await client.call("getUser", { id: "123" });
	 * console.log(user.name);
	 * ```
	 */
	call<K extends MethodKeys<T>>(
		method: K,
		params: MethodParams<T, K>,
		timeoutMs: number = DEFAULT_CALL_TIMEOUT,
	): Promise<MethodReturn<T, K>> {
		return this.raw.call(method, params as Record<string, unknown>, timeoutMs) as Promise<MethodReturn<T, K>>;
	}

	/**
	 * Subscribe to an event from the server with typed event data.
	 *
	 * @param event - The event name to listen for
	 * @param handler - The handler function for the event data
	 * @returns Unsubscribe function to remove the event listener
	 *
	 * @example
	 * ```typescript
	 * interface MyContract extends ChannelContract {
	 *   events: {
	 *     userUpdated: { userId: string; name: string };
	 *     userDeleted: { userId: string };
	 *   };
	 * }
	 *
	 * const client = new ClientChannel<MyContract>(channel);
	 * const unsub = client.on("userUpdated", (data) => {
	 *   console.log(`User ${data.userId} updated to ${data.name}`);
	 * });
	 *
	 * // Later, unsubscribe
	 * unsub();
	 * ```
	 */
	on<K extends EventKeys<T>>(_event: K, handler: (data: EventData<T, K>) => void): () => void {
		return this.raw.onReceive(handler as (data: unknown) => void);
	}

	/**
	 * Get the raw Channel object for low-level operations.
	 */
	get raw_(): Channel {
		return this.raw;
	}
}

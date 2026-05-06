import type { Channel } from "./channel-types.js";

export interface ChannelContract {
	methods?: Record<string, { params: unknown; return: unknown }>;
	events?: Record<string, unknown>;
}

type MethodKeys<T extends ChannelContract> = keyof NonNullable<T["methods"]> & string;

type MethodParams<T extends ChannelContract, K extends MethodKeys<T>> = NonNullable<T["methods"]>[K] extends {
	params: infer P;
}
	? P
	: unknown;

type MethodReturn<T extends ChannelContract, K extends MethodKeys<T>> = NonNullable<T["methods"]>[K] extends {
	return: infer R;
}
	? R
	: unknown;

type EventKeys<T extends ChannelContract> = keyof NonNullable<T["events"]> & string;

type EventData<T extends ChannelContract, K extends EventKeys<T>> = NonNullable<T["events"]>[K];

export class ServerChannel<T extends ChannelContract = ChannelContract> {
	private raw: Channel;
	private methodHandlers = new Map<string, (params: unknown) => unknown>();

	constructor(raw: Channel) {
		this.raw = raw;

		this.raw.onReceive((data: unknown) => {
			const msg = data as Record<string, unknown>;
			if (!("__call" in msg)) return;

			const method = msg.__call as string;
			const handler = this.methodHandlers.get(method);
			if (!handler) return;

			const { __call: _, invokeId, ...params } = msg;
			const result = handler(params);

			if (result instanceof Promise) {
				result.then((res) => {
					if (invokeId) {
						this.raw.send({ ...(res ?? {}), invokeId });
					}
				});
			} else {
				if (invokeId) {
					this.raw.send({ ...(result ?? {}), invokeId });
				}
			}
		});
	}

	handle<K extends MethodKeys<T>>(
		method: K,
		fn: (params: MethodParams<T, K>) => MethodReturn<T, K> | Promise<MethodReturn<T, K>>,
	): void {
		this.methodHandlers.set(method, fn as (params: unknown) => unknown);
	}

	emit<K extends EventKeys<T>>(_event: K, data: EventData<T, K>): void {
		this.raw.send(data);
	}

	get raw_(): Channel {
		return this.raw;
	}
}

export type { MethodKeys, MethodParams, MethodReturn, EventKeys, EventData };

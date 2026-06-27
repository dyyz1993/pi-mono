import { asRecord } from "../../utils/type-helpers.ts";
import type { Channel } from "./channel-types.ts";
import type {
	ChannelContract,
	EventData,
	EventKeys,
	MethodKeys,
	MethodParams,
	MethodReturn,
} from "./server-channel.ts";

export type {
	ChannelContract,
	EventData,
	EventKeys,
	MethodKeys,
	MethodParams,
	MethodReturn,
} from "./server-channel.ts";

const DEFAULT_CALL_TIMEOUT = 30_000;

export class ClientChannel<T extends ChannelContract = ChannelContract> {
	private raw: Channel;

	constructor(raw: Channel) {
		this.raw = raw;
	}

	call<K extends MethodKeys<T>>(
		method: K,
		params: MethodParams<T, K>,
		timeoutMs: number = DEFAULT_CALL_TIMEOUT,
	): Promise<MethodReturn<T, K>> {
		return this.raw.call(method, asRecord(params), timeoutMs) as Promise<MethodReturn<T, K>>;
	}

	on<K extends EventKeys<T>>(_event: K, handler: (data: EventData<T, K>) => void): () => void {
		return this.raw.onReceive((data: unknown) => {
			const msg = asRecord(data);
			// RPC requests have __call, RPC responses have invokeId — skip both
			if (msg && ("__call" in msg || "invokeId" in msg)) return;
			handler(data as EventData<T, K>);
		});
	}

	get raw_(): Channel {
		return this.raw;
	}
}

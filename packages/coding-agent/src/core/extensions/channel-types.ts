export interface Channel {
	name: string;
	/**
	 * @deprecated Use `call()` for request-response or `ServerChannel.emit()` on the server side.
	 */
	send: (data: unknown) => void;
	/**
	 * @deprecated Use `call()` for typed request-response. Raw `onReceive` receives all messages.
	 */
	onReceive: (handler: (data: unknown) => void) => () => void;
	invoke: (data: unknown, timeoutMs?: number) => Promise<unknown>;
	call: (method: string, params: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>;
}

export interface ChannelEntry {
	name: string;
	handlers: Set<(data: unknown) => void>;
	pendingInvokes: Map<
		string,
		{
			resolve: (data: unknown) => void;
			reject: (err: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>;
}

export type ChannelOutputFn = (message: ChannelDataMessage) => void;

export interface ChannelDataMessage {
	type: "channel_data";
	name: string;
	data: unknown;
}

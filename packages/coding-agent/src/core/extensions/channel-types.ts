export interface Channel {
	name: string;
	send: (data: unknown) => void;
	onReceive: (handler: (data: unknown) => void) => () => void;
	invoke: (data: unknown, timeoutMs?: number) => Promise<unknown>;
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

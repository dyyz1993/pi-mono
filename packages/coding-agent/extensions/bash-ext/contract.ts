import type { ChannelContract } from "@dyyz1993/pi-coding-agent";

export const BASH_CHANNEL_NAME = "bash";

export interface BashProcess {
	bashId: string;
	toolCallId: string;
	command: string;
	cwd: string;
	pid?: number;
	startedAt: number;
	endedAt?: number;
	exitCode?: number | null;
	output: string;
	status: "running" | "done" | "error" | "terminated" | "background";
	error?: string;
	logPath?: string;
}

export interface BashChannelEvent {
	type: "start" | "output" | "end" | "error" | "terminated" | "background" | "list";
	processes?: BashProcess[];
	toolCallId?: string;
	pid?: number;
	data?: string;
	timestamp: number;
}

export interface BashChannelContract extends ChannelContract {
	methods: {
		list: {
			params: Record<string, never>;
			return: BashChannelEvent;
		};
		kill: {
			params: { toolCallId: string };
			return: void;
		};
		background: {
			params: { toolCallId: string };
			return: void;
		};
		subscribe_output: {
			params: { toolCallId: string };
			return: void;
		};
		unsubscribe_output: {
			params: { toolCallId: string };
			return: void;
		};
		remove: {
			params: { toolCallId: string };
			return: void;
		};
		write_stdin: {
			params: { toolCallId: string; data: string };
			return: void;
		};
	};
	events: {
		list: BashChannelEvent;
		start: BashChannelEvent;
		output: BashChannelEvent;
		end: BashChannelEvent;
		error: BashChannelEvent;
		background: BashChannelEvent;
		terminated: BashChannelEvent;
	};
}

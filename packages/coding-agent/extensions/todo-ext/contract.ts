import type { ChannelContract } from "@dyyz1993/pi-coding-agent";

export const TODO_CHANNEL_NAME = "todo";

export interface TodoItem {
	id: number;
	text: string;
	done: boolean;
	deleted?: boolean;
	priority?: "high" | "medium" | "low";
}

export interface TodoChannelEvent {
	action: string;
	todos: TodoItem[];
	timestamp: number;
}

export interface TodoChannelContract extends ChannelContract {
	methods?: Record<string, never>;
	events: {
		restored: TodoChannelEvent;
		list: TodoChannelEvent;
		add: TodoChannelEvent;
		toggle: TodoChannelEvent;
		remove: TodoChannelEvent;
		clear: TodoChannelEvent;
		error: TodoChannelEvent;
	};
}

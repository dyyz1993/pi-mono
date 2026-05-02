/**
 * Todo Extension - LLM-managed todo list with channel exposure and UI rendering.
 *
 * - Registers a `todo` tool for the LLM (list, add, toggle, remove, clear)
 * - Registers a `todo` channel for real-time event streaming
 * - Persists snapshots via appendEntry for history retrieval
 * - Renders tool calls/results with styled UI (✓/○/✗)
 * - Shows live todo widget in the editor panel
 */

import type { AgentToolResult } from "@dyyz1993/pi-agent-core";
import { StringEnum } from "@dyyz1993/pi-ai";
import { Text } from "@dyyz1993/pi-tui";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "../../src/core/extensions/index.js";
import { ServerChannel } from "../../src/core/extensions/server-channel.js";

export interface Todo {
	id: number;
	text: string;
	done: boolean;
	deleted?: boolean;
	priority?: "high" | "medium" | "low";
}

export interface TodoDetails {
	action: string;
	todos: Todo[];
	nextId: number;
	error?: string;
}

export interface TodoChannelEvent {
	action: string;
	todos: Todo[];
	timestamp: number;
}

const PRIORITY_LABELS: Record<string, string> = {
	high: "!",
	medium: "",
	low: "?",
};

const PRIORITY_ORDER: Record<string, number> = {
	high: 0,
	medium: 1,
	low: 2,
};

const TodoParams = Type.Object({
	action: StringEnum(["list", "add", "toggle", "remove", "clear"] as const),
	text: Type.Optional(Type.String({ description: "Todo text (for add)" })),
	id: Type.Optional(Type.Number({ description: "Todo ID (for toggle / remove)" })),
	priority: Type.Optional(StringEnum(["high", "medium", "low"] as const)),
});

function persistEntry(pi: ExtensionAPI, action: string, todos: Todo[], nextId: number): void {
	pi.appendEntry("todo", { action, todos: [...todos], nextId, timestamp: Date.now() });
}

function updateWidget(ctx: ExtensionContext | undefined, todos: Todo[]): void {
	if (!ctx?.hasUI) return;
	const active = todos.filter((t) => !t.deleted);
	if (active.length === 0) {
		ctx.ui.setWidget("todo-todos", undefined);
		return;
	}
	const sorted = [...active].sort((a, b) => {
		const pa = PRIORITY_ORDER[a.priority ?? "medium"] ?? 1;
		const pb = PRIORITY_ORDER[b.priority ?? "medium"] ?? 1;
		return pa - pb || a.id - b.id;
	});
	const lines = sorted.map((t) => {
		const check = t.done ? ctx.ui.theme.fg("success", "☑ ") : ctx.ui.theme.fg("muted", "☐ ");
		const priLabel = t.priority
			? ctx.ui.theme.fg(
					t.priority === "high" ? "error" : t.priority === "low" ? "dim" : "dim",
					PRIORITY_LABELS[t.priority] ?? "",
				)
			: "";
		const text = t.done ? ctx.ui.theme.fg("dim", ctx.ui.theme.strikethrough(t.text)) : t.text;
		return `${check}${priLabel} ${text}`;
	});
	ctx.ui.setWidget("todo-todos", lines);
}

export default function (pi: ExtensionAPI) {
	let todos: Todo[] = [];
	let nextId = 1;
	let channel: ServerChannel | null = null;

	const reconstructState = (ctx: ExtensionContext): void => {
		todos = [];
		nextId = 1;

		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === "todo") {
				const data = entry.data as { action: string; todos: Todo[]; nextId: number } | undefined;
				if (data?.todos) {
					todos = data.todos;
					nextId = data.nextId;
				}
				continue;
			}
			if (entry.type !== "message") continue;
			const msg = entry.message;
			if (msg.role !== "toolResult" || msg.toolName !== "todo") continue;

			const details = msg.details as TodoDetails | undefined;
			if (details) {
				todos = details.todos;
				nextId = details.nextId;
			}
		}
		updateWidget(undefined, todos);
	};

	pi.on("session_start", async (_event, ctx) => {
		const rawChannel = pi.registerChannel("todo");
		channel = new ServerChannel(rawChannel);
		reconstructState(ctx);
		channel.emit("restored", { action: "restored", todos, timestamp: Date.now() } satisfies TodoChannelEvent);
	});

	pi.on("session_tree", async (_event, ctx) => reconstructState(ctx));

	pi.registerTool({
		name: "todo",
		label: "Todo",
		description: "Manage a todo list. Actions: list, add (text, priority?), toggle (id), remove (id), clear",
		parameters: TodoParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<TodoDetails>> {
			switch (params.action) {
				case "list": {
					const active = todos.filter((t) => !t.deleted);
					channel?.emit("list", { action: "list", todos, timestamp: Date.now() } satisfies TodoChannelEvent);
					persistEntry(pi, "list", todos, nextId);
					updateWidget(ctx, todos);
					return {
						content: [
							{
								type: "text",
								text: active.length
									? active.map((t) => `[${t.done ? "x" : " "}] #${t.id}: ${t.text}`).join("\n")
									: "No todos",
							},
						],
						details: { action: "list", todos: [...todos], nextId },
					};
				}

				case "add": {
					if (!params.text) {
						channel?.emit("error", { action: "error", todos, timestamp: Date.now() } satisfies TodoChannelEvent);
						persistEntry(pi, "add_error", todos, nextId);
						return {
							content: [{ type: "text", text: "Error: text required for add" }],
							details: { action: "add", todos: [...todos], nextId, error: "text required" },
						};
					}
					const lines = params.text
						.split("\n")
						.map((l) => l.trim())
						.filter(Boolean);
					const added: Todo[] = [];
					for (const line of lines) {
						const newTodo: Todo = { id: nextId++, text: line, done: false, priority: params.priority };
						todos.push(newTodo);
						added.push(newTodo);
					}
					channel?.emit("add", { action: "add", todos, timestamp: Date.now() } satisfies TodoChannelEvent);
					persistEntry(pi, "add", todos, nextId);
					updateWidget(ctx, todos);
					if (added.length === 1) {
						return {
							content: [{ type: "text", text: `Added todo #${added[0].id}: ${added[0].text}` }],
							details: { action: "add", todos: [...todos], nextId },
						};
					}
					return {
						content: [
							{ type: "text", text: `Added ${added.length} todos (#${added[0].id}–#${added.at(-1)!.id})` },
						],
						details: { action: "add_batch", todos: [...todos], nextId },
					};
				}

				case "toggle": {
					if (params.id === undefined) {
						channel?.emit("error", { action: "error", todos, timestamp: Date.now() } satisfies TodoChannelEvent);
						persistEntry(pi, "toggle_error", todos, nextId);
						return {
							content: [{ type: "text", text: "Error: id required for toggle" }],
							details: { action: "toggle", todos: [...todos], nextId, error: "id required" },
						};
					}
					const todo = todos.find((t) => t.id === params.id);
					if (!todo) {
						channel?.emit("error", { action: "error", todos, timestamp: Date.now() } satisfies TodoChannelEvent);
						persistEntry(pi, "toggle_notfound", todos, nextId);
						return {
							content: [{ type: "text", text: `Todo #${params.id} not found` }],
							details: {
								action: "toggle",
								todos: [...todos],
								nextId,
								error: `#${params.id} not found`,
							},
						};
					}
					todo.done = !todo.done;
					channel?.emit("toggle", { action: "toggle", todos, timestamp: Date.now() } satisfies TodoChannelEvent);
					persistEntry(pi, "toggle", todos, nextId);
					updateWidget(ctx, todos);
					return {
						content: [{ type: "text", text: `Todo #${todo.id} ${todo.done ? "completed" : "uncompleted"}` }],
						details: { action: "toggle", todos: [...todos], nextId },
					};
				}

				case "remove": {
					if (params.id === undefined) {
						channel?.emit("error", { action: "error", todos, timestamp: Date.now() } satisfies TodoChannelEvent);
						persistEntry(pi, "remove_error", todos, nextId);
						return {
							content: [{ type: "text", text: "Error: id required for remove" }],
							details: { action: "remove", todos: [...todos], nextId, error: "id required" },
						};
					}
					const todo = todos.find((t) => t.id === params.id);
					if (!todo) {
						channel?.emit("error", { action: "error", todos, timestamp: Date.now() } satisfies TodoChannelEvent);
						persistEntry(pi, "remove_notfound", todos, nextId);
						return {
							content: [{ type: "text", text: `Todo #${params.id} not found` }],
							details: { action: "remove", todos: [...todos], nextId, error: `#${params.id} not found` },
						};
					}
					todo.deleted = true;
					channel?.emit("remove", { action: "remove", todos, timestamp: Date.now() } satisfies TodoChannelEvent);
					persistEntry(pi, "remove", todos, nextId);
					updateWidget(ctx, todos);
					return {
						content: [{ type: "text", text: `Removed todo #${todo.id}: ${todo.text}` }],
						details: { action: "remove", todos: [...todos], nextId },
					};
				}

				case "clear": {
					const count = todos.length;
					todos = [];
					nextId = 1;
					channel?.emit("clear", { action: "clear", todos: [], timestamp: Date.now() } satisfies TodoChannelEvent);
					persistEntry(pi, "clear", [], 1);
					updateWidget(ctx, todos);
					return {
						content: [{ type: "text", text: `Cleared ${count} todos` }],
						details: { action: "clear", todos: [], nextId: 1 },
					};
				}

				default: {
					channel?.emit("error", { action: "error", todos, timestamp: Date.now() } satisfies TodoChannelEvent);
					return {
						content: [{ type: "text", text: `Unknown action: ${params.action}` }],
						details: {
							action: "list",
							todos: [...todos],
							nextId,
							error: `unknown action: ${params.action}`,
						},
					};
				}
			}
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", args.action);
			if (args.text) text += ` ${theme.fg("dim", `"${args.text}"`)}`;
			if (args.id !== undefined) text += ` ${theme.fg("accent", `#${args.id}`)}`;
			if (args.priority) text += ` ${theme.fg(args.priority === "high" ? "error" : "dim", `[${args.priority}]`)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as TodoDetails | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			if (details.error) {
				return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			}

			const todoList = details.todos.filter((t) => !t.deleted);

			const statusBadge = (t: Todo): string => {
				if (t.done) return theme.fg("success", "已完成");
				if (t.priority === "high") return theme.fg("error", "高优先");
				if (t.priority === "low") return theme.fg("dim", "低优先");
				return theme.fg("dim", "待处理");
			};

			const formatRow = (t: Todo): string => {
				const check = t.done ? theme.fg("success", "☑") : theme.fg("muted", "☐");
				const label = t.priority ? (t.priority === "high" ? theme.fg("error", "!") : theme.fg("dim", "?")) : "";
				const txt = t.done ? theme.fg("dim", t.text) : theme.fg("text", t.text);
				const badge = statusBadge(t);
				return `${check} ${label} ${txt}${" ".repeat(Math.max(1, 20 - t.text.length))}${badge}`;
			};

			switch (details.action) {
				case "list": {
					if (todoList.length === 0) {
						return new Text(theme.fg("dim", "No todos"), 0, 0);
					}
					const header = theme.fg("toolTitle", `${todoList.length} todos`);
					const display = expanded ? todoList : todoList.slice(0, 5);
					let listText = header;
					for (const t of display) {
						listText += `\n${formatRow(t)}`;
					}
					if (!expanded && todoList.length > 5) {
						listText += `\n${theme.fg("dim", `... ${todoList.length - 5} more`)}`;
					}
					return new Text(listText, 0, 0);
				}

				case "add": {
					const added = todoList[todoList.length - 1];
					if (!added) return new Text(theme.fg("success", "✓ Added"), 0, 0);
					const header = theme.fg("toolTitle", `${todoList.length} todos`);
					return new Text(`${header}\n${formatRow(added)}`, 0, 0);
				}

				case "toggle": {
					const header = theme.fg("toolTitle", `${todoList.length} todos`);
					const display = expanded ? todoList : todoList.slice(0, 5);
					let listText = header;
					for (const t of display) {
						listText += `\n${formatRow(t)}`;
					}
					if (!expanded && todoList.length > 5) {
						listText += `\n${theme.fg("dim", `... ${todoList.length - 5} more`)}`;
					}
					return new Text(listText, 0, 0);
				}

				case "remove": {
					const header = theme.fg("toolTitle", `${todoList.length} todos`);
					const display = expanded ? todoList : todoList.slice(0, 5);
					let listText = header;
					for (const t of display) {
						listText += `\n${formatRow(t)}`;
					}
					if (!expanded && todoList.length > 5) {
						listText += `\n${theme.fg("dim", `... ${todoList.length - 5} more`)}`;
					}
					return new Text(listText, 0, 0);
				}

				case "clear":
					return new Text(theme.fg("success", "☑ Cleared all todos"), 0, 0);

				default: {
					const text = result.content[0];
					const msg = text?.type === "text" ? text.text : "";
					return new Text(theme.fg("muted", msg), 0, 0);
				}
			}
		},
	});

	pi.registerCommand("todos", {
		description: "Show all todos on the current branch",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/todos requires interactive mode", "error");
				return;
			}
			const active = todos.filter((t) => !t.deleted);
			const lines: string[] = [];
			lines.push(`Todos (${active.filter((t) => t.done).length}/${active.length}):`);
			for (const t of active) {
				const pri = t.priority ? (t.priority === "high" ? "!" : t.priority === "low" ? "?" : "") : "";
				lines.push(`${t.done ? "✓" : "○"}${pri} #${t.id}: ${t.text}`);
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}

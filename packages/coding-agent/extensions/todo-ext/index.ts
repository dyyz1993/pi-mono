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
import { createTypedChannel } from "@dyyz1993/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext, ServerChannel } from "@dyyz1993/pi-coding-agent";
import { TODO_CHANNEL_NAME, type TodoChannelContract, type TodoItem, type TodoChannelEvent } from "./contract.js";

export type Todo = TodoItem;

export interface TodoDetails {
	action: string;
	todos: Todo[];
	nextId: number;
	error?: string;
	added?: Todo[];
	modified?: Todo[];
	deleted?: Todo[];
	totalActive?: number;
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
	// ── Sub-agent mode: inject parent's todos as read-only, no todo tool ──
	if (process.env.PI_SUBAGENT === "true") {
		let parentTodos: TodoItem[] = [];
		try {
			const raw = process.env.PI_PARENT_TODOS;
			if (raw) parentTodos = JSON.parse(raw) as TodoItem[];
		} catch {
			// ignore parse errors
		}
		const active = parentTodos.filter((t) => !t.deleted && !t.done);
		if (active.length > 0) {
			const lines = active.map((t) => {
				const pri = t.priority === "high" ? " [!]" : t.priority === "low" ? " [?]" : "";
				return `  #${t.id}${pri}: ${t.text}`;
			});
			const header = `[Parent session's tasks — read-only]\nThese are the parent session's active tasks for reference. Do not modify them.\n${lines.join("\n")}`;
			pi.on("context", (_event, _ctx) => {
				return {
					messages: [
						...(_event as any).messages,
						{
							role: "user" as const,
							content: [{ type: "text" as const, text: header }],
							timestamp: Date.now(),
						},
					],
				};
			});
		}
		return; // Skip all tool/command/channel registration
	}

	// ── Normal mode ──
	let todos: Todo[] = [];
	let nextId = 1;
	let channel: ServerChannel<TodoChannelContract> | null = null;

	pi.on("session_start", async (_event, ctx) => {
		try {
			const rawChannel = pi.registerChannel(TODO_CHANNEL_NAME);
			const typed = createTypedChannel<TodoChannelContract>(rawChannel);
			channel = typed.server;
		} catch {
			// registerChannel only available in RPC mode — skip in interactive mode
		}

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
		updateWidget(ctx, todos);

		channel?.emit("restored", { action: "restored", todos, timestamp: Date.now() } satisfies TodoChannelEvent);
	});

	pi.on("session_tree", async (_event, ctx) => {
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
		updateWidget(ctx, todos);
		channel?.emit("restored", { action: "restored", todos, timestamp: Date.now() } satisfies TodoChannelEvent);
	});

	pi.registerTool({
		name: "todo",
		label: "Todo",
		description: `Manage a todo list for task tracking and planning.
- add: Create one or more todos. Separate multiple items with newlines in the text field for batch creation. Optional priority: high/medium/low.
- list: Show all active todos with their IDs, status, and priority.
- toggle: Mark a todo as done/undone by ID.
- remove: Delete a todo by ID.
- clear: Remove all todos.

IMPORTANT: For creating a plan with multiple steps, use a SINGLE add call with newline-separated text. Example: text="Step 1\\nStep 2\\nStep 3" creates 3 todos at once. Do NOT call add repeatedly for multiple items.`,
		parameters: TodoParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<TodoDetails>> {
			const activeTodos = (): Todo[] => todos.filter((t) => !t.deleted);

			switch (params.action) {
				case "list": {
					const active = activeTodos();
					channel?.emit("list", { action: "list", todos, timestamp: Date.now() } satisfies TodoChannelEvent);
					persistEntry(pi, "list", todos, nextId);
					updateWidget(ctx, todos);

					return {
						content: [{ type: "text", text: active.length === 0 ? "No todos." : `${active.length} todos.` }],
						details: {
							action: "list",
							todos: [...todos],
							nextId,
							totalActive: active.length,
						},
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

					const summary = added.length === 1
						? `Created 1 todo: "${added[0].text}"`
						: `Created ${added.length} todos.`;

					return {
						content: [{ type: "text", text: `✅ ${summary}` }],
						details: { action: added.length === 1 ? "add" : "add_batch", todos: [...todos], nextId, added: [...added] },
					};
				}

				case "toggle": {
					if (params.id === undefined) {
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
							content: [{ type: "text", text: `Error: Todo #${params.id} not found.` }],
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
						content: [{ type: "text", text: `✅ Toggled #${todo.id} "${todo.text}" to ${todo.done ? "done" : "undone"}.` }],
						details: { action: "toggle", todos: [...todos], nextId, modified: [todo] },
					};
				}

				case "remove": {
					if (params.id === undefined) {
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
							content: [{ type: "text", text: `Error: Todo #${params.id} not found.` }],
							details: {
								action: "remove",
								todos: [...todos],
								nextId,
								error: `#${params.id} not found`,
							},
						};
					}
					todo.deleted = true;
					channel?.emit("remove", { action: "remove", todos, timestamp: Date.now() } satisfies TodoChannelEvent);
					persistEntry(pi, "remove", todos, nextId);
					updateWidget(ctx, todos);
					return {
						content: [{ type: "text", text: `✅ Removed #${todo.id}: "${todo.text}".` }],
						details: { action: "remove", todos: [...todos], nextId, deleted: [todo] },
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
						content: [{ type: "text", text: `✅ Cleared ${count} todos.` }],
						details: { action: "clear", todos: [], nextId: 1 },
					};
				}

				default: {
					channel?.emit("error", { action: "error", todos, timestamp: Date.now() } satisfies TodoChannelEvent);
					return {
						content: [{ type: "text", text: `Error: Unknown action "${params.action}".` }],
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

				case "add":
				case "add_batch": {
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

	// Inject active todo list into context so the LLM is aware of ongoing tasks
	pi.on("context", (_event, _ctx) => {
		const active = todos.filter((t) => !t.deleted && !t.done);
		if (active.length === 0) return;

		const lines = active.map((t) => {
			const pri = t.priority === "high" ? " [!]" : t.priority === "low" ? " [?]" : "";
			return `  #${t.id}${pri}: ${t.text}`;
		});
		const text = `[Todo list — ${active.length} active task(s)]\n${lines.join("\n")}`;
		return {
			messages: [
				...(_event as any).messages,
				{
					role: "user" as const,
					content: [{ type: "text" as const, text }],
					timestamp: Date.now(),
				},
			],
		};
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

/**
 * Tests for extractParentTodos — extracts parent session's todo list
 * from session history entries for read-only reference in sub-agents.
 */
import { describe, expect, it } from "vitest";
import { extractParentTodos } from "./index.js";

interface CustomEntry {
	type: "custom";
	customType: string;
	data?: { todos: unknown[]; nextId?: number };
}

interface MessageEntry {
	type: "message";
	message: {
		role: string;
		toolName?: string;
		details?: { todos: unknown[]; nextId?: number };
	};
}

type Entry = CustomEntry | MessageEntry;

function customEntry(customType: string, todos: unknown[], nextId = 1): CustomEntry {
	return { type: "custom", customType, data: { todos, nextId } };
}

function toolResultEntry(details: { todos: unknown[]; nextId?: number }): MessageEntry {
	return {
		type: "message",
		message: { role: "toolResult", toolName: "todo", details },
	};
}

function userMessageEntry(): MessageEntry {
	return { type: "message", message: { role: "user" } };
}

function assistantMessageEntry(): MessageEntry {
	return { type: "message", message: { role: "assistant" } };
}

describe("extractParentTodos", () => {
	it("returns empty array when branch is empty", () => {
		expect(extractParentTodos([])).toEqual([]);
	});

	it("returns empty array when branch has no todo entries", () => {
		const branch: Entry[] = [userMessageEntry(), assistantMessageEntry()];
		expect(extractParentTodos(branch)).toEqual([]);
	});

	it("returns active todos from custom entry", () => {
		const todos = [
			{ id: 1, text: "Fix login", done: false },
			{ id: 2, text: "Add tests", done: false },
		];
		const branch: Entry[] = [customEntry("todo", todos)];
		const result = extractParentTodos(branch);
		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({ id: 1, text: "Fix login", priority: undefined, done: false });
		expect(result[1]).toEqual({ id: 2, text: "Add tests", priority: undefined, done: false });
	});

	it("filters out done todos", () => {
		const todos = [
			{ id: 1, text: "Done task", done: true },
			{ id: 2, text: "Active task", done: false },
		];
		const branch: Entry[] = [customEntry("todo", todos)];
		const result = extractParentTodos(branch);
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe(2);
	});

	it("filters out deleted todos", () => {
		const todos = [
			{ id: 1, text: "Deleted task", done: false, deleted: true },
			{ id: 2, text: "Active task", done: false },
		];
		const branch: Entry[] = [customEntry("todo", todos)];
		const result = extractParentTodos(branch);
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe(2);
	});

	it("returns the latest todo list from toolResult messages (overwrites previous)", () => {
		const earlyTodos = [{ id: 1, text: "Old task", done: false }];
		const latestTodos = [
			{ id: 1, text: "Old task", done: true },
			{ id: 2, text: "New task", done: false },
		];
		const branch: Entry[] = [customEntry("todo", earlyTodos), toolResultEntry({ todos: latestTodos, nextId: 3 })];
		const result = extractParentTodos(branch);
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe(2);
		expect(result[0].text).toBe("New task");
	});

	it("preserves priority field", () => {
		const todos = [
			{ id: 1, text: "High priority", done: false, priority: "high" },
			{ id: 2, text: "Low priority", done: false, priority: "low" },
			{ id: 3, text: "Medium priority", done: false },
		];
		const branch: Entry[] = [customEntry("todo", todos)];
		const result = extractParentTodos(branch);
		expect(result[0].priority).toBe("high");
		expect(result[1].priority).toBe("low");
		expect(result[2].priority).toBeUndefined();
	});

	it("ignores non-todo entries interspersed", () => {
		const todos = [{ id: 1, text: "The only task", done: false }];
		const branch: Entry[] = [
			userMessageEntry(),
			assistantMessageEntry(),
			customEntry("some_other_thing", [{ unrelated: true }]),
			customEntry("todo", todos),
			userMessageEntry(),
		];
		const result = extractParentTodos(branch);
		expect(result).toHaveLength(1);
		expect(result[0].text).toBe("The only task");
	});

	it("handles toolResult with no matching details gracefully", () => {
		const branch: Entry[] = [
			{
				type: "message",
				message: { role: "toolResult", toolName: "bash", details: { exitCode: 0 } },
			},
		];
		expect(extractParentTodos(branch)).toEqual([]);
	});

	it("returns empty array when all todos are done", () => {
		const todos = [
			{ id: 1, text: "Done A", done: true },
			{ id: 2, text: "Done B", done: true, deleted: true },
		];
		const branch: Entry[] = [customEntry("todo", todos)];
		expect(extractParentTodos(branch)).toEqual([]);
	});
});

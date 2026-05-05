import { describe, expect, it } from "vitest";
import { type FileEntry, migrateSessionEntries } from "../../src/core/session-manager.js";

describe("migrateSessionEntries", () => {
	it("should add id/parentId to v1 entries", () => {
		const entries: FileEntry[] = [
			{ type: "session", id: "sess-1", timestamp: "2025-01-01T00:00:00Z", cwd: "/tmp" },
			{ type: "message", timestamp: "2025-01-01T00:00:01Z", message: { role: "user", content: "hi", timestamp: 1 } },
			{
				type: "message",
				timestamp: "2025-01-01T00:00:02Z",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "hello" }],
					api: "test",
					provider: "test",
					model: "test",
					usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
					stopReason: "stop",
					timestamp: 2,
				},
			},
		] as FileEntry[];

		migrateSessionEntries(entries);

		// Header should have version set (v3 is current after hookMessage->custom migration)
		expect((entries[0] as any).version).toBe(3);

		// Entries should have id/parentId
		const msg1 = entries[1] as any;
		const msg2 = entries[2] as any;

		expect(msg1.id).toBeDefined();
		expect(msg1.id.length).toBe(8);
		expect(msg1.parentId).toBeNull();

		expect(msg2.id).toBeDefined();
		expect(msg2.id.length).toBe(8);
		expect(msg2.parentId).toBe(msg1.id);
	});

	describe("generateId (via migration)", () => {
		function makeEntries(count: number): FileEntry[] {
			const entries: FileEntry[] = [
				{ type: "session", id: "sess-1", timestamp: "2025-01-01T00:00:00Z", cwd: "/tmp" },
			];
			for (let i = 0; i < count; i++) {
				entries.push({
					type: "message",
					timestamp: `2025-01-01T00:00:0${i}Z`,
					message: { role: "user", content: `msg ${i}`, timestamp: i },
				} as any);
			}
			return entries;
		}

		it("should produce 8-char IDs on migrated entries", () => {
			const entries = makeEntries(5);
			migrateSessionEntries(entries);
			for (let i = 1; i < entries.length; i++) {
				expect((entries[i] as any).id.length).toBe(8);
			}
		});

		it("should produce IDs containing only hex characters", () => {
			const entries = makeEntries(20);
			migrateSessionEntries(entries);
			for (let i = 1; i < entries.length; i++) {
				expect((entries[i] as any).id).toMatch(/^[0-9a-f]{8}$/);
			}
		});

		it("should produce unique IDs across consecutive entries", () => {
			const entries = makeEntries(50);
			migrateSessionEntries(entries);
			const ids = new Set<string>();
			for (let i = 1; i < entries.length; i++) {
				const id = (entries[i] as any).id as string;
				expect(ids.has(id)).toBe(false);
				ids.add(id);
			}
		});

		it("should use generated IDs as the id field on migrated entries", () => {
			const entries = makeEntries(3);
			migrateSessionEntries(entries);
			for (let i = 1; i < entries.length; i++) {
				const entry = entries[i] as any;
				expect(typeof entry.id).toBe("string");
				expect(entry.id).toBeDefined();
			}
		});
	});

	it("should be idempotent (skip already migrated)", () => {
		const entries: FileEntry[] = [
			{ type: "session", id: "sess-1", version: 2, timestamp: "2025-01-01T00:00:00Z", cwd: "/tmp" },
			{
				type: "message",
				id: "abc12345",
				parentId: null,
				timestamp: "2025-01-01T00:00:01Z",
				message: { role: "user", content: "hi", timestamp: 1 },
			},
			{
				type: "message",
				id: "def67890",
				parentId: "abc12345",
				timestamp: "2025-01-01T00:00:02Z",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "hello" }],
					api: "test",
					provider: "test",
					model: "test",
					usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
					stopReason: "stop",
					timestamp: 2,
				},
			},
		] as FileEntry[];

		migrateSessionEntries(entries);

		// IDs should be unchanged
		expect((entries[1] as any).id).toBe("abc12345");
		expect((entries[2] as any).id).toBe("def67890");
		expect((entries[2] as any).parentId).toBe("abc12345");
	});
});

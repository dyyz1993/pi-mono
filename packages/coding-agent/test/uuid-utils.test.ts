/**
 * Test for UUID utility functions
 * Ensures cross-environment compatibility and uniqueness
 */

import { describe, expect, it } from "vitest";
import { generateOAuthState, generateShortId, generateUUID } from "../src/utils/uuid";

describe("UUID utility functions", () => {
	describe("generateUUID()", () => {
		it("should generate valid UUID format", () => {
			const uuid = generateUUID();
			expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
		});

		it("should generate unique UUIDs", () => {
			const uuid1 = generateUUID();
			const uuid2 = generateUUID();
			expect(uuid1).not.toBe(uuid2);
		});

		it("should generate 36-character strings", () => {
			const uuid = generateUUID();
			expect(uuid.length).toBe(36);
		});

		it("should work consistently across multiple calls", () => {
			const uuids = Array.from({ length: 100 }, () => generateUUID());
			const uniqueUuids = new Set(uuids);
			expect(uniqueUuids.size).toBe(100);
		});
	});

	describe("generateShortId()", () => {
		it("should generate unique short IDs", () => {
			const id1 = generateShortId();
			const id2 = generateShortId();
			expect(id1).not.toBe(id2);
		});

		it("should support custom prefix", () => {
			const id = generateShortId("test");
			expect(id).toMatch(/^test_/);
		});

		it("should generate shorter than UUIDs", () => {
			const uuid = generateUUID();
			const shortId = generateShortId();
			expect(shortId.length).toBeLessThan(uuid.length);
		});
	});

	describe("generateOAuthState()", () => {
		it("should generate unique OAuth states", () => {
			const state1 = generateOAuthState();
			const state2 = generateOAuthState();
			expect(state1).not.toBe(state2);
		});

		it("should generate UUID-like strings", () => {
			const state = generateOAuthState();
			expect(state.length).toBeGreaterThan(20);
		});
	});

	describe("integration with actual usage", () => {
		it("should work with clipboard file naming pattern", () => {
			const ext = "png";
			const uuid = generateUUID();
			const fileName = `pi-clipboard-${uuid}.${ext}`;
			expect(fileName).toMatch(
				/^pi-clipboard-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/i,
			);
		});

		it("should work with RPC request IDs", () => {
			const id = generateUUID();
			expect(id).toBeDefined();
			expect(typeof id).toBe("string");
			expect(id.length).toBe(36);
		});

		it("should work with custom provider IDs", () => {
			const providerId = generateUUID();
			expect(providerId).toBeDefined();
			expect(typeof providerId).toBe("string");
			expect(providerId.length).toBe(36);
		});

		it("should work with OAuth state parameters", () => {
			const state = generateOAuthState();
			expect(state).toBeDefined();
			expect(typeof state).toBe("string");
			expect(state.length).toBeGreaterThan(20);
		});
	});
});

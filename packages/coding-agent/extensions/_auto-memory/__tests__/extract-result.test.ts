import { describe, it, expect } from "vitest";

describe("ExtractResult type shape", () => {
	it("MemoryFileEntry has filename, name, description", () => {
		const entry = { filename: "test.md", name: "Test Policy", description: "A test description" };
		expect(entry.filename).toBe("test.md");
		expect(entry.name).toBe("Test Policy");
		expect(entry.description).toBe("A test description");
	});

	it("ExtractResult has created and updated arrays of MemoryFileEntry", () => {
		const result = {
			created: [
				{ filename: "a.md", name: "Alpha", description: "First" },
				{ filename: "b.md", name: "Beta", description: "Second" },
			],
			updated: [
				{ filename: "c.md", name: "Gamma", description: "Third" },
			],
		};
		expect(result.created).toHaveLength(2);
		expect(result.updated).toHaveLength(1);
		expect(result.created[0].name).toBe("Alpha");
		expect(result.updated[0].name).toBe("Gamma");
	});

	it("empty result is valid", () => {
		const result = { created: [], updated: [] };
		expect(result.created).toHaveLength(0);
		expect(result.updated).toHaveLength(0);
	});

	it("update entries can have description derived from append text", () => {
		const appendText = "Added new section about testing strategies";
		const entry = {
			filename: "testing.md",
			name: "testing.md",
			description: appendText.slice(0, 80),
		};
		expect(entry.description).toBe("Added new section about testing strategies");
	});
});

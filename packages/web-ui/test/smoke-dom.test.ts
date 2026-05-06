import { describe, expect, it } from "vitest";

describe("DOM environment", () => {
	it("has document available", () => {
		expect(document).toBeDefined();
		expect(document.createElement).toBeDefined();
	});

	it("has customElements available", () => {
		expect(customElements).toBeDefined();
		expect(customElements.define).toBeDefined();
	});

	it("has window available", () => {
		expect(window).toBeDefined();
	});
});

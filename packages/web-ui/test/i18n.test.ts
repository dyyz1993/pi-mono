import { describe, expect, it } from "vitest";

vi.mock("@mariozechner/mini-lit", () => ({
	defaultEnglish: {},
	defaultGerman: {},
	setTranslations: vi.fn(),
}));

vi.mock("@mariozechner/mini-lit/dist/i18n.js", () => ({
	i18n: (key: string) => key,
}));

import { translations } from "../src/utils/i18n.js";

describe("translations", () => {
	it("has en and de keys", () => {
		expect(translations).toHaveProperty("en");
		expect(translations).toHaveProperty("de");
	});

	it("english translations have required keys", () => {
		const en = translations.en;
		expect(en.Free).toBe("Free");
		expect(en.Cancel).toBe("Cancel");
		expect(en.Confirm).toBe("Confirm");
		expect(en.You).toBe("You");
		expect(en.Assistant).toBe("Assistant");
	});

	it("german translations have translated values", () => {
		const de = translations.de;
		expect(de.Free).toBe("Kostenlos");
		expect(de.Cancel).toBe("Abbrechen");
		expect(de.Confirm).toBe("Bestätigen");
		expect(de.You).toBe("Sie");
		expect(de.Assistant).toBe("Assistent");
	});

	it("has matching keys between en and de", () => {
		const enKeys = Object.keys(translations.en).sort();
		const deKeys = Object.keys(translations.de).sort();
		expect(deKeys).toEqual(enKeys);
	});

	it("has tool result strings", () => {
		expect(translations.en.Call).toBe("Call");
		expect(translations.en.Result).toBe("Result");
		expect(translations.en["(no result)"]).toBe("(no result)");
	});

	it("has file type labels", () => {
		expect(translations.en.PDF).toBe("PDF");
		expect(translations.en.Document).toBe("Document");
		expect(translations.en.Spreadsheet).toBe("Spreadsheet");
		expect(translations.en.Presentation).toBe("Presentation");
	});
});

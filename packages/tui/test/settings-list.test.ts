import assert from "node:assert";
import { describe, it } from "node:test";
import { type SettingItem, SettingsList, type SettingsListTheme } from "../src/components/settings-list.js";

function createTheme(): SettingsListTheme {
	return {
		label: (text, selected) => (selected ? `[*${text}*]` : text),
		value: (text, selected) => (selected ? `{${text}}` : text),
		description: (text) => `(${text})`,
		cursor: "> ",
		hint: (text) => `[hint: ${text}]`,
	};
}

function createItems(): SettingItem[] {
	return [
		{ id: "theme", label: "Theme", currentValue: "dark", values: ["dark", "light"] },
		{ id: "lang", label: "Language", currentValue: "en", values: ["en", "zh", "ja"] },
		{ id: "verbose", label: "Verbose", currentValue: "off", description: "Enable verbose logging output" },
	];
}

function createList(items: SettingItem[] = createItems(), opts: { enableSearch?: boolean } = {}): SettingsList {
	return new SettingsList(
		items,
		10,
		createTheme(),
		() => {},
		() => {},
		opts,
	);
}

describe("SettingsList", () => {
	describe("render", () => {
		it("renders items with labels and values", () => {
			const list = createList();
			const lines = list.render(80);
			const joined = lines.join("\n");
			assert.ok(joined.includes("Theme"), "should contain Theme label");
			assert.ok(joined.includes("dark"), "should contain dark value");
			assert.ok(joined.includes("Language"), "should contain Language label");
			assert.ok(joined.includes("en"), "should contain en value");
		});

		it("renders first item as selected", () => {
			const list = createList();
			const lines = list.render(80);
			const joined = lines.join("\n");
			assert.ok(joined.includes("> "), "selected item should have cursor prefix");
			assert.ok(joined.includes("[*"), "selected label should be styled");
			assert.ok(joined.includes("{dark}"), "selected value should be styled");
		});

		it("renders description for selected item", () => {
			const items = [{ id: "a", label: "A", currentValue: "val", description: "A description here" }];
			const list = createList(items);
			const lines = list.render(80);
			const joined = lines.join("\n");
			assert.ok(joined.includes("A description here"), "should contain description");
		});

		it("renders hint line", () => {
			const list = createList();
			const lines = list.render(80);
			const joined = lines.join("\n");
			assert.ok(joined.includes("Enter/Space"), "hint should mention Enter/Space");
			assert.ok(joined.includes("Esc"), "hint should mention Esc");
		});

		it("renders empty items list", () => {
			const list = createList([]);
			const lines = list.render(80);
			const joined = lines.join("\n");
			assert.ok(joined.includes("No settings available"), "should show empty message");
		});

		it("respects maxVisible for scrolling", () => {
			const items = Array.from({ length: 20 }, (_, i) => ({
				id: `item${i}`,
				label: `Item ${i}`,
				currentValue: `val${i}`,
			}));
			const list = new SettingsList(
				items,
				5,
				createTheme(),
				() => {},
				() => {},
			);
			const lines = list.render(80);
			const joined = lines.join("\n");
			assert.ok(joined.includes("1/20"), "should show scroll indicator");
		});

		it("shows search input when search enabled", () => {
			const list = createList(createItems(), { enableSearch: true });
			const lines = list.render(80);
			const joined = lines.join("\n");
			assert.ok(joined.includes("Type to search"), "hint should mention search");
		});

		it("shows no matching settings when search filters all out", () => {
			const list = createList(createItems(), { enableSearch: true });
			list.handleInput("zzzzz");
			const lines = list.render(80);
			const joined = lines.join("\n");
			assert.ok(joined.includes("No matching settings"), "should show no match message");
		});
	});

	describe("updateValue", () => {
		it("changes the correct item's value", () => {
			const items = createItems();
			const list = createList(items);
			list.updateValue("theme", "light");
			const lines = list.render(80);
			const joined = lines.join("\n");
			assert.ok(joined.includes("light"), "should show updated value");
			assert.ok(!joined.includes('Value: "dark"') || joined.includes("light"), "updated");
		});

		it("does nothing for unknown id", () => {
			const items = createItems();
			const list = createList(items);
			const before = list.render(80).join("\n");
			list.updateValue("nonexistent", "value");
			const after = list.render(80).join("\n");
			assert.strictEqual(before, after, "should not change for unknown id");
		});
	});

	describe("invalidate", () => {
		it("does not throw when no submenu is active", () => {
			const list = createList();
			assert.doesNotThrow(() => list.invalidate());
		});
	});
});

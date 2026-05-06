import { describe, expect, it } from "vitest";
import type { ChannelTypeRegistry } from "../../src/core/extensions/channel-registry.js";

describe("ChannelTypeRegistry", () => {
	it("should have bash channel entry", () => {
		type BashEntry = ChannelTypeRegistry["bash"];
		const _: BashEntry = {} as BashEntry;
		expect(_).toBeDefined();
	});

	it("should have todo channel entry", () => {
		type TodoEntry = ChannelTypeRegistry["todo"];
		const _: TodoEntry = {} as TodoEntry;
		expect(_).toBeDefined();
	});

	it("should have lsp channel entry", () => {
		type LspEntry = ChannelTypeRegistry["lsp"];
		const _: LspEntry = {} as LspEntry;
		expect(_).toBeDefined();
	});

	it("should have memory channel entry", () => {
		type MemoryEntry = ChannelTypeRegistry["memory"];
		const _: MemoryEntry = {} as MemoryEntry;
		expect(_).toBeDefined();
	});

	it("should have subagent channel entry", () => {
		type SubagentEntry = ChannelTypeRegistry["subagent"];
		const _: SubagentEntry = {} as SubagentEntry;
		expect(_).toBeDefined();
	});

	it("should have coordinator channel entry", () => {
		type CoordinatorEntry = ChannelTypeRegistry["coordinator"];
		const _: CoordinatorEntry = {} as CoordinatorEntry;
		expect(_).toBeDefined();
	});

	it("should have rules-engine channel entry", () => {
		type RulesEntry = ChannelTypeRegistry["rules-engine"];
		const _: RulesEntry = {} as RulesEntry;
		expect(_).toBeDefined();
	});

	it("should contain all expected channel names as keys", () => {
		const keys: Array<keyof ChannelTypeRegistry> = [
			"bash",
			"todo",
			"lsp",
			"memory",
			"subagent",
			"coordinator",
			"rules-engine",
		];
		expect(keys).toHaveLength(7);
	});
});

/**
 * Channel Type Registry
 *
 * Central registry mapping channel names to their typed contracts.
 * Consumers (TUI, IDE extensions) can look up channel types by name:
 *
 *   import type { ChannelTypeRegistry } from "@dyyz1993/pi-coding-agent";
 *   type BashMethods = ChannelTypeRegistry["bash"]["methods"];
 *   type BashEvents = ChannelTypeRegistry["bash"]["events"];
 */

import type { MemoryChannelContract } from "../../../extensions/auto-memory/contract.js";
import type { BashChannelContract } from "../../../extensions/bash-ext/contract.js";
import type { CoordinatorChannelContract } from "../../../extensions/coordinator/types.js";
import type { LspChannelContract } from "../../../extensions/lsp/lsp/contract.js";
import type { RulesChannelContract } from "../../../extensions/rules-engine/types.js";
import type { SupervisorChannelContract } from "../../../extensions/session-supervisor/types.js";
import type { SubagentExtChannelContract } from "../../../extensions/subagent-ext/contract.js";
import type { SubagentV2ChannelContract } from "../../../extensions/subagent-v2/contract.js";
import type { TodoChannelContract } from "../../../extensions/todo-ext/contract.js";

export interface ChannelTypeRegistry {
	bash: BashChannelContract;
	todo: TodoChannelContract;
	lsp: LspChannelContract;
	memory: MemoryChannelContract;
	subagent: SubagentExtChannelContract & SubagentV2ChannelContract;
	coordinator: CoordinatorChannelContract;
	"rules-engine": RulesChannelContract;
	supervisor: SupervisorChannelContract;
}

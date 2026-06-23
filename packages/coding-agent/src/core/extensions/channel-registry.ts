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

import type { MemoryChannelContract } from "../../../extensions/auto-memory/contract.ts";
import type { BashChannelContract } from "../../../extensions/bash-ext/contract.ts";
import type { CoordinatorChannelContract } from "../../../extensions/coordinator/types.ts";
import type { LspChannelContract } from "../../../extensions/lsp/contract.ts";
import type { RemoteSshChannelContract } from "../../../extensions/remote-ssh/contract.ts";
import type { RulesChannelContract } from "../../../extensions/rules-engine/types.ts";
import type { SupervisorChannelContract } from "../../../extensions/session-supervisor/types.ts";
import type { SubagentV2ChannelContract } from "../../../extensions/subagent-v2/contract.ts";
import type { TodoChannelContract } from "../../../extensions/todo-ext/contract.ts";

export interface ChannelTypeRegistry {
	bash: BashChannelContract;
	todo: TodoChannelContract;
	lsp: LspChannelContract;
	memory: MemoryChannelContract;
	subagent: SubagentV2ChannelContract;
	coordinator: CoordinatorChannelContract;
	"rules-engine": RulesChannelContract;
	supervisor: SupervisorChannelContract;
	"remote-ssh": RemoteSshChannelContract;
}

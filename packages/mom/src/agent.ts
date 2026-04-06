import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import { getModel, type ImageContent } from "@mariozechner/pi-ai";
import {
	AgentSession,
	AuthStorage,
	convertToLlm,
	createExtensionRuntime,
	formatSkillsForPrompt,
	loadSkillsFromDir,
	ModelRegistry,
	type ResourceLoader,
	SessionManager,
	type Skill,
} from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { createMomSettingsManager, syncLogToSessionManager } from "./context.js";
import * as log from "./log.js";
import { createExecutor, type SandboxConfig } from "./sandbox.js";
import { ReviewManager } from "./review-manager.js";
import type { ChannelInfo, SlackContext, UserInfo } from "./slack.js";
import type { ChannelStore } from "./store.js";
import { createMomTools, setUploadFunction } from "./tools/index.js";

// Hardcoded model for now - TODO: make configurable (issue #63)
const model = getModel("anthropic", "claude-sonnet-4-5");

export interface PendingMessage {
	userName: string;
	text: string;
	attachments: { local: string }[];
	timestamp: number;
}

export interface AgentRunner {
	run(
		ctx: SlackContext,
		store: ChannelStore,
		pendingMessages?: PendingMessage[],
	): Promise<{ stopReason: string; errorMessage?: string }>;
	abort(): void;
}
